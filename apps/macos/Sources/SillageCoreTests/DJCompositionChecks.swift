import SillageKit

func djCompositionChecks() async throws {
  var queue = PlaybackQueue()
  let first = Track(id: "first123456", title: "Navajo", channel: "Masego")
  queue.replace([first])
  for index in 0..<240 {
    queue.markEnded()
    queue.replace([Track(id: "song\(index)", title: "Song \(index)")])
  }
  try expect(queue.history.count == 200, "Display history exceeded its bound")
  let repeatResponse = DJResponse(reply: "Je lance Navajo", action: "append", tracks: [first])
  try expect(
    queue.freshContinuation(repeatResponse).tracks.isEmpty,
    "An old song was forgotten after the display history rolled over")
  try expect(
    !queue.apply(repeatResponse, automatic: true), "Automatic continuation replayed an old song")
  try expect(
    !queue.freshContinuation(repeatResponse).reply.contains("Je lance"),
    "DJ announced a rejected repetition")
  let fresh = Track(id: "fresh123456", title: "Fresh")
  let mixed = queue.freshContinuation(
    DJResponse(reply: "Navajo and Fresh", action: "append", tracks: [first, fresh, fresh]))
  try expect(
    mixed.tracks == [fresh] && !mixed.reply.contains("Navajo"),
    "Mixed response retained a repeated track or misleading announcement")
  try expect(
    queue.apply(DJResponse(reply: "rejoue", action: "replace", tracks: [first])),
    "Explicit replay was forbidden")
  queue.reset()
  queue.replace([fresh])
  try expect(
    queue.freshContinuation(repeatResponse).tracks == [first],
    "New account/session inherited old exclusions")

  var composition = DJComposition()
  composition.direct("Du Masego")
  try expect(composition.begin(tail: fresh.id), "First refill was refused")
  try expect(!composition.begin(tail: fresh.id), "Progress ticks duplicated a refill")
  composition.finish(added: false)
  for _ in 0..<300 {
    try expect(
      !composition.begin(tail: "different-tail"), "Empty refill triggered an automatic loop")
  }
  try expect(composition.begin(tail: fresh.id, retry: true), "Deliberate retry was refused")
  composition.finish(added: true)
  try expect(!composition.begin(tail: fresh.id), "Successful refill was immediately repeated")
  try expect(composition.begin(tail: "new-tail"), "New tail could not prepare the next sequence")
  composition.cancel()
  try expect(!composition.begin(tail: "third-tail"), "Cancelled preparation restarted itself")
  composition.direct("Du rock maintenant, sans live")
  try expect(composition.begin(tail: "third-tail"), "New direction failed to unblock composition")
  let noisyChat = (0..<40).map { ChatMessage(role: "assistant", content: "On continue \($0)") }
  let request = composition.request(history: noisyChat, queue: queue, broaden: true)
  let memory = request.history.map(\.content).joined(separator: "\n")
  try expect(
    memory.contains("Du Masego") && memory.contains("Du rock maintenant, sans live"),
    "Announcements erased the actual user directions")
  try expect(
    memory.contains("la dernière prime") && memory.contains("current"),
    "Composition lost latest-request priority or actual playback state")
  try expect(
    request.message.contains("restriction explicite")
      && request.message.contains("recherche différente"),
    "Fallback did not preserve constraints or change its search strategy")
  try expect(
    request.history.count <= 12 && request.history.allSatisfy { $0.content.count <= 2000 },
    "Composition context exceeded the server contract")
  var calls = 0
  let repeated = DJResponse(reply: "Navajo encore", action: "append", tracks: [fresh])
  let recovered = try await composition.continueSession(history: [], queue: queue) { request in
    calls += 1
    if calls == 1 { return repeated }
    try expect(
      request.message.contains("recherche différente"), "Fallback repeated the same strategy")
    return DJResponse(reply: "Un nouveau morceau", action: "append", tracks: [first])
  }
  try expect(
    calls == 2 && recovered.tracks == [first], "Bounded fallback did not recover fresh tracks")
  calls = 0
  let exhausted = try await composition.continueSession(history: [], queue: queue) { _ in
    calls += 1
    return repeated
  }
  try expect(calls == 2 && exhausted.tracks.isEmpty, "Repeated results caused an unbounded loop")
  calls = 0
  do {
    _ = try await composition.continueSession(history: [], queue: queue) { _ in
      calls += 1
      throw SillageError.message("offline")
    }
  } catch {}
  try expect(calls == 1, "Transport failure consumed extra provider calls")
  let cancelled = Task {
    try await composition.continueSession(history: [], queue: queue) { _ in
      try await Task.sleep(nanoseconds: 5_000_000_000)
      return repeated
    }
  }
  cancelled.cancel()
  do {
    _ = try await cancelled.value
    throw SillageError.message("Cancelled composition returned a selection")
  } catch is CancellationError {}
  composition.direct("Du jazz", source: .youtube)
  try expect(
    composition.request(history: [], queue: queue).scope == .youtube,
    "Continuation lost its musical direction source")
  var browsing = composition.userRequest("Cherche sur YouTube", history: [], queue: queue)
  browsing.scope = .all
  try expect(
    composition.request(history: [], queue: queue).scope == .youtube,
    "Browsing changed the continuation source")
  composition.direct("Maintenant mes playlists", source: .library)
  try expect(
    composition.request(history: [], queue: queue).scope == .library,
    "New musical direction did not update its source")
  composition.direct("Du Omer Adam sans live", source: .all)
  queue.replace([Track(id: "nMQw29nfzpg", title: "Tel Aviv", channel: "Omer Adam feat. Arisa")])
  composition.direct("prepare moi des à suivre comme ça stp", source: .all)
  let relative = composition.userRequest("dans ce même style", history: noisyChat, queue: queue)
  try expect(
    relative.playbackContext?.current?.channel == "Omer Adam feat. Arisa",
    "Current artist was lost from the relative request")
  try expect(
    relative.playbackContext?.direction == "Du Omer Adam sans live",
    "Relative follow-up erased the musical direction or restrictions")
  try expect(
    composition.request(history: noisyChat, queue: queue).playbackContext?.current?.id
      == "nMQw29nfzpg",
    "Automatic refill lost actual playback context")
  var copies = PlaybackQueue()
  copies.replace([
    Track(id: "original001", title: "Artist - Song (Official Video)", channel: "Artist")
  ])
  let duplicateCopy = Track(id: "duplicate01", title: "Song", channel: "Artist - Topic")
  try expect(
    copies.freshContinuation(DJResponse(reply: "Encore", action: "append", tracks: [duplicateCopy]))
      .tracks.isEmpty,
    "Another upload of the same cleaned artist/title was replayed")
  try expect(
    copies.apply(DJResponse(reply: "Rejoue", action: "replace", tracks: [duplicateCopy])),
    "An explicit immediate replay was blocked")
  composition.reset()
  try expect(
    composition.directions.isEmpty && !composition.needsDirection,
    "Reset retained musical direction")
  print(
    "DJ composition checks passed: 240-track session, bounded retries, latest intent, real playback context, honest announcements"
  )
}
