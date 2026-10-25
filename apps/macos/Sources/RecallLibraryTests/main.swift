import Foundation
import RecallKit

func check(_ condition: Bool, _ message: String) throws {
  if !condition { throw RecallError.message(message) }
}
func rejects(_ body: () throws -> Void) throws {
  do { try body() } catch { return }
  throw RecallError.message("Expected failure")
}
actor Fixture {
  var calls = 0
  var failSecond: Bool
  init(failSecond: Bool = false) { self.failSecond = failSecond }
  func fetch(_ request: URLRequest) throws -> (Data, HTTPURLResponse) {
    calls += 1
    try check(
      request.value(forHTTPHeaderField: "X-Goog-Api-Key") == String(repeating: "k", count: 24),
      "Credential header missing")
    try check(request.url!.query?.contains("key=") == false, "Key leaked into URL")
    var body: [String: Any]
    var status = 200
    if request.url!.lastPathComponent == "playlists" {
      body = ["items": [["snippet": ["title": "My playlist"]]]]
    } else if request.url!.query!.contains("pageToken=second") {
      if failSecond {
        failSecond = false
        status = 429
        body = [:]
      } else {
        body = [
          "items": [
            [
              "contentDetails": ["videoId": "12345678901"],
              "snippet": ["title": "Été au café", "videoOwnerChannelTitle": "Mac Miller"],
            ]
          ]
        ]
      }
    } else {
      body = [
        "items": [
          [
            "contentDetails": ["videoId": "abcdefghijk"],
            "snippet": ["title": "Self Care", "videoOwnerChannelTitle": "Mac Miller"],
          ],
          [
            "contentDetails": ["videoId": "abcdefghijk"],
            "snippet": ["title": "Self Care", "videoOwnerChannelTitle": "Mac Miller"],
          ],
          ["contentDetails": ["videoId": "zzzzzzzzzzz"], "snippet": ["title": "Private video"]],
        ], "nextPageToken": "second",
      ]
    }
    return (
      try JSONSerialization.data(withJSONObject: body),
      HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
    )
  }
}
actor ServerFixture {
  var polls = 0
  var posted = false
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
    if path == "export" {
      return [
        "collections": [
          [
            "playlist": ["id": "PL1234567890", "title": "Test"],
            "videos": [
              ["id": "abcdefghijk", "title": "Self Care"],
              ["id": "12345678901", "title": NSNull()],
            ],
          ],
          [
            "playlist": ["id": "OtherPlaylist", "title": "Other"],
            "videos": [["id": "other123456", "title": "Other"]],
          ],
        ]
      ]
    }
    throw RecallError.message("Unexpected server request")
  }
}

@main struct LibraryTests {
  static func main() async {
    do {
      let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
      defer { try? FileManager.default.removeItem(at: root) }
      try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
      let a = Track(id: "abcdefghijk", title: "Self Care", channel: "Mac Miller")
      let b = Track(id: "12345678901", title: "Été au café", channel: "Mac Miller")
      let old = root.appendingPathComponent("local-library.json")
      try JSONEncoder().encode([a]).write(to: old)
      let store = LibraryStore(directory: root)
      try store.prepare()
      try check(try store.read(.local) == [a], "Migration lost tracks")
      try check(FileManager.default.fileExists(atPath: old.path), "Migration removed original")
      try store.prepare()
      try check(try store.count(.local) == 1, "Migration repeated")
      let doc = LibraryDocument(
        tracks: [a, b],
        playlists: [
          LibraryPlaylist(id: "p1", title: "First", videoIDs: [b.id, a.id, b.id]),
          LibraryPlaylist(id: "p2", title: "Second", videoIDs: [a.id]),
        ])
      try store.commit(doc, source: .local)
      try store.commit(doc, source: .local)
      try check(try store.count(.local) == 2, "Duplicate import multiplied tracks")
      try check(
        try store.playlists(.local).first(where: { $0.id == "p1" })?.videoIDs == [
          b.id, a.id, b.id,
        ], "Playlist order or repeated membership lost")
      try check(
        try store.search("", source: .local, playlist: "p1", offset: 1, limit: 2).map(\.id) == [
          a.id, b.id,
        ], "Playlist pagination failed")
      try check(
        try store.search("ete cafe", source: .local).first?.id == b.id,
        "Accent indexed search failed")
      try check(
        try store.search("Mac Miller", source: .local, excluded: [a.id]).map(\.id) == [b.id],
        "DJ exclusion failed")
      try check(
        try store.search("jazz doux cafe", source: .local).map(\.id) == [b.id],
        "Mood query without a full match found nothing")
      try check(
        try store.search("cafe self", source: .local, excluded: [b.id]).map(\.id) == [a.id],
        "Broadened search ignored exclusions")
      try rejects {
        try store.commit(
          LibraryDocument(
            tracks: [a],
            playlists: [LibraryPlaylist(id: "bad", title: "Bad", videoIDs: ["unknownxxxx"])]),
          source: .local, replace: true)
      }
      try check(try store.count(.local) == 2, "Failed import wasn't rolled back")
      try store.save([a], source: .server)
      try check(
        try store.count(.local) == 2 && store.count(.server) == 1,
        "Server write changed local source")
      let exported = try LibraryDocument.parse(store.export(.local))
      try check(
        exported.playlists.first(where: { $0.id == "p1" })?.videoIDs == [b.id, a.id, b.id],
        "Export lost membership")
      let legacyExport = Data(
        #"{"collections":[{"playlist":{"id":"p1","title":"One"},"videos":[{"id":"abcdefghijk","title":"Self Care"}]},{"playlist":{"id":"p2","title":"Two"},"videos":[{"id":"12345678901","title":"Woods"}]}]}"#
          .utf8)
      let parsedLegacy = try LibraryDocument.parse(legacyExport)
      try check(
        parsedLegacy.playlists.map(\.title) == ["One", "Two"],
        "Server export playlist metadata lost")
      let missingTitle = Data(
        #"{"videos":[{"id":"abcdefghijk"},{"id":"abcdefghijk","title":"Self Care"}]}"#.utf8)
      try check(
        try Catalog.parse(missingTitle).count == 1, "Missing title suppressed later valid track")
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
      let fixture = Fixture(failSecond: true)
      let importer = YouTubePlaylistImporter(
        directory: root.appendingPathComponent("imports"), fetch: { try await fixture.fetch($0) })
      do {
        _ = try await importer.load(link: link, key: String(repeating: "k", count: 24))
        throw RecallError.message("Quota failure expected")
      } catch {
        try check(try store.count(.local) == 2, "Incomplete network import mutated database")
      }
      let result = try await importer.load(link: link, key: String(repeating: "k", count: 24))
      try check(
        result.resumed && result.skipped == 1 && result.document.tracks.count == 2,
        "Import didn't resume or skip unavailable video")
      try check(result.document.playlists[0].videoIDs == [a.id, a.id, b.id], "YouTube order lost")
      try check(await fixture.calls == 4, "Resume refetched completed pages")
      try store.commit(result.document, source: .local)
      try importer.finish(link: link)
      try check(
        !FileManager.default.fileExists(
          atPath: root.appendingPathComponent("imports/PL1234567890.json").path),
        "Completed checkpoint retained")
      let cancellationFixture = Fixture()
      let cancelledImporter = YouTubePlaylistImporter(
        directory: root.appendingPathComponent("cancelled"),
        fetch: { try await cancellationFixture.fetch($0) })
      let cancellation = Task {
        try await cancelledImporter.load(link: link, key: String(repeating: "k", count: 24)) { _ in
          withUnsafeCurrentTask { $0?.cancel() }
        }
      }
      do {
        _ = try await cancellation.value
        throw RecallError.message("Cancellation expected")
      } catch is CancellationError {}
      try check(await cancellationFixture.calls == 2, "Cancellation fetched another page")
      let resumedCancellation = try await cancelledImporter.load(
        link: link, key: String(repeating: "k", count: 24))
      try check(
        resumedCancellation.resumed && resumedCancellation.document.tracks.count == 2,
        "Cancelled import didn't resume")
      let orphan = Track(id: "orphan00001", title: "Unassigned")
      try store.commit(LibraryDocument(tracks: [orphan], playlists: []), source: .local)
      let reparsed = try LibraryDocument.parse(store.export(.local))
      try check(
        reparsed.tracks.contains(where: { $0.id == orphan.id && $0.title == orphan.title }),
        "Export lost unassigned video")
      try check(
        !reparsed.playlists.contains(where: { $0.id == LibraryDocument.unassignedID }),
        "Unassigned export bucket became a playlist")
      let staleFixture = Fixture(failSecond: true)
      let staleDirectory = root.appendingPathComponent("stale")
      do {
        _ = try await YouTubePlaylistImporter(
          directory: staleDirectory, fetch: { try await staleFixture.fetch($0) }
        ).load(link: link, key: String(repeating: "k", count: 24))
        throw RecallError.message("Quota failure expected")
      } catch {}
      let restarted = try await YouTubePlaylistImporter(
        directory: staleDirectory, resumeWindow: 0, fetch: { try await staleFixture.fetch($0) }
      ).load(link: link, key: String(repeating: "k", count: 24))
      let staleCalls = await staleFixture.calls
      try check(
        !restarted.resumed && restarted.document.playlists[0].videoIDs == [a.id, a.id, b.id]
          && staleCalls == 6,
        "Expired checkpoint was resumed")
      // Measured large local import, bounded page retrieval; no network or personal data.
      let bulk = (0..<10_000).map {
        Track(id: String(format: "%011d", $0), title: "Library track \($0)", channel: "Bulk artist")
      }
      let begin = Date()
      try store.save(bulk, source: .server)
      let duration = Date().timeIntervalSince(begin)
      try check(
        try store.search("Library track 9999", source: .server).first?.id == "00000009999",
        "Large library search failed")
      try check(
        try store.search("", source: .server, offset: 100, limit: 100).count == 100,
        "Bounded page failed")
      let firstPage = try store.searchPage("", source: .server, limit: 100)
      let secondPage = try store.searchPage("", source: .server, offset: 100, limit: 100)
      let lastPage = try store.searchPage("", source: .server, offset: 9900, limit: 100)
      let beyond = try store.searchPage("", source: .server, offset: 10_000, limit: 100)
      try check(
        firstPage.total == 10_000 && secondPage.total == 10_000 && lastPage.tracks.count == 100,
        "Page totals or exact final page incorrect")
      try check(
        Set(firstPage.tracks.map(\.id)).isDisjoint(with: secondPage.tracks.map(\.id)),
        "Adjacent pages overlap")
      try check(beyond.total == 10_000 && beyond.tracks.isEmpty, "Past-end page incorrect")
      let repeatedPage = try store.searchPage(
        "", source: .local, playlist: "p1", offset: 2, limit: 2)
      try check(
        repeatedPage.total == 3 && repeatedPage.tracks.map(\.id) == [b.id],
        "Playlist total must count repeated positions")
      let filteredPage = try store.searchPage("jazz doux cafe", source: .local, limit: 1)
      try check(
        filteredPage.total == 1 && filteredPage.tracks.first?.id == b.id,
        "Search total diverges from broadened FTS results")
      let beforePlaylists = try store.playlists(.server)
      try store.commit(
        LibraryDocument(
          tracks: [a, b],
          playlists: [
            LibraryPlaylist(id: "added-one", title: "Added one", videoIDs: [a.id])
          ]), source: .server)
      try store.commit(
        LibraryDocument(
          tracks: [a, b],
          playlists: [
            LibraryPlaylist(id: "added-two", title: "Added two", videoIDs: [b.id, a.id])
          ]), source: .server)
      let afterPlaylists = try store.playlists(.server)
      try check(
        afterPlaylists.count == beforePlaylists.count + 2
          && beforePlaylists.allSatisfy { old in
            afterPlaylists.contains { $0.id == old.id && $0.videoIDs == old.videoIDs }
          },
        "Adding playlists replaced an existing playlist")
      let serverFixture = ServerFixture()
      let serverImporter = ServerPlaylistImporter(
        call: { path, body in try await serverFixture.call(path, body) }, pause: {})
      let serverResult = try await serverImporter.load(
        link: "https://www.youtube.com/playlist?list=PL1234567890")
      try check(
        serverResult.playlists.count == 1 && serverResult.tracks.count == 2,
        "Server import leaked other playlists or dropped untitled videos")
      try check(
        serverResult.tracks.contains { $0.metadataUnavailable == true },
        "Untitled server entry was lost")
      let stopped = Task {
        try await ServerPlaylistImporter(
          call: { path, body in try await serverFixture.call(path, body) },
          pause: { try Task.checkCancellation() }
        ).load(link: "https://www.youtube.com/playlist?list=PL1234567890")
      }
      stopped.cancel()
      do {
        _ = try await stopped.value
        throw RecallError.message("Cancelled server import completed")
      } catch is CancellationError {}
      print(
        "Library regression scenarios passed: migration, transactions, sources, playlists, FTS, URL validation, quota/resume/expiry, broadened FTS, export, server import/freshness/isolation/cancellation. 10,000 synthetic videos imported in \(String(format:"%.2f",duration)) s."
      )
    } catch {
      fputs("Library tests failed: \(error.localizedDescription)\n", stderr)
      exit(1)
    }
  }
}
