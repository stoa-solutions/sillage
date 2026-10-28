import AppKit
import Combine
import SillageAudio
import SillageKit
import SwiftUI

enum DeskPillPlacement: String, CaseIterable, Identifiable {
  /// Out of the MacBook notch when the screen has one, otherwise at the bottom.
  case automatic
  case bottom
  var id: String { rawValue }
  var label: String {
    switch self {
    case .automatic: return "Encoche si disponible"
    case .bottom: return "En bas de l’écran"
    }
  }
}

/// The small listening surface shown over other apps after the global shortcut: it follows the
/// dictation, then the DJ's search, then shows the answer for a moment. It never takes focus.
@MainActor
final class DeskPill: ObservableObject {
  enum Phase: Equatable {
    case hidden
    case listening
    case finishing
    case thinking
    case reply(String, Track?)
    case problem(String)
  }
  /// Where the dictation and the DJ are; `shown` follows it with animation once on screen.
  private(set) var phase = Phase.hidden
  @Published private(set) var shown = Phase.hidden
  @Published var handsFree = false
  @Published private(set) var levels = Array(repeating: Float(0), count: 24)
  @Published private(set) var notch = false
  /// Height of the notch: the pill's content starts below it.
  @Published private(set) var notchHeight: CGFloat = 0
  @Published private(set) var shortcut: DeskShortcut?
  var placement: () -> DeskPillPlacement = { .automatic }

  let dj: DJModel
  private let session: Session
  private var panel: DeskPanel?
  private var hideTask: Task<Void, Never>?
  private var subscriptions: Set<AnyCancellable> = []
  private var errorAtStart = ""
  private var demoTask: Task<Void, Never>?
  /// Hovering keeps an answer on screen; leaving gives it a few more seconds.
  private var hovering = false
  private static let size = NSSize(width: 500, height: 210)

  init(dj: DJModel, session: Session) {
    self.dj = dj
    self.session = session
    dj.microphone.objectWillChange.sink { [weak self] _ in
      Task { @MainActor in self?.update() }
    }.store(in: &subscriptions)
    dj.listeningChanges.sink { [weak self] _ in
      Task { @MainActor in self?.update() }
    }.store(in: &subscriptions)
    dj.microphone.meter.$level.sink { [weak self] level in
      guard let self, self.phase == .listening else { return }
      self.levels.removeFirst()
      self.levels.append(level)
    }.store(in: &subscriptions)
  }

  func listen(shortcut: DeskShortcut?) {
    self.shortcut = shortcut
    errorAtStart = session.error
    levels = Array(repeating: 0, count: levels.count)
    show(.listening)
  }

  /// The whole sequence with a simulated voice: Réglages → Bureau → Essayer, and the visual QA
  /// (`SILLAGE_QA_PILL=demo|listening|thinking|reply|problem`). No microphone, no server.
  func demo(shortcut: DeskShortcut?) {
    demoTask?.cancel()
    self.shortcut = shortcut ?? .standard
    handsFree = false
    demoTask = Task { [weak self] in
      guard let self else { return }
      self.show(.listening)
      let started = Date()
      while Date().timeIntervalSince(started) < 2.8, !Task.isCancelled {
        self.levels.removeFirst()
        self.levels.append(Self.simulatedVoice(at: Date().timeIntervalSince(started)))
        try? await Task.sleep(nanoseconds: 33_000_000)
      }
      for (next, seconds) in [(Phase.finishing, 0.7), (.thinking, 1.9)] {
        guard !Task.isCancelled else { return }
        self.show(next)
        try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
      }
      guard !Task.isCancelled else { return }
      self.show(
        .reply(
          "Je lance une sélection soul douce pour bosser, en commençant par Masego.",
          self.dj.current), hidingAfter: 4.5)
      self.demoTask = nil
    }
  }

  func preview(_ name: String) {
    shortcut = .standard
    switch name {
    case "demo": demo(shortcut: .standard)
    case "listening":
      levels = (0..<levels.count).map { Self.simulatedVoice(at: Double($0) * 0.09) }
      show(.listening)
    case "thinking": show(.thinking)
    case "reply":
      // A real video ID (SILLAGE_QA_PILL_TRACK) shows the song card with its cover.
      let track = ProcessInfo.processInfo.environment["SILLAGE_QA_PILL_TRACK"].map {
        Track(id: $0, title: "Rick Astley - Never Gonna Give You Up", channel: "Rick Astley", durationSeconds: 213)
      }
      show(
        .reply("Je lance une sélection soul douce pour bosser, en commençant par Masego.", track))
    default: show(.problem("Je n’ai pas entendu de parole. Vérifie l’entrée audio et réessaie."))
    }
  }

  /// Syllables: a fast carrier under a slower phrase envelope, with a little grain.
  private static func simulatedVoice(at time: Double) -> Float {
    let phrase = max(0, sin(time * 2.1))
    let syllables = abs(sin(time * 11)) * 0.7 + abs(sin(time * 23 + 1)) * 0.3
    return Float(min(1, 0.08 + phrase * syllables * 0.95 + Double.random(in: 0...0.06)))
  }

  func cancel() {
    demoTask?.cancel()
    demoTask = nil
    dj.microphone.stop()
    hide()
  }

  func openSillage() {
    hide()
    NSApp.activate(ignoringOtherApps: true)
    NSApp.windows.first { $0.identifier?.rawValue.hasPrefix(SillageApp.mainWindowID) == true }?
      .makeKeyAndOrderFront(nil)
  }

  private func update() {
    guard demoTask == nil else { return }
    switch phase {
    case .hidden, .reply, .problem: return
    case .listening, .finishing, .thinking: break
    }
    let microphone = dj.microphone
    if microphone.active {
      show(microphone.finishing ? .finishing : .listening)
    } else if dj.busy {
      show(.thinking)
    } else if phase == .thinking {
      let reply = dj.messages.last { $0.role != "user" }?.content ?? ""
      show(.reply(Self.firstLines(reply), dj.current), hidingAfter: dj.current == nil ? 7 : 9)
    } else if session.error != errorAtStart, !session.error.isEmpty {
      show(.problem(session.error), hidingAfter: 5)
    } else {
      hide()
    }
  }

  private static func firstLines(_ text: String) -> String {
    let plain = text.replacingOccurrences(of: "**", with: "")
      .replacingOccurrences(of: #"\[\d+\]"#, with: "", options: .regularExpression)
    return String(plain.prefix(220))
  }

  // MARK: - Panel

  private func show(_ next: Phase, hidingAfter seconds: Double? = nil) {
    hideTask?.cancel()
    let appearing = phase == .hidden
    phase = next
    if appearing {
      present()
      // On screen first, then the entrance: the panel exists before the pill grows out of it.
      DispatchQueue.main.async { [weak self] in
        guard let self, self.phase != .hidden else { return }
        withAnimation(Self.motion) { self.shown = self.phase }
      }
    } else {
      withAnimation(Self.motion) { shown = next }
    }
    if let seconds, !hovering {
      hideTask = Task { [weak self] in
        try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
        guard !Task.isCancelled else { return }
        self?.hide()
      }
    }
  }

  func holdOpen(_ hovering: Bool) {
    self.hovering = hovering
    switch phase {
    case .reply, .problem:
      hideTask?.cancel()
      if !hovering { show(phase, hidingAfter: 3) }
    default: break
    }
  }

  func hide() {
    hideTask?.cancel()
    guard phase != .hidden else { return }
    phase = .hidden
    withAnimation(Self.reducedMotion ? .easeOut(duration: 0.2) : .smooth(duration: 0.32)) {
      shown = .hidden
    }
    let panel = panel
    Task {
      try? await Task.sleep(nanoseconds: 380_000_000)
      if self.phase == .hidden { panel?.orderOut(nil) }
    }
  }

  static var reducedMotion: Bool { NSWorkspace.shared.accessibilityDisplayShouldReduceMotion }
  /// A short, slightly elastic spring: the pill settles like a physical object.
  static var motion: Animation {
    reducedMotion ? .easeInOut(duration: 0.2) : .spring(response: 0.42, dampingFraction: 0.78)
  }

  func forgetPosition() {
    UserDefaults.standard.removeObject(forKey: "deskPillOrigin")
  }

  private func present() {
    let panel = panel ?? makePanel()
    self.panel = panel
    // The screen where the person is working: the one under the pointer.
    let qaScreen = ProcessInfo.processInfo.environment["SILLAGE_QA_PILL_SCREEN"].flatMap(Int.init)
    let screen =
      qaScreen.flatMap { NSScreen.screens.indices.contains($0) ? NSScreen.screens[$0] : nil }
      ?? NSScreen.screens.first { NSMouseInRect(NSEvent.mouseLocation, $0.frame, false) }
      ?? NSScreen.main
    guard let screen else { return }
    let hasNotch = screen.safeAreaInsets.top > 0
    notch = hasNotch && placement() == .automatic
    notchHeight = screen.safeAreaInsets.top
    let size = Self.size
    var origin: NSPoint
    if notch {
      origin = NSPoint(x: screen.frame.midX - size.width / 2, y: screen.frame.maxY - size.height)
    } else if let saved = UserDefaults.standard.string(forKey: "deskPillOrigin"),
      case let point = NSPointFromString(saved),
      NSScreen.screens.contains(where: {
        $0.visibleFrame.insetBy(dx: -40, dy: -40).contains(
          NSRect(origin: point, size: size).insetBy(dx: 60, dy: 40))
      })
    {
      origin = point
    } else {
      origin = NSPoint(
        x: screen.visibleFrame.midX - size.width / 2, y: screen.visibleFrame.minY + 28)
    }
    panel.isMovableByWindowBackground = !notch
    panel.setFrame(NSRect(origin: origin, size: size), display: false)
    panel.orderFrontRegardless()
  }

  private func makePanel() -> DeskPanel {
    let panel = DeskPanel(
      contentRect: NSRect(origin: .zero, size: Self.size),
      styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: true)
    panel.contentView = NSHostingView(rootView: DeskPillView(model: self))
    NotificationCenter.default.addObserver(
      forName: NSWindow.didMoveNotification, object: panel, queue: .main
    ) { [weak self] note in
      guard let window = note.object as? NSWindow else { return }
      MainActor.assumeIsolated {
        guard let self, !self.notch, self.phase != .hidden else { return }
        UserDefaults.standard.set(NSStringFromPoint(window.frame.origin), forKey: "deskPillOrigin")
      }
    }
    return panel
  }
}

/// Floats above full-screen apps and the menu bar without ever becoming the key window.
final class DeskPanel: NSPanel {
  override init(
    contentRect: NSRect, styleMask: NSWindow.StyleMask, backing: NSWindow.BackingStoreType,
    defer flag: Bool
  ) {
    super.init(contentRect: contentRect, styleMask: styleMask, backing: backing, defer: flag)
    collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
    isOpaque = false
    backgroundColor = .clear
    hasShadow = false
    hidesOnDeactivate = false
    // Before the level: a floating panel resets it to .floating.
    isFloatingPanel = true
    level = .statusBar
    becomesKeyOnlyIfNeeded = true
    isReleasedWhenClosed = false
    animationBehavior = .utilityWindow
  }
  override var canBecomeKey: Bool { false }
  override var canBecomeMain: Bool { false }
}

struct DeskPillView: View {
  @ObservedObject var model: DeskPill
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    VStack(spacing: 0) {
      if model.notch { pill } else { Spacer(minLength: 0) }
      if model.notch { Spacer(minLength: 0) } else { pill }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .environment(\.colorScheme, .dark)
  }

  @ViewBuilder private var pill: some View {
    if model.shown != .hidden {
      surface
        .shadow(color: .black.opacity(model.notch ? 0 : 0.35), radius: 18, y: 8)
        .shadow(color: Color.sillageOrange.opacity(glowShadow), radius: 20)
        .padding(.bottom, model.notch ? 0 : 30)
        .transition(entrance)
    }
  }

  private var glowShadow: Double { model.shown == .listening && !model.notch ? 0.08 : 0 }

  private var surface: some View {
    let inner: some View =
      content
      .id(phaseKey)
      .transition(reduceMotion ? AnyTransition.opacity : AnyTransition(.blurReplace))
      .padding(.horizontal, 16)
      .padding(.top, model.notch ? model.notchHeight + 6 : 11)
      .padding(.bottom, 11)
      .frame(width: width)
    return
      inner
      .background { background }
      .overlay { glow }
      .onHover { model.holdOpen($0) }
  }

  @ViewBuilder private var background: some View {
    ZStack {
      if model.notch {
        shape.fill(Color.black)
      } else {
        shape.fill(.ultraThinMaterial)
        shape.fill(Color.black.opacity(0.86))
      }
      if let track = shownTrack {
        // The cover's colours bleed into the glass, like a sleeve under smoked glass. Under the
        // notch they start below it, so the pill still grows out of pure black.
        Color.clear
          .overlay { Artwork.image(for: track, quality: "mqdefault") }
          .blur(radius: 38).saturation(1.35).opacity(0.42)
          .mask {
            LinearGradient(
              colors: [model.notch ? .clear : .black, .black], startPoint: .top,
              endPoint: .init(x: 0.5, y: 0.45))
          }
          .clipShape(shape)
          .transition(.opacity)
      }
      if !model.notch { shape.strokeBorder(Color.white.opacity(0.1), lineWidth: 0.5) }
    }
  }

  private var shownTrack: Track? {
    if case .reply(_, let track) = model.shown { return track }
    return nil
  }

  @ViewBuilder private var glow: some View {
    if model.shown == .listening {
      EdgeGlow(shape: shape, level: model.levels.last ?? 0, still: reduceMotion)
        .transition(.opacity)
    }
  }

  private var entrance: AnyTransition {
    if reduceMotion { return .opacity }
    // Out of the notch like the Dynamic Island; from below like a toast elsewhere.
    return model.notch
      ? .scale(scale: 0.3, anchor: .top).combined(with: .opacity)
      : .scale(scale: 0.86, anchor: .bottom).combined(with: .offset(y: 26))
        .combined(with: .opacity)
  }

  private var phaseKey: String {
    switch model.shown {
    case .hidden: return "hidden"
    case .listening: return "listening"
    case .finishing: return "finishing"
    case .thinking: return "thinking"
    case .reply: return "reply"
    case .problem: return "problem"
    }
  }

  private var width: CGFloat {
    switch model.shown {
    case .reply(_, let track): return track == nil ? 430 : 440
    case .finishing, .thinking: return 300
    case .problem: return 390
    default: return 360
    }
  }

  private var shape: UnevenRoundedRectangle {
    UnevenRoundedRectangle(
      topLeadingRadius: model.notch ? 0 : 24, bottomLeadingRadius: 24,
      bottomTrailingRadius: 24, topTrailingRadius: model.notch ? 0 : 24, style: .continuous)
  }

  @ViewBuilder private var content: some View {
    switch model.shown {
    case .hidden:
      EmptyView()
    case .listening:
      HStack(spacing: 12) {
        SignalDot(level: model.levels.last ?? 0, still: reduceMotion)
        VStack(spacing: 5) {
          Waveform(levels: model.levels).frame(height: 14)
          Text(caption).font(.system(size: 11.5)).foregroundStyle(.white.opacity(0.62))
            .lineLimit(1).truncationMode(.head).multilineTextAlignment(.center)
            .contentTransition(.interpolate)
            .animation(.smooth(duration: 0.2), value: caption)
        }.frame(maxWidth: .infinity)
        closeButton
      }
    case .finishing, .thinking:
      HStack(spacing: 12) {
        Color.clear.frame(width: 22, height: 22)
        HStack(spacing: 8) {
          ThinkingDots(still: reduceMotion)
          ShimmerText(
            text: model.shown == .finishing ? "Je termine la transcription…" : "Le DJ cherche…",
            still: reduceMotion)
        }.frame(maxWidth: .infinity)
        closeButton
      }
    case .reply(let text, let track?):
      DeskSongCard(
        model: model, player: model.dj.player, text: text, track: track, still: reduceMotion)
    case .reply(let text, nil):
      HStack(alignment: .center, spacing: 12) {
        Image(nsImage: SillageGlyph.image(listening: true)).frame(width: 22)
        Text(text).font(.system(size: 12)).foregroundStyle(.white.opacity(0.8))
          .lineLimit(3).multilineTextAlignment(.center).frame(maxWidth: .infinity)
        Button("Ouvrir") { model.openSillage() }.buttonStyle(.plain)
          .font(.system(size: 11, weight: .semibold)).foregroundStyle(Color.sillageOrange)
      }
    case .problem(let message):
      HStack(spacing: 12) {
        Image(systemName: "exclamationmark.circle").font(.system(size: 14, weight: .regular))
          .foregroundStyle(Color.sillageOrange).frame(width: 22)
          .symbolEffect(.bounce, options: .nonRepeating, value: message)
        Text(message).font(.system(size: 12)).foregroundStyle(.white.opacity(0.8))
          .lineLimit(2).multilineTextAlignment(.center).frame(maxWidth: .infinity)
        closeButton
      }
    }
  }

  /// What was heard so far, else how to send: one quiet centered line.
  private var caption: String {
    let text = model.dj.microphone.transcript
    if !text.isEmpty { return text }
    if model.dj.microphone.starting { return "Préparation du micro…" }
    if model.handsFree, let shortcut = model.shortcut {
      return "Je t’écoute · \(shortcut.keycaps.joined()) pour envoyer"
    }
    return "Je t’écoute · relâche pour envoyer"
  }

  private var closeButton: some View {
    Button {
      model.cancel()
    } label: {
      Image(systemName: "xmark").font(.system(size: 9, weight: .semibold))
        .foregroundStyle(.white.opacity(0.5)).frame(width: 22, height: 22)
        .background(Circle().fill(.white.opacity(0.07)))
    }.buttonStyle(.plain).accessibilityLabel("Annuler")
  }
}

/// An orange light that runs around the border while the microphone is open, brighter when the
/// voice is louder.
private struct EdgeGlow: View {
  let shape: UnevenRoundedRectangle
  let level: Float
  let still: Bool
  /// Mostly dark around the ring: one soft highlight travels, the rest stays quiet.
  private static let colors: [Color] = [
    Color.sillageOrange.opacity(0.9), Color(red: 1, green: 0.78, blue: 0.62).opacity(0.7),
    Color.sillageOrange.opacity(0.05), Color.sillageOrange.opacity(0), Color.sillageOrange.opacity(0.05),
    Color.sillageOrange.opacity(0.9),
  ]
  var body: some View {
    TimelineView(.animation(paused: still)) { context in
      let turn = still ? 0 : context.date.timeIntervalSinceReferenceDate * 50
      let gradient = AngularGradient(
        colors: Self.colors, center: .center,
        angle: .degrees(turn.truncatingRemainder(dividingBy: 360)))
      let energy = 0.35 + 0.4 * Double(level)
      ZStack {
        shape.strokeBorder(gradient, lineWidth: 0.8).opacity(energy)
        shape.strokeBorder(gradient, lineWidth: 2).blur(radius: 3).opacity(energy * 0.45)
      }
    }
    .allowsHitTesting(false)
    .animation(.easeOut(duration: 0.2), value: level)
  }
}

/// A light sweeping across the label, the way system intelligence features say "working".
private struct ShimmerText: View {
  let text: String
  let still: Bool
  var body: some View {
    let label = Text(text).font(.system(size: 12.5))
    label.foregroundStyle(.white.opacity(still ? 0.85 : 0.5))
      .overlay {
        if !still {
          TimelineView(.animation) { context in
            let progress =
              context.date.timeIntervalSinceReferenceDate
              .truncatingRemainder(dividingBy: 1.6) / 1.6
            GeometryReader { geometry in
              LinearGradient(
                colors: [.clear, .white, Color(red: 1, green: 0.8, blue: 0.68), .clear],
                startPoint: .leading, endPoint: .trailing
              )
              .frame(width: 70)
              .offset(x: -70 + (geometry.size.width + 140) * progress)
            }
          }
          .mask(label)
        }
      }
  }
}

/// Recent input loudness as rounded bars, newest on the right.
struct Waveform: View {
  let levels: [Float]
  var body: some View {
    HStack(alignment: .center, spacing: 3) {
      ForEach(Array(levels.enumerated()), id: \.offset) { index, level in
        // Older bars fade out to the left, so the newest sound reads first.
        Capsule().fill(Color.sillageOrange.opacity(0.25 + 0.75 * Double(index) / Double(levels.count)))
          .frame(width: 2, height: 2 + CGFloat(level) * 12)
      }
    }
    .animation(.easeOut(duration: 0.1), value: levels)
    .accessibilityHidden(true)
  }
}

/// Three orange dots in a wave while the DJ searches.
private struct ThinkingDots: View {
  var still = false
  var body: some View {
    TimelineView(.animation(paused: still)) { context in
      let time = context.date.timeIntervalSinceReferenceDate
      HStack(spacing: 4) {
        ForEach(0..<3, id: \.self) { index in
          let phase = sin(time * 5 - Double(index) * 0.7)
          Circle().fill(Color.sillageOrange).frame(width: 4, height: 4)
            .opacity(0.45 + 0.55 * max(0, phase)).offset(y: -1.5 * max(0, phase))
        }
      }.frame(width: 20, height: 22)
    }.accessibilityLabel("Recherche en cours")
  }
}

/// The orange signal that says the microphone is open; its halo breathes with the voice.
private struct SignalDot: View {
  let level: Float
  let still: Bool
  @State private var breathe = false
  var body: some View {
    ZStack {
      Circle().fill(Color.sillageOrange.opacity(0.14))
        .frame(width: 26, height: 26)
        .scaleEffect(still ? 1 : 0.82 + CGFloat(level) * 0.3 + (breathe ? 0.04 : 0))
      Image(systemName: "mic.fill").font(.system(size: 9.5, weight: .semibold))
        .foregroundStyle(.white).frame(width: 20, height: 20)
        .background(Circle().fill(Color.sillageOrange))
    }
    .animation(.easeOut(duration: 0.12), value: level)
    .onAppear {
      guard !still else { return }
      withAnimation(.easeInOut(duration: 1.1).repeatForever(autoreverses: true)) { breathe = true }
    }
    .accessibilityLabel("Micro ouvert")
  }
}

/// The song the DJ just started, presented like a record sleeve: the cover settles in, the title
/// rises after it, and the progress keeps running for as long as the card stays.
private struct DeskSongCard: View {
  let model: DeskPill
  @ObservedObject var player: Player
  let text: String
  let track: Track
  let still: Bool
  @State private var appeared = false

  var body: some View {
    let title = TrackTitle(track)
    VStack(alignment: .leading, spacing: 11) {
      HStack(alignment: .center, spacing: 13) {
        Artwork(track: track, showsDuration: false).frame(width: 98)
          .overlay {
            RoundedRectangle(cornerRadius: 6, style: .continuous)
              .strokeBorder(.white.opacity(0.1), lineWidth: 0.5)
          }
          .shadow(color: .black.opacity(0.5), radius: 10, y: 5)
          .scaleEffect(appeared ? 1 : 0.84, anchor: .leading)
          .opacity(appeared ? 1 : 0)
        VStack(alignment: .leading, spacing: 2) {
          HStack(spacing: 6) {
            Equalizer(playing: player.playing, still: still)
            Text(player.playing ? "LE DJ LANCE" : "PRÊT À JOUER")
              .font(.system(size: 9.5, weight: .semibold, design: .monospaced)).tracking(1.3)
              .foregroundStyle(Color.sillageOrange)
          }.padding(.bottom, 3)
          Text(title.title).font(.system(size: 14, weight: .semibold)).lineLimit(1)
          if let artist = title.artist ?? track.channel {
            Text(artist).font(.system(size: 11.5)).foregroundStyle(.white.opacity(0.58))
              .lineLimit(1)
          }
        }
        .foregroundStyle(.white)
        .offset(y: appeared ? 0 : 7).opacity(appeared ? 1 : 0)
        Spacer(minLength: 4)
        controls.opacity(appeared ? 1 : 0)
      }
      progress.opacity(appeared ? 1 : 0)
      if !text.isEmpty {
        HStack(alignment: .lastTextBaseline, spacing: 10) {
          Text(text).font(.system(size: 11.5)).foregroundStyle(.white.opacity(0.7))
            .lineLimit(2).fixedSize(horizontal: false, vertical: true)
          Spacer(minLength: 0)
          Button {
            model.openSillage()
          } label: {
            HStack(spacing: 2) {
              Text("Ouvrir")
              Image(systemName: "chevron.right").font(.system(size: 8, weight: .bold))
            }
          }
          .buttonStyle(.plain).font(.system(size: 11, weight: .semibold))
          .foregroundStyle(Color.sillageOrange)
        }
        .offset(y: appeared ? 0 : 5).opacity(appeared ? 1 : 0)
      }
    }
    .onAppear {
      guard !still else {
        appeared = true
        return
      }
      // Cover first, then the words: a short stagger reads as one gesture.
      withAnimation(.spring(response: 0.5, dampingFraction: 0.8).delay(0.05)) { appeared = true }
    }
  }

  private var controls: some View {
    HStack(spacing: 6) {
      button(player.playing ? "pause.fill" : "play.fill", prominent: true) {
        model.dj.togglePlayback()
      }.accessibilityLabel(player.playing ? "Pause" : "Lecture")
      button("forward.fill") { model.dj.next() }.accessibilityLabel("Morceau suivant")
      button("xmark", size: 8) { model.hide() }.accessibilityLabel("Fermer")
    }
  }

  private func button(
    _ symbol: String, prominent: Bool = false, size: CGFloat = 10,
    action: @escaping () -> Void
  ) -> some View {
    Button(action: action) {
      Image(systemName: symbol).font(.system(size: size, weight: .bold))
        .contentTransition(.symbolEffect(.replace))
        .foregroundStyle(prominent ? Color.black : .white.opacity(0.75))
        .frame(width: 26, height: 26)
        .background(Circle().fill(prominent ? Color.white : .white.opacity(0.09)))
        .contentShape(Circle())
    }.buttonStyle(.plain)
  }

  private var progress: some View {
    let duration = player.duration > 0 ? player.duration : track.durationSeconds ?? 0
    let fraction = duration > 0 ? min(1, player.elapsed / duration) : 0
    return HStack(spacing: 8) {
      Text(clock(player.elapsed))
      GeometryReader { geometry in
        ZStack(alignment: .leading) {
          Capsule().fill(.white.opacity(0.12))
          Capsule().fill(Color.sillageOrange)
            .frame(width: max(2, geometry.size.width * fraction * (appeared ? 1 : 0)))
        }
      }
      .frame(height: 2.5)
      .animation(.linear(duration: 0.5), value: fraction)
      Text(clock(duration))
    }
    .font(.system(size: 9.5, design: .monospaced)).foregroundStyle(.white.opacity(0.45))
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("Position \(clock(player.elapsed)) sur \(clock(duration))")
  }
}

/// Three bars dancing while the song plays, resting low when it pauses.
private struct Equalizer: View {
  let playing: Bool
  let still: Bool
  var body: some View {
    TimelineView(.animation(paused: still || !playing)) { context in
      let time = context.date.timeIntervalSinceReferenceDate
      HStack(alignment: .bottom, spacing: 1.5) {
        ForEach(0..<3, id: \.self) { index in
          let wave = (sin(time * (6.5 + Double(index) * 2.3) + Double(index) * 1.7) + 1) / 2
          Capsule().fill(Color.sillageOrange)
            .frame(width: 2, height: playing && !still ? 3 + 6 * wave : 3)
        }
      }
      .frame(width: 9, height: 9, alignment: .bottom)
    }
    .accessibilityHidden(true)
  }
}
