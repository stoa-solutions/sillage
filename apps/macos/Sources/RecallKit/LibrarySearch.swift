import Foundation

/// Text search over one library. Exclusion and the limit are applied by the implementation,
/// so callers always receive up to `limit` tracks they can actually use.
public protocol LibrarySearch: Sendable {
  func search(_ query: String, excluding: Set<String>, limit: Int) async throws -> [Track]
}

/// SQLite and FTS5 on this Mac.
public struct LocalLibrarySearch: LibrarySearch {
  let store: LibraryStore
  let source: LibraryStore.Source
  public init(store: LibraryStore, source: LibraryStore.Source) {
    self.store = store
    self.source = source
  }
  public func search(_ query: String, excluding: Set<String>, limit: Int) async throws -> [Track] {
    let store = store
    let source = source
    return try await Task.detached {
      try store.search(query, source: source, limit: limit, excluded: excluding)
    }.value
  }
}

/// Hybrid lexical and semantic search on the private server, one request per query.
public struct ServerLibrarySearch: LibrarySearch {
  let connection: Connection
  public init(connection: Connection) { self.connection = connection }
  public func search(_ query: String, excluding: Set<String>, limit: Int) async throws -> [Track] {
    let object = try await HTTPClient().server(
      connection, path: "search",
      body: [
        "query": query, "mode": "text", "sort": "relevance", "offset": 0,
        "limit": min(max(limit, 1), 100), "excludeIds": Array(excluding.prefix(100)),
        "availableOnly": true,
      ])
    let videos = (object["results"] as? [[String: Any]] ?? []).compactMap {
      $0["video"] as? [String: Any]
    }
    // Servers deployed before `excludeIds` ignore it; the exclusion still holds here.
    return try Catalog.parse(JSONSerialization.data(withJSONObject: ["videos": videos]))
      .filter { !excluding.contains($0.id) }
  }
}

/// Several libraries in priority order: results keep that order, without duplicates.
public struct MergedLibrarySearch: LibrarySearch {
  let sources: [any LibrarySearch]
  public init(_ sources: [any LibrarySearch]) { self.sources = sources }
  public func search(_ query: String, excluding: Set<String>, limit: Int) async throws -> [Track] {
    var seen = excluding
    var merged: [Track] = []
    for source in sources where merged.count < limit {
      let found = try await source.search(query, excluding: excluding, limit: limit)
      merged += found.filter { seen.insert($0.id).inserted }
    }
    return Array(merged.prefix(limit))
  }
}
