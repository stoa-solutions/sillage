import AppKit
import Combine
import RecallKit
import SwiftUI

/// Sillage outside its window: the global microphone shortcut, the listening pill, the menu bar
/// and the Dock presence. The DJ itself stays in `DJModel`; this only routes gestures to it.
@MainActor
final class DeskIntegration: ObservableObject {
  /// nil when the person removed the shortcut.
  @Published private(set) var shortcut: DeskShortcut?
  @Published private(set) var shortcutIssue = ""
  @Published var dictationMusic: DictationMusic {
    didSet { UserDefaults.standard.set(dictationMusic.rawValue, forKey: "dictationMusic") }
  }
  @Published var showsPill: Bool {
    didSet { UserDefaults.standard.set(showsPill, forKey: "deskPill") }
  }
  @Published var pillPlacement: DeskPillPlacement {
    didSet {
      UserDefaults.standard.set(pillPlacement.rawValue, forKey: "deskPillPlacement")
      pill.forgetPosition()
    }
  }
  @Published var hidesDockWhenClosed: Bool {
    didSet {
      UserDefaults.standard.set(hidesDockWhenClosed, forKey: "hideDockWhenClosed")
      applyDockPolicy()
    }
  }
  @Published private(set) var mainWindowOpen = false
  /// Set by the menu bar label, the one view alive for the whole session.
  var openWindowAction: (() -> Void)?

  let dj: DJModel
  let pill: DeskPill
  private let hotKey = DeskHotKey()
  private var gesture = PushToTalkGesture()
  private var keyHeld = false
  private var dictationSeen = false
  private var subscriptions: Set<AnyCancellable> = []
  private var qaWindow: NSWindow?

  init(dj: DJModel, session: Session) {
    self.dj = dj
    pill = DeskPill(dj: dj, session: session)
    let defaults = UserDefaults.standard
    dictationMusic =
      DictationMusic(rawValue: defaults.string(forKey: "dictationMusic") ?? "") ?? .duck
    showsPill = defaults.object(forKey: "deskPill") as? Bool ?? true
    pillPlacement =
      DeskPillPlacement(rawValue: defaults.string(forKey: "deskPillPlacement") ?? "") ?? .automatic
    hidesDockWhenClosed = defaults.object(forKey: "hideDockWhenClosed") as? Bool ?? true
    if defaults.bool(forKey: "deskShortcutRemoved") {
      shortcut = nil
    } else if let data = defaults.data(forKey: "deskShortcut"),
      let saved = try? JSONDecoder().decode(DeskShortcut.self, from: data), saved.isUsable
    {
      shortcut = saved
    } else {
      shortcut = .standard
    }
    pill.placement = { [weak self] in self?.pillPlacement ?? .automatic }
    hotKey.onEvent = { [weak self] in self?.handle($0) }
    dj.microphone.objectWillChange.sink { [weak self] _ in
      // Published fires before the value is stored.
      Task { @MainActor in self?.microphoneChanged() }
    }.store(in: &subscriptions)
    registerShortcut()
    if let preview = ProcessInfo.processInfo.environment["SILLAGE_QA_PILL"] {
      Task { @MainActor [pill] in
        try? await Task.sleep(nanoseconds: 1_500_000_000)
        pill.preview(preview)
      }
    }
    if ProcessInfo.processInfo.environment["SILLAGE_QA_MENU"] == "1" {
      // The menu bar window cannot be opened by code: the same view in a plain window.
      let window = NSWindow(
        contentRect: NSRect(x: 200, y: 200, width: 330, height: 420),
        styleMask: [.titled], backing: .buffered, defer: false)
      window.title = "QA menu"
      window.contentView = NSHostingView(
        rootView: DeskMenu(desk: self, dj: dj, player: dj.player, microphone: dj.microphone)
          .tint(.recall))
      window.makeKeyAndOrderFront(nil)
      qaWindow = window
    }
  }

  // MARK: - Shortcut

  /// Records a new shortcut; nil removes it. Returns false when it cannot be used.
  @discardableResult func setShortcut(_ value: DeskShortcut?) -> Bool {
    let previous = shortcut
    shortcut = value
    guard registerShortcut() else {
      shortcut = previous
      registerShortcut(keepingIssue: true)
      return false
    }
    let defaults = UserDefaults.standard
    defaults.set(value == nil, forKey: "deskShortcutRemoved")
    if let value, let data = try? JSONEncoder().encode(value) {
      defaults.set(data, forKey: "deskShortcut")
    }
    return true
  }

  /// The recorder listens to every key while it is open, including the current shortcut.
  func suspendShortcut() { hotKey.unregister() }
  func resumeShortcut() { registerShortcut() }

  @discardableResult private func registerShortcut(keepingIssue: Bool = false) -> Bool {
    hotKey.unregister()
    guard let shortcut else {
      if !keepingIssue { shortcutIssue = "" }
      return true
    }
    guard shortcut.isUsable else {
      shortcutIssue = "Ajoute ⌃, ⌥ ou ⌘ pour qu’il fonctionne partout."
      return false
    }
    switch hotKey.register(shortcut) {
    case nil:
      if !keepingIssue { shortcutIssue = "" }
      return true
    case .reservedBySystem:
      shortcutIssue =
        "macOS utilise déjà \(shortcut.display). Choisis-en un autre ou libère-le dans Réglages Système → Clavier."
      return false
    case .taken:
      shortcutIssue = "Une autre app utilise déjà \(shortcut.display)."
      return false
    }
  }

  // MARK: - Microphone gesture

  private func handle(_ event: DeskHotKey.Event) {
    let now = ProcessInfo.processInfo.systemUptime
    switch event {
    case .pressed:
      keyHeld = true
      perform(gesture.pressed(at: now))
    case .released:
      keyHeld = false
      if dj.microphone.starting {
        gesture.releasedWhileStarting()
        pill.handsFree = true
        return
      }
      let action = gesture.released(at: now)
      pill.handsFree = gesture.listening
      perform(action)
    }
  }

  private func perform(_ action: PushToTalkGesture.Action?) {
    switch action {
    case .start:
      startDictation()
    case .submit:
      dj.microphone.stop(submit: true)
    case nil:
      break
    }
  }

  /// Also used by the menu bar's microphone button.
  func startDictation(showingPill: Bool = true) {
    // Playback lives in the main window: bring it back before the DJ answers.
    if !mainWindowOpen { openMainWindow(activating: false) }
    dictationSeen = false
    pill.handsFree = false
    guard !dj.microphone.active else { return }
    dj.toggleMicrophone()
    if showingPill && showsPill { pill.listen(shortcut: shortcut) }
  }

  private func microphoneChanged() {
    if dj.microphone.active {
      dictationSeen = true
    } else if dictationSeen {
      dictationSeen = false
      gesture.dictationEnded(keyHeld: keyHeld)
    }
  }

  // MARK: - Window and Dock

  func mainWindowAppeared() {
    mainWindowOpen = true
    applyDockPolicy()
  }
  func mainWindowClosed() {
    mainWindowOpen = false
    applyDockPolicy()
  }
  /// Without the menu bar sign, the Dock stays the way back to Sillage.
  func applyDockPolicy() {
    let menuBar = UserDefaults.standard.object(forKey: "showsMenuBarExtra") as? Bool ?? true
    let policy: NSApplication.ActivationPolicy =
      mainWindowOpen || !hidesDockWhenClosed || !menuBar ? .regular : .accessory
    if NSApp.activationPolicy() != policy { NSApp.setActivationPolicy(policy) }
  }

  func openMainWindow(activating: Bool = true) {
    if let window = NSApp.windows.first(where: Self.isMainWindow) {
      if window.isMiniaturized { window.deminiaturize(nil) }
      if activating {
        window.makeKeyAndOrderFront(nil)
      } else {
        window.orderFront(nil)
      }
    } else {
      openWindowAction?()
    }
    if activating { NSApp.activate(ignoringOtherApps: true) }
  }
  private static func isMainWindow(_ window: NSWindow) -> Bool {
    window.identifier?.rawValue.hasPrefix(RecallApp.mainWindowID) == true
  }
}

/// Keys as Raycast and the menus draw them: one small cap per symbol.
struct Keycaps: View {
  let shortcut: DeskShortcut
  var prominent = false
  var body: some View {
    HStack(spacing: 3) {
      ForEach(Array(shortcut.keycaps.enumerated()), id: \.offset) { _, cap in
        Text(cap).font(.system(size: 11, weight: .medium, design: .rounded))
          .padding(.horizontal, cap.count > 1 ? 6 : 0).frame(minWidth: 20, minHeight: 20)
          .background(
            RoundedRectangle(cornerRadius: 5, style: .continuous)
              .fill(prominent ? Color.recall.opacity(0.18) : Color.primary.opacity(0.08))
          )
          .overlay(
            RoundedRectangle(cornerRadius: 5, style: .continuous)
              .strokeBorder(Color.primary.opacity(0.1), lineWidth: 0.5))
      }
    }.accessibilityElement(children: .ignore).accessibilityLabel(shortcut.display)
  }
}

/// The Sillage sign reduced to one line for the menu bar: the ribbon rises, arches over, comes
/// down on the right and curls back inside the arch, like the sculpture.
enum SillageGlyph {
  static func image(listening: Bool) -> NSImage {
    let image = NSImage(size: NSSize(width: 18, height: 18), flipped: false) { _ in
      (listening ? NSColor(Color.recall) : .black).setStroke()
      let ribbon = NSBezierPath()
      ribbon.move(to: NSPoint(x: 3.4, y: 2.4))
      ribbon.curve(
        to: NSPoint(x: 9.4, y: 15.4), controlPoint1: NSPoint(x: 3.0, y: 9.4),
        controlPoint2: NSPoint(x: 5.4, y: 15.4))
      ribbon.curve(
        to: NSPoint(x: 15.0, y: 3.2), controlPoint1: NSPoint(x: 13.6, y: 15.4),
        controlPoint2: NSPoint(x: 15.6, y: 9.2))
      ribbon.curve(
        to: NSPoint(x: 10.2, y: 8.8), controlPoint1: NSPoint(x: 13.6, y: 1.4),
        controlPoint2: NSPoint(x: 9.6, y: 3.8))
      ribbon.lineWidth = 2.2
      ribbon.lineCapStyle = .round
      ribbon.lineJoinStyle = .round
      ribbon.stroke()
      return true
    }
    // Template: macOS tints it for light, dark and tinted menu bars. Orange only while listening.
    image.isTemplate = !listening
    image.accessibilityDescription = listening ? "Sillage écoute" : "Sillage"
    return image
  }
}
