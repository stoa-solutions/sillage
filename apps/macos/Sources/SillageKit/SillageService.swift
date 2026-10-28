import Foundation

/// The hosted service identity, independent of the app's stable bundle and callback identifiers.
public enum SillageService {
  public static let origin = "https://sillage.stoa.solutions"

  /// Resolve the former hosted origin without modifying saved credentials or self-hosted servers.
  public static func connection(url: String, token: String) throws -> Connection {
    let connection = try Connection(url: url, token: token)
    if matchesOrigin(URL(string: connection.url), host: FormerIdentity.host) {
      return try Connection(url: origin, token: connection.token)
    }
    return connection
  }

  public static func isPlayerOrigin(_ url: URL?) -> Bool {
    matchesOrigin(url, host: "sillage.stoa.solutions")
  }

  private static func matchesOrigin(_ url: URL?, host: String) -> Bool {
    guard let url else { return false }
    return url.scheme?.lowercased() == "https" && url.host?.lowercased() == host
      && (url.port == nil || url.port == 443) && url.user == nil && url.password == nil
  }
}
