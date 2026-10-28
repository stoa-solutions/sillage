import Foundation
import SillageKit

@MainActor func lyricsLifecycleChecks() async throws {
  let connection = try Connection(
    url: "https://lyrics.example.test", token: String(repeating: "t", count: 32))
  let a = Track(id: "aaaaaaaaaaa", title: "A")
  let b = Track(id: "bbbbbbbbbbb", title: "B")
  let c = Track(id: "ccccccccccc", title: "C")
  let timed = Lyrics(
    status: .synced, lines: [LyricsLine(startMs: 1000, endMs: 2000, text: "Synthetic line")])
  func waitFor(_ condition: () -> Bool) async throws {
    for _ in 0..<4000 {
      if condition() { return }
      await Task.yield()
    }
    throw SillageError.message("Lyrics lifecycle task did not settle")
  }

  var calls: [String: Int] = [:]
  var pending: [String: CheckedContinuation<Lyrics, Never>] = [:]
  let shared = LyricsModel(fetch: { _, id in
    calls[id, default: 0] += 1
    return await withCheckedContinuation { pending[id] = $0 }
  })
  shared.show(a, next: b, connection: connection)
  try await waitFor { pending.count == 2 }
  shared.show(a, next: b, connection: connection)
  shared.show(b, next: nil, connection: connection)
  for _ in 0..<20 { await Task.yield() }
  try expect(calls[b.id] == 1, "Promoting a prefetched song duplicated the request")
  pending.removeValue(forKey: b.id)?.resume(returning: timed)
  pending.removeValue(forKey: a.id)?.resume(returning: timed)
  try await waitFor { !shared.loading && shared.lyrics?.status == .synced }
  shared.reset()

  var date = Date(timeIntervalSince1970: 1000)
  calls = [:]
  let bounded = LyricsModel(
    fetch: { _, id in
      calls[id, default: 0] += 1
      return Lyrics(status: .missing, lines: [])
    }, cacheLimit: 2, now: { date })
  for track in [a, b, c, a] {
    date = date.addingTimeInterval(1)
    bounded.show(track, next: nil, connection: connection)
    try await waitFor { !bounded.loading }
  }
  try expect(calls[a.id] == 2, "Lyrics cache retained entries past its size limit")
  bounded.show(c, next: nil, connection: connection)
  try await waitFor { !bounded.loading }
  date = date.addingTimeInterval(301)
  bounded.show(a, next: nil, connection: connection)
  try await waitFor { !bounded.loading }
  try expect(calls[a.id] == 3, "Missing lyrics stayed cached after expiry")
  bounded.reset()

  var hold = false
  var refresh: CheckedContinuation<Lyrics, Never>?
  var writes = 0
  let correcting = LyricsModel(
    fetch: { _, _ in
      if hold { return await withCheckedContinuation { refresh = $0 } }
      return timed
    },
    save: { _, _, _ in
      writes += 1
      throw SillageError.message("Offline")
    })
  correcting.show(a, next: nil, connection: connection)
  try await waitFor { !correcting.loading }
  hold = true
  correcting.retry(connection: connection)
  try await waitFor { refresh != nil }
  correcting.nudge(by: 500, connection: connection)
  refresh?.resume(returning: timed)
  try await waitFor { !correcting.loading }
  try expect(correcting.lyrics?.offsetMs == 500, "A late refresh erased an optimistic correction")
  hold = false
  correcting.show(b, next: nil, connection: connection)
  try await waitFor { !correcting.loading }
  try await Task.sleep(for: .milliseconds(900))
  try expect(correcting.correctionState == .idle, "Another song inherited a correction failure")
  correcting.show(a, next: nil, connection: connection)
  try expect(
    writes == 1 && correcting.correctionState == .failed,
    "Failed persistence was silently reported as saved")
  correcting.reset()
  try expect(correcting.correctionState == .idle, "Correction error crossed account reset")
  print(
    "Lyrics lifecycle checks passed: request sharing, bounded cache, expiry, late refresh, save failure"
  )
}
