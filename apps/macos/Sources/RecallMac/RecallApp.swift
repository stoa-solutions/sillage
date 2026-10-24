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
  @StateObject private var model: AppModel
  @State private var didBootstrap = false
  init() { _model = StateObject(wrappedValue: AppModel()) }
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
          if let key = values["apiKey"], (20...256).contains(key.count) {
            credentials["gemini"] = Data(key.utf8)
          }
          if let key = values["youtubeKey"], (20...256).contains(key.count) {
            credentials["youtube"] = Data(key.utf8)
          }
          guard !credentials.isEmpty else {
            throw RecallError.message("Configuration privée vide.")
          }
          try KeychainStore.install(credentials)
          if let selectedModel = values["model"],
            ["gemini-3.5-flash-lite", "gemini-3.8-flash", "gemini-4-argon"].contains(selectedModel)
          {
            UserDefaults.standard.set(selectedModel, forKey: "djModel")
          }
        }.value
        model.model = UserDefaults.standard.string(forKey: "djModel") ?? "gemini-3.5-flash-lite"
      } catch { model.error = error.localizedDescription }
    }
    await model.refreshCredentials()
    if model.useServer { model.sync() }
  }
  var body: some Scene {
    WindowGroup("Playlist Recall") {
      MainView().environmentObject(model).preferredColorScheme(.light)
        .frame(minWidth: 1000, minHeight: 700)
        .task {
          if !didBootstrap {
            didBootstrap = true
            await bootstrap()
          }
        }
        .onDisappear {
          model.cancel()
          model.player.command("pause")
        }
    }
    .defaultSize(width: 1180, height: 800)
    .commands {
      CommandGroup(after: .appInfo) {
        Button("Rechercher des mises à jour…") { delegate.updater?.checkForUpdates(nil) }
          .disabled(delegate.updater == nil)
      }
      CommandGroup(replacing: .newItem) {
        Button("Importer une bibliothèque…") { model.importLibrary() }.keyboardShortcut("o")
        Button("Exporter la bibliothèque…") { model.exportLibrary() }.keyboardShortcut(
          "e", modifiers: [.command, .shift])
      }
    }
    Settings { SettingsView().environmentObject(model).preferredColorScheme(.light) }
  }
}
