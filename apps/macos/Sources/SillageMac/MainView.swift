import AppKit
import SillageKit
import SwiftUI

extension Color {
  /// Sillage action accent: Stoa orange on dark surfaces, deep orange on light ones.
  static let sillageOrange = Color(
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
    value += nextValue()
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
  @Environment(\.openSettings) private var openSettings
  /// Compact's narrow toolbar: smaller tabs and an icon-only Studio toggle, nothing hidden.
  private var pocket: Bool { section == .dj && !dj.player.studio }
  /// The Studio clip fills the window only on the DJ page; lists keep the Stoa backdrop.
  private var stage: Bool { section == .dj && dj.player.studio }
  private var presentation: WindowPresentation {
    section == .dj && !dj.player.studio
      ? .compact(restHeight: compactRestHeight, panelOpen: !panelCollapsed) : .reading
  }
  /// The window depends on the player (Studio on or off), which MainView does not observe
  /// by itself: the scene is rebuilt whenever the player changes.
  var body: some View {
    ObservingPlayer(player: dj.player) { scene }
      // Recette: a test build opens Réglages on a page (SILLAGE_QA_SETTINGS=taste), no click.
      .task { if SettingsPage.qaPage != nil { openSettings() } }
  }

  private var scene: some View {
    Shell(
      player: dj.player, current: dj.current, focused: section == .dj && !session.showOnboarding,
      stage: stage, immersion: immersion
    ) {
      page
    }
    .onPreferenceChange(CompactRestHeightKey.self) { compactRestHeight = $0 }
    // Minimums protect the controls; WindowSizer fits Compact (width up to 620, a folded pocket
    // snaps back to its height after a drag). No hard maximum: banners and full screen must
    // always be able to grow the window.
    .frame(minWidth: minimumWidth, minHeight: minimumHeight)
    .toolbar {
      ToolbarItem(placement: .principal) {
        // Every page stays one click away, Compact included (⌘1, ⌘2, ⌘3 too); opening
        // Bibliothèque or Découvrir from Compact grows the window to the reading size.
        picker.controlSize(pocket ? .small : .regular)
      }.withoutSystemBackground()
      ToolbarItem(placement: .primaryAction) {
        HStack(spacing: 10) {
          DisplayPicker(player: dj.player, iconOnly: pocket)
          SettingsLink {
            Image(systemName: "gearshape").frame(width: 24, height: 24).contentShape(Rectangle())
          }
          .help("Réglages").accessibilityLabel("Réglages")
        }
        .buttonStyle(.plain)
        .padding(.horizontal, pocket ? 9 : 12).padding(.vertical, pocket ? 5 : 7)
        .background {
          Capsule().fill(Color.primary.opacity(0.07))
            .overlay(Capsule().strokeBorder(Color.primary.opacity(0.08)))
        }
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
    // Page shortcuts, available everywhere and the only tab access in the pocket.
    .background {
      Group {
        Button("DJ") { section = .dj }.keyboardShortcut("1")
        Button("Bibliothèque") { section = .library }.keyboardShortcut("2")
        Button("Découvrir") { section = .discover }.keyboardShortcut("3")
      }.opacity(0).frame(width: 0, height: 0).accessibilityHidden(true)
    }
    .background(WindowSizer(presentation: presentation, animate: !reduceMotion))
    .tint(.sillageOrange)
    .animation(reduceMotion ? nil : .easeInOut(duration: 0.25), value: section)
    .sheet(isPresented: $session.showOnboarding) {
      OnboardingView().environmentObject(session).environmentObject(library)
    }
    .onChange(of: session.showOnboarding) { _, showing in
      if !showing && session.hasServer && library.libraryCount == 0 { section = .library }
    }
  }

  private var picker: some View {
    Picker("Vue", selection: $section) {
      Text("DJ").tag(Destination.dj)
      Text("Bibliothèque").tag(Destination.library)
      Text("Découvrir").tag(Destination.discover)
    }.pickerStyle(.segmented).fixedSize().neutralSelection().studioChrome(immersion.visible)
  }

  private var minimumWidth: CGFloat {
    CGFloat(SillageWindowLayout.minimumWidth(studio: dj.player.studio, reading: section != .dj))
  }
  private var minimumHeight: CGFloat {
    if case .compact(let rest, let open) = presentation {
      return CGFloat(
        SillageWindowLayout.compactMinimumHeight(restHeight: Double(rest), panelOpen: open))
    }
    return CGFloat(
      SillageWindowLayout.minimumHeight(studio: dj.player.studio, reading: section != .dj))
  }

  /// Banners on top, then the page; pages fade into each other.
  @ViewBuilder private var page: some View {
    VStack(spacing: 0) {
      VStack(spacing: 0) {
        if !session.error.isEmpty {
          Banner(text: session.error, symbol: "exclamationmark.triangle.fill", color: .orange) {
            session.error = ""
          }
        }
        if !session.notice.isEmpty {
          Banner(text: session.notice, symbol: "info.circle.fill", color: .sillageOrange) {
            session.notice = ""
          }
        }
      }
      // Banners sit above the pocket: Compact's height includes them.
      .background {
        GeometryReader { proxy in
          Color.clear.preference(key: CompactRestHeightKey.self, value: proxy.size.height)
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

private struct ObservingPlayer<Content: View>: View {
  @ObservedObject var player: Player
  @ViewBuilder var content: () -> Content
  var body: some View { content() }
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
      // The toolbar band is the same glass as the page under it, edged by a faint rule.
      // An overlay keeps the content's safe area, so the toolbar height is measurable; the band
      // sits above the content, where nothing else is drawn.
      .overlay(alignment: .top) {
        if !stage {
          GeometryReader { geometry in
            Color.clear.sillageSurface(.chrome)
              .overlay(alignment: .bottom) { SillageRule() }
              .frame(height: geometry.safeAreaInsets.top)
              .offset(y: -geometry.safeAreaInsets.top)
          }.allowsHitTesting(false).accessibilityHidden(true)
        }
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
  /// Compact's narrow toolbar keeps the tabs and shows Studio as its icon only.
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

/// Applies SillageWindowLayout when the presentation changes: Compact follows its content
/// under a fixed top edge, reading pages return to the size the person last chose.
/// Switching between reading tabs never resizes; neither does the person's own resizing get
/// undone: a pocket height change only applies while the window still has the size we gave it.
private struct WindowSizer: NSViewRepresentable {
  let presentation: WindowPresentation
  let animate: Bool
  func makeCoordinator() -> Coordinator { Coordinator() }
  func makeNSView(context: Context) -> NSView { NSView() }
  func updateNSView(_ view: NSView, context: Context) {
    let presentation = presentation
    let animate = animate
    let coordinator = context.coordinator
    DispatchQueue.main.async {
      coordinator.request(presentation, in: view.window, animate: animate)
    }
  }

  @MainActor final class Coordinator {
    private var requested: WindowPresentation?
    private var applied: WindowPresentation?
    private var appliedFrame: NSRect?
    private var readingSize: (width: Double, height: Double)?
    private var compactWidth: Double?
    /// The pocket's home top edge while its panel is open.
    private var anchorTop: Double?
    private weak var window: NSWindow?
    private var resizing = false
    nonisolated(unsafe) private var observers: [NSObjectProtocol] = []

    deinit { observers.forEach(NotificationCenter.default.removeObserver) }

    func request(_ presentation: WindowPresentation, in window: NSWindow?, animate: Bool) {
      guard let window else { return }
      watch(window)
      requested = presentation
      apply(animate: animate)
    }

    private func apply(animate: Bool) {
      guard let window, let presentation = requested, !window.inLiveResize,
        !window.styleMask.contains(.fullScreen), let screen = window.screen ?? NSScreen.main
      else { return }
      if case .compact(let rest, _) = presentation, rest <= 0 { return }
      guard presentation != applied else { return }
      let previous = applied
      applied = presentation
      let current = rect(window.frame)
      let visible = rect(screen.visibleFrame)
      let target: LayoutRect
      switch (previous, presentation) {
      case (nil, .reading):
        // Launch: keep the restored window unless it is still pocket-sized.
        guard SillageWindowLayout.needsReadingSize(current) else { return }
        target = SillageWindowLayout.readingFrame(
          from: current, rememberedSize: readingSize, visible: visible)
      case (_, .reading):
        anchorTop = nil
        target = SillageWindowLayout.readingFrame(
          from: current, rememberedSize: readingSize, visible: visible)
      case (.compact(_, let wasOpen)?, .compact(let rest, let open)) where wasOpen == open:
        // Only the pocket's content changed: follow it unless the person resized the window
        // (appliedFrame is cleared then). Moving the window does not count.
        guard !open, let appliedFrame, window.frame.size == appliedFrame.size else { return }
        target = compact(rest: rest, open: open, from: current, in: window, visible: visible)
      case (_, .compact(let rest, let open)):
        if open && anchorTop == nil { anchorTop = current.maxY }
        target = compact(rest: rest, open: open, from: current, in: window, visible: visible)
        if !open { anchorTop = nil }
      }
      let frame = NSRect(x: target.x, y: target.y, width: target.width, height: target.height)
      appliedFrame = frame
      if frame != window.frame {
        // Our own move must not reset the pocket's home.
        resizing = true
        window.setFrame(frame, display: true, animate: animate)
        resizing = false
      }
    }

    private func compact(
      rest: CGFloat, open: Bool, from current: LayoutRect, in window: NSWindow,
      visible: LayoutRect
    ) -> LayoutRect {
      let chrome = window.frame.height - window.contentLayoutRect.height
      return SillageWindowLayout.compactFrame(
        from: current, rememberedWidth: compactWidth, restHeight: Double(rest + chrome),
        panelOpen: open, visible: visible, anchorTop: anchorTop)
    }

    /// The person's own resizing becomes the remembered size of that presentation; leaving
    /// full screen applies whatever was asked meanwhile.
    private func watch(_ window: NSWindow) {
      guard self.window !== window else { return }
      self.window = window
      let center = NotificationCenter.default
      observers.append(
        center.addObserver(
          forName: NSWindow.didEndLiveResizeNotification, object: window, queue: .main
        ) { [weak self] note in
          guard let window = note.object as? NSWindow else { return }
          MainActor.assumeIsolated {
            guard let self else { return }
            switch self.applied {
            case .reading:
              self.readingSize = (Double(window.frame.width), Double(window.frame.height))
            case .compact(_, let open):
              self.compactWidth = Double(window.frame.width)
              self.anchorTop = nil
              if open {
                // A height the person chose for the open panel stays until it folds.
                self.appliedFrame = nil
              } else {
                // A folded pocket only has its content's height: refit, keeping the width
                // (up to 620).
                self.applied = nil
              }
            case nil: break
            }
            if case .reading = self.applied { self.appliedFrame = window.frame }
            // Whatever was asked during the drag is applied now.
            self.apply(animate: false)
          }
        })
      observers.append(
        center.addObserver(forName: NSWindow.didMoveNotification, object: window, queue: .main) {
          [weak self] _ in
          // A window moved by hand has a new home: folding returns under its new top edge.
          MainActor.assumeIsolated {
            guard let self, !self.resizing else { return }
            self.anchorTop = nil
          }
        })
      observers.append(
        center.addObserver(
          forName: NSWindow.didExitFullScreenNotification, object: window, queue: .main
        ) { [weak self] _ in
          MainActor.assumeIsolated {
            self?.applied = nil
            self?.apply(animate: false)
          }
        })
    }

    private func rect(_ frame: NSRect) -> LayoutRect {
      LayoutRect(
        x: Double(frame.minX), y: Double(frame.minY), width: Double(frame.width),
        height: Double(frame.height))
    }
  }
}
