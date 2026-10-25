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
  /// Supplement MCP's short list from server pages, including when earlier tracks are queued.
  public func djCandidates(_ connection: Connection, query: String, excluded: Set<String>)
    async throws -> [Track]
  {
    let primary = try await mcpSearch(connection, query: query)
    var seen = Set<String>()
    var tracks = primary.filter { !excluded.contains($0.id) && seen.insert($0.id).inserted }
    for offset in stride(from: 0, to: 300, by: 100) {
      let page = try await searchPage(connection, query: query, offset: offset, limit: 100)
      tracks += page.tracks.filter { !excluded.contains($0.id) && seen.insert($0.id).inserted }
      if tracks.count >= 30 || offset + 100 >= page.total { break }
    }
    return Array(tracks.prefix(80))
  }
  public func mcpSearch(_ connection: Connection, query: String, includeQueued: Bool = false)
    async throws -> [Track]
  {
    let endpoint = URL(string: connection.url + "/v1/mcp")!
    let headers = [
      "Authorization": "Bearer " + connection.token,
      "Accept": "application/json, text/event-stream", "MCP-Protocol-Version": "2025-03-26",
    ]
    let initialized = try await json(
      url: endpoint,
      body: [
        "jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": [
          "protocolVersion": "2025-03-26", "capabilities": [:],
          "clientInfo": ["name": "recall-macos", "version": "1.0.0"],
        ],
      ], headers: headers)
    guard initialized["result"] != nil else {
      throw RecallError.message("Le serveur MCP n’a pas accepté la connexion.")
    }
    let response = try await json(
      url: endpoint,
      body: [
        "jsonrpc": "2.0", "id": 2, "method": "tools/call",
        "params": [
          "name": "library_search", "arguments": ["query": query, "includeQueued": includeQueued],
        ],
      ], headers: headers)
    guard let result = response["result"] as? [String: Any], result["isError"] as? Bool != true,
      let content = result["content"] as? [[String: Any]],
      let text = content.first?["text"] as? String,
      let data = text.data(using: .utf8),
      let catalog = try JSONSerialization.jsonObject(with: data) as? [String: Any],
      let tracks = catalog["tracks"] as? [[String: Any]]
    else { throw RecallError.message("La recherche MCP n’a pas renvoyé de bibliothèque valide.") }
    return try Catalog.parse(JSONSerialization.data(withJSONObject: ["videos": tracks]))
  }

}
