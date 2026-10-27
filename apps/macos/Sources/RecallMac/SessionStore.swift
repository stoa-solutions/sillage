import Foundation
import RecallKit

/// Deliberately never probes historical Keychain items: doing so can display a password dialog.
enum SessionStore {
  private static let file: CredentialFile = {
    let root =
      ProcessInfo.processInfo.environment["RECALL_DATA_DIR"].map { URL(fileURLWithPath: $0) }
      ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("Playlist Recall", isDirectory: true)
    return CredentialFile(directory: root.appendingPathComponent("Session", isDirectory: true))
  }()
  static func read(_ account: String) throws -> Data? { try file.read(account) }
  static func save(_ data: Data, account: String) throws { try file.save(data, account: account) }
  static func remove(_ account: String) throws { try file.save(nil, account: account) }
  static func install(_ values: [String: Data]) throws { try file.install(values) }
  static func connection() throws -> Connection? {
    guard let data = try read("server") else { return nil }
    let raw = try JSONDecoder().decode(Connection.self, from: data)
    return try SillageService.connection(url: raw.url, token: raw.token)
  }
}
