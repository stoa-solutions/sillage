import Foundation
import RecallKit
import Security

// One self-owned vault, not separate legacy items with different authorization histories.
// The lock serializes migration and read/modify/write across detached credential tasks.
enum KeychainStore {
  static let service = "solutions.stoa.playlist-recall"
  private static let vault = Vault()
  static func read(_ account: String) throws -> Data? { try vault.read(account) }
  static func string(_ account: String) throws -> String? {
    try read(account).flatMap { String(data: $0, encoding: .utf8) }
  }
  static func save(_ data: Data, account: String) throws { try vault.save(data, account: account) }
  static func save(_ value: String, account: String) throws {
    try save(Data(value.utf8), account: account)
  }
  static func connection() throws -> Connection? {
    guard let data = try read("server") else { return nil }
    let raw = try JSONDecoder().decode(Connection.self, from: data)
    return try Connection(url: raw.url, token: raw.token)
  }
  static func remove(_ account: String) throws { try vault.save(nil, account: account) }
  static func install(_ values: [String: Data]) throws { try vault.install(values) }

  private final class Vault: @unchecked Sendable {
    private let lock = NSRecursiveLock()
    private var cached: [String: Data]?
    private let account = "credentials-v2"
    private let allowed = ["gemini", "server", "youtube", "legacy-server"]
    func read(_ key: String) throws -> Data? {
      lock.lock()
      defer { lock.unlock() }
      return try load()[key]
    }
    func save(_ data: Data?, account key: String) throws {
      lock.lock()
      defer { lock.unlock() }
      guard allowed.contains(key) else { throw RecallError.message("Réglage privé inconnu.") }
      var values = try load()
      values[key] = data
      try write(values)
      // Legacy values remain for rollback, except when explicitly removing a credential.
      if data == nil {
        let status = SecItemDelete(query(key) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
          throw RecallError.message("La copie historique de la clé n’a pas pu être retirée.")
        }
      }
    }
    func install(_ values: [String: Data]) throws {
      lock.lock()
      defer { lock.unlock() }
      guard values.keys.allSatisfy({ allowed.contains($0) }) else {
        throw RecallError.message("Configuration privée invalide.")
      }
      var merged: [String: Data] = [:]
      if let existing = try readItem(account) {
        merged = try JSONDecoder().decode([String: Data].self, from: existing)
      }
      for key in allowed where values[key] == nil && merged[key] == nil {
        merged[key] = try readItem(key)
      }
      for (key, value) in values { merged[key] = value }
      try write(merged)
    }
    private func load() throws -> [String: Data] {
      if let cached { return cached }
      if let data = try readItem(account) {
        let values = try JSONDecoder().decode([String: Data].self, from: data)
        cached = values
        return values
      }
      var values: [String: Data] = [:]
      for key in allowed { values[key] = try readItem(key) }
      try write(values)
      return values
    }
    private func query(_ key: String) -> [String: Any] {
      [
        kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
        kSecAttrAccount as String: key,
      ]
    }
    private func readItem(_ key: String) throws -> Data? {
      var query = query(key)
      query[kSecReturnData as String] = true
      query[kSecMatchLimit as String] = kSecMatchLimitOne
      var result: CFTypeRef?
      let status = SecItemCopyMatching(query as CFDictionary, &result)
      if status == errSecItemNotFound { return nil }
      guard status == errSecSuccess else {
        throw RecallError.message(
          "Le Trousseau n’est pas accessible (\(status)). Déverrouille ta session Mac.")
      }
      return result as? Data
    }
    private func write(_ values: [String: Data]) throws {
      let data = try JSONEncoder().encode(values)
      let query = query(account)
      let status = SecItemUpdate(
        query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
      if status == errSecItemNotFound {
        var item = query
        item[kSecValueData as String] = data
        item[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        item[kSecAttrLabel as String] = "Playlist Recall — connexion personnelle"
        guard SecItemAdd(item as CFDictionary, nil) == errSecSuccess else {
          throw RecallError.message("Le Trousseau a refusé l’enregistrement de Recall.")
        }
      } else if status != errSecSuccess {
        throw RecallError.message("La connexion Recall n’a pas pu être enregistrée.")
      }
      cached = values
    }
  }
}
