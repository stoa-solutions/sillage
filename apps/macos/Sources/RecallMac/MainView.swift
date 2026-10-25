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

private enum Destination: Hashable { case dj, library, discover }

struct MainView: View {
  @EnvironmentObject var session: Session
  @EnvironmentObject var library: LibraryModel
  @EnvironmentObject var dj: DJModel
  @StateObject private var immersion = StudioImmersion()
  @State private var section = Destination.dj
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  var body: some View {
    Shell(
      player: dj.player, current: dj.current, focused: section == .dj && !session.showOnboarding,
      immersion: immersion
    ) {
      page
    }
    .toolbar {
      ToolbarItem(placement: .principal) {
        Picker("Vue", selection: $section) {
          Text("DJ").tag(Destination.dj)
          Text("Bibliothèque").tag(Destination.library)
          Text("Découvrir").tag(Destination.discover)
        }.pickerStyle(.segmented).fixedSize().neutralSelection().studioChrome(immersion.visible)
      }
      ToolbarItemGroup(placement: .primaryAction) {
        DisplayPicker(player: dj.player, wide: section == .discover).studioChrome(immersion.visible)
        SettingsLink { Image(systemName: "gearshape") }
          .help("Réglages").accessibilityLabel("Réglages").studioChrome(immersion.visible)
      }
    }
    .background(
      StudioActivity(immersion: immersion, visible: immersion.visible, reduceMotion: reduceMotion)
    )
    .animation(
      reduceMotion ? nil : .easeInOut(duration: immersion.visible ? 0.18 : 0.65),
      value: immersion.visible
    )
    .background(WindowAppearance(player: dj.player, discovery: section == .discover))
    .tint(.recall)
    .animation(reduceMotion ? nil : .easeInOut(duration: 0.25), value: section)
    .sheet(isPresented: $session.showOnboarding) {
      OnboardingView().environmentObject(session).environmentObject(library)
    }
    .onChange(of: section) { _, destination in
      guard destination == .discover, let window = NSApp.keyWindow,
        !window.styleMask.contains(.fullScreen), window.frame.width < 1180
      else { return }
      var frame = window.frame
      frame.size.width = 1180
      if let screen = window.screen { frame = window.constrainFrameRect(frame, to: screen) }
      window.setFrame(frame, display: true, animate: true)
    }
    .onChange(of: session.showOnboarding) { _, showing in
      if !showing && session.hasServer && library.libraryCount == 0 { section = .library }
    }
  }

  /// Banners on top, then the page; pages fade into each other.
  @ViewBuilder private var page: some View {
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
      ZStack {
        switch section {
        case .discover: DiscoverView(openDJ: { section = .dj }).transition(.opacity)
        case .dj: DJView(model: dj).transition(.opacity)
        case .library: LibraryView(onPlay: { section = .dj }).transition(.opacity)
        }
      }.frame(maxWidth: .infinity, maxHeight: .infinity)
    }
  }
}

/// Every page sits on the same dark stage under a transparent toolbar: the clip in Studio
/// (dimmed outside DJ), the cover in Compact. Reading panels retain stable contrast.
private struct Shell<Content: View>: View {
  @ObservedObject var player: Player
  let current: Track?
  let focused: Bool
  @ObservedObject var immersion: StudioImmersion
  @ViewBuilder var content: Content
  var body: some View {
    content
      .background {
        Group {
          if player.studio {
            StageBackground(player: player, current: current)
          } else {
            AmbientBackground(current: current)
          }
        }.ignoresSafeArea().allowsHitTesting(false).transition(.opacity)
      }
      .environment(\.surface, focused ? .immersive : .reading)
      .environment(\.studioControlsVisible, immersion.visible)
      .onChange(
        of: focused && player.studio && player.playing && current != nil && player.failure.isEmpty
          && !NSWorkspace.shared.isVoiceOverEnabled,
        initial: true
      ) { _, enabled in
        immersion.configure(enabled: enabled)
      }
      .onDisappear { immersion.stop() }
      .toolbarBackground(.hidden, for: .windowToolbar)
      .animation(.easeInOut(duration: 0.3), value: player.studio)
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

/// Off: the compact player beside your work. On: Studio, the clip behind every page.
private struct DisplayPicker: View {
  @ObservedObject var player: Player
  let wide: Bool
  var body: some View {
    Toggle(
      isOn: Binding(
        get: { player.studio },
        set: { studio in
          player.setStudio(studio)
          fitWindow(studio: studio)
        })
    ) {
      Label("Studio", systemImage: "play.rectangle.on.rectangle")
    }.toggleStyle(ToolbarToggleStyle())
      .help(
        "Studio : le clip en plein cadre derrière chaque page, lu depuis un cache privé quand c’est possible."
      )
  }
  private func fitWindow(studio: Bool) {
    guard let window = NSApp.keyWindow, !window.styleMask.contains(.fullScreen) else { return }
    var frame = window.frame
    frame.size.width = studio || wide ? max(frame.width, 1180) : min(frame.width, 600)
    if let screen = window.screen { frame = window.constrainFrameRect(frame, to: screen) }
    window.setFrame(frame, display: true, animate: true)
  }
}

/// The app is dark in both modes; Studio needs at least 900 points of width.
private struct WindowAppearance: NSViewRepresentable {
  @ObservedObject var player: Player
  let discovery: Bool
  func makeNSView(context: Context) -> NSView { NSView() }
  func updateNSView(_ view: NSView, context: Context) {
    let studio = player.studio
    DispatchQueue.main.async {
      guard let window = view.window else { return }
      if window.appearance?.name != .darkAqua {
        window.appearance = NSAppearance(named: .darkAqua)
      }
      let minimumWidth: CGFloat = studio || discovery ? 900 : 600
      if window.contentMinSize.width != minimumWidth {
        window.contentMinSize.width = minimumWidth
      }
      guard window.frame.width < window.contentMinSize.width,
        !window.styleMask.contains(.fullScreen)
      else { return }
      var frame = window.frame
      frame.size.width = window.contentMinSize.width
      window.setFrame(frame, display: true, animate: true)
    }
  }
}
