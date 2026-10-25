import Foundation
import RecallKit

func check(_ condition: Bool, _ message: String) throws {
  if !condition { throw RecallError.message(message) }
}
func rejects(_ body: () throws -> Void) throws {
  do { try body() } catch { return }
  throw RecallError.message("Expected failure")
}

/// A private server that confirms a fresh sync on the third poll.
actor ServerFixture {
  var polls = 0
  var posted = false
  var exports = 0
  func call(_ path: String, _ body: [String: String]?) throws -> [String: Any] {
    if path == "status" { return ["youtubeConfigured": true] }
    if path == "playlists", body != nil {
      posted = true
      return ["id": "PL1234567890"]
    }
    if path == "playlists" {
      polls += 1
      let fresh = posted && polls > 2
      return [
        "playlists": [
          [
            "id": "PL1234567890", "status": fresh ? "ready" : "syncing",
            "last_sync_at": fresh ? "new" : "old",
          ]
        ]
      ]
    }
    if path == "export" { exports += 1 }
    throw RecallError.message("Unexpected server request")
  }
}

@main struct ServerTests {
  static func main() async {
    do {
      for link in [
        "http://youtube.com/playlist?list=PL1234567890",
        "https://evil.com/playlist?list=PL1234567890",
        "https://youtube.com.evil.com/playlist?list=PL1234567890",
        "https://user@youtube.com/playlist?list=PL1234567890",
      ] {
        try rejects { _ = try YouTubePlaylistLink.id(from: link) }
      }
      let link = "https://www.youtube.com/playlist?list=PL1234567890"
      try check(
        try YouTubePlaylistLink.id(from: link) == "PL1234567890", "Valid YouTube URL rejected")

      let fixture = ServerFixture()
      let synchronized = try await ServerPlaylistImporter(
        call: { path, body in try await fixture.call(path, body) }, pause: {}
      ).synchronize(link: link)
      let exports = await fixture.exports
      try check(
        synchronized == "PL1234567890" && exports == 0,
        "Server import downloaded the library instead of waiting for the server")
      let stopped = Task {
        try await ServerPlaylistImporter(
          call: { path, body in try await ServerFixture().call(path, body) },
          pause: { try Task.checkCancellation() }
        ).synchronize(link: link)
      }
      stopped.cancel()
      do {
        _ = try await stopped.value
        throw RecallError.message("Cancelled server import completed")
      } catch is CancellationError {}

      let overview = try ServerLibraryOverview(
        status: ["counts": ["videos": 15]],
        collections: [
          "playlists": [
            ["id": "one", "title": "One", "entries": 13],
            ["id": "two", "title": "Two", "entries": 5],
          ]
        ])
      try check(
        overview.videoCount == 15 && overview.playlists.map(\.entries) == [13, 5],
        "Server summary lost distinct total or playlist counts")
      try rejects { _ = try ServerLibraryOverview(status: [:], collections: [:]) }
      let discoveryData = Data(
        #"{"reply":"Voici un résultat","action":"keep","tracks":[],"discoveries":[{"video":{"id":"newtrack001","title":"New track"},"inLibrary":false}]}"#
          .utf8)
      let discoveryReply = try JSONDecoder().decode(DJResponse.self, from: discoveryData)
      try check(discoveryReply.discoveries?.first?.id == "newtrack001", "DJ discovery cards lost")
      var playback = PlaybackQueue()
      playback.replace([Track(id: "oldtrack001", title: "Current")])
      try check(
        !playback.apply(discoveryReply) && playback.tracks.first?.id == "oldtrack001",
        "Discovery replaced playback")
      try rejects {
        _ = try JSONDecoder().decode(
          DiscoveryItem.self,
          from: Data(#"{"video":{"id":"../unsafe","title":"Bad"},"inLibrary":false}"#.utf8))
      }
      let personalCollection = try ServerLibraryOverview(
        status: ["counts": ["videos": 1]],
        collections: [
          "playlists": [
            [
              "id": "recall-discoveries:user", "title": "Mes découvertes", "entries": 1,
              "sync_enabled": false,
            ]
          ]
        ])
      try check(
        personalCollection.playlists.first?.syncEnabled == false,
        "Private collection would be synced as YouTube playlist")
      print(
        "Server client checks passed: YouTube links, server import freshness and cancellation, library summary."
      )
    } catch {
      fputs("Server tests failed: \(error.localizedDescription)\n", stderr)
      exit(1)
    }
  }
}
