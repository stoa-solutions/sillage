import Foundation
import SillageKit

func tasteChecks() throws {
  // Each play carries how long it lasted: a skip after 4 s is not one after 3 minutes.
  var queue = PlaybackQueue()
  let tracks = (1...3).map { Track(id: "taste\($0)abcde", title: "Titre \($0)") }
  _ = queue.apply(DJResponse(reply: "", action: "replace", tracks: tracks))
  queue.progress(4.2)
  queue.requestNext()
  try expect(queue.elapsed == 0, "The next track inherited the previous clock")
  queue.progress(185)
  queue.requestNext()
  queue.progress(.nan)
  queue.requestNext(outcome: .finished)
  try expect(
    queue.history.map(\.listenedSeconds) == [4.2, 185, 0],
    "A play lost or borrowed its listening time")
  var outbox = ListeningHistoryOutbox()
  outbox.observe(queue.history)
  let payload = outbox.nextBatch().map(\.payload)
  try expect(
    payload.map { $0["listenedMs"] as? Int } == [4200, 185_000, 0],
    "The listening time did not reach the server payload")
  print("Taste checks passed: listening time per play, reset between tracks")
}
