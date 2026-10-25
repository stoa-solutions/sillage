import Foundation

/// What to show for a YouTube video: the song and its artist, not the upload title and channel.
/// "Midnight Oil - Beds Are Burning (Official Video)" by "MidnightOilVEVO" reads
/// "Beds Are Burning" by "Midnight Oil". Same rules as the server's lyrics search.
public struct TrackTitle: Equatable, Sendable {
  public let title: String
  public let artist: String?

  public init(title: String, channel: String?) {
    let cleaned = Self.clean(title)
    if let channel, channel.hasSuffix(" - Topic") {
      self.init(song: cleaned, artist: String(channel.dropLast(8)))
      return
    }
    for separator in [" - ", " – ", " — "] {
      if let range = cleaned.range(of: separator) {
        let artist = cleaned[..<range.lowerBound].trimmingCharacters(in: .whitespaces)
        let song = cleaned[range.upperBound...].trimmingCharacters(in: .whitespaces)
        if !artist.isEmpty && !song.isEmpty {
          self.init(song: song, artist: artist)
          return
        }
      }
    }
    self.init(song: cleaned, artist: channel.map(Self.artist(fromChannel:)))
  }

  public init(_ track: Track) { self.init(title: track.title, channel: track.channel) }

  private init(song: String, artist: String?) {
    title = song
    self.artist = artist.flatMap { $0.isEmpty ? nil : $0 }
  }

  private static let noise = try! NSRegularExpression(
    pattern:
      "official|officiel|video|vidéo|clip|audio|lyrics?|paroles|visuali[sz]er|\\bhd\\b|\\b4k\\b|remaster(ed)?|explicit|music video",
    options: .caseInsensitive)

  /// Drops bracketed decorations such as "(Official Video)" or "[Clip Officiel]", keeps the rest.
  static func clean(_ title: String) -> String {
    var result = ""
    var group = ""
    var closing: Character?
    for character in title {
      if let close = closing {
        group.append(character)
        if character == close {
          let range = NSRange(group.startIndex..., in: group)
          if noise.firstMatch(in: group, range: range) == nil { result += group }
          group = ""
          closing = nil
        }
      } else if let close = ["(": ")", "[": "]", "【": "】"][character] {
        closing = Character(close)
        group = String(character)
      } else {
        result.append(character)
      }
    }
    result += group
    let collapsed = result.split(whereSeparator: \.isWhitespace).joined(separator: " ")
    return collapsed.isEmpty ? title : collapsed
  }

  static func artist(fromChannel channel: String) -> String {
    var name = channel
    for suffix in ["VEVO", "Vevo", " Official", " Officiel", "Official", "Officiel"]
    where name.hasSuffix(suffix) && name.count > suffix.count {
      name = String(name.dropLast(suffix.count))
    }
    return name.trimmingCharacters(in: .whitespaces)
  }
}
