import Foundation

public struct LyricsLine: Hashable, Sendable {
  public let startMs: Int
  public let endMs: Int
  public let text: String
  public init(startMs: Int, endMs: Int, text: String) {
    self.startMs = startMs
    self.endMs = endMs
    self.text = text
  }
}

/// Lyrics of a video as served by the Recall server, with this account's timing correction.
public struct Lyrics: Equatable, Sendable {
  public enum Status: String, Sendable {
    case synced, plain, instrumental, missing, unavailable
  }
  public let status: Status
  public let lines: [LyricsLine]
  /// Unsynchronised text, when that is all that exists.
  public let text: String?
  /// Positive values delay the lyrics.
  public var offsetMs: Int
  /// Video length minus lyrics length: a large gap usually means a clip intro or outro.
  public let durationDeltaMs: Int?
  public let sourceName: String?
  public init(
    status: Status, lines: [LyricsLine], text: String? = nil, offsetMs: Int = 0,
    durationDeltaMs: Int? = nil, sourceName: String? = nil
  ) {
    // A malformed provider record must never produce an empty synced panel or unsafe seeks.
    let valid = lines.prefix(5000).filter {
      $0.startMs >= 0 && $0.endMs >= $0.startMs && $0.endMs <= 86_400_000
        && !$0.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }.sorted { $0.startMs < $1.startMs }
    var merged: [LyricsLine] = []
    for line in valid {
      if let last = merged.last, last.startMs == line.startMs {
        merged[merged.count - 1] = LyricsLine(
          startMs: last.startMs, endMs: max(last.endMs, line.endMs),
          text: last.text == line.text
            ? last.text : String((last.text + "\n" + line.text).prefix(1000)))
      } else {
        merged.append(
          LyricsLine(startMs: line.startMs, endMs: line.endMs, text: String(line.text.prefix(500))))
      }
    }
    let plain = text.map {
      String($0.prefix(100_000)).trimmingCharacters(in: .whitespacesAndNewlines)
    }
    self.status =
      status == .synced && merged.isEmpty
      ? (plain?.isEmpty == false ? .plain : .missing)
      : status == .plain && plain?.isEmpty != false ? .missing : status
    self.lines = merged
    self.text = plain
    self.offsetMs = min(30000, max(-30000, offsetMs))
    self.durationDeltaMs = durationDeltaMs.map { min(86_400_000, max(-86_400_000, $0)) }
    self.sourceName = sourceName
  }

  public static func decode(_ object: [String: Any]) throws -> Lyrics {
    guard let raw = object["status"] as? String, let status = Status(rawValue: raw) else {
      throw RecallError.message("Réponse de paroles invalide.")
    }
    let lines = (object["lines"] as? [[String: Any]] ?? []).prefix(5000).compactMap {
      line -> LyricsLine? in
      guard let start = line["startMs"] as? Int, let end = line["endMs"] as? Int,
        let text = line["text"] as? String, start >= 0, end >= start
      else { return nil }
      return LyricsLine(startMs: start, endMs: end, text: String(text.prefix(500)))
    }
    return Lyrics(
      status: status, lines: lines.sorted { $0.startMs < $1.startMs },
      text: object["text"] as? String,
      offsetMs: object["offsetMs"] as? Int ?? 0,
      durationDeltaMs: object["durationDeltaMs"] as? Int,
      sourceName: (object["source"] as? [String: Any])?["name"] as? String)
  }

  /// The line sung at `seconds` of playback (nil before the first one) and how far into it, 0...1.
  /// Between two lines the previous one stays complete, so the eye has somewhere to rest.
  public func position(at seconds: Double) -> (index: Int?, progress: Double) {
    guard seconds.isFinite else { return (nil, 0) }
    let now = max(0, seconds) * 1000 - Double(offsetMs)
    var low = 0
    var high = lines.count
    while low < high {
      let middle = (low + high) / 2
      if Double(lines[middle].startMs) <= now { low = middle + 1 } else { high = middle }
    }
    guard low > 0 else { return (nil, 0) }
    let line = lines[low - 1]
    let length = max(1, line.endMs - line.startMs)
    return (low - 1, min(1, max(0, (now - Double(line.startMs)) / Double(length))))
  }

  /// Playback time, in seconds, at which a line starts once the correction is applied.
  public func start(of index: Int) -> Double {
    guard lines.indices.contains(index) else { return 0 }
    return max(0, Double(lines[index].startMs) + Double(offsetMs)) / 1000
  }
}
