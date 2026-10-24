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
          if let url = values["url"], let token = values["token"] {
            let connection = try Connection(url: url, token: token)
            try KeychainStore.save(JSONEncoder().encode(connection), account: "server")
          }
          if let selectedModel = values["model"],
            ["gemini-3.5-flash-lite", "gemini-3.8-flash", "gemini-4-argon"].contains(selectedModel)
          {
            UserDefaults.standard.set(selectedModel, forKey: "djModel")
          }
          if let key = values["apiKey"], (20...256).contains(key.count) {
            try KeychainStore.save(key, account: "gemini")
          }
        }.value
        model.model = UserDefaults.standard.string(forKey: "djModel") ?? "gemini-3.5-flash-lite"
        model.useServer = true
      } catch { model.error = error.localizedDescription }
    }
    await model.refreshCredentials()
    if model.useServer { model.sync() }
  }
  var body: some Scene {
    WindowGroup("Playlist Recall") {
      MainView().environmentObject(model)
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
    Settings { SettingsView().environmentObject(model) }
  }
}
