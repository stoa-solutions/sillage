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
    self.status = status
    self.lines = lines
    self.text = text
    self.offsetMs = offsetMs
    self.durationDeltaMs = durationDeltaMs
    self.sourceName = sourceName
  }

  public static func decode(_ object: [String: Any]) throws -> Lyrics {
    guard let raw = object["status"] as? String, let status = Status(rawValue: raw) else {
      throw RecallError.message("Réponse de paroles invalide.")
    }
    let lines = (object["lines"] as? [[String: Any]] ?? []).compactMap { line -> LyricsLine? in
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
    let now = Int((seconds * 1000).rounded()) - offsetMs
    var low = 0
    var high = lines.count
    while low < high {
      let middle = (low + high) / 2
      if lines[middle].startMs <= now { low = middle + 1 } else { high = middle }
    }
    guard low > 0 else { return (nil, 0) }
    let line = lines[low - 1]
    let length = max(1, line.endMs - line.startMs)
    return (low - 1, min(1, max(0, Double(now - line.startMs) / Double(length))))
  }

  /// Playback time, in seconds, at which a line starts once the correction is applied.
  public func start(of index: Int) -> Double {
    Double(max(0, lines[index].startMs + offsetMs)) / 1000
  }
}
