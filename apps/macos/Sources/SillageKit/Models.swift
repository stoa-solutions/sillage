import Foundation

public struct Track: Codable, Identifiable, Hashable, Sendable {
  public let id: String
  public let musicMetadata: MusicMetadata?
  public let title: String
  public let channel: String?
  public let durationSeconds: Double?
  public let description: String?
  public let metadataUnavailable: Bool?
  /// Channel photo served by Google's image hosts; nil until the server knows it.
  public let channelAvatarURL: URL?
  public var url: URL { URL(string: "https://www.youtube.com/watch?v=\(id)")! }
  public init(
    id: String, title: String, channel: String? = nil, durationSeconds: Double? = nil,
    description: String? = nil, metadataUnavailable: Bool? = nil, channelAvatarURL: URL? = nil,
    musicMetadata: MusicMetadata? = nil
  ) {
    self.musicMetadata = musicMetadata
    self.id = id
    self.title = title
    self.channel = channel
    self.durationSeconds = durationSeconds
    self.description = description
    self.metadataUnavailable = metadataUnavailable
    self.channelAvatarURL = channelAvatarURL
  }
}
public struct InformationSource: Codable, Identifiable, Sendable {
  public let id: Int
  public let title: String
  public let url: URL
  public var safeURL: URL? {
    ["http", "https"].contains(url.scheme ?? "") && url.user == nil && url.password == nil
      ? url : nil
  }
}
public struct ChatMessage: Codable, Identifiable, Sendable {
  public var id = UUID()
  public let role: String
  public let content: String
  public let sources: [InformationSource]?
  public let discoveries: [DiscoveryItem]?
  /// The agent that wrote an answer, shown above it; nil for the default DJ.
  public let agentName: String?
  /// Preserve the visible candidates in provider context; catalog metadata is data, not instructions.
  public var contextContent: String {
    guard let discoveries, !discoveries.isEmpty else { return String(content.prefix(2000)) }
    let cards = discoveries.prefix(DJLimits.selection).enumerated().map { index, item in
      [
        "position": String(index + 1), "id": item.id,
        "title": String(item.video.title.prefix(70)),
        "artist": String((item.video.channel ?? "").prefix(30)),
      ]
    }
    let encoded =
      (try? JSONSerialization.data(withJSONObject: cards, options: [.sortedKeys])) ?? Data()
    return String(content.prefix(250)) + "\nCartes proposées (métadonnées) : "
      + String(decoding: encoded, as: UTF8.self)
  }
  public init(
    role: String, content: String, discoveries: [DiscoveryItem]? = nil,
    sources: [InformationSource]? = nil, agentName: String? = nil
  ) {
    self.sources = sources
    self.discoveries = discoveries
    self.role = role
    self.content = content
    self.agentName = agentName
  }
}
public struct DJResponse: Codable, Sendable {
  /// The agent that answered, sent by the server when it is not the default DJ.
  public struct Agent: Codable, Sendable {
    public let id: String
    public let name: String
  }
  public let reply: String
  public let action: String
  public let tracks: [Track]
  public let sources: [InformationSource]?
  public let discoveries: [DiscoveryItem]?
  public let agent: Agent?
  public init(
    reply: String, action: String, tracks: [Track], discoveries: [DiscoveryItem]? = nil,
    sources: [InformationSource]? = nil, agent: Agent? = nil
  ) {
    self.agent = agent
    self.sources = sources
    self.discoveries = discoveries
    self.reply = reply
    self.action = action
    self.tracks = tracks
  }
}
public struct Connection: Codable, Sendable {
  public let url: String
  public let token: String
  public init(url: String, token: String) throws {
    guard let value = URL(string: url), let host = value.host,
      value.scheme == "https"
        || (value.scheme == "http" && ["localhost", "127.0.0.1"].contains(host)),
      value.user == nil, value.password == nil, value.query == nil, value.fragment == nil,
      value.path.isEmpty || value.path == "/", token.count >= 20, token.count <= 256
    else {
      throw SillageError.message(
        "Adresse ou jeton serveur invalide. Utilise une origine HTTPS sans chemin.")
    }
    self.url = url.hasSuffix("/") ? String(url.dropLast()) : url
    self.token = token
  }
}
public enum SillageError: LocalizedError {
  case message(String)
  public var errorDescription: String? {
    if case .message(let text) = self { return text }
    return nil
  }
}
public enum Catalog {
  private static func hasImitationMarker(_ text: String) -> Bool {
    ["type beat", "typebeat", "hommage", "tribute", "instrumental"].contains {
      text.localizedCaseInsensitiveContains($0)
    }
  }
  public static func requestsImitations(_ text: String) -> Bool {
    let negative = [
      "sans type", "pas de type", "sans hommage", "sans instrumental", "sans tribute", "exclu",
    ]
    return hasImitationMarker(text)
      && !negative.contains { text.localizedCaseInsensitiveContains($0) }
  }
  public static func isImitation(_ track: Track) -> Bool { hasImitationMarker(track.title) }

  public static func parse(_ data: Data) throws -> [Track] {
    guard data.count <= 40 * 1024 * 1024,
      let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]
    else {
      throw SillageError.message("Bibliothèque JSON invalide ou trop volumineuse.")
    }
    var rows: [[String: Any]] = []
    if let collections = object["collections"] as? [[String: Any]] {
      rows = collections.flatMap { $0["videos"] as? [[String: Any]] ?? [] }
    } else if let videos = object["videos"] as? [[String: Any]] {
      rows = videos
    } else if let entries = object["entries"] as? [[String: Any]] {
      rows = entries
    } else {
      throw SillageError.message("Importe un export Sillage ou yt-dlp contenant les vidéos.")
    }
    guard rows.count <= 50_000 else {
      throw SillageError.message("Maximum 50 000 entrées par import.")
    }
    var seen = Set<String>()
    return try rows.compactMap { row in
      guard let id = row["id"] as? String,
        id.range(of: "^[A-Za-z0-9_-]{11}$", options: .regularExpression) != nil
      else {
        throw SillageError.message("Un identifiant vidéo de l’import est invalide.")
      }
      let originalTitle = row["title"] as? String
      let missingTitle =
        originalTitle?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty != false
      let title = missingTitle ? "Vidéo sans titre · " + id : originalTitle!
      guard seen.insert(id).inserted else { return nil }
      let duration =
        (row["durationSeconds"] ?? row["duration_seconds"] ?? row["duration"]) as? Double
      guard duration == nil || (duration!.isFinite && duration! >= 0) else {
        throw SillageError.message("Une durée vidéo est invalide.")
      }
      return Track(
        id: id, title: String(title.prefix(1000)),
        channel: (row["channel"] ?? row["uploader"]) as? String,
        durationSeconds: duration,
        description: String((row["description"] as? String ?? "").prefix(10000)),
        metadataUnavailable: missingTitle || row["metadataUnavailable"] as? Bool == true
          ? true : nil,
        channelAvatarURL: (row["channelAvatarUrl"] as? String).flatMap(googleImage),
        musicMetadata: (row["musicMetadata"] as? [String: Any]).flatMap { value in
          guard let data = try? JSONSerialization.data(withJSONObject: value) else { return nil }
          return try? JSONDecoder().decode(MusicMetadata.self, from: data)
        })
    }
  }
}

/// Only https images from Google's own hosts are loaded, whatever a server or import says.
func googleImage(_ text: String) -> URL? {
  guard let url = URL(string: text), url.scheme == "https", let host = url.host else { return nil }
  let allowed = ["ggpht.com", "googleusercontent.com", "ytimg.com"]
  return allowed.contains { host == $0 || host.hasSuffix("." + $0) } ? url : nil
}
