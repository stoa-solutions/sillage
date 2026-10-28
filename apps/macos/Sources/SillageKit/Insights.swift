import Combine
import Foundation

/// An artist's page as the server gathers it: YouTube Music, MusicBrainz and Wikipedia.
public struct ArtistProfile: Decodable, Equatable, Sendable {
  public struct Bio: Decodable, Equatable, Sendable {
    public let text: String
    public let source: String
    public let url: URL?
  }
  public struct Release: Decodable, Equatable, Identifiable, Sendable {
    public let browseId: String
    public let title: String
    public let kind: String
    public let year: String?
    public let artwork: URL?
    public var id: String { browseId }
    public var url: URL? { URL(string: "https://music.youtube.com/browse/\(browseId)") }
  }
  public struct Related: Decodable, Equatable, Identifiable, Sendable {
    public let name: String
    public let portrait: URL?
    public var id: String { name }
  }
  public struct Links: Decodable, Equatable, Sendable {
    public let youtubeMusic: URL?
    public let wikipedia: URL?
    public let musicbrainz: URL?
  }
  public let name: String
  public let description: String?
  public let bio: Bio?
  public let banner: URL?
  public let portrait: URL?
  public let photo: URL?
  public let audience: String?
  public let kind: String?
  public let origin: String?
  public let active: String?
  public let genres: [String]
  public let releases: [Release]
  public let related: [Related]
  public let links: Links
  public let found: Bool
  /// « Groupe · Aberdeen, United States · 1987 – 1994 »
  public var facts: String {
    [kind, origin, active].compactMap { $0 }.joined(separator: " · ")
  }
  /// The bio's first sentence or two, for a card that must stay small.
  public var teaser: String? {
    guard let text = bio?.text else { return description }
    var sentences: [String] = []
    text.enumerateSubstrings(in: text.startIndex..., options: .bySentences) { sentence, _, _, stop in
      guard let sentence else { return }
      let joined = (sentences + [sentence]).joined()
      if !sentences.isEmpty && (sentences.count == 2 || joined.count > 180) {
        stop = true
        return
      }
      sentences.append(sentence)
    }
    return sentences.joined().trimmingCharacters(in: .whitespacesAndNewlines)
  }
}

/// What people make of a video, and the song's own article when there is one.
public struct VideoInsights: Decodable, Equatable, Sendable {
  public struct Comment: Decodable, Equatable, Identifiable, Sendable {
    public let author: String
    public let text: String
    public let likes: Int
    public let publishedAt: String?
    public var id: String { author + String(text.prefix(40)) }
  }
  public struct Song: Decodable, Equatable, Sendable {
    public let title: String
    public let description: String?
    public let text: String
    public let url: URL
  }
  public let views: Int?
  public let likes: Int?
  public let commentCount: Int?
  public let comments: [Comment]
  public let song: Song?
}

/// « 1,9 Md », « 12 M », « 4,2 k »: counts as people say them.
public func compactCount(_ value: Int) -> String {
  let units: [(Double, String)] = [(1e9, " Md"), (1e6, " M"), (1e3, " k")]
  for (size, unit) in units where Double(value) >= size {
    let scaled = Double(value) / size
    let digits = scaled < 10 ? 1 : 0
    let formatter = NumberFormatter()
    formatter.locale = Locale(identifier: "fr_FR")
    formatter.maximumFractionDigits = digits
    return (formatter.string(from: NSNumber(value: scaled)) ?? "\(Int(scaled))") + unit
  }
  return "\(value)"
}

extension HTTPClient {
  private static func query(_ items: [URLQueryItem]) -> String {
    var components = URLComponents()
    components.queryItems = items
    // « + » and « & » stay part of a name such as « Florence + the Machine ».
    return (components.percentEncodedQuery ?? "").replacingOccurrences(of: "+", with: "%2B")
  }
  public func artistProfile(_ connection: Connection, name: String) async throws -> ArtistProfile {
    let object = try await server(
      connection, path: "insights/artist?" + Self.query([URLQueryItem(name: "name", value: name)]))
    return try JSONDecoder().decode(
      ArtistProfile.self, from: JSONSerialization.data(withJSONObject: object))
  }
  public func videoInsights(
    _ connection: Connection, videoId: String, artist: String?, title: String?
  ) async throws -> VideoInsights {
    guard videoId.range(of: "^[A-Za-z0-9_-]{11}$", options: .regularExpression) != nil else {
      throw SillageError.message("Vidéo invalide.")
    }
    let items =
      (artist.map { [URLQueryItem(name: "artist", value: $0)] } ?? [])
      + (title.map { [URLQueryItem(name: "title", value: $0)] } ?? [])
    let object = try await server(
      connection, path: "insights/video/\(videoId)" + (items.isEmpty ? "" : "?" + Self.query(items)))
    return try JSONDecoder().decode(
      VideoInsights.self, from: JSONSerialization.data(withJSONObject: object))
  }
}

/// Artist pages and video reactions, each asked once per session and shared by every view:
/// the Studio card, the « Le morceau » tab and Découvrir read the same answers.
@MainActor
public final class InsightsModel: ObservableObject {
  @Published public private(set) var artists: [String: ArtistProfile] = [:]
  @Published public private(set) var videos: [String: VideoInsights] = [:]
  @Published public private(set) var failed: Set<String> = []
  private var running: [String: Task<Void, Never>] = [:]
  private var account: Connection?
  private let fetchArtist: (Connection, String) async throws -> ArtistProfile
  private let fetchVideo: (Connection, String, String?, String?) async throws -> VideoInsights

  public init(
    fetchArtist: @escaping (Connection, String) async throws -> ArtistProfile = {
      try await HTTPClient().artistProfile($0, name: $1)
    },
    fetchVideo: @escaping (Connection, String, String?, String?) async throws -> VideoInsights = {
      try await HTTPClient().videoInsights($0, videoId: $1, artist: $2, title: $3)
    }
  ) {
    self.fetchArtist = fetchArtist
    self.fetchVideo = fetchVideo
  }

  private static func key(_ name: String) -> String {
    name.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: nil)
      .trimmingCharacters(in: .whitespaces)
  }
  public func artist(_ name: String) -> ArtistProfile? { artists[Self.key(name)] }
  public func video(_ id: String) -> VideoInsights? { videos[id] }
  public func loading(artist name: String) -> Bool { running["artist:" + Self.key(name)] != nil }
  public func loading(video id: String) -> Bool { running["video:" + id] != nil }
  public func didFail(artist name: String) -> Bool { failed.contains("artist:" + Self.key(name)) }
  public func didFail(video id: String) -> Bool { failed.contains("video:" + id) }

  /// Another account sees other answers in flight; kept answers are public and stay.
  private func use(_ connection: Connection) {
    guard account?.url != connection.url || account?.token != connection.token else { return }
    account = connection
    running.values.forEach { $0.cancel() }
    running = [:]
    failed = []
  }

  public func loadArtist(_ name: String, connection: Connection?, retry: Bool = false) {
    let name = name.trimmingCharacters(in: .whitespaces)
    guard let connection, !name.isEmpty else { return }
    use(connection)
    let key = Self.key(name), job = "artist:" + key
    guard artists[key] == nil, running[job] == nil, retry || !failed.contains(job) else { return }
    failed.remove(job)
    running[job] = Task { [fetchArtist] in
      let result = try? await fetchArtist(connection, name)
      guard !Task.isCancelled else { return }
      if let result { self.artists[key] = result } else { self.failed.insert(job) }
      self.running[job] = nil
    }
  }

  public func loadVideo(
    _ id: String, artist: String?, title: String?, connection: Connection?, retry: Bool = false
  ) {
    guard let connection else { return }
    use(connection)
    let job = "video:" + id
    guard videos[id] == nil, running[job] == nil, retry || !failed.contains(job) else { return }
    failed.remove(job)
    running[job] = Task { [fetchVideo] in
      let result = try? await fetchVideo(connection, id, artist, title)
      guard !Task.isCancelled else { return }
      if let result { self.videos[id] = result } else { self.failed.insert(job) }
      self.running[job] = nil
    }
  }
}

/// An album or single from YouTube Music, its tracks marked when the library has them.
public struct Album: Decodable, Equatable, Sendable {
  public struct Entry: Decodable, Equatable, Identifiable, Sendable {
    public let videoId: String
    public let title: String
    public let position: Int
    public let durationSeconds: Int?
    public let plays: String?
    public let inLibrary: Bool
    public var id: String { videoId }
  }
  public let browseId: String
  public let title: String
  public let artist: String?
  public let kind: String
  public let year: String?
  public let summary: String?
  public let description: String?
  public let artwork: URL?
  public let tracks: [Entry]
  public var url: URL? { URL(string: "https://music.youtube.com/browse/\(browseId)") }
  /// A track as the player knows it; the « Artist - Topic » channel credits the album's artist.
  public func track(_ entry: Entry) -> Track {
    Track(
      id: entry.videoId, title: entry.title, channel: artist.map { "\($0) - Topic" },
      durationSeconds: entry.durationSeconds.map(Double.init))
  }
}

/// An artist suggested by YouTube Music for what is typed.
public struct ArtistHit: Decodable, Equatable, Identifiable, Sendable {
  public let browseId: String
  public let name: String
  public let portrait: URL?
  public let audience: String?
  public var id: String { browseId }
}

/// An artist of the library: songs, the account's plays, and its most played song's cover.
public struct LibraryArtist: Decodable, Equatable, Identifiable, Sendable {
  public let name: String
  public let tracks: Int
  public let plays: Int
  public let coverVideoId: String
  public let cover: URL?
  public var id: String { name }
}

private struct ArtistHits: Decodable { let artists: [ArtistHit] }
private struct LibraryArtists: Decodable { let artists: [LibraryArtist] }

extension HTTPClient {
  public func album(_ connection: Connection, browseId: String) async throws -> Album {
    guard browseId.range(of: "^MPRE[A-Za-z0-9_-]{5,40}$", options: .regularExpression) != nil
    else { throw SillageError.message("Album invalide.") }
    let object = try await server(connection, path: "insights/album/\(browseId)")
    return try JSONDecoder().decode(Album.self, from: JSONSerialization.data(withJSONObject: object))
  }
  public func searchArtists(_ connection: Connection, query: String) async throws -> [ArtistHit] {
    var components = URLComponents()
    components.queryItems = [URLQueryItem(name: "query", value: query)]
    let encoded = (components.percentEncodedQuery ?? "").replacingOccurrences(of: "+", with: "%2B")
    let object = try await server(connection, path: "insights/artists?" + encoded)
    return try JSONDecoder().decode(
      ArtistHits.self, from: JSONSerialization.data(withJSONObject: object)
    ).artists
  }
  public func libraryArtists(_ connection: Connection) async throws -> [LibraryArtist] {
    let object = try await server(connection, path: "discover/artists")
    return try JSONDecoder().decode(
      LibraryArtists.self, from: JSONSerialization.data(withJSONObject: object)
    ).artists
  }
}
