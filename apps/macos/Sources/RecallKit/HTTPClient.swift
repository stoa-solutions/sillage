import Foundation

public struct HTTPServiceError: LocalizedError, Sendable {
  public let status: Int
  public let message: String
  public var errorDescription: String? { message }
}

public struct HTTPClient: Sendable {
  public init() {}
  private static let session = URLSession(configuration: .ephemeral)
  /// Network failures in the person's words; system messages are English and technical.
  /// Cancellation passes through untouched so callers can ignore it.
  public static func transportError(_ error: Error) -> Error {
    if error is CancellationError { return error }
    let code = (error as? URLError)?.code
    if code == .cancelled { return error }
    if code == .timedOut {
      return RecallError.message(
        "Le serveur met trop de temps à répondre. Réessaie dans un instant.")
    }
    return RecallError.message(
      "Connexion au serveur impossible. Vérifie ta connexion Internet, puis réessaie.")
  }

  public func json(
    url: URL, method: String? = nil, body: Any? = nil, headers: [String: String] = [:]
  ) async throws
    -> [String: Any]
  {
    var request = URLRequest(url: url, timeoutInterval: 90)
    request.httpMethod = method ?? (body == nil ? "GET" : "POST")
    for (name, value) in headers { request.setValue(value, forHTTPHeaderField: name) }
    if let body {
      request.httpBody = try JSONSerialization.data(withJSONObject: body)
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    }
    let (data, response): (Data, URLResponse)
    do {
      (data, response) = try await Self.session.data(for: request)
    } catch {
      throw Self.transportError(error)
    }
    guard let http = response as? HTTPURLResponse else {
      throw RecallError.message("Réponse réseau invalide.")
    }
    guard (200..<300).contains(http.statusCode) else {
      // Never return a raw provider body: it may contain credentials or private request data.
      let message =
        http.statusCode == 429
        ? "Quota atteint ou IA occupée. Vérifie le quota du projet Google."
        : "Le service ne répond pas (\(http.statusCode)). Vérifie les réglages."
      // Own server routes return bounded user-facing errors, never raw Google payloads.
      let serverError =
        headers["Authorization"]?.hasPrefix("Bearer ") == true
        ? (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
        : nil
      throw HTTPServiceError(
        status: http.statusCode, message: serverError.map { String($0.prefix(350)) } ?? message)
    }
    guard data.count <= 45 * 1024 * 1024,
      let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { throw RecallError.message("Réponse trop volumineuse ou illisible.") }
    return object
  }
  public func server(
    _ connection: Connection, path: String, method: String? = nil, body: Any? = nil
  ) async throws
    -> [String: Any]
  {
    try await json(
      url: URL(string: connection.url + "/v1/" + path)!, method: method, body: body,
      headers: ["Authorization": "Bearer " + connection.token])
  }
  /// Sends finished plays; the server ignores events it already has.
  public func recordHistory(_ connection: Connection, _ events: [ListeningEvent]) async throws {
    _ = try await server(connection, path: "history", body: ["events": events.map(\.payload)])
  }
  /// A page of the account's history, newest first; pass the last play to read further back.
  public func history(_ connection: Connection, limit: Int = 50, after last: ListenedTrack? = nil)
    async throws -> [ListenedTrack]
  {
    var path = "history?limit=\(limit)"
    if let last {
      let date = ListeningEvent.format.string(from: last.playedAt)
      path += "&before=\(date)&beforeId=\(last.id.uuidString.lowercased())"
    }
    return ListenedTrack.page(try await server(connection, path: path))
  }
  public func clearHistory(_ connection: Connection) async throws {
    _ = try await server(connection, path: "history", method: "DELETE")
  }
  /// Removes a playlist from this account only; YouTube is never changed.
  public func deletePlaylist(_ connection: Connection, id: String) async throws {
    let encoded = id.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? id
    _ = try await server(connection, path: "playlists/" + encoded, method: "DELETE")
  }
  public func lyrics(_ connection: Connection, videoId: String) async throws -> Lyrics {
    try Lyrics.decode(await server(connection, path: "lyrics/" + videoId))
  }
  public func setLyricsOffset(_ connection: Connection, videoId: String, offsetMs: Int)
    async throws
  {
    _ = try await server(connection, path: "lyrics/\(videoId)/offset", body: ["offsetMs": offsetMs])
  }
  public func search(_ connection: Connection, query: String) async throws -> [Track] {
    try await searchPage(connection, query: query).tracks
  }
  public func searchPage(
    _ connection: Connection, query: String, offset: Int = 0,
    limit: Int = 50, playlist: String? = nil, excludeIds: [String] = []
  ) async throws -> LibrarySearchPage {
    var body: [String: Any] = [
      "query": query, "mode": "text", "sort": query.isEmpty ? "position" : "relevance",
      "offset": offset, "limit": limit,
    ]
    if let playlist { body["playlistId"] = playlist }
    if !excludeIds.isEmpty { body["excludeIds"] = Array(excludeIds.prefix(100)) }
    let object = try await server(connection, path: "search", body: body)
    let videos = (object["results"] as? [[String: Any]] ?? []).compactMap {
      $0["video"] as? [String: Any]
    }
    let tracks = try Catalog.parse(JSONSerialization.data(withJSONObject: ["videos": videos]))
    return LibrarySearchPage(tracks: tracks, total: object["total"] as? Int ?? tracks.count)
  }
  public func libraryOverview(_ connection: Connection) async throws -> ServerLibraryOverview {
    let status = try await server(connection, path: "status")
    let collections = try await server(connection, path: "playlists")
    return try ServerLibraryOverview(status: status, collections: collections)
  }

}
/// One page of server search results and the total number of matches.
public struct LibrarySearchPage: Sendable {
  public let tracks: [Track]
  public let total: Int
  public init(tracks: [Track], total: Int) {
    self.tracks = tracks
    self.total = total
  }
}
