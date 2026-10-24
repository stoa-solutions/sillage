import Combine
import Foundation
import RecallKit

// Shared state for the whole window: credentials, active source and user-facing banners.
// Library and DJ read it; only the session changes the source.
@MainActor
final class Session: ObservableObject {
  @Published var error = ""
  @Published var notice = ""
  @Published private(set) var loadingCredentials = false
  @Published private(set) var hasKey = false
  @Published private(set) var hasServer = false
  @Published private(set) var hasYouTubeKey = false
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
    localDJ = UserDefaults.standard.object(forKey: "localDJ") as? Bool ?? true
    model = UserDefaults.standard.string(forKey: "djModel") ?? "gemini-3.5-flash-lite"
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
  func forgetServer() async {
    do {
      try await Task.detached { try KeychainStore.remove("server") }.value
      useServer = false
      await refreshCredentials()
    } catch { self.error = error.localizedDescription }
  }
}
