import Foundation
import RecallKit

func expect(_ condition: Bool, _ message: String) throws {
  if !condition { throw RecallError.message(message) }
}
func expectFailure(_ work: () throws -> Void) throws {
  var failed = false
  do { try work() } catch { failed = true }
  try expect(failed, "Invalid input was accepted")
}
do {
  let source =
    #"{"collections":[{"videos":[{"id":"abcdefghijk","title":"Self Care","channel":"Mac Miller - Topic","duration_seconds":1480}]},{"videos":[{"id":"abcdefghijk","title":"Self Care"}]}]}"#
  let tracks = try Catalog.parse(Data(source.utf8))
  try expect(
    tracks.count == 1 && tracks[0].durationSeconds == 1480, "Import or deduplication failed")
  let long = Track(id: "12345678901", title: "Été au café", durationSeconds: 7200)
  try expectFailure {
    _ = try Catalog.parse(Data(#"{"videos":[{"id":"bad/url","title":"bad"}]}"#.utf8))
  }
  try expectFailure { _ = try Catalog.validateSelection(ids: ["invented123"], candidates: [:]) }
  try expect(
    try Catalog.validateSelection(ids: [long.id, long.id], candidates: [long.id: long]) == [long],
    "Duplicate selection")
  try expectFailure {
    _ = try Connection(url: "http://example.com", token: String(repeating: "t", count: 20))
  }
  try expectFailure {
    _ = try Connection(
      url: "https://user:secret@example.com", token: String(repeating: "t", count: 20))
  }
  try expectFailure {
    _ = try Connection(url: "https://example.com/path", token: String(repeating: "t", count: 20))
  }
  try expect(
    try Connection(url: "https://music.example.com/", token: String(repeating: "t", count: 20)).url
      == "https://music.example.com", "Origin normalization")
  let pcm = Data([0, 0, 1, 1])
  let wav = GeminiDJ.wav(pcm)
  try expect(
    wav.count == 48 && wav.starts(with: Data("RIFF".utf8)) && wav.suffix(4) == pcm, "Invalid WAV")
  let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  defer { try? FileManager.default.removeItem(at: directory) }
  let store = LibraryStore(directory: directory)
  try store.save([long], source: .local)
  try store.save(tracks, source: .server)
  try expect(try store.read(.local) == [long], "Server cache overwrote local library")
  try expect(try store.read(.server) == tracks, "Server cache missing")
  let baker = Track(id: "baker123456", title: "Chet Baker - Almost Blue")
  let faker = Track(id: "faker123456", title: "Chet Faker - Gold")
  try expect(
    AppleDJ.namedMatches([baker, faker], query: "Chet Baker") == [baker],
    "Named search confused similar artists")
  try expect(
    AppleDJ.namedMatches([faker], query: "Chet Baker").isEmpty, "Missing artist was substituted")
  try expect(
    AppleDJ.namedMatches([long], query: "ete cafe") == [long],
    "Named matching lost accent normalization")
  print("14 native behavior checks passed")
} catch {
  fputs("Native tests failed: \(error.localizedDescription)\n", stderr)
  exit(1)
}
