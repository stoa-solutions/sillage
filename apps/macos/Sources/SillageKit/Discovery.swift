import Foundation

public enum DiscoveryScope: String, CaseIterable, Identifiable, Codable, Sendable {
  case all, youtube, library
  public var id: Self { self }
  public var title: String {
    switch self {
    case .all: "Partout"
    case .youtube: "YouTube"
    case .library: "Mes playlists"
    }
  }
}
public struct DiscoveryItem: Codable, Identifiable, Sendable {
  public let video: Track
  public let inLibrary: Bool
  public var id: String { video.id }
  public init(video: Track, inLibrary: Bool) {
    self.video = video
    self.inLibrary = inLibrary
  }
  private enum CodingKeys: String, CodingKey { case video, inLibrary }
  public init(from decoder: Decoder) throws {
    let values = try decoder.container(keyedBy: CodingKeys.self)
    video = try values.decode(Track.self, forKey: .video)
    inLibrary = try values.decode(Bool.self, forKey: .inLibrary)
    guard video.id.range(of: "^[A-Za-z0-9_-]{11}$", options: .regularExpression) != nil else {
      throw DecodingError.dataCorruptedError(
        forKey: .video, in: values, debugDescription: "Invalid video ID")
    }
  }
}
public struct DiscoveryPage: Decodable, Sendable {
  public let results: [DiscoveryItem]
  public let nextPageToken: String?
}
public struct DiscoverySuggestion: Decodable, Identifiable, Sendable {
  public let video: Track
  public let inLibrary: Bool
  public let reason: String
  public var id: String { video.id }
}
public struct DiscoveryHome: Decodable, Sendable {
  public let suggestions: [DiscoverySuggestion]
  public let basedOn: [String]
  public let notice: String?
  public let emptyReason: String?
}
public struct AICheck: Decodable, Sendable {
  public let ok: Bool
  public let voice: Bool
  public let message: String
}
extension HTTPClient {
  public func discoveryHome(_ connection: Connection) async throws -> DiscoveryHome {
    let object = try await server(connection, path: "discover/home")
    return try JSONDecoder().decode(
      DiscoveryHome.self, from: JSONSerialization.data(withJSONObject: object))
  }
  public func discover(_ connection: Connection, query: String, pageToken: String = "") async throws
    -> DiscoveryPage
  {
    let object = try await server(
      connection, path: "discover/search", body: ["query": query, "pageToken": pageToken])
    return try JSONDecoder().decode(
      DiscoveryPage.self, from: JSONSerialization.data(withJSONObject: object))
  }
  public func addDiscovery(_ connection: Connection, id: String) async throws {
    guard id.range(of: "^[A-Za-z0-9_-]{11}$", options: .regularExpression) != nil else {
      throw SillageError.message("Vidéo invalide.")
    }
    _ = try await server(connection, path: "discover/add", body: ["videoId": id])
  }
  public func checkAI(
    _ connection: Connection, provider: AIProvider, model: String, key: String? = nil,
    voice: Bool = false
  ) async throws -> AICheck {
    var body: [String: Any] = [
      "provider": provider.rawValue, "model": model, "voice": voice && provider == .google,
    ]
    if let key { body["apiKey"] = key }
    let object = try await server(connection, path: "dj/check", body: body)
    return try JSONDecoder().decode(
      AICheck.self, from: JSONSerialization.data(withJSONObject: object))
  }
}
