import Foundation

public enum DiscoveryScope: String, CaseIterable, Identifiable, Codable, Sendable {
  case all, youtube, library
  public var id: Self { self }
  public var title: String {
    switch self {
    case .all: "Partout"
    case .youtube: "YouTube"
    case .library: "Mes playlists"
    }
  }
}
public struct DiscoveryItem: Codable, Identifiable, Sendable {
  public let video: Track
  public let inLibrary: Bool
  public var id: String { video.id }
  public init(video: Track, inLibrary: Bool) {
    self.video = video
    self.inLibrary = inLibrary
  }
  private enum CodingKeys: String, CodingKey { case video, inLibrary }
  public init(from decoder: Decoder) throws {
    let values = try decoder.container(keyedBy: CodingKeys.self)
    video = try values.decode(Track.self, forKey: .video)
    inLibrary = try values.decode(Bool.self, forKey: .inLibrary)
    guard video.id.range(of: "^[A-Za-z0-9_-]{11}$", options: .regularExpression) != nil else {
      throw DecodingError.dataCorruptedError(
        forKey: .video, in: values, debugDescription: "Invalid video ID")
    }
  }
}
public struct DiscoveryPage: Decodable, Sendable {
  public let results: [DiscoveryItem]
  public let nextPageToken: String?
}
public struct DiscoverySuggestion: Decodable, Identifiable, Sendable {
  public let video: Track
  public let inLibrary: Bool
  public let reason: String
  /// The discovered artist, when the suggestion comes from a listening neighbour.
  public let artist: String?
  public var id: String { video.id }
  public var item: DiscoveryItem { DiscoveryItem(video: video, inLibrary: inLibrary) }
}
/// One shelf of « Pour toi »: neighbours of a favourite artist, a genre, or new tracks of
/// the listener's own artists.
public struct DiscoverySection: Decodable, Identifiable, Sendable {
  public let id: String
  public let kind: String
  public let title: String
  public let reason: String
  public let items: [DiscoverySuggestion]
}
public struct DiscoveryHome: Decodable, Sendable {
  public let sections: [DiscoverySection]
  public let suggestions: [DiscoverySuggestion]
  public let basedOn: [String]
  /// The listener's own genres, for the « envies » shortcuts.
  public let ideas: [String]
  /// The listener's precise genres and starting artists, to explore next.
  public let scenes: [String]
  public let artists: [String]
  public let notice: String?
  public let emptyReason: String?
  private enum CodingKeys: String, CodingKey {
    case sections, suggestions, basedOn, ideas, scenes, artists, notice, emptyReason
  }
  public init(from decoder: Decoder) throws {
    let values = try decoder.container(keyedBy: CodingKeys.self)
    suggestions = try values.decode([DiscoverySuggestion].self, forKey: .suggestions)
    // A server from before the shelves sends one flat list: it becomes one shelf.
    sections =
      try values.decodeIfPresent([DiscoverySection].self, forKey: .sections)
      ?? (suggestions.isEmpty
        ? []
        : [
          DiscoverySection(
            id: "suggestions", kind: "artists", title: "Selon tes écoutes", reason: "",
            items: suggestions)
        ])
    basedOn = try values.decodeIfPresent([String].self, forKey: .basedOn) ?? []
    ideas = try values.decodeIfPresent([String].self, forKey: .ideas) ?? []
    scenes = try values.decodeIfPresent([String].self, forKey: .scenes) ?? []
    artists = try values.decodeIfPresent([String].self, forKey: .artists) ?? []
    notice = try values.decodeIfPresent(String.self, forKey: .notice)
    emptyReason = try values.decodeIfPresent(String.self, forKey: .emptyReason)
  }
}
public struct AICheck: Decodable, Sendable {
  public let ok: Bool
  public let voice: Bool
  public let message: String
}
extension HTTPClient {
  /// `refresh` asks the server for other neighbours instead of the page it keeps.
  public func discoveryHome(_ connection: Connection, refresh: Bool = false) async throws
    -> DiscoveryHome
  {
    let object = try await server(
      connection, path: refresh ? "discover/home?refresh=true" : "discover/home")
    return try JSONDecoder().decode(
      DiscoveryHome.self, from: JSONSerialization.data(withJSONObject: object))
  }
  /// A scene (`genre`) or the world around an artist (`name`), shaped like « Pour toi ».
  public func discoveryPage(
    _ connection: Connection, scene: String? = nil, artist: String? = nil, refresh: Bool = false
  ) async throws -> DiscoveryHome {
    var query = URLComponents()
    query.queryItems =
      (scene.map { [URLQueryItem(name: "genre", value: $0)] } ?? [])
      + (artist.map { [URLQueryItem(name: "name", value: $0)] } ?? [])
      + (refresh ? [URLQueryItem(name: "refresh", value: "true")] : [])
    // « + » and « & » stay part of a name such as « Florence + the Machine ».
    let encoded = (query.percentEncodedQuery ?? "").replacingOccurrences(of: "+", with: "%2B")
    let object = try await server(
      connection, path: (scene != nil ? "discover/scene?" : "discover/artist?") + encoded)
    return try JSONDecoder().decode(
      DiscoveryHome.self, from: JSONSerialization.data(withJSONObject: object))
  }
  public func discover(_ connection: Connection, query: String, pageToken: String = "") async throws
    -> DiscoveryPage
  {
    let object = try await server(
      connection, path: "discover/search", body: ["query": query, "pageToken": pageToken])
    return try JSONDecoder().decode(
      DiscoveryPage.self, from: JSONSerialization.data(withJSONObject: object))
  }
  public func addDiscovery(_ connection: Connection, id: String) async throws {
    guard id.range(of: "^[A-Za-z0-9_-]{11}$", options: .regularExpression) != nil else {
      throw SillageError.message("Vidéo invalide.")
    }
    _ = try await server(connection, path: "discover/add", body: ["videoId": id])
  }
  public func checkAI(
    _ connection: Connection, provider: AIProvider, model: String, key: String? = nil,
    voice: Bool = false
  ) async throws -> AICheck {
    var body: [String: Any] = [
      "provider": provider.rawValue, "model": model, "voice": voice && provider == .google,
    ]
    if let key { body["apiKey"] = key }
    let object = try await server(connection, path: "dj/check", body: body)
    return try JSONDecoder().decode(
      AICheck.self, from: JSONSerialization.data(withJSONObject: object))
  }
}

/// One of the listener's own songs by an artist, with how often they played it.
public struct OwnedTrack: Decodable, Identifiable, Sendable {
  public let video: Track
  public let plays: Int
  public var id: String { video.id }
}
private struct OwnedTracks: Decodable { let tracks: [OwnedTrack] }

extension HTTPClient {
  /// The artist's songs already in the library, most played first.
  public func artistInLibrary(_ connection: Connection, name: String) async throws -> [OwnedTrack] {
    var query = URLComponents()
    query.queryItems = [URLQueryItem(name: "name", value: name)]
    let encoded = (query.percentEncodedQuery ?? "").replacingOccurrences(of: "+", with: "%2B")
    let object = try await server(connection, path: "discover/artist/library?" + encoded)
    return try JSONDecoder().decode(
      OwnedTracks.self, from: JSONSerialization.data(withJSONObject: object)
    ).tracks
  }
}
