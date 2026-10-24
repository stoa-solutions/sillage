import Foundation
import RecallKit

@main struct Diagnostics {
  static func main() async {
    do {
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
        let response = try await AppleDJ.turn(
          message: request.isEmpty ? "Mets-moi du Mac Miller" : request, history: [], excluded: []
        ) { query, _ in
          print("Query: \(query)")
          return try store.search(query, source: .local, limit: 20)
        }
        if request.isEmpty {
          guard !response.tracks.isEmpty,
            response.tracks.allSatisfy({ $0.title.localizedCaseInsensitiveContains("Mac Miller") })
          else { throw RecallError.message("Apple did not select Mac Miller tracks") }
        }
        print(
          "Apple DJ: \(response.tracks.count) verified local tracks in \(Date().timeIntervalSince(start))s"
        )
        print(response.reply)
        print(response.tracks.map(\.title).joined(separator: "\n"))
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
      let response = try await GeminiDJ(key: key, model: selectedModel).turn(
        message: "Mets-moi Self Care de Mac Miller.", history: [], excluded: []
      ) { query, _ in
        try await HTTPClient().mcpSearch(connection, query: query)
      }
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
      fputs("Native verification failed: \(error.localizedDescription)\n", stderr)
      exit(1)
    }
  }
}
