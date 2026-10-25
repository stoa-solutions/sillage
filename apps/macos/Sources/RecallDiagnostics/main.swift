import Foundation
import RecallKit

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
        // Two DJ turns on the server: the second must not replay what the first queued.
        let dj = ServerDJ(connection: connection)
        let opening = try await dj.turn(
          DJRequest(message: "Mets-moi du Mac Miller", history: [], queued: []))
        guard !opening.tracks.isEmpty else { throw RecallError.message("No server DJ selection") }
        let queued = Set(opening.tracks.map(\.id))
        let next = try await dj.turn(
          DJRequest(message: "D’autres titres de Mac Miller, pas ceux déjà en file", history: [], queued: queued))
        guard next.tracks.allSatisfy({ !queued.contains($0.id) }) else {
          throw RecallError.message("Server DJ replayed a queued track")
        }
        print(
          "Server-only verification passed:", overview.videoCount, "videos;",
          overview.playlists.count, "playlists; DJ picked", opening.tracks.count, "then",
          next.tracks.count, "new tracks. No local store used.")
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
      throw RecallError.message(
        "Usage: RecallDiagnostics --server-library <connexion.json> | --server-sync <connexion.json> <lien>"
      )
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
