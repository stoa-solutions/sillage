import AppKit
import RecallKit
import SwiftUI

extension Color {
  /// Sillage action accent: Stoa orange on dark surfaces, deep orange on light ones.
  static let recall = Color(
    nsColor: NSColor(name: nil) { appearance in
      appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
        ? NSColor(red: 0xF1 / 255, green: 0x5A / 255, blue: 0x24 / 255, alpha: 1)
        : NSColor(red: 0xBD / 255, green: 0x3B / 255, blue: 0x12 / 255, alpha: 1)
    })
}

private enum Destination: String, Hashable { case dj, library, discover }

/// The pocket height Compact reports, so the window can follow its content.
struct CompactRestHeightKey: PreferenceKey {
  static let defaultValue: CGFloat = 0
  static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
    value = max(value, nextValue())
  }
}

struct MainView: View {
  @EnvironmentObject var session: Session
  @EnvironmentObject var library: LibraryModel
  @EnvironmentObject var dj: DJModel
  @StateObject private var immersion = StudioImmersion()
  // Recette: a test build can open on a given page without scripted clicks.
  @State private var section =
    ProcessInfo.processInfo.environment["SILLAGE_QA_SECTION"].flatMap(Destination.init)
    ?? .dj
  @State private var compactRestHeight: CGFloat = 0
  @AppStorage("djPanelCollapsed") private var panelCollapsed = false
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  /// Compact's narrow toolbar: smaller tabs and an icon-only Studio toggle, nothing hidden.
  private var pocket: Bool { section == .dj && !dj.player.studio }
  /// The Studio clip fills the window only on the DJ page; lists keep the Stoa backdrop.
  private var stage: Bool { section == .dj && dj.player.studio }
  private var presentation: WindowPresentation {
    section == .dj && !dj.player.studio
      ? .compact(restHeight: compactRestHeight, panelOpen: !panelCollapsed) : .reading
  }
  var body: some View {
    Shell(
      player: dj.player, current: dj.current, focused: section == .dj && !session.showOnboarding,
      stage: stage, immersion: immersion
    ) {
      page
    }
    .onPreferenceChange(CompactRestHeightKey.self) { compactRestHeight = $0 }
    .frame(minWidth: minimumWidth, minHeight: minimumHeight)
    .toolbar {
      ToolbarItem(placement: .principal) {
        Picker("Vue", selection: $section) {
          Text("DJ").tag(Destination.dj)
          Text("Bibliothèque").tag(Destination.library)
          Text("Découvrir").tag(Destination.discover)
        }.pickerStyle(.segmented).fixedSize().neutralSelection()
          .controlSize(pocket ? .small : .regular).studioChrome(immersion.visible)
      }.withoutSystemBackground()
      ToolbarItem(placement: .primaryAction) {
        HStack(spacing: 10) {
          DisplayPicker(player: dj.player, iconOnly: pocket)
          SettingsLink { Image(systemName: "gearshape") }
            .help("Réglages").accessibilityLabel("Réglages")
        }
        .buttonStyle(.plain)
        .padding(.horizontal, pocket ? 9 : 12).padding(.vertical, pocket ? 5 : 7)
        .background(.ultraThinMaterial, in: Capsule())
        .studioChrome(immersion.visible)
      }.withoutSystemBackground()
    }
    .background(
      StudioActivity(immersion: immersion, visible: immersion.visible, reduceMotion: reduceMotion)
    )
    .animation(
      reduceMotion ? nil : .easeInOut(duration: immersion.visible ? 0.18 : 0.65),
      value: immersion.visible
    )
    .background(WindowAppearance(dark: stage))
    .background(WindowSizer(presentation: presentation, animate: !reduceMotion))
    .tint(.recall)
    .animation(reduceMotion ? nil : .easeInOut(duration: 0.25), value: section)
    .sheet(isPresented: $session.showOnboarding) {
      OnboardingView().environmentObject(session).environmentObject(library)
    }
    .onChange(of: session.showOnboarding) { _, showing in
      if !showing && session.hasServer && library.libraryCount == 0 { section = .library }
    }
  }

  private var minimumWidth: CGFloat {
    CGFloat(RecallWindowLayout.minimumWidth(studio: dj.player.studio, reading: section != .dj))
  }
  private var minimumHeight: CGFloat {
    CGFloat(RecallWindowLayout.minimumHeight(studio: dj.player.studio, reading: section != .dj))
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

/// Every page sits under a transparent toolbar: the Studio clip behind the DJ page, the
/// still Stoa backdrop everywhere else (no moving video behind lists).
private struct Shell<Content: View>: View {
  @ObservedObject var player: Player
  let current: Track?
  let focused: Bool
  let stage: Bool
  @ObservedObject var immersion: StudioImmersion
  @ViewBuilder var content: Content
  var body: some View {
    content
      .background {
        Group {
          if stage {
            StageBackground(player: player, current: current)
          } else {
            SillageBackdrop()
          }
        }.ignoresSafeArea().allowsHitTesting(false).transition(.opacity)
      }
      .environment(\.surface, stage && focused ? .immersive : .reading)
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

/// Off: the compact player beside your work. On: Studio, the clip fills the DJ page.
/// The window follows through WindowSizer; this toggle only changes the presentation.
private struct DisplayPicker: View {
  @ObservedObject var player: Player
  let iconOnly: Bool
  var body: some View {
    Toggle(
      isOn: Binding(get: { player.studio }, set: { player.setStudio($0) })
    ) {
      Label("Studio", systemImage: "play.rectangle.on.rectangle")
        .labelStyle(iconOnly ? AnyLabelStyle(.iconOnly) : AnyLabelStyle(.titleAndIcon))
    }.toggleStyle(ToolbarToggleStyle())
      .accessibilityLabel("Studio")
      .help(
        "Studio : le clip en plein cadre sur la page DJ, lu depuis un cache privé quand c’est possible."
      )
  }
}

/// The system decides light or dark; only the Studio stage keeps its dark protection,
/// toolbar included, so its controls stay legible over any clip.
private struct WindowAppearance: NSViewRepresentable {
  let dark: Bool
  func makeNSView(context: Context) -> NSView { NSView() }
  func updateNSView(_ view: NSView, context: Context) {
    let dark = dark
    DispatchQueue.main.async {
      guard let window = view.window else { return }
      let wanted = dark ? NSAppearance(named: .darkAqua) : nil
      if window.appearance?.name != wanted?.name { window.appearance = wanted }
    }
  }
}

enum WindowPresentation: Equatable {
  case compact(restHeight: CGFloat, panelOpen: Bool)
  case reading
}

/// Applies RecallWindowLayout when the presentation changes: Compact follows its content
/// under a fixed top edge, reading pages return to the size the person last chose.
/// Only presentation changes resize; switching between reading tabs never does.
private struct WindowSizer: NSViewRepresentable {
  let presentation: WindowPresentation
  let animate: Bool
  func makeCoordinator() -> Coordinator { Coordinator() }
  func makeNSView(context: Context) -> NSView { NSView() }
  func updateNSView(_ view: NSView, context: Context) {
    let presentation = presentation
    let animate = animate
    let coordinator = context.coordinator
    DispatchQueue.main.async { coordinator.apply(presentation, in: view.window, animate: animate) }
  }

  @MainActor final class Coordinator {
    private var applied: WindowPresentation?
    private var readingFrame: LayoutRect?
    private var compactWidth: Double?
    private var observer: NSObjectProtocol?

    func apply(_ presentation: WindowPresentation, in window: NSWindow?, animate: Bool) {
      guard let window, !window.styleMask.contains(.fullScreen),
        let screen = window.screen ?? NSScreen.main
      else { return }
      watchResizes(of: window)
      if case .compact(let rest, _) = presentation, rest <= 0 { return }
      guard presentation != applied else { return }
      let previous = applied
      applied = presentation
      // A first layout keeps the restored window; afterwards each change is applied.
      if previous == nil, case .reading = presentation { return }
      let current = rect(window.frame)
      let visible = rect(screen.visibleFrame)
      let target: LayoutRect
      switch presentation {
      case .reading:
        target = RecallWindowLayout.readingFrame(
          from: current, remembered: readingFrame, visible: visible)
      case .compact(let rest, let open):
        let chrome = window.frame.height - window.contentLayoutRect.height
        target = RecallWindowLayout.compactFrame(
          from: current, rememberedWidth: compactWidth, restHeight: Double(rest + chrome),
          panelOpen: open, visible: visible)
      }
      let frame = NSRect(x: target.x, y: target.y, width: target.width, height: target.height)
      if frame != window.frame { window.setFrame(frame, display: true, animate: animate) }
    }

    /// The person's own resizing becomes the remembered size of that presentation.
    private func watchResizes(of window: NSWindow) {
      guard observer == nil else { return }
      observer = NotificationCenter.default.addObserver(
        forName: NSWindow.didEndLiveResizeNotification, object: window, queue: .main
      ) { [weak self] note in
        guard let window = note.object as? NSWindow else { return }
        MainActor.assumeIsolated {
          switch self?.applied {
          case .reading: self?.readingFrame = self?.rect(window.frame)
          case .compact: self?.compactWidth = Double(window.frame.width)
          case nil: break
          }
        }
      }
    }

    private func rect(_ frame: NSRect) -> LayoutRect {
      LayoutRect(
        x: Double(frame.minX), y: Double(frame.minY), width: Double(frame.width),
        height: Double(frame.height))
    }
  }
}
