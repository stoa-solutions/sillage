import Foundation

/// Pure inactivity policy. Pausing or leaving Studio always brings the controls back.
public struct StudioChrome: Sendable {
  public static let idleDelay: TimeInterval = 3
  public private(set) var enabled = false
  public private(set) var lastInteraction: TimeInterval = 0
  public init() {}
  public mutating func configure(enabled: Bool, at time: TimeInterval) {
    guard enabled != self.enabled else { return }
    self.enabled = enabled
    lastInteraction = time
  }
  public mutating func interact(at time: TimeInterval) { lastInteraction = time }
  public func visible(at time: TimeInterval) -> Bool {
    !enabled || time - lastInteraction < Self.idleDelay
  }
  public func remaining(at time: TimeInterval) -> TimeInterval {
    max(0, Self.idleDelay - (time - lastInteraction))
  }
}
