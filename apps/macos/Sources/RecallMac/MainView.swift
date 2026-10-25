import AppKit
import RecallKit
import SwiftUI

extension Color {
  /// Recall green: deep on light backgrounds, luminous on dark ones and over Studio video.
  static let recall = Color(
    nsColor: NSColor(name: nil) { appearance in
      appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
        ? NSColor(red: 0.55, green: 0.86, blue: 0.69, alpha: 1)
        : NSColor(red: 0.12, green: 0.42, blue: 0.31, alpha: 1)
    })
}

private enum Destination: Hashable { case dj, library }

struct MainView: View {
  @EnvironmentObject var session: Session
  @EnvironmentObject var library: LibraryModel
  @EnvironmentObject var dj: DJModel
  @State private var section = Destination.dj
  var body: some View {
    VStack(spacing: 0) {
      if !session.error.isEmpty {
        Banner(text: session.error, symbol: "exclamationmark.triangle.fill", color: .orange) {
          session.error = ""
        }
      }
      if !session.notice.isEmpty {
        Banner(text: session.notice, symbol: "info.circle.fill", color: .recall) {
          session.notice = ""
        }
      }
      switch section {
      case .dj: DJView(model: dj)
      case .library: LibraryView(onPlay: { section = .dj })
      }
    }
    .toolbar {
      ToolbarItem(placement: .principal) {
        Picker("Vue", selection: $section) {
          Text("DJ").tag(Destination.dj)
          Text("Bibliothèque").tag(Destination.library)
        }.pickerStyle(.segmented).fixedSize()
      }
      ToolbarItemGroup(placement: .primaryAction) {
        if section == .dj { DisplayPicker(player: dj.player) }
        SettingsLink { Label("Réglages", systemImage: "gearshape") }.help("Réglages")
      }
    }
    .background(WindowAppearance(player: dj.player, dj: section == .dj))
    .tint(.recall)
    .sheet(isPresented: $session.showOnboarding) { OnboardingView().environmentObject(session) }
    .onChange(of: session.showOnboarding) { _, showing in
      if !showing && session.hasServer && library.libraryCount == 0 { section = .library }
    }
  }
}

private struct Banner: View {
  let text: String
  let symbol: String
  let color: Color
  let dismiss: () -> Void
  var body: some View {
    HStack(spacing: 10) {
      Image(systemName: symbol).foregroundStyle(color)
      Text(text).font(.callout).textSelection(.enabled)
      Spacer()
      Button(action: dismiss) { Image(systemName: "xmark") }.buttonStyle(.borderless)
        .accessibilityLabel("Fermer")
    }.padding(.horizontal, 16).padding(.vertical, 10).background(.bar)
      .overlay(alignment: .bottom) { Divider() }
  }
}

/// Compact keeps the official YouTube player; Studio plays the private local clip when ready.
private struct DisplayPicker: View {
  @ObservedObject var player: Player
  var body: some View {
    Picker(
      "Affichage",
      selection: Binding(
        get: { player.studio },
        set: { studio in
          player.setStudio(studio)
          fitWindow(studio: studio)
        })
    ) {
      Text("Compact").tag(false)
      Text("Studio").tag(true)
    }.pickerStyle(.segmented).fixedSize()
      .help("Studio : clip plein cadre, lu depuis un cache privé sur ce Mac quand c’est possible.")
  }
  private func fitWindow(studio: Bool) {
    guard let window = NSApp.keyWindow, !window.styleMask.contains(.fullScreen) else { return }
    var frame = window.frame
    frame.size.width = studio ? max(frame.width, 1180) : min(frame.width, 540)
    if let screen = window.screen { frame = window.constrainFrameRect(frame, to: screen) }
    window.setFrame(frame, display: true, animate: true)
  }
}

/// Studio is always dark and at least 900 points wide; everything else follows the system.
private struct WindowAppearance: NSViewRepresentable {
  @ObservedObject var player: Player
  let dj: Bool
  func makeNSView(context: Context) -> NSView { NSView() }
  func updateNSView(_ view: NSView, context: Context) {
    let studio = dj && player.studio
    DispatchQueue.main.async {
      guard let window = view.window else { return }
      window.appearance = studio ? NSAppearance(named: .darkAqua) : nil
      window.contentMinSize.width = studio ? 900 : 540
      guard window.frame.width < window.contentMinSize.width,
        !window.styleMask.contains(.fullScreen)
      else { return }
      var frame = window.frame
      frame.size.width = window.contentMinSize.width
      window.setFrame(frame, display: true, animate: true)
    }
  }
}
