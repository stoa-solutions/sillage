import Foundation

public enum YouTubePlaylistLink {
  public static func id(from text: String) throws -> String {
    let raw = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let url = URLComponents(string: raw), url.scheme == "https",
      ["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"].contains(
        url.host?.lowercased() ?? ""),
      url.user == nil, url.password == nil, url.port == nil,
      ["/playlist", "/watch"].contains(url.path),
      let id = url.queryItems?.first(where: { $0.name == "list" })?.value,
      id.range(of: "^[A-Za-z0-9_-]{10,150}$", options: .regularExpression) != nil
    else { throw RecallError.message("Colle un lien HTTPS de playlist YouTube contenant list=…") }
    return id
  }
}
private final class NoRedirect: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
  func urlSession(
    _ session: URLSession, task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
    completionHandler: @escaping (URLRequest?) -> Void
  ) { completionHandler(nil) }
}
public struct YouTubePlaylistImporter: Sendable {
  public typealias Fetch = @Sendable (URLRequest) async throws -> (Data, HTTPURLResponse)
  private let fetch: Fetch
  private let directory: URL
  private let resumeWindow: TimeInterval
  /// A checkpoint older than `resumeWindow` restarts the import: YouTube page tokens describe
  /// the playlist as it was, and mixing old and new pages shifts positions.
  public init(directory: URL, resumeWindow: TimeInterval = 24 * 3600, fetch: Fetch? = nil) {
    self.directory = directory
    self.resumeWindow = resumeWindow
    self.fetch =
      fetch ?? { request in
        let session = URLSession(
          configuration: .ephemeral, delegate: NoRedirect(), delegateQueue: nil)
        defer { session.finishTasksAndInvalidate() }
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
          throw RecallError.message("Réponse YouTube invalide.")
        }
        return (data, http)
      }
  }
  private struct Checkpoint: Codable {
    var title: String
    var startedAt: Date? = Date()
    var tracks: [Track] = []
    var ids: [String] = []
    var next: String = ""
    var pages: [String] = []
    var count = 0
    var skipped = 0
    var complete = false
  }
  public struct Result: Sendable {
    public let document: LibraryDocument
    public let skipped: Int
    public let resumed: Bool
  }
  public func load(
    link: String, key: String,
    progress: @MainActor @Sendable (Int) async -> Void = { _ in }
  ) async throws -> Result {
    let id = try YouTubePlaylistLink.id(from: link)
    guard (20...256).contains(key.count) else {
      throw RecallError.message(
        "Ajoute ta clé YouTube dans Réglages. Elle est distincte de la clé Gemini.")
    }
    try FileManager.default.createDirectory(
      at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    let file = directory.appendingPathComponent(id + ".json")
    var saved: Checkpoint?
    if FileManager.default.fileExists(atPath: file.path) {
      let data = try Data(contentsOf: file)
      guard data.count < 40 * 1024 * 1024 else {
        throw RecallError.message("Import en attente trop volumineux.")
      }
      // Unreadable, legacy or expired checkpoints restart from the first page.
      let decoded = try? JSONDecoder().decode(Checkpoint.self, from: data)
      if let started = decoded?.startedAt, Date().timeIntervalSince(started) < resumeWindow {
        saved = decoded
      } else {
        try FileManager.default.removeItem(at: file)
      }
    }
    let resumed = saved != nil
    var checkpoint: Checkpoint
    if let saved {
      checkpoint = saved
    } else {
      let info = try await get("playlists", params: ["part": "snippet", "id": id], key: key)
      guard let item = (info["items"] as? [[String: Any]])?.first,
        let snippet = item["snippet"] as? [String: Any], let title = snippet["title"] as? String
      else {
        throw RecallError.message(
          "Playlist introuvable ou privée. Commence par une playlist publique ou non répertoriée.")
      }
      checkpoint = Checkpoint(title: String(title.prefix(1000)))
    }
    while !checkpoint.complete {
      try Task.checkCancellation()
      guard !checkpoint.pages.contains(checkpoint.next), checkpoint.pages.count < 1000 else {
        throw RecallError.message("Pagination YouTube incohérente ou playlist trop grande.")
      }
      var params = ["part": "snippet,contentDetails", "playlistId": id, "maxResults": "50"]
      if !checkpoint.next.isEmpty { params["pageToken"] = checkpoint.next }
      let page = try await get("playlistItems", params: params, key: key)
      guard let items = page["items"] as? [[String: Any]], items.count <= 50 else {
        throw RecallError.message("Page YouTube invalide.")
      }
      checkpoint.pages.append(checkpoint.next)
      for row in items {
        checkpoint.count += 1
        guard checkpoint.count <= 50_000 else {
          throw RecallError.message("Maximum 50 000 entrées par playlist.")
        }
        let snippet = row["snippet"] as? [String: Any] ?? [:]
        let details = row["contentDetails"] as? [String: Any] ?? [:]
        guard let video = details["videoId"] as? String,
          video.range(of: "^[A-Za-z0-9_-]{11}$", options: .regularExpression) != nil,
          let title = snippet["title"] as? String, !title.isEmpty,
          !["Private video", "Deleted video"].contains(title)
        else {
          checkpoint.skipped += 1
          continue
        }
        checkpoint.ids.append(video)
        checkpoint.tracks.append(
          Track(
            id: video, title: String(title.prefix(1000)),
            channel: snippet["videoOwnerChannelTitle"] as? String,
            description: String((snippet["description"] as? String ?? "").prefix(10000))))
      }
      checkpoint.next = page["nextPageToken"] as? String ?? ""
      checkpoint.complete = checkpoint.next.isEmpty
      let encoded = try JSONEncoder().encode(checkpoint)
      guard encoded.count < 40 * 1024 * 1024 else {
        throw RecallError.message("Playlist trop volumineuse pour cet import (40 Mo maximum).")
      }
      try encoded.write(to: file, options: .atomic)
      try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
      await progress(checkpoint.count)
    }
    try Task.checkCancellation()
    var seen = Set<String>()
    let tracks = checkpoint.tracks.filter { seen.insert($0.id).inserted }
    return Result(
      document: LibraryDocument(
        tracks: tracks,
        playlists: [
          LibraryPlaylist(
            id: id, title: checkpoint.title,
            url: "https://www.youtube.com/playlist?list=" + id, videoIDs: checkpoint.ids)
        ]), skipped: checkpoint.skipped, resumed: resumed)
  }
  public func finish(link: String) throws {
    let file = directory.appendingPathComponent(try YouTubePlaylistLink.id(from: link) + ".json")
    if FileManager.default.fileExists(atPath: file.path) {
      try FileManager.default.removeItem(at: file)
    }
  }
  private func get(_ endpoint: String, params: [String: String], key: String) async throws
    -> [String: Any]
  {
    var url = URLComponents(string: "https://www.googleapis.com/youtube/v3/" + endpoint)!
    url.queryItems = params.sorted { $0.key < $1.key }.map {
      URLQueryItem(name: $0.key, value: $0.value)
    }
    var request = URLRequest(url: url.url!, timeoutInterval: 30)
    request.setValue(key, forHTTPHeaderField: "X-Goog-Api-Key")
    let (data, response) = try await fetch(request)
    guard (200..<300).contains(response.statusCode) else {
      if response.statusCode == 403 || response.statusCode == 429 {
        throw RecallError.message(
          "YouTube refuse l’accès : vérifie la clé, l’activation de YouTube Data API et le quota. L’import reste reprenable."
        )
      }
      throw RecallError.message(
        "Playlist inaccessible ou erreur YouTube (\(response.statusCode)). Réessaie avec le même lien."
      )
    }
    guard data.count < 4 * 1024 * 1024,
      let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { throw RecallError.message("Réponse YouTube illisible.") }
    return object
  }
}
