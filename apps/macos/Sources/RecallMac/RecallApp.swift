import AppKit
import RecallKit
import Sparkle
import SwiftUI

@MainActor final class AppDelegate: NSObject, NSApplicationDelegate {
  var updater: SPUStandardUpdaterController?
  func applicationDidFinishLaunching(_ notification: Notification) {
    NSApp.setActivationPolicy(.regular)
    NSApp.activate(ignoringOtherApps: true)
    if Bundle.main.object(forInfoDictionaryKey: "SUPublicEDKey") as? String != nil {
      updater = SPUStandardUpdaterController(
        startingUpdater: true, updaterDelegate: nil, userDriverDelegate: nil)
    }
  }
  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
}
@main struct RecallApp: App {
  @NSApplicationDelegateAdaptor(AppDelegate.self) var delegate
  @StateObject private var session: Session
  @StateObject private var library: LibraryModel
  @StateObject private var dj: DJModel
  @StateObject private var discovery: DiscoveryModel
  @State private var didBootstrap = false
  init() {
    let session = Session()
    let library = LibraryModel(session: session)
    let dj = DJModel(session: session)
    let discovery = DiscoveryModel(session: session, library: library)
    session.onConnectionChange = { [weak library, weak dj, weak discovery] in
      discovery?.reset()
      dj?.reset()
      library?.reset()
    }
    _session = StateObject(wrappedValue: session)
    _library = StateObject(wrappedValue: library)
    _dj = StateObject(wrappedValue: dj)
    _discovery = StateObject(wrappedValue: discovery)
  }
  private func bootstrap() async {
    if CommandLine.arguments.contains("--import-configuration-stdin") {
      do {
        try await Task.detached {
          let data = FileHandle.standardInput.readDataToEndOfFile()
          guard data.count < 16384,
            let values = try JSONSerialization.jsonObject(with: data) as? [String: String]
          else { throw RecallError.message("Configuration privée invalide.") }
          var credentials: [String: Data] = [:]
          if let url = values["url"], let token = values["token"] {
            credentials["server"] = try JSONEncoder().encode(Connection(url: url, token: token))
          }
          guard !credentials.isEmpty else {
            throw RecallError.message("Configuration privée vide.")
          }
          try SessionStore.install(credentials)
          if let selectedModel = values["model"],
            ["gemini-3.5-flash-lite", "gemini-3.8-flash", "gemini-4-argon"].contains(selectedModel)
          {
            UserDefaults.standard.set(selectedModel, forKey: "djModel")
          }
        }.value
        session.model = UserDefaults.standard.string(forKey: "djModel") ?? "gemini-3.5-flash-lite"
      } catch { session.error = error.localizedDescription }
    }
    await session.refreshCredentials()
    if CommandLine.arguments.contains("--verify-quality") {
      let report = FileManager.default.temporaryDirectory.appendingPathComponent(
        "recall-quality-verification.json")
      do {
        let started = Date()
        guard let connection = session.connection, session.hasKey else {
          throw RecallError.message("Clé ou connexion existante absente")
        }
        let response = try await ServerDJ(connection: connection).turn(
          DJRequest(
            message: "Mets-moi trois vrais titres de Mac Miller, sans type beats ni hommages.",
            history: [], queued: []))
        guard !response.tracks.isEmpty, response.tracks.allSatisfy({ !Catalog.isImitation($0) })
        else { throw RecallError.message("Sélection musicale incorrecte") }
        let speech = try await HTTPClient().server(
          connection, path: "dj/speech",
          body: ["text": "Salut Samuel. Ton DJ et sa voix sont de retour. On reprend la musique."])
        guard let encoded = speech["audio"] as? String, let audio = Data(base64Encoded: encoded)
        else { throw RecallError.message("Voix invalide") }
        guard audio.starts(with: Data("RIFF".utf8)) else {
          throw RecallError.message("Voix invalide")
        }
        let value: [String: Any] = [
          "ok": true, "model": session.model, "tracks": response.tracks.map(\.title),
          "voiceBytes": audio.count, "seconds": Date().timeIntervalSince(started),
        ]
        try JSONSerialization.data(withJSONObject: value, options: .prettyPrinted).write(
          to: report, options: .atomic)
      } catch {
        try? JSONSerialization.data(withJSONObject: [
          "ok": false, "error": error.localizedDescription,
        ]).write(to: report, options: .atomic)
        session.error = error.localizedDescription
      }
    }
    session.showOnboarding =
      !session.hasServer || (session.googleAccount && (!session.hasKey || session.canClaimLibrary))
    if session.hasServer { library.sync() }
  }
  var body: some Scene {
    WindowGroup("Playlist Recall") {
      MainView().environmentObject(session).environmentObject(library).environmentObject(dj)
        .environmentObject(discovery)
        .frame(minWidth: 600, minHeight: 640)
        .task {
          if !didBootstrap {
            didBootstrap = true
            await bootstrap()
          }
          while !Task.isCancelled {
            do { try await Task.sleep(nanoseconds: 60_000_000_000) } catch { break }
            if session.hasServer { library.sync() }
          }
        }
        .onOpenURL { session.receiveGoogleCallback($0) }
        .onDisappear {
          dj.cancel()
          dj.pause()
        }
    }
    .defaultSize(width: 600, height: 840)
    .windowToolbarStyle(.unified(showsTitle: false))
    .commands {
      CommandGroup(after: .appInfo) {
        Button("Rechercher des mises à jour…") { delegate.updater?.checkForUpdates(nil) }
          .disabled(delegate.updater == nil)
      }
      CommandGroup(replacing: .newItem) {
        Button("Actualiser la bibliothèque") { library.sync() }.keyboardShortcut("r")
      }
    }
    Settings {
      SettingsView().environmentObject(session).environmentObject(library).environmentObject(dj)
        .onOpenURL { session.receiveGoogleCallback($0) }
        .tint(.recall)
    }
  }
}
