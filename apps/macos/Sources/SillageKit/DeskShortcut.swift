import Foundation

/// The global shortcut that opens the microphone from any app. It is stored as the physical key
/// plus modifiers, with the label read from the keyboard layout when it was recorded.
public struct DeskShortcut: Codable, Equatable, Sendable {
  public struct Modifiers: OptionSet, Codable, Hashable, Sendable {
    public let rawValue: Int
    public init(rawValue: Int) { self.rawValue = rawValue }
    public static let control = Modifiers(rawValue: 1 << 0)
    public static let option = Modifiers(rawValue: 1 << 1)
    public static let shift = Modifiers(rawValue: 1 << 2)
    public static let command = Modifiers(rawValue: 1 << 3)
  }

  /// Virtual key code (kVK_*), layout independent.
  public let keyCode: UInt32
  public let modifiers: Modifiers
  /// What the key shows on the keyboard, e.g. "Espace" or "D".
  public let key: String

  public init(keyCode: UInt32, modifiers: Modifiers, key: String) {
    self.keyCode = keyCode
    self.modifiers = modifiers
    self.key = key
  }

  /// ⌥⇧ Espace: free on a stock Mac, unlike ⌥ Espace (ChatGPT, Raycast) or ⌃⌥ Espace (input
  /// sources).
  public static let standard = DeskShortcut(
    keyCode: 49, modifiers: [.option, .shift], key: "Espace")

  /// Shift alone types a capital: a global shortcut needs ⌃, ⌥ or ⌘.
  public var isUsable: Bool { !modifiers.isDisjoint(with: [.control, .option, .command]) }

  /// Keycaps in Apple's order, ⌃ ⌥ ⇧ ⌘ then the key.
  public var keycaps: [String] {
    let symbols: [(Modifiers, String)] = [
      (.control, "⌃"), (.option, "⌥"), (.shift, "⇧"), (.command, "⌘"),
    ]
    return symbols.filter { modifiers.contains($0.0) }.map(\.1) + [key]
  }
  public var display: String { keycaps.joined(separator: " ") }
}

/// One key for two ways of speaking: hold it to talk and release to send, or tap it to listen
/// hands-free until the next tap (or the dictation's own silence detection).
public struct PushToTalkGesture: Equatable, Sendable {
  public enum Action: Equatable, Sendable {
    case start
    case submit
  }
  private enum State: Equatable, Sendable {
    case idle
    case holding(since: TimeInterval)
    case handsFree
    /// The press that ended hands-free listening; its release must not start anything.
    case closing
  }
  /// A press shorter than this is a tap.
  public static let holdThreshold: TimeInterval = 0.35
  private var state = State.idle

  public init() {}

  public var listening: Bool {
    switch state {
    case .holding, .handsFree: return true
    case .idle, .closing: return false
    }
  }

  public mutating func pressed(at time: TimeInterval) -> Action? {
    switch state {
    case .idle:
      state = .holding(since: time)
      return .start
    case .handsFree:
      state = .closing
      return .submit
    case .holding, .closing:
      // Key repeat or a lost release: the gesture already owns this press.
      return nil
    }
  }

  public mutating func released(at time: TimeInterval) -> Action? {
    switch state {
    case .holding(let since):
      if time - since >= Self.holdThreshold {
        state = .idle
        return .submit
      }
      state = .handsFree
      return nil
    case .closing:
      state = .idle
      return nil
    case .idle, .handsFree:
      return nil
    }
  }

  /// The dictation ended on its own (silence, error, cancel). A key still held is ignored until
  /// released.
  public mutating func dictationEnded(keyHeld: Bool) {
    state = keyHeld ? .closing : .idle
  }

  /// The dictation is still waiting for permissions when the key comes up: keep listening
  /// hands-free instead of cancelling a request the person just made.
  public mutating func releasedWhileStarting() {
    if case .holding = state { state = .handsFree }
  }
}

/// What the music does while the person dictates.
public enum DictationMusic: String, CaseIterable, Sendable {
  case duck
  case pause
  public var label: String {
    switch self {
    case .duck: return "Baisser la musique"
    case .pause: return "Mettre en pause"
    }
  }
}
