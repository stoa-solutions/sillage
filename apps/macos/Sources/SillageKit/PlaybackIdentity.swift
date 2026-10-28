import Foundation

/// Conservative duplicate keys: same recording, or same cleaned title AND artist.
/// No fuzzy matching: similarly named songs and distinct live versions remain distinct.
enum PlaybackIdentity {
  static func keys(_ track: Track) -> Set<String> {
    var keys: Set<String> = ["video:" + track.id]
    if let metadata = track.musicMetadata, metadata.matched, let recording = metadata.recordingId {
      keys.insert("recording:" + recording)
    }
    let title = TrackTitle(track)
    if let artist = title.artist, !artist.isEmpty {
      func clean(_ value: String) -> String {
        value.folding(
          options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "fr_FR")
        )
        .split(whereSeparator: \.isWhitespace).joined(separator: " ")
      }
      keys.insert("song:" + clean(artist) + "|" + clean(title.title))
    }
    return keys
  }
}
