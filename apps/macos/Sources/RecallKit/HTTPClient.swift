import Foundation

public struct HTTPClient: Sendable {
  public init() {}
  private static let session = URLSession(configuration: .ephemeral)
  public func json(url: URL, body: Any? = nil, headers: [String: String] = [:]) async throws
    -> [String: Any]
  {
    var request = URLRequest(url: url, timeoutInterval: 90)
    request.httpMethod = body == nil ? "GET" : "POST"
    for (name, value) in headers { request.setValue(value, forHTTPHeaderField: name) }
    if let body {
      request.httpBody = try JSONSerialization.data(withJSONObject: body)
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    }
    let (data, response) = try await Self.session.data(for: request)
    guard let http = response as? HTTPURLResponse else {
      throw RecallError.message("Réponse réseau invalide.")
    }
    guard (200..<300).contains(http.statusCode) else {
      // Never return a raw provider body: it may contain credentials or private request data.
      let message =
        http.statusCode == 429
        ? "Quota atteint ou IA occupée. Vérifie le quota du projet Google."
        : "Le service ne répond pas (\(http.statusCode)). Vérifie les réglages."
      throw RecallError.message(message)
    }
    guard data.count <= 45 * 1024 * 1024,
      let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { throw RecallError.message("Réponse trop volumineuse ou illisible.") }
    return object
  }
  public func server(_ connection: Connection, path: String, body: Any? = nil) async throws
    -> [String: Any]
  {
    try await json(
      url: URL(string: connection.url + "/v1/" + path)!, body: body,
      headers: ["Authorization": "Bearer " + connection.token])
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
