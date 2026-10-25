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
    title = Self.clip(entry.track.title, 300)
    channel = entry.track.channel.map { Self.clip($0, 200) }
    outcome =
      switch entry.outcome {
      case .finished: "finished"
      case .skipped: "skipped"
      case .unavailable: "unavailable"
      case .replaced: "replaced"
      }
    playedAt = date
  }

  /// The server counts UTF-16 units; whole characters are kept, so emoji never split.
  static func clip(_ text: String, _ limit: Int) -> String {
    var result = ""
    var units = 0
    for character in text {
      units += character.utf16.count
      if units > limit { break }
      result.append(character)
    }
    return result
  }
  /// Only YouTube's eleven-character IDs reach the server.
  static func valid(_ id: String) -> Bool {
    id.count == 11
      && id.unicodeScalars.allSatisfy {
        CharacterSet.alphanumerics.contains($0) && $0.isASCII || $0 == "_" || $0 == "-"
      }
  }

  public var payload: [String: Any] {
    [
      "id": id.uuidString.lowercased(), "videoId": videoId, "title": title,
      "channel": channel ?? NSNull(), "outcome": outcome,
      "playedAt": Self.format.string(from: playedAt),
    ]
  }
  nonisolated(unsafe) static let format: ISO8601DateFormatter = {
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
    for entry in history where !seen.contains(entry.id) && ListeningEvent.valid(entry.track.id) {
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

/// One play read back from the server's history, newest first.
public struct ListenedTrack: Identifiable, Sendable, Equatable {
  public let id: UUID
  public let track: Track
  public let outcome: PlaybackOutcome
  public let playedAt: Date

  /// Rows the server returned; malformed ones are skipped rather than failing the page.
  public static func page(_ object: [String: Any]) -> [ListenedTrack] {
    let rows = object["events"] as? [[String: Any]] ?? []
    return rows.compactMap { row in
      guard let id = (row["id"] as? String).flatMap(UUID.init(uuidString:)),
        let videoId = row["videoId"] as? String, let title = row["title"] as? String,
        let outcome = (row["outcome"] as? String).flatMap(PlaybackOutcome.init(server:)),
        let date = (row["playedAt"] as? String).flatMap(ListeningEvent.date(from:))
      else { return nil }
      return ListenedTrack(
        id: id, track: Track(id: videoId, title: title, channel: row["channel"] as? String),
        outcome: outcome, playedAt: date)
    }
  }
}

extension PlaybackOutcome {
  init?(server value: String) {
    switch value {
    case "finished": self = .finished
    case "skipped": self = .skipped
    case "unavailable": self = .unavailable
    case "replaced": self = .replaced
    default: return nil
    }
  }
}

extension ListeningEvent {
  static func date(from text: String) -> Date? {
    format.date(from: text) ?? ISO8601DateFormatter().date(from: text)
  }
}
