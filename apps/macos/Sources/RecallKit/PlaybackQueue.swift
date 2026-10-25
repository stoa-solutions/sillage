import Foundation

public enum PlaybackOutcome: String, Sendable {
  case finished = "Terminé"
  case skipped = "Passé"
  case unavailable = "Indisponible"
  case replaced = "Remplacé"
}

public struct PlaybackHistoryEntry: Identifiable, Sendable {
  public let id = UUID()
  public let track: Track
  public let outcome: PlaybackOutcome
}

/// Playback decisions do not depend on a provider's wording or on UI timing.
public struct PlaybackQueue: Sendable {
  public private(set) var tracks: [Track] = []
  public private(set) var position = 0
  public private(set) var ended = false
  public private(set) var history: [PlaybackHistoryEntry] = []
  private var recorded = false
  public init() {}
  public mutating func markEnded() {
    record(.finished)
    ended = true
  }
  public mutating func reset() { self = Self() }
  public mutating func replace(_ tracks: [Track]) {
    record(.replaced)
    self.tracks = tracks
    position = 0
    ended = false
    recorded = false
  }
  private mutating func record(_ outcome: PlaybackOutcome) {
    guard tracks.indices.contains(position), !recorded else { return }
    history.append(PlaybackHistoryEntry(track: tracks[position], outcome: outcome))
    history = Array(history.suffix(200))
    recorded = true
  }
  /// A pending Next survives an in-flight request, including an empty response.
  @discardableResult
  public mutating func requestNext(outcome: PlaybackOutcome = .skipped) -> Bool {
    stop(outcome: outcome)
    return advance()
  }
  public mutating func stop(outcome: PlaybackOutcome) {
    record(outcome)
    ended = true
  }
  @discardableResult
  public mutating func advance() -> Bool {
    guard position + 1 < tracks.count else { return false }
    record(.skipped)
    position += 1
    ended = false
    recorded = false
    return true
  }
  /// Only future entries can move; the current song and completed history stay fixed.
  @discardableResult
  public mutating func moveUpcoming(from source: Int, to destination: Int) -> Bool {
    guard source > position, destination > position,
      tracks.indices.contains(source), tracks.indices.contains(destination), source != destination
    else { return false }
    let track = tracks.remove(at: source)
    tracks.insert(track, at: destination)
    return true
  }
  /// Play a future entry now without silently discarding the intervening songs.
  @discardableResult
  public mutating func playUpcoming(at index: Int) -> Bool {
    guard index > position, tracks.indices.contains(index) else { return false }
    if index != position + 1 { moveUpcoming(from: index, to: position + 1) }
    return advance()
  }
  /// Returns true exactly when the player needs a new cue.
  public mutating func apply(_ response: DJResponse, automatic: Bool = false) -> Bool {
    guard !response.tracks.isEmpty, response.action != "keep" else { return false }
    if automatic || response.action == "append", position < tracks.count {
      // Continuations must not refill the queue with the same unavailable/played songs.
      let known = Set(tracks.map(\.id) + history.map(\.track.id))
      var seen = known
      let additions =
        automatic ? response.tracks.filter { seen.insert($0.id).inserted } : response.tracks
      tracks.append(contentsOf: additions)
      return ended ? advance() : false
    }
    replace(response.tracks)
    return true
  }
}
