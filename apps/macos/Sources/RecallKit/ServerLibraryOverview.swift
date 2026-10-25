import Foundation

public struct ServerPlaylistSummary: Identifiable, Sendable {
  public let id: String
  public let title: String
  public let entries: Int
  public let syncEnabled: Bool
}

public struct ServerLibraryOverview: Sendable {
  public let videoCount: Int
  public let playlists: [ServerPlaylistSummary]
  public init(status: [String: Any], collections: [String: Any]) throws {
    guard let counts = status["counts"] as? [String: Any],
      let count = counts["videos"] as? Int,
      let rows = collections["playlists"] as? [[String: Any]]
    else {
      throw RecallError.message(
        "La bibliothèque du serveur est illisible. Réessaie dans un instant.")
    }
    videoCount = count
    playlists = try rows.map { row in
      guard let id = row["id"] as? String, let title = row["title"] as? String,
        let entries = row["entries"] as? Int
      else {
        throw RecallError.message("Une playlist du serveur est illisible.")
      }
      return ServerPlaylistSummary(
        id: id, title: title, entries: entries, syncEnabled: row["sync_enabled"] as? Bool ?? true)
    }
  }
}
