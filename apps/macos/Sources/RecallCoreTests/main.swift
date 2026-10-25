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
  let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  defer { try? FileManager.default.removeItem(at: directory) }
  let baker = Track(id: "baker123456", title: "Chet Baker - Almost Blue")
  var queue = PlaybackQueue()
  queue.replace([long])
  let add = DJResponse(reply: "suite", action: "append", tracks: tracks)
  try expect(!queue.apply(add), "Appending interrupted active playback")
  queue.markEnded()
  try expect(
    queue.advance() && queue.position == 1, "Ended player did not advance to a queued song")
  queue.replace([long])
  queue.markEnded()
  try expect(
    queue.apply(add) && queue.position == 1 && !queue.ended,
    "Append after end stayed stuck on finished track")
  queue.markEnded()
  try expect(
    !queue.apply(DJResponse(reply: "aucun", action: "keep", tracks: [])) && queue.ended,
    "Empty response restarted ended song")
  try expect(
    queue.apply(DJResponse(reply: "jazz", action: "replace", tracks: [baker]))
      && queue.position == 0 && queue.tracks == [baker],
    "New request did not replace the finished queue")
  queue.markEnded()
  try expect(
    queue.apply(DJResponse(reply: "suite", action: "replace", tracks: [long]), automatic: true)
      && queue.position == 1, "Automatic continuation discarded queue history")
  let untitled = try Catalog.parse(Data(#"{"videos":[{"id":"abcdefghijk","title":null}]}"#.utf8))
  try expect(
    untitled.count == 1 && untitled[0].metadataUnavailable == true,
    "Untitled YouTube entries were silently lost")
  let sessionDirectory = directory.appendingPathComponent("session-test")
  let sessions = CredentialFile(directory: sessionDirectory)
  let token = Data("test-session-not-a-real-token".utf8)
  try expect(try sessions.read("server") == nil, "Fresh session is not empty")
  try sessions.save(token, account: "server")
  try expect(
    try CredentialFile(directory: sessionDirectory).read("server") == token,
    "Session lost after restart")
  let file = sessionDirectory.appendingPathComponent("session.json")
  let permissions = try FileManager.default.attributesOfItem(atPath: file.path)
  let directoryPermissions = try FileManager.default.attributesOfItem(atPath: sessionDirectory.path)
  try expect(
    (permissions[.posixPermissions] as? NSNumber)?.intValue == 0o600, "Session is not private")
  try expect(
    (directoryPermissions[.posixPermissions] as? NSNumber)?.intValue == 0o700,
    "Session directory is not private")
  try expectFailure { try sessions.save(token, account: "gemini") }
  try sessions.install(["legacy-server": token])
  try expect(try sessions.read("server") == token, "Import overwrote existing session")
  try sessions.save(nil, account: "server")
  try expect(
    try CredentialFile(directory: sessionDirectory).read("server") == nil,
    "Logout failed to persist")
  try Data("invalid".utf8).write(to: file)
  try expectFailure { _ = try sessions.read("server") }
  try FileManager.default.removeItem(at: file)
  let target = directory.appendingPathComponent("do-not-follow")
  try Data("untouched".utf8).write(to: target)
  try FileManager.default.createSymbolicLink(at: file, withDestinationURL: target)
  try expectFailure { try sessions.save(token, account: "server") }
  try expect(try String(contentsOf: target) == "untouched", "Session followed a symlink")
  let now = Date()
  let authState = "test-state"
  let grant = String(repeating: "g", count: 43)
  let callbackURL = URL(string: "playlist-recall://auth?state=\(authState)&code=\(grant)")!
  var callback = GoogleCallback(state: authState, now: now)
  try expect(
    callback.consume(URL(string: "playlist-recall://auth?state=wrong&code=\(grant)")!, now: now)
      == nil, "Foreign OAuth state accepted")
  try expect(
    callback.consume(URL(string: callbackURL.absoluteString + "&code=\(grant)")!, now: now) == nil,
    "Duplicate OAuth parameter accepted")
  try expect(
    callback.consume(
      URL(
        string: callbackURL.absoluteString.replacingOccurrences(
          of: "//auth?", with: "//auth/other?"))!, now: now) == nil, "Wrong callback path accepted")
  try expect(callback.consume(callbackURL, now: now) == grant, "Valid OAuth callback rejected")
  try expect(callback.consume(callbackURL, now: now) == nil, "Replayed OAuth callback accepted")
  var expired = GoogleCallback(state: authState, now: now)
  try expect(
    expired.consume(callbackURL, now: now.addingTimeInterval(601)) == nil,
    "Expired OAuth callback accepted")
  let avatars = try Catalog.parse(
    Data(
      #"{"videos":[{"id":"abcdefghijk","title":"a","channelAvatarUrl":"https://yt3.ggpht.com/x"},{"id":"bcdefghijkl","title":"b","channelAvatarUrl":"https://evil.example/ggpht.com"}]}"#
        .utf8))
  try expect(
    avatars[0].channelAvatarURL?.host == "yt3.ggpht.com" && avatars[1].channelAvatarURL == nil,
    "Channel photo accepted from a host other than Google's")
  print("30 native behavior checks passed")
  try await studioCacheChecks()
} catch {
  fputs("Native tests failed: \(error.localizedDescription)\n", stderr)
  exit(1)
}
