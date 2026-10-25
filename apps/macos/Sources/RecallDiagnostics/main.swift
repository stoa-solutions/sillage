import Foundation
import RecallKit

/// Prints each search the DJ runs and what the library returned.
struct LoggedSearch: LibrarySearch {
  let base: any LibrarySearch
  func search(_ query: String, excluding: Set<String>, limit: Int) async throws -> [Track] {
    let found = try await base.search(query, excluding: excluding, limit: limit)
    print(
      "Query: \(query) → \(found.count) [\(found.prefix(5).map(\.title).joined(separator: " | "))]")
    return found
  }
}

@main struct Diagnostics {
  static func main() async {
    do {
      if CommandLine.arguments.count == 3, CommandLine.arguments[1] == "--server-library" {
        let connection = try JSONDecoder().decode(
          Connection.self, from: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[2])))
        let client = HTTPClient()
        let overview = try await client.libraryOverview(connection)
        let first = try await client.searchPage(connection, query: "", limit: 25)
        let second = try await client.searchPage(connection, query: "", offset: 25, limit: 25)
        guard first.total == overview.videoCount,
          Set(first.tracks.map(\.id)).isDisjoint(with: second.tracks.map(\.id))
        else {
          throw RecallError.message("Server pagination mismatch")
        }
        for playlist in overview.playlists {
          let page = try await client.searchPage(
            connection, query: "", limit: 25, playlist: playlist.id)
          print(
            "Server playlist:", playlist.title, "entries", playlist.entries, "distinct", page.total,
            "page", page.tracks.count)
        }
        let candidates = try await client.djCandidates(
          connection, query: "Mac Miller", excluded: [])
        guard !candidates.isEmpty else { throw RecallError.message("No server DJ candidates") }
        let excluded = Set(candidates.prefix(10).map(\.id))
        let continued = try await client.djCandidates(
          connection, query: "Mac Miller", excluded: excluded)
        guard !continued.isEmpty, continued.allSatisfy({ !excluded.contains($0.id) }) else {
          throw RecallError.message("Server DJ exclusion failed")
        }
        print(
          "Server-only verification passed:", overview.videoCount, "videos;",
          overview.playlists.count, "playlists;", candidates.count,
          "DJ candidates. No local store used.")
        return
      }
      if CommandLine.arguments.count == 4, CommandLine.arguments[1] == "--server-sync" {
        let connection = try JSONDecoder().decode(
          Connection.self,
          from:
            Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[2])))
        let id = try await ServerPlaylistImporter(connection: connection).synchronize(
          link: CommandLine.arguments[3])
        let overview = try await HTTPClient().libraryOverview(connection)
        guard let playlist = overview.playlists.first(where: { $0.id == id }) else {
          throw RecallError.message("Synchronized playlist missing")
        }
        print(
          "Server-only import confirmed:", playlist.title, playlist.entries, "entries;",
          overview.playlists.count, "playlists;", overview.videoCount,
          "unique videos. No local export or database.")
        return
      }
      if CommandLine.arguments.count == 4, CommandLine.arguments[1] == "--server-import" {
        let data = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[2]))
        let raw = try JSONDecoder().decode(Connection.self, from: data)
        let connection = try Connection(url: raw.url, token: raw.token)
        let start = Date()
        let document = try await ServerPlaylistImporter(connection: connection).load(
          link: CommandLine.arguments[3])
        let store = LibraryStore(
          directory: FileManager.default.urls(
            for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent(
              "Playlist Recall"))
        try store.commit(document, source: .local)
        print(
          "Real server import committed: \(document.playlists.count) playlist, \(document.tracks.count) videos, \(document.playlists.first?.videoIDs.count ?? 0) entries in \(Date().timeIntervalSince(start))s"
        )
        return
      }
      if CommandLine.arguments.contains("--apple") {
        if let reason = AppleDJ.availability {
          print("Apple DJ unavailable: \(reason)")
          return
        }
        let store = LibraryStore(
          directory: FileManager.default.urls(
            for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent(
              "Playlist Recall"))
        let start = Date()
        let request = CommandLine.arguments.dropFirst(2).joined(separator: " ")
        let response = try await LocalDJ(
          model: AppleDJ(),
          library: LoggedSearch(base: LocalLibrarySearch(store: store, source: .local))
        ).turn(
          DJRequest(
            message: request.isEmpty ? "Mets-moi du Mac Miller" : request, history: [], queued: []))
        print(response.reply)
        print(response.tracks.map(\.title).joined(separator: "\n"))
        if request.isEmpty {
          guard !response.tracks.isEmpty,
            response.tracks.allSatisfy({
              ($0.title + " " + ($0.channel ?? "")).localizedCaseInsensitiveContains("Mac Miller")
            })
          else { throw RecallError.message("Apple did not select Mac Miller tracks") }
        }
        print(
          "Apple DJ: \(response.tracks.count) verified local tracks in \(Date().timeIntervalSince(start))s"
        )
        return
      }

      guard CommandLine.arguments.count >= 2 else {
        throw RecallError.message("Provide the path to a private test configuration.")
      }
      let data = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))
      guard let value = try JSONSerialization.jsonObject(with: data) as? [String: String],
        let key = value["apiKey"], let url = value["url"], let token = value["token"]
      else { throw RecallError.message("Invalid private test configuration") }
      let connection = try Connection(url: url, token: token)
      let start = Date()
      let selectedModel =
        CommandLine.arguments.count > 2 ? CommandLine.arguments[2] : "gemini-3.8-flash"
      let response = try await LocalDJ(
        model: GeminiDJ(key: key, model: selectedModel),
        library: ServerLibrarySearch(connection: connection)
      ).turn(DJRequest(message: "Mets-moi Self Care de Mac Miller.", history: [], queued: []))
      let seconds = Date().timeIntervalSince(start)
      print(
        "Native DJ verified in \(String(format: "%.2f", seconds)) seconds: \(response.tracks.map(\.title).joined(separator: ", "))"
      )
      let wav = try await GeminiDJ(key: key, model: "gemini-3.8-flash").speech(
        "Salut Samuel. Je suis prêt pour une nouvelle session.")
      guard wav.starts(with: Data("RIFF".utf8)) else {
        throw RecallError.message("Invalid voice WAV")
      }
      print("Native voice verified: \(wav.count) bytes of WAV audio")
    } catch {
      let info = error as NSError
      print(
        "Network diagnostic:", info.domain, info.code, info.userInfo["_NSURLErrorNWPathKey"] ?? "")
      if let underlying = info.userInfo[NSUnderlyingErrorKey] as? NSError {
        print("Underlying:", underlying.domain, underlying.code)
      }
      fputs("Native verification failed: \(error.localizedDescription)\n", stderr)
      exit(1)
    }
  }
}
