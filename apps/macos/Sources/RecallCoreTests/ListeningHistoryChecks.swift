import Foundation
import RecallKit

func listeningHistoryChecks() throws {
  var queue = PlaybackQueue()
  let tracks = (1...3).map {
    Track(id: "track\($0)abcde", title: "Titre \($0)", channel: $0 == 2 ? nil : "Chaîne")
  }
  _ = queue.apply(DJResponse(reply: "", action: "replace", tracks: tracks))
  queue.requestNext()  // track 1 skipped
  queue.requestNext(outcome: .finished)  // track 2 finished
  var outbox = ListeningHistoryOutbox()
  let now = Date(timeIntervalSince1970: 1_793_000_000)
  outbox.observe(queue.history, at: now)
  try expect(
    outbox.pending.map(\.videoId) == ["track1abcde", "track2abcde"]
      && outbox.pending.map(\.outcome) == ["skipped", "finished"],
    "Outbox lost the order or outcome of plays")
  try expect(
    outbox.pending[1].channel == nil && outbox.pending[0].playedAt == now,
    "Outbox changed a play's channel or time")

  outbox.observe(queue.history, at: now.addingTimeInterval(5))
  try expect(outbox.pending.count == 2, "The same play was queued twice")

  let payload = outbox.nextBatch().map(\.payload)
  try expect(
    payload[0]["outcome"] as? String == "skipped"
      && (payload[0]["playedAt"] as? String)?.hasSuffix("Z") == true
      && UUID(uuidString: payload[0]["id"] as? String ?? "") != nil
      && payload[1]["channel"] is NSNull,
    "History payload does not match the server contract")

  // A failed upload keeps the batch; a successful one removes only what was sent.
  let sent = outbox.nextBatch()
  queue.requestNext(outcome: .finished)
  outbox.observe(queue.history)
  outbox.acknowledge(sent)
  try expect(
    outbox.pending.map(\.videoId) == ["track3abcde"], "Acknowledging removed an unsent play")

  outbox.reset()
  try expect(outbox.pending.isEmpty, "Another account would receive this account's plays")
  outbox.observe(queue.history)
  try expect(outbox.pending.isEmpty, "A reset outbox resent plays seen before the reset")

  var offline = ListeningHistoryOutbox()
  var long = PlaybackQueue()
  let many = (0..<600).map { Track(id: String(format: "v%010d", $0), title: "T\($0)") }
  _ = long.apply(DJResponse(reply: "", action: "replace", tracks: many))
  for _ in 0..<599 {
    long.requestNext()
    offline.observe(long.history)
  }
  try expect(
    offline.pending.count == ListeningHistoryOutbox.capacity
      && offline.pending.last?.videoId == "v0000000598"
      && offline.nextBatch().count == ListeningHistoryOutbox.batchSize,
    "Offline outbox is unbounded or drops the newest plays")
  var odd = PlaybackQueue()
  let emojiTitle = String(repeating: "🎵", count: 200)
  _ = odd.apply(
    DJResponse(
      reply: "", action: "replace",
      tracks: [Track(id: "bad id", title: "Invalide"), Track(id: "emojititle1", title: emojiTitle)]
    ))
  odd.requestNext()
  odd.requestNext()
  var strict = ListeningHistoryOutbox()
  strict.observe(odd.history)
  try expect(
    strict.pending.map(\.videoId) == ["emojititle1"]
      && strict.pending[0].title.utf16.count == 300
      && strict.pending[0].title.allSatisfy { $0 == "🎵" },
    "History sent an invalid video ID or a title the server would reject")
  print(
    "Listening history checks passed: order, duplicates, payload, acknowledgement, reset, bound")
}
