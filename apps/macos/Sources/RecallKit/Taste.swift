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
