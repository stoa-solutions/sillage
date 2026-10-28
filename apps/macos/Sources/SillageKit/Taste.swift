import Foundation

/// The listener's opinion on a track. The server ranks the DJ's candidates with it; a 👎 only
/// keeps a track out of proposals for a while, and never touches a playlist.
public enum TrackOpinion: String, Sendable {
  case like, dislike
}

/// Bounds of the per-account delay a 👎 keeps a track out of proposals, as the server enforces.
public enum TasteLimits {
  public static let dislikeDays = 1...60
  public static let defaultDislikeDays = 5
}

extension HTTPClient {
  public func trackOpinion(_ connection: Connection, videoId: String) async throws
    -> TrackOpinion?
  {
    let object = try await server(connection, path: "taste/feedback/" + videoId)
    return (object["value"] as? String).flatMap(TrackOpinion.init(rawValue:))
  }
  public func setTrackOpinion(
    _ connection: Connection, videoId: String, _ opinion: TrackOpinion?
  ) async throws {
    _ = try await server(
      connection, path: "taste/feedback/" + videoId, method: "PUT",
      body: ["value": opinion?.rawValue ?? "none"])
  }
  public func dislikeDays(_ connection: Connection) async throws -> Int {
    let object = try await server(connection, path: "taste/settings")
    return object["dislikeDays"] as? Int ?? TasteLimits.defaultDislikeDays
  }
  public func saveDislikeDays(_ connection: Connection, _ days: Int) async throws -> Int {
    let object = try await server(
      connection, path: "taste/settings", method: "PUT", body: ["dislikeDays": days])
    return object["dislikeDays"] as? Int ?? days
  }
}

/// What the account's plays and opinions say: `GET /v1/taste/overview`.
public struct TasteOverview: Decodable, Sendable {
  public struct Summary: Decodable, Sendable {
    public let tracks: Int
    public let listens: Int
    public let liked: Int
    public let hidden: Int
  }
  public struct Artist: Decodable, Sendable, Identifiable {
    public let name: String
    public let tracks: Int
    public let listens: Int
    public let affinity: Int
    public var id: String { name }
  }
  public struct Item: Decodable, Sendable, Identifiable {
    public let id: String
    public let title: String
    public let channel: String?
    public let durationSeconds: Double?
    public let artist: String?
    /// favourite, frequent, heard, unconvinced or hidden.
    public let category: String
    public let categoryTitle: String
    /// 0–100, shown under the category.
    public let affinity: Int
    public let listens: Int
    public let opinion: String?
    public let daysLeft: Int?
    public let label: String?
    public var track: Track {
      Track(id: id, title: title, channel: channel, durationSeconds: durationSeconds)
    }
  }
  public let dislikeDays: Int
  public let summary: Summary
  public let artists: [Artist]
  public let tracks: [Item]
}

extension HTTPClient {
  public func tasteOverview(_ connection: Connection) async throws -> TasteOverview {
    let object = try await server(connection, path: "taste/overview")
    return try JSONDecoder().decode(
      TasteOverview.self, from: JSONSerialization.data(withJSONObject: object))
  }
}
