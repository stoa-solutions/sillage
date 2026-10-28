import SillageKit

func playbackSessionChecks() throws {
  for text in ["Next", "suivant stp", "Passe au morceau suivant !", "titre suivant s’il te plaît"] {
    try expect(
      DJTransportCommand.parse(text) == .next, "Transport command went through slow search")
  }
  for text in ["Pause", "mets en pause stp", "Stop !", "arrête"] {
    try expect(DJTransportCommand.parse(text) == .pause, "Pause must bypass generation")
  }
  for text in [
    "Reprends", "reprends la musique", "Play", "continue la lecture", "Mets Play s’il te plaît",
  ] {
    try expect(DJTransportCommand.parse(text) == .resume, "Resume must bypass generation")
  }
  for text in [
    "joue Pause de Eddy de Pretto", "continue dans cette ambiance", "ne mets pas en pause",
    "joue Next de The Weeknd", "ajoute le morceau suivant à la file",
    "change de morceau pour du jazz",
  ] {
    try expect(
      DJTransportCommand.parse(text) == nil,
      "A musical request was mistaken for a transport command")
  }

  let a = Track(id: "aaaaaaaaaaa", title: "A")
  let b = Track(id: "bbbbbbbbbbb", title: "B")
  let c = Track(id: "ccccccccccc", title: "C")
  let d = Track(id: "ddddddddddd", title: "D")
  let empty = DJResponse(reply: "aucun", action: "keep", tracks: [])
  let refill = DJResponse(reply: "suite", action: "append", tracks: [b, c])
  var queue = PlaybackQueue()
  queue.replace([a])
  try expect(!queue.requestNext(), "Exhausted queue unexpectedly advanced")
  try expect(!queue.requestNext(), "Repeated Next unexpectedly advanced")
  try expect(
    queue.history.count == 1 && queue.history[0].outcome == .skipped,
    "Repeated pending Next duplicated history")
  try expect(
    !queue.apply(empty, automatic: true) && queue.ended,
    "Empty response lost pending Next or replayed a finished song")
  try expect(
    queue.apply(refill, automatic: true) && queue.tracks[queue.position] == b,
    "A response arriving after Next did not start the first new track")
  try expect(
    !queue.apply(refill, automatic: true) && queue.tracks == [a, b, c],
    "Continuation repeated queued songs")
  queue.replace([a, b, c, d])
  try expect(!queue.moveUpcoming(from: 0, to: 2), "Reordering moved the current song")
  try expect(!queue.moveUpcoming(from: 1, to: 0), "Reordering replaced the current song")
  try expect(!queue.moveUpcoming(from: 1, to: 4), "Invalid destination was accepted")
  try expect(
    queue.moveUpcoming(from: 3, to: 1) && queue.tracks == [a, d, b, c]
      && queue.position == 0, "Reordering changed the current song or lost entries")
  try expect(
    queue.moveUpcoming(from: 1, to: 3) && queue.tracks == [a, b, c, d],
    "Moving down produced the wrong order")
  try expect(
    queue.playUpcoming(at: 3) && queue.tracks == [a, d, b, c]
      && queue.position == 1, "Play now lost intervening tracks")
  queue.markEnded()
  queue.markEnded()
  let count = queue.history.count
  try expect(
    queue.requestNext() && queue.tracks[queue.position] == b,
    "Natural end did not advance in edited order")
  try expect(
    queue.history.count == count && queue.history.last?.outcome == .finished,
    "Natural end was counted as a manual skip")
  queue.stop(outcome: .unavailable)
  try expect(
    queue.history.last?.track == b && queue.history.last?.outcome == .unavailable,
    "Unavailable clip was not recorded")
  queue.replace([c])
  try expect(queue.history.count == count + 1, "Replacing a stopped song duplicated history")
  queue.replace([a, a, b])
  try expect(
    queue.moveUpcoming(from: 2, to: 1) && queue.tracks == [a, b, a],
    "Repeated video IDs prevented positional reordering")
  queue.reset()
  try expect(
    queue.history.isEmpty && queue.tracks.isEmpty && !queue.ended,
    "Account reset retained previous session")
  queue.replace([a])
  try expect(
    !queue.apply(refill, automatic: true) && queue.position == 0,
    "Background refill interrupted playback")
  queue.markEnded()
  try expect(
    queue.advance() && queue.tracks[queue.position] == b,
    "Prefetched continuation failed at natural end")
  queue.reset()
  let intent = "Joue Masego Navajo puis FKJ Masego Tadow puis Michael Bublé Feeling Good"
  let continuation = DJRequest.continuation(context: intent, history: [], queued: [a.id])
  try expect(
    !continuation.message.contains(intent) && !continuation.message.contains("puis"),
    "A continuation leaked an ordered title list into the new command")
  try expect(
    continuation.history.last?.content.contains(intent) == true && continuation.queued == [a.id],
    "Continuation lost the user's musical intent or exclusions")
  print("22 playback session checks passed (pending Next, refill, order, history, account reset)")
}
