import Foundation
import SillageKit

@MainActor
func lyricsAccountChecks() async throws {
  let a = try Connection(
    url: "https://sillage.example.com", token: String(repeating: "a", count: 32))
  let b = try Connection(
    url: "https://sillage.example.com", token: String(repeating: "b", count: 32))
  let track = Track(id: "abcdefghijk", title: "Song")
  let next = Track(id: "bcdefghijkl", title: "Next")
  var pending: [String: CheckedContinuation<Lyrics, Never>] = [:]
  var writes = 0
  let model = LyricsModel(
    fetch: { connection, id in
      await withCheckedContinuation { pending[connection.token + id] = $0 }
    }, save: { _, _, _ in writes += 1 })
  func waitFor(_ condition: () -> Bool) async throws {
    for _ in 0..<2000 {
      if condition() { return }
      await Task.yield()
    }
    throw SillageError.message("Lyrics task did not reach expected state")
  }
  model.show(track, next: next, connection: a)
  try await waitFor { pending.count == 2 }
  model.show(track, next: nil, connection: b)
  try expect(model.lyrics == nil, "Account switch displayed previous lyrics")
  try await waitFor { pending.count == 3 }
  pending.removeValue(forKey: b.token + track.id)?.resume(
    returning:
      Lyrics(status: .plain, lines: [], text: "B", offsetMs: 200))
  try await waitFor { model.lyrics?.text == "B" }
  pending.removeValue(forKey: a.token + track.id)?.resume(
    returning:
      Lyrics(status: .plain, lines: [], text: "A", offsetMs: 9000))
  pending.removeValue(forKey: a.token + next.id)?.resume(
    returning:
      Lyrics(status: .plain, lines: [], text: "A next", offsetMs: 9000))
  for _ in 0..<20 { await Task.yield() }
  try expect(
    model.lyrics?.text == "B" && model.lyrics?.offsetMs == 200,
    "Late response crossed account boundary")
  model.show(next, next: nil, connection: b)
  try expect(model.lyrics == nil, "Prefetched lyrics crossed account boundary")
  try await waitFor { pending[b.token + next.id] != nil }
  pending.removeValue(forKey: b.token + next.id)?.resume(
    returning:
      Lyrics(
        status: .synced,
        lines: [LyricsLine(startMs: 1000, endMs: 2000, text: "Synthetic line")], text: "B next"))
  try await waitFor { model.lyrics?.text == "B next" }
  let uncached = Track(id: "cdefghijklm", title: "Uncached")
  model.show(uncached, next: nil, connection: b)
  try await waitFor { pending[b.token + uncached.id] != nil }
  model.show(next, next: nil, connection: b)
  try expect(
    !model.loading && model.lyrics?.text == "B next", "Cached song kept old loading indicator")
  pending.removeValue(forKey: b.token + uncached.id)?.resume(
    returning: Lyrics(status: .plain, lines: [], text: "late"))
  model.nudge(by: 500, connection: b)
  model.reset()
  try await Task.sleep(nanoseconds: 900_000_000)
  try expect(
    writes == 0 && model.lyrics == nil && !model.loading,
    "Account reset retained an offset write or visible state")
  print("Lyrics account checks passed: stale load, prefetch isolation, pending offset cancellation")
}
