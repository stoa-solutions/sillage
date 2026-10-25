import Combine
import Foundation
import RecallKit

// Credentials and connection lifetime. Library data lives exclusively on the server.
@MainActor
final class Session: ObservableObject {
  @Published var showOnboarding = false
  @Published var error = ""
  @Published var notice = ""
  @Published private(set) var loadingCredentials = false
  @Published private(set) var hasKey = false
  @Published private(set) var hasServer = false
  @Published var cloudVoice: Bool {
    didSet { UserDefaults.standard.set(cloudVoice, forKey: "cloudVoice") }
  }
  @Published var model: String { didSet { UserDefaults.standard.set(model, forKey: "djModel") } }
  private(set) var generation = UUID()
  var onConnectionChange: (() -> Void)?
  private(set) var geminiKey = ""
  private(set) var connection: Connection?
  var connectedURL: String { connection?.url ?? "" }

  init() {
    cloudVoice = UserDefaults.standard.object(forKey: "cloudVoice") as? Bool ?? true
    model = UserDefaults.standard.string(forKey: "djModel") ?? "gemini-4-argon"
  }
  func refreshCredentials() async {
    loadingCredentials = true
    defer { loadingCredentials = false }
    do {
      let credentials = try await Task.detached { () -> (String, Connection?) in
        (
          try KeychainStore.string("gemini") ?? "", try KeychainStore.connection()
        )
      }.value
      geminiKey = credentials.0
      let changed =
        connection?.url != credentials.1?.url || connection?.token != credentials.1?.token
      connection = credentials.1
      hasKey = !geminiKey.isEmpty
      hasServer = connection != nil
      if changed {
        generation = UUID()
        onConnectionChange?()
      }
    } catch { self.error = error.localizedDescription }
  }
  func saveGeminiKey(_ value: String) async throws {
    let key = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard (20...256).contains(key.count) else {
      throw RecallError.message("Vérifie ta clé Gemini.")
    }
    try await Task.detached { try KeychainStore.save(key, account: "gemini") }.value
    cloudVoice = true
    await refreshCredentials()
    if hasKey && hasServer { showOnboarding = false }
  }
  func importConnection(_ url: URL) async throws {
    let connection = try await Task.detached {
      let data = try Data(contentsOf: url)
      guard data.count < 16384 else { throw RecallError.message("Fichier de connexion invalide.") }
      let raw = try JSONDecoder().decode(Connection.self, from: data)
      let value = try Connection(url: raw.url, token: raw.token)
      try KeychainStore.save(JSONEncoder().encode(value), account: "server")
      return value
    }.value
    await refreshCredentials()
    notice = "Serveur enregistré : " + (URL(string: connection.url)?.host ?? "")
  }
  func forgetServer() async {
    do {
      try await Task.detached { try KeychainStore.remove("server") }.value
      await refreshCredentials()
    } catch { self.error = error.localizedDescription }
  }
}
