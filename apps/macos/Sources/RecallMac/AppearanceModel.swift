import AppKit
import RecallKit
import SwiftUI

@MainActor final class AppearanceModel: ObservableObject {
  static let shared = AppearanceModel()
  @Published private(set) var preferences: AppearancePreferences
  @Published private(set) var personalImage: NSImage?
  @Published var error = ""
  @Published private(set) var importing = false
  let stoaImage: NSImage?
  private let store: AppearanceStore

  init() {
    let root =
      ProcessInfo.processInfo.environment["RECALL_DATA_DIR"].map { URL(fileURLWithPath: $0) }
      ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("Playlist Recall", isDirectory: true)
    store = AppearanceStore(directory: root.appendingPathComponent("Appearance", isDirectory: true))
    preferences = store.load()
    personalImage = NSImage(contentsOf: store.imageURL)
    // Avoid Bundle.module's fatalError when a resource bundle is missing from an installation.
    // SwiftPM development builds keep the bundle next to the executable.
    let bundleName = "PlaylistRecallMac_RecallMac.bundle"
    let candidates = [
      Bundle.main.resourceURL?.appendingPathComponent(bundleName),
      Bundle.main.executableURL?.deletingLastPathComponent().appendingPathComponent(bundleName),
      Bundle.main.bundleURL.appendingPathComponent(bundleName),
    ]
    let resources = candidates.compactMap { $0 }.compactMap { Bundle(url: $0) }.first
    stoaImage = resources?.url(
      forResource: "stoa-passage", withExtension: "webp", subdirectory: "Resources"
    ).flatMap(NSImage.init(contentsOf:))
  }
  var image: NSImage? {
    switch preferences.backdrop {
    case .stoa: return stoaImage
    case .personal: return personalImage ?? stoaImage
    case .none: return nil
    }
  }
  func select(_ backdrop: IdleBackdrop) {
    var value = preferences
    value.backdrop = backdrop
    update(value)
  }
  func dim(_ amount: Double) {
    var value = preferences
    value.dimming = amount
    update(value)
  }
  func reset() { update(AppearancePreferences()) }
  private func update(_ value: AppearancePreferences) {
    do {
      try store.save(value)
      preferences = store.load()
      error = ""
    } catch { self.error = "Impossible de mémoriser l’apparence. \(error.localizedDescription)" }
  }
  func chooseImage() {
    let panel = NSOpenPanel()
    panel.allowedContentTypes = [.image]
    panel.allowsMultipleSelection = false
    panel.canChooseDirectories = false
    panel.prompt = "Choisir ce fond"
    panel.message = "Une copie optimisée reste sur ce Mac. Ton image n’est pas envoyée au serveur."
    panel.begin { [weak self] response in
      guard response == .OK, let url = panel.url else { return }
      Task { @MainActor in await self?.importImage(url) }
    }
  }
  private func importImage(_ url: URL) async {
    importing = true
    error = ""
    defer { importing = false }
    do {
      let store = store
      try await Task.detached(priority: .userInitiated) { try store.importImage(from: url) }.value
      personalImage = NSImage(contentsOf: store.imageURL)
      select(.personal)
    } catch { self.error = error.localizedDescription }
  }
}

/// Used only when no track is selected, in both Compact and Studio.
struct IdleBackground: View {
  @ObservedObject private var appearance = AppearanceModel.shared
  var body: some View {
    GeometryReader { geometry in
      ZStack {
        Color(white: 0.055)
        if let image = appearance.image {
          Image(nsImage: image).resizable().scaledToFill()
            .frame(width: geometry.size.width, height: geometry.size.height).clipped()
          Color.black.opacity(appearance.preferences.dimming)
          LinearGradient(
            colors: [.clear, .black.opacity(0.65)], startPoint: .center, endPoint: .bottom)
        }
      }
    }.accessibilityHidden(true)
  }
}
