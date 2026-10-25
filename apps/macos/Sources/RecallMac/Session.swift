import Combine
import Foundation
import RecallKit

// Shared state for the whole window: credentials, active source and user-facing banners.
// Library and DJ read it; only the session changes the source.
@MainActor
final class Session: ObservableObject {
  @Published var showOnboarding = false
  @Published var error = ""
  @Published var notice = ""
  @Published private(set) var loadingCredentials = false
  @Published private(set) var hasKey = false
  @Published private(set) var hasServer = false
  @Published private(set) var hasYouTubeKey = false
  @Published var cloudVoice: Bool {
    didSet { UserDefaults.standard.set(cloudVoice, forKey: "cloudVoice") }
  }
  @Published var localDJ: Bool { didSet { UserDefaults.standard.set(localDJ, forKey: "localDJ") } }
  @Published var model: String { didSet { UserDefaults.standard.set(model, forKey: "djModel") } }
  @Published var useServer: Bool {
    didSet {
      UserDefaults.standard.set(useServer, forKey: "useServer")
      if oldValue != useServer {
        generation = UUID()
        onSourceChange?()
      }
    }
  }
  /// Changes with the source. Background work captures it and drops results from another source.
  private(set) var generation = UUID()
  var onSourceChange: (() -> Void)?
  private(set) var geminiKey = ""
  private(set) var youtubeKey = ""
  private(set) var connection: Connection?
  let store: LibraryStore
  var source: LibraryStore.Source { useServer ? .server : .local }
  var connectedURL: String { connection?.url ?? "" }

  init() {
    // Development runs set RECALL_DATA_DIR to keep the owner's library untouched.
    let directory =
      ProcessInfo.processInfo.environment["RECALL_DATA_DIR"].map {
        URL(fileURLWithPath: $0, isDirectory: true)
      }
      ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("Playlist Recall", isDirectory: true)
    store = LibraryStore(directory: directory)
    cloudVoice = UserDefaults.standard.object(forKey: "cloudVoice") as? Bool ?? true
    localDJ = UserDefaults.standard.object(forKey: "localDJ") as? Bool ?? false
    model = UserDefaults.standard.string(forKey: "djModel") ?? "gemini-4-argon"
    useServer = UserDefaults.standard.object(forKey: "useServer") as? Bool ?? false
  }
  func refreshCredentials() async {
    loadingCredentials = true
    defer { loadingCredentials = false }
    do {
      let credentials = try await Task.detached { () -> (String, Connection?, String) in
        (
          try KeychainStore.string("gemini") ?? "", try KeychainStore.connection(),
          try KeychainStore.string("youtube") ?? ""
        )
      }.value
      geminiKey = credentials.0
      connection = credentials.1
      youtubeKey = credentials.2
      hasKey = !geminiKey.isEmpty
      hasServer = connection != nil
      hasYouTubeKey = !youtubeKey.isEmpty
    } catch { self.error = error.localizedDescription }
  }
  func saveGeminiKey(_ value: String) async throws {
    let key = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard (20...256).contains(key.count) else {
      throw RecallError.message("Vérifie ta clé Gemini.")
    }
    try await Task.detached { try KeychainStore.save(key, account: "gemini") }.value
    localDJ = false
    cloudVoice = true
    await refreshCredentials()
    if hasKey { showOnboarding = false }
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
      useServer = false
      await refreshCredentials()
    } catch { self.error = error.localizedDescription }
  }
}
