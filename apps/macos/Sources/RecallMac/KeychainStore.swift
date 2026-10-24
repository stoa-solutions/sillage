import Foundation
import RecallKit
import Security

enum KeychainStore {
  static let service = "solutions.stoa.playlist-recall"
  static func read(_ account: String) throws -> Data? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
      kSecAttrAccount as String: account, kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess else {
      throw RecallError.message(
        "Le Trousseau n’est pas accessible (\(status)). Déverrouille ta session Mac.")
    }
    return result as? Data
  }
  static func string(_ account: String) throws -> String? {
    try read(account).flatMap { String(data: $0, encoding: .utf8) }
  }
  static func save(_ data: Data, account: String) throws {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
      kSecAttrAccount as String: account,
    ]
    let update = SecItemUpdate(
      query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
    if update == errSecSuccess { return }
    guard update == errSecItemNotFound else {
      throw RecallError.message("La clé n’a pas pu être enregistrée dans le Trousseau.")
    }
    var item = query
    item[kSecValueData as String] = data
    item[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
    guard SecItemAdd(item as CFDictionary, nil) == errSecSuccess else {
      throw RecallError.message("Le Trousseau a refusé l’enregistrement.")
    }
  }
  static func save(_ value: String, account: String) throws {
    try save(Data(value.utf8), account: account)
  }
  static func connection() throws -> Connection? {
    guard let data = try read("server") else { return nil }
    let raw = try JSONDecoder().decode(Connection.self, from: data)
    return try Connection(url: raw.url, token: raw.token)
  }
  static func remove(_ account: String) throws {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
      kSecAttrAccount as String: account,
    ]
    let status = SecItemDelete(query as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else {
      throw RecallError.message("Impossible de retirer cette clé du Trousseau.")
    }
  }
}
