import Foundation

public struct Track: Codable, Identifiable, Hashable, Sendable {
  public let id: String
  public let title: String
  public let channel: String?
  public let durationSeconds: Double?
  public let description: String?
  public var url: URL { URL(string: "https://www.youtube.com/watch?v=\(id)")! }
  public init(
    id: String, title: String, channel: String? = nil, durationSeconds: Double? = nil,
    description: String? = nil
  ) {
    self.id = id
    self.title = title
    self.channel = channel
    self.durationSeconds = durationSeconds
    self.description = description
  }
}
public struct ChatMessage: Codable, Identifiable, Sendable {
  public var id = UUID()
  public let role: String
  public let content: String
  public init(role: String, content: String) {
    self.role = role
    self.content = content
  }
}
public struct DJResponse: Codable, Sendable {
  public let reply: String
  public let action: String
  public let tracks: [Track]
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
      throw RecallError.message(
        "Adresse ou jeton serveur invalide. Utilise une origine HTTPS sans chemin.")
    }
    self.url = url.hasSuffix("/") ? String(url.dropLast()) : url
    self.token = token
  }
}
public enum RecallError: LocalizedError {
  case message(String)
  public var errorDescription: String? {
    if case .message(let text) = self { return text }
    return nil
  }
}
public enum Catalog {
  public static func parse(_ data: Data) throws -> [Track] {
    guard data.count <= 40 * 1024 * 1024,
      let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]
    else {
      throw RecallError.message("Bibliothèque JSON invalide ou trop volumineuse.")
    }
    var rows: [[String: Any]] = []
    if let collections = object["collections"] as? [[String: Any]] {
      rows = collections.flatMap { $0["videos"] as? [[String: Any]] ?? [] }
    } else if let videos = object["videos"] as? [[String: Any]] {
      rows = videos
    } else if let entries = object["entries"] as? [[String: Any]] {
      rows = entries
    } else {
      throw RecallError.message("Importe un export Recall ou yt-dlp contenant les vidéos.")
    }
    guard rows.count <= 50_000 else {
      throw RecallError.message("Maximum 50 000 entrées par import.")
    }
    var seen = Set<String>()
    return try rows.compactMap { row in
      guard let id = row["id"] as? String,
        id.range(of: "^[A-Za-z0-9_-]{11}$", options: .regularExpression) != nil
      else {
        throw RecallError.message("Un identifiant vidéo de l’import est invalide.")
      }
      guard seen.insert(id).inserted else { return nil }
      guard let title = row["title"] as? String, !title.isEmpty else { return nil }
      let duration =
        (row["durationSeconds"] ?? row["duration_seconds"] ?? row["duration"]) as? Double
      guard duration == nil || (duration!.isFinite && duration! >= 0) else {
        throw RecallError.message("Une durée vidéo est invalide.")
      }
      return Track(
        id: id, title: String(title.prefix(1000)),
        channel: (row["channel"] ?? row["uploader"]) as? String,
        durationSeconds: duration,
        description: String((row["description"] as? String ?? "").prefix(10000)))
    }
  }
  public static func search(_ query: String, tracks: [Track], excluded: Set<String> = []) -> [Track]
  {
    let normalize: (String) -> String = {
      $0.folding(
        options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "fr_FR"))
    }
    let text = normalize(query)
    let terms = text.split(whereSeparator: { !$0.isLetter && !$0.isNumber }).map(String.init)
    var ranked: [(track: Track, score: Int)] = []
    for track in tracks where !excluded.contains(track.id) {
      let title = normalize(track.title)
      let artist = normalize(track.channel ?? "")
      let metadata = normalize(track.description ?? "")
      var score = title.contains(text) && !text.isEmpty ? 100 : 0
      if artist.contains(text) && !text.isEmpty { score += 80 }
      for term in terms {
        if title.contains(term) { score += 10 }
        if artist.contains(term) { score += 8 }
        if metadata.contains(term) { score += 1 }
      }
      if terms.isEmpty || score > 0 { ranked.append((track, score)) }
    }
    ranked.sort { a, b in a.score == b.score ? a.track.id < b.track.id : a.score > b.score }
    return ranked.prefix(30).map { $0.track }
  }

  public static func validateSelection(ids: [String], candidates: [String: Track]) throws -> [Track]
  {
    guard ids.count <= 8, ids.allSatisfy({ candidates[$0] != nil }) else {
      throw RecallError.message("Le DJ a proposé un titre non vérifié. Réessaie.")
    }
    var seen = Set<String>()
    return ids.filter { seen.insert($0).inserted }.compactMap { candidates[$0] }
  }
}
