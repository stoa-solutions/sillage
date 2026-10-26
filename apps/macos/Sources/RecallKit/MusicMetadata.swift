import Foundation

public struct MusicMetadata: Codable, Hashable, Sendable {
  public struct Artist: Codable, Hashable, Sendable {
    public let id: String
    public let name: String
    public let role: String
  }
  public struct Album: Codable, Hashable, Sendable {
    public let id: String
    public let title: String
  }
  public let source: String
  public let status: String
  public let checkedAt: String
  public let recordingId: String?
  public let confidence: Double?
  public let reason: String?
  public let artists: [Artist]
  public let albums: [Album]
  public let genres: [String]
  public let artistGenres: [String]
  public var matched: Bool { status == "matched" }
  public var featured: String {
    artists.filter { $0.role == "featured" }.map(\.name).joined(separator: ", ")
  }
  public var summary: String {
    guard matched else {
      return status == "ambiguous"
        ? "MusicBrainz · correspondance à vérifier" : "MusicBrainz · non identifié"
    }
    return [albums.first?.title, genres.isEmpty ? nil : genres.prefix(3).joined(separator: " · ")]
      .compactMap { $0 }.joined(separator: " · ")
  }
  public var sourceURL: URL? {
    guard let recordingId, UUID(uuidString: recordingId) != nil else { return nil }
    return URL(string: "https://musicbrainz.org/recording/\(recordingId)")
  }
}
