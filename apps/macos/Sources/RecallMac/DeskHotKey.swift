import Carbon.HIToolbox
import RecallKit

/// A system-wide shortcut through Carbon's hot keys: it reports press and release from any app
/// and needs neither Accessibility nor Input Monitoring permission.
@MainActor
final class DeskHotKey {
  enum Event {
    case pressed
    case released
  }
  enum Failure: Equatable {
    /// macOS keeps this combination for itself (Spotlight, input sources, screenshots…).
    case reservedBySystem
    /// Another app registered it first.
    case taken
  }
  var onEvent: ((Event) -> Void)?
  private var reference: EventHotKeyRef?
  private var handler: EventHandlerRef?
  private static let signature: OSType = 0x534C_4747  // "SLGG"

  func register(_ shortcut: DeskShortcut) -> Failure? {
    unregister()
    if Self.reservedBySystem(shortcut) { return .reservedBySystem }
    installHandler()
    var registered: EventHotKeyRef?
    let status = RegisterEventHotKey(
      shortcut.keyCode, Self.carbonModifiers(shortcut.modifiers),
      EventHotKeyID(signature: Self.signature, id: 1), GetEventDispatcherTarget(), 0, &registered)
    guard status == noErr, let registered else { return .taken }
    reference = registered
    return nil
  }

  func unregister() {
    if let reference { UnregisterEventHotKey(reference) }
    reference = nil
  }

  private func installHandler() {
    guard handler == nil else { return }
    var types = [
      EventTypeSpec(
        eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed)),
      EventTypeSpec(
        eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyReleased)),
    ]
    InstallEventHandler(
      GetEventDispatcherTarget(),
      { _, event, context in
        guard let event, let context else { return OSStatus(eventNotHandledErr) }
        var identifier = EventHotKeyID()
        GetEventParameter(
          event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID), nil,
          MemoryLayout<EventHotKeyID>.size, nil, &identifier)
        guard identifier.signature == DeskHotKey.signature else {
          return OSStatus(eventNotHandledErr)
        }
        let pressed = GetEventKind(event) == UInt32(kEventHotKeyPressed)
        let hotKey = Unmanaged<DeskHotKey>.fromOpaque(context).takeUnretainedValue()
        // Carbon delivers hot keys on the main run loop.
        MainActor.assumeIsolated { hotKey.onEvent?(pressed ? .pressed : .released) }
        return noErr
      }, types.count, &types, Unmanaged.passUnretained(self).toOpaque(), &handler)
  }

  private static func carbonModifiers(_ modifiers: DeskShortcut.Modifiers) -> UInt32 {
    var value = 0
    if modifiers.contains(.command) { value |= cmdKey }
    if modifiers.contains(.option) { value |= optionKey }
    if modifiers.contains(.control) { value |= controlKey }
    if modifiers.contains(.shift) { value |= shiftKey }
    return UInt32(value)
  }

  /// Enabled shortcuts of System Settings → Keyboard → Keyboard Shortcuts.
  private static func reservedBySystem(_ shortcut: DeskShortcut) -> Bool {
    var unmanaged: Unmanaged<CFArray>?
    guard CopySymbolicHotKeys(&unmanaged) == noErr,
      let entries = unmanaged?.takeRetainedValue() as? [[String: Any]]
    else { return false }
    let modifiers = Int(carbonModifiers(shortcut.modifiers))
    let relevant = cmdKey | optionKey | controlKey | shiftKey
    return entries.contains { entry in
      guard (entry[kHISymbolicHotKeyEnabled] as? Bool) == true,
        let code = entry[kHISymbolicHotKeyCode] as? Int,
        let flags = entry[kHISymbolicHotKeyModifiers] as? Int
      else { return false }
      return code == Int(shortcut.keyCode) && flags & relevant == modifiers
    }
  }
}
