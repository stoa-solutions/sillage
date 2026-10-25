import Foundation

public struct HTTPClient: Sendable {
  public init() {}
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
    let (data, response) = try await URLSession.shared.data(for: request)
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
  public func searchPage(_ connection: Connection, query: String, offset: Int = 0,
                         limit: Int = 50) async throws -> LibrarySearchPage {
    let object = try await server(
      connection, path: "search",
      body: ["query": query, "mode": "text", "sort": "relevance", "offset": offset, "limit": limit])
    let videos = (object["results"] as? [[String: Any]] ?? []).compactMap {
      $0["video"] as? [String: Any]
    }
    let tracks = try Catalog.parse(JSONSerialization.data(withJSONObject: ["videos": videos]))
    return LibrarySearchPage(tracks: tracks, total: object["total"] as? Int ?? tracks.count)
  }

}
