import AppKit
import SwiftUI

/// The « Lecture » menu: play or pause on Space, the next song on ⌘→, ten seconds back or
/// forward on ⇧⌘← and ⇧⌘→. Everything is off while no song is loaded.
///
/// A key equivalent without modifier is matched by the menu before the first responder sees
/// the key, so Space would never reach a text field. The shortcut therefore exists only while
/// no text is being edited; the menu item stays, Space goes back to the field.
struct PlaybackCommands: Commands {
  @ObservedObject var dj: DJModel
  @ObservedObject var editing: TextEditingWatcher
  var body: some Commands {
    CommandMenu("Lecture") {
      Button("Lecture / Pause") { dj.togglePlayback() }
        .keyboardShortcut(editing.active ? nil : KeyboardShortcut(.space, modifiers: []))
        .disabled(dj.current == nil)
      Button("Morceau suivant") { dj.next() }
        .keyboardShortcut(.rightArrow, modifiers: .command)
        .disabled(dj.current == nil)
      Divider()
      Button("Reculer de 10 s") { dj.seek(dj.player.elapsed - 10) }
        .keyboardShortcut(.leftArrow, modifiers: [.shift, .command])
        .disabled(dj.current == nil)
      Button("Avancer de 10 s") { dj.seek(dj.player.elapsed + 10) }
        .keyboardShortcut(.rightArrow, modifiers: [.shift, .command])
        .disabled(dj.current == nil)
    }
  }
}

/// Whether the key window's first responder is a text view: a field being edited (every
/// AppKit text field edits through the window's field editor, an NSTextView) or a text editor.
@MainActor final class TextEditingWatcher: ObservableObject {
  @Published private(set) var active = false
  private var responder: NSKeyValueObservation?
  nonisolated(unsafe) private var observers: [NSObjectProtocol] = []

  init() {
    let center = NotificationCenter.default
    for name in [NSWindow.didBecomeKeyNotification, NSWindow.didResignKeyNotification] {
      observers.append(
        center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
          MainActor.assumeIsolated { self?.watchKeyWindow() }
        })
    }
    watchKeyWindow()
  }
  deinit { observers.forEach(NotificationCenter.default.removeObserver) }

  private func watchKeyWindow() {
    guard let window = NSApp.keyWindow else {
      responder = nil
      active = false
      return
    }
    responder = window.observe(\.firstResponder, options: [.initial, .new]) {
      [weak self] window, _ in
      let editing = window.firstResponder is NSTextView
      MainActor.assumeIsolated {
        guard let self, self.active != editing else { return }
        self.active = editing
      }
    }
  }
}
