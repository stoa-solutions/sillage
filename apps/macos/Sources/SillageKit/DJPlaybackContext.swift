import Foundation

/// Current playback is distinct from old conversation turns and candidate cards.
public struct DJPlaybackContext: Codable, Sendable {
  public struct Current: Codable, Sendable {
    public let id: String
    public let title: String
    public let channel: String
    public let artists: [String]
    public let genres: [String]
  }
  public static func followsCurrent(_ text: String) -> Bool {
    let normalized = text.folding(
      options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "fr_FR"))
    return normalized.range(
      of: #"\b(meme (style|ambiance|vibe|esprit|genre)|comme ca|dans cet esprit)\b"#,
      options: .regularExpression) != nil
      && normalized.range(
        of: #"\b(meme (style|ambiance|genre) que)\b"#, options: .regularExpression) == nil
  }
  public let current: Current?
  public let direction: String
  public init(queue: PlaybackQueue, direction: String) {
    self.direction = String(direction.prefix(600))
    if queue.tracks.indices.contains(queue.position) {
      let track = queue.tracks[queue.position]
      let metadata = track.musicMetadata.flatMap { $0.matched ? $0 : nil }
      current = Current(
        id: track.id, title: String(track.title.prefix(300)),
        channel: String((track.channel ?? "").prefix(200)),
        artists: Array((metadata?.artists.map { String($0.name.prefix(100)) } ?? []).prefix(8)),
        genres: Array((metadata?.genres.map { String($0.prefix(80)) } ?? []).prefix(8)))
    } else {
      current = nil
    }
  }
}
