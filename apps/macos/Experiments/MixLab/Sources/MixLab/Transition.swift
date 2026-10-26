import Foundation

/// A deterministic envelope. Analysis/AI may later choose these parameters; the audio clock
/// executes them. No sleeps, network requests, wall-clock timers or app state enter rendering.
struct Transition {
  enum Mode: String, CaseIterable { case cut, fade, bassSwap }
  let mode: Mode
  let segment: Double
  let overlap: Double
  var incomingStart: Double { segment - (mode == .cut ? 0 : overlap) }
  var duration: Double { incomingStart + segment }

  func gains(at time: Double) -> (outgoing: Float, incoming: Float) {
    if mode == .cut { return time < segment ? (1, 0) : (0, 1) }
    let progress = min(1, max(0, (time - incomingStart) / overlap))
    return (Float(cos(progress * .pi / 2)), Float(sin(progress * .pi / 2)))
  }
  func bass(at time: Double) -> (outgoing: Float, incoming: Float) {
    guard mode == .bassSwap else { return (0, 0) }
    let progress = min(1, max(0, (time - incomingStart) / overlap))
    return (-18 * Float(progress), -18 * Float(1 - progress))
  }
}
