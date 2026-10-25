import Foundation

/// Playback decisions do not depend on a provider's choice of wording or on UI timing.
public struct PlaybackQueue: Sendable {
  public private(set) var tracks: [Track] = []
  public private(set) var position = 0
  public private(set) var ended = false
  public init() {}
  public mutating func markEnded() { ended = true }
  public mutating func reset() { self = Self() }
  public mutating func replace(_ tracks: [Track]) {
    self.tracks = tracks
    position = 0
    ended = false
  }
  @discardableResult
  public mutating func advance() -> Bool {
    guard position + 1 < tracks.count else { return false }
    position += 1
    ended = false
    return true
  }
  /// Returns true exactly when the player needs a new cue.
  public mutating func apply(_ response: DJResponse, automatic: Bool = false) -> Bool {
    guard !response.tracks.isEmpty, response.action != "keep" else { return false }
    if automatic || response.action == "append", position < tracks.count {
      tracks.append(contentsOf: response.tracks)
      return ended ? advance() : false
    }
    replace(response.tracks)
    return true
  }
}
