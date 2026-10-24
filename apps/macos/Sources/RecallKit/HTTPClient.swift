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
    let object = try await server(
      connection, path: "search",
      body: ["query": query, "mode": "text", "sort": "relevance", "offset": 0, "limit": 50])
    let videos = (object["results"] as? [[String: Any]] ?? []).compactMap {
      $0["video"] as? [String: Any]
    }
    return try Catalog.parse(JSONSerialization.data(withJSONObject: ["videos": videos]))
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
