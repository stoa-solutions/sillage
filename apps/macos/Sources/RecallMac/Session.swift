import Combine
import Foundation
import RecallKit

// Credentials and connection lifetime. Library data lives exclusively on the server.
@MainActor
final class Session: ObservableObject {
  @Published private(set) var accountEmail = ""
  @Published private(set) var googleAccount = false
  @Published private(set) var signingIn = false
  @Published private(set) var canClaimLibrary = false
  private var legacyConnection: Connection?
  private let signIn = GoogleSignIn()
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
  private var refreshAttempt = UUID()
  private(set) var generation = UUID()
  var onConnectionChange: (() -> Void)?
  private(set) var geminiKey = ""
  private(set) var connection: Connection?
  var connectedURL: String { connection?.url ?? "" }

  init() {
    cloudVoice = UserDefaults.standard.object(forKey: "cloudVoice") as? Bool ?? true
    model = UserDefaults.standard.string(forKey: "djModel") ?? "gemini-3.5-flash-lite"
  }
  func refreshCredentials() async {
    let attempt = UUID()
    refreshAttempt = attempt
    loadingCredentials = true
    defer { if refreshAttempt == attempt { loadingCredentials = false } }
    do {
      let credentials = try await Task.detached { () -> (String, Connection?, Connection?) in
        (
          try KeychainStore.string("gemini") ?? "", try KeychainStore.connection(),
          try KeychainStore.read("legacy-server").map {
            try JSONDecoder().decode(Connection.self, from: $0)
          }
        )
      }.value
      guard refreshAttempt == attempt else { return }
      geminiKey = ""  // Only the legacy account may use the previous device key.
      let changed =
        connection?.url != credentials.1?.url || connection?.token != credentials.1?.token
      connection = credentials.1
      hasKey = false
      accountEmail = ""
      googleAccount = false
      legacyConnection = credentials.2
      canClaimLibrary = legacyConnection != nil
      hasServer = connection != nil
      if changed {
        generation = UUID()
        onConnectionChange?()
      }
      if let connection {
        do {
          let profile = try await HTTPClient().server(connection, path: "me")
          guard refreshAttempt == attempt, self.connection?.token == connection.token else { return }
          googleAccount = profile["google"] as? Bool == true
          accountEmail = profile["email"] as? String ?? ""
          if !googleAccount { geminiKey = credentials.0 }
          let settings = try await HTTPClient().server(connection, path: "dj/status")
          guard refreshAttempt == attempt, self.connection?.token == connection.token else { return }
          hasKey = settings["personal"] as? Bool == true || !geminiKey.isEmpty
          if googleAccount, let selected = settings["model"] as? String, hasKey { model = selected }
        } catch {
          self.error = "Impossible de vérifier le compte. Réessaie ou reconnecte-toi dans Réglages."
        }
      }
    } catch { self.error = error.localizedDescription }
  }
  func saveGeminiKey(_ value: String) async throws {
    let key = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard (20...256).contains(key.count) else {
      throw RecallError.message("Vérifie ta clé Gemini.")
    }
    guard let connection, googleAccount else {
      throw RecallError.message("Connecte ton compte Google avant d’enregistrer ta clé.")
    }
    _ = try await HTTPClient().server(
      connection, path: "dj/settings", body: ["apiKey": key, "model": model])
    cloudVoice = true
    await refreshCredentials()
    if hasKey && hasServer && !canClaimLibrary { showOnboarding = false }
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
  func connectGoogle() async {
    guard !signingIn else { return }
    signingIn = true
    defer { signingIn = false }
    do {
      let previous = connection
      let wasLegacy = !googleAccount
      let value = try await signIn.connect(server: "https://recall.stoa.solutions")
      try await Task.detached {
        if wasLegacy, let previous {
          try KeychainStore.save(JSONEncoder().encode(previous), account: "legacy-server")
        }
        try KeychainStore.save(JSONEncoder().encode(value), account: "server")
      }.value
      if wasLegacy, let previous {
        legacyConnection = previous
        canClaimLibrary = true
      }
      await refreshCredentials()
      showOnboarding = !hasKey || canClaimLibrary
    } catch { self.error = error.localizedDescription }
  }
  func claimLibrary() async {
    guard let connection, let legacyConnection, googleAccount else { return }
    do {
      _ = try await HTTPClient().server(
        connection, path: "account/claim-library", body: ["legacyToken": legacyConnection.token])
      try await Task.detached { try KeychainStore.remove("legacy-server") }.value
      self.legacyConnection = nil
      canClaimLibrary = false
      generation = UUID()
      onConnectionChange?()
      notice = "Tes playlists existantes sont maintenant rattachées à " + accountEmail
    } catch { self.error = error.localizedDescription }
  }
  func saveModel() async throws {
    guard let connection, googleAccount, hasKey else { return }
    _ = try await HTTPClient().server(connection, path: "dj/settings", body: ["model": model])
  }
  func removeGeminiKey() async throws {
    guard let connection, googleAccount else { return }
    _ = try await HTTPClient().server(connection, path: "dj/settings/reset", body: [:])
    await refreshCredentials()
  }
  func forgetServer() async {
    refreshAttempt = UUID()
    loadingCredentials = false
    let previous = connection
    // Clear all visible private state immediately, even if revocation needs a retry.
    generation = UUID()
    connection = nil
    geminiKey = ""
    hasServer = false
    hasKey = false
    googleAccount = false
    accountEmail = ""
    legacyConnection = nil
    canClaimLibrary = false
    onConnectionChange?()
    do {
      if let previous { _ = try await HTTPClient().server(previous, path: "logout", body: [:]) }
      try await Task.detached { try KeychainStore.remove("server") }.value
      showOnboarding = true
    } catch {
      try? await Task.detached { try KeychainStore.remove("server") }.value
      self.error = "Déconnecté de ce Mac. La révocation serveur n’a pas pu être confirmée."
    }
  }
}
