import Foundation

/// One finished play, as the server stores it (`/v1/history`).
public struct ListeningEvent: Sendable, Equatable {
  public let id: UUID
  public let videoId: String
  public let title: String
  public let channel: String?
  public let outcome: String
  public let playedAt: Date

  init(_ entry: PlaybackHistoryEntry, at date: Date) {
    id = entry.id
    videoId = entry.track.id
    title = String(entry.track.title.prefix(300))
    channel = entry.track.channel.map { String($0.prefix(200)) }
    outcome =
      switch entry.outcome {
      case .finished: "finished"
      case .skipped: "skipped"
      case .unavailable: "unavailable"
      case .replaced: "replaced"
      }
    playedAt = date
  }

  public var payload: [String: Any] {
    [
      "id": id.uuidString.lowercased(), "videoId": videoId, "title": title,
      "channel": channel ?? NSNull(), "outcome": outcome,
      "playedAt": Self.format.string(from: playedAt),
    ]
  }
  nonisolated(unsafe) private static let format: ISO8601DateFormatter = {
    let format = ISO8601DateFormatter()
    format.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return format
  }()
}

/// Plays waiting to reach the server. It watches the queue's history, keeps each play once,
/// and drops a batch only after the server confirmed it. Bounded while offline: the oldest
/// plays go first. Reset on account change so plays never reach another account.
public struct ListeningHistoryOutbox: Sendable {
  public static let batchSize = 100
  public static let capacity = 500
  public private(set) var pending: [ListeningEvent] = []
  /// Entries of the current history already taken; history is bounded, so this is too.
  private var seen: Set<UUID> = []

  public init() {}

  public mutating func observe(_ history: [PlaybackHistoryEntry], at date: Date = Date()) {
    for entry in history where !seen.contains(entry.id) {
      pending.append(ListeningEvent(entry, at: date))
    }
    seen = Set(history.map(\.id))
    if pending.count > Self.capacity { pending.removeFirst(pending.count - Self.capacity) }
  }
  public func nextBatch() -> [ListeningEvent] { Array(pending.prefix(Self.batchSize)) }
  public mutating func acknowledge(_ batch: [ListeningEvent]) {
    let sent = Set(batch.map(\.id))
    pending.removeAll { sent.contains($0.id) }
  }
  /// Forgets pending plays but remembers the visible history, so it is not sent again.
  public mutating func reset() { pending = [] }
}
