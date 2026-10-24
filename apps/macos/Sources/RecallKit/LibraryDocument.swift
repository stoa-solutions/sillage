import CryptoKit
import Foundation

public struct LibraryPlaylist: Codable, Identifiable, Sendable, Equatable {
  public let id: String
  public let title: String
  public let url: String?
  public let videoIDs: [String]
  public init(id: String, title: String, url: String? = nil, videoIDs: [String]) {
    self.id = id
    self.title = title
    self.url = url
    self.videoIDs = videoIDs
  }
}
public struct LibraryDocument: Sendable {
  public let tracks: [Track]
  public let playlists: [LibraryPlaylist]
  public init(tracks: [Track], playlists: [LibraryPlaylist]) {
    self.tracks = tracks
    self.playlists = playlists
  }
  public static func parse(_ data: Data, fallbackTitle: String = "Import JSON") throws -> Self {
    let tracks = try Catalog.parse(data)
    guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
      throw RecallError.message("Import invalide.")
    }
    let valid = Set(tracks.map(\.id))
    let collections = object["collections"] as? [[String: Any]] ?? [object]
    var identifiers = Set<String>()
    let playlists = try collections.enumerated().map { index, row -> LibraryPlaylist in
      let raw = row["videos"] as? [[String: Any]] ?? row["entries"] as? [[String: Any]] ?? []
      let metadata = row["playlist"] as? [String: Any] ?? row
      let original = metadata["id"] as? String
      let digest = SHA256.hash(data: Data((fallbackTitle + String(index)).utf8)).prefix(12).map {
        String(format: "%02x", $0)
      }.joined()
      let id = original ?? "file_" + digest
      guard identifiers.insert(id).inserted else {
        throw RecallError.message("Playlist répétée dans le fichier.")
      }
      return LibraryPlaylist(
        id: id, title: metadata["title"] as? String ?? fallbackTitle,
        url: metadata["url"] as? String,
        videoIDs: raw.compactMap { $0["id"] as? String }.filter { valid.contains($0) })
    }
    return Self(tracks: tracks, playlists: playlists)
  }
}
