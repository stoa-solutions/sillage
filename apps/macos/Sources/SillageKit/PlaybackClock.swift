import Foundation

/// Interpolates short gaps between actual player samples. Owned by the player, never a view.
/// Stops extrapolating during stalls; a fresh sample corrects the estimate without accumulating drift.
public struct PlaybackClock {
  private var seconds: Double = 0
  private var sampledAt = Date()
  private var playing = false

  public init() {}

  public mutating func sample(_ seconds: Double, playing: Bool, at date: Date = Date()) {
    self.seconds = seconds.isFinite ? max(0, seconds) : 0
    self.playing = playing
    sampledAt = date
  }

  public mutating func setPlaying(_ value: Bool, at date: Date = Date()) {
    sample(position(at: date), playing: value, at: date)
  }

  public func position(at date: Date = Date()) -> Double {
    seconds + (playing ? min(0.5, max(0, date.timeIntervalSince(sampledAt))) : 0)
  }
}
