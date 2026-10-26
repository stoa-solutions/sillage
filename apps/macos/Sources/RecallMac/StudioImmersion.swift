import AppKit
import RecallKit
import SwiftUI

/// One sleeping task, not a polling timer or a new task for every mouse move.
@MainActor final class StudioImmersion: ObservableObject {
  @Published private(set) var visible = true
  private var policy = StudioChrome()
  private var task: Task<Void, Never>?
  private var now: TimeInterval { ProcessInfo.processInfo.systemUptime }
  func configure(enabled: Bool) {
    policy.configure(enabled: enabled, at: now)
    if !enabled {
      task?.cancel()
      task = nil
      reveal()
    } else {
      interact()
    }
  }
  func interact() {
    policy.interact(at: now)
    reveal()
    guard policy.enabled, task == nil else { return }
    task = Task { [weak self] in
      while !Task.isCancelled {
        guard let remaining = self?.policy.remaining(at: self?.now ?? 0) else { return }
        if remaining <= 0 { break }
        try? await Task.sleep(for: .seconds(remaining))
      }
      guard let self, !Task.isCancelled else { return }
      task = nil
      if !policy.visible(at: now) { visible = false }
    }
  }
  private func reveal() { if !visible { visible = true } }
  func stop() {
    task?.cancel()
    task = nil
  }
}

private struct StudioControlsVisibleKey: EnvironmentKey { static let defaultValue = true }
extension EnvironmentValues {
  var studioControlsVisible: Bool {
    get { self[StudioControlsVisibleKey.self] }
    set { self[StudioControlsVisibleKey.self] = newValue }
  }
}
extension View {
  /// Hide only chrome; its space stays reserved so the clip never changes size.
  func studioChrome(_ visible: Bool) -> some View {
    opacity(visible ? 1 : 0).allowsHitTesting(visible).accessibilityHidden(!visible)
  }
}

extension ToolbarContent {
  /// The system glass lives outside the label's opacity and can leave an empty capsule.
  /// Own the visible background inside the content instead, so it fades as one unit.
  @ToolbarContentBuilder func withoutSystemBackground() -> some ToolbarContent {
    if #available(macOS 26, *) {
      sharedBackgroundVisibility(.hidden)
    } else {
      self
    }
  }
}

/// App-local events only. It neither consumes input nor asks for global input permissions.
struct StudioActivity: NSViewRepresentable {
  let immersion: StudioImmersion
  let visible: Bool
  let reduceMotion: Bool
  func makeCoordinator() -> Coordinator { Coordinator(immersion) }
  func makeNSView(context: Context) -> NSView { NSView() }
  func updateNSView(_ view: NSView, context: Context) {
    DispatchQueue.main.async { [weak view] in
      guard let window = view?.window else { return }
      context.coordinator.attach(window)
      context.coordinator.showWindowControls(visible, animate: !reduceMotion)
    }
  }
  static func dismantleNSView(_ view: NSView, coordinator: Coordinator) { coordinator.detach() }

  @MainActor final class Coordinator {
    let immersion: StudioImmersion
    weak var window: NSWindow?
    var monitor: Any?
    var keyObserver: NSObjectProtocol?
    var previousMouseEvents = false
    init(_ immersion: StudioImmersion) { self.immersion = immersion }
    func attach(_ window: NSWindow) {
      guard self.window !== window else { return }
      detach()
      self.window = window
      previousMouseEvents = window.acceptsMouseMovedEvents
      window.acceptsMouseMovedEvents = true
      monitor = NSEvent.addLocalMonitorForEvents(matching: [
        .mouseMoved, .leftMouseDown, .leftMouseUp, .rightMouseDown, .rightMouseUp,
        .leftMouseDragged, .rightMouseDragged, .scrollWheel, .keyDown,
      ]) { [weak self] event in
        if let self, event.window === self.window || NSApp.keyWindow === self.window {
          self.immersion.interact()
        }
        return event
      }
      keyObserver = NotificationCenter.default.addObserver(
        forName: NSWindow.didBecomeKeyNotification, object: window, queue: .main
      ) { [weak self] _ in MainActor.assumeIsolated { self?.immersion.interact() } }
    }
    func showWindowControls(_ visible: Bool, animate: Bool) {
      guard let window else { return }
      for kind in [NSWindow.ButtonType.closeButton, .miniaturizeButton, .zoomButton] {
        guard let button = window.standardWindowButton(kind), button.alphaValue != (visible ? 1 : 0)
        else { continue }
        NSAnimationContext.runAnimationGroup { context in
          context.duration = animate ? (visible ? 0.18 : 0.65) : 0
          button.animator().alphaValue = visible ? 1 : 0
        }
      }
    }
    func detach() {
      if let monitor { NSEvent.removeMonitor(monitor) }
      if let keyObserver { NotificationCenter.default.removeObserver(keyObserver) }
      showWindowControls(true, animate: false)
      window?.acceptsMouseMovedEvents = previousMouseEvents
      monitor = nil
      keyObserver = nil
      window = nil
    }
  }
}
