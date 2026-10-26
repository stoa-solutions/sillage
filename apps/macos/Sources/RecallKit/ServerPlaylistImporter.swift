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

/// Uses the user's authenticated private server. The YouTube key never leaves that server.
public struct ServerPlaylistImporter: Sendable {
  public typealias Call = @Sendable (String, [String: String]?) async throws -> [String: Any]
  private let call: Call
  private let pause: @Sendable () async throws -> Void
  public init(connection: Connection) {
    call = { path, body in try await HTTPClient().server(connection, path: path, body: body) }
    pause = { try await Task.sleep(nanoseconds: 2_000_000_000) }
  }
  public init(call: @escaping Call, pause: @escaping @Sendable () async throws -> Void) {
    self.call = call
    self.pause = pause
  }
  /// Wait for a fresh server commit without downloading or storing the library.
  public func synchronize(link: String) async throws -> String {
    try Task.checkCancellation()
    let id = try YouTubePlaylistLink.id(from: link)
    let status = try await call("status", nil)
    guard status["youtubeConfigured"] as? Bool == true else {
      throw RecallError.message(
        "La clé YouTube doit être configurée sur ton serveur. Aucune clé n’est demandée dans l’app."
      )
    }
    let before = try await call("playlists", nil)
    let previous =
      (before["playlists"] as? [[String: Any]])?.first { $0["id"] as? String == id }?[
        "last_sync_at"] as? String
    try Task.checkCancellation()
    _ = try await call("playlists", ["url": link])
    for _ in 0..<150 {
      try Task.checkCancellation()
      try await pause()
      let result = try await call("playlists", nil)
      let playlist = (result["playlists"] as? [[String: Any]])?.first { $0["id"] as? String == id }
      if playlist?["status"] as? String == "error" {
        throw RecallError.message(
          "YouTube n’a pas pu actualiser cette playlist. Vérifie son accès et le quota dans les réglages du serveur."
        )
      }
      if playlist?["status"] as? String == "ready",
        let synced = playlist?["last_sync_at"] as? String, synced != previous
      {
        return id
      }
    }
    throw RecallError.message(
      "Le serveur travaille encore. Réimporte le même lien dans quelques instants ; ta bibliothèque reste conservée."
    )
  }
}
