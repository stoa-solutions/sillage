import Foundation
import RecallKit

extension Array where Element == ListeningSession.Effect {
  fileprivate var requests: [Int] {
    compactMap { if case .send(let id, _) = $0 { return id } else { return nil } }
  }
  fileprivate var cued: [String] {
    compactMap { if case .cue(let t) = $0 { return t.id } else { return nil } }
  }
  fileprivate var prepared: [[String]] {
    compactMap { if case .prepare(let t) = $0 { return t.map(\.id) } else { return nil } }
  }
  fileprivate var pauses: Bool {
    contains { if case .pause = $0 { return true } else { return false } }
  }
  fileprivate var cancels: Bool {
    contains { if case .cancelRequest = $0 { return true } else { return false } }
  }
  fileprivate var banners: [String] {
    compactMap { if case .banner(let text) = $0 { return text } else { return nil } }
  }
}

private func track(_ letter: Character) -> Track {
  Track(id: String(repeating: letter, count: 11), title: "Titre \(letter)", channel: "Artiste")
}

/// Brings a session to "one song playing, last one in the File, account ready".
private func playingAlone(_ song: Track) -> ListeningSession {
  var session = ListeningSession()
  _ = session.handle(.accountReady(true))
  _ = session.handle(.play(song, source: .library))
  _ = session.handle(.playback(.playing(true)))
  return session
}

func listeningSessionChecks() throws {
  let a = track("a")
  let b = track("b")
  let c = track("c")
  let d = track("d")
  let e = track("e")

  // A request travels as one numbered effect; its answer starts the music and is spoken.
  var session = ListeningSession()
  _ = session.handle(.accountReady(true))
  let asked = session.handle(.ask("Du jazz", source: .library))
  try expect(
    asked.requests.count == 1 && session.busy, "A request did not leave as one numbered send")
  let answered = session.handle(
    .answer(
      request: asked.requests[0],
      DJResponse(reply: "Voilà", action: "replace", tracks: [a, b, c, d, e])))
  try expect(answered.cued == [a.id], "An answer did not cue its first track")
  try expect(
    answered.prepared.last == [b.id, c.id, d.id],
    "The three upcoming tracks were not prepared ahead")
  try expect(
    !session.busy && session.messages.last?.content == "Voilà", "The answer was not recorded")

  // A late answer after Next is ignored: Next wins.
  session = playingAlone(a)
  let late = session.handle(.ask("Plutôt du rock", source: .library)).requests[0]
  _ = session.handle(.enqueue(b, source: .library))
  let skipped = session.handle(.next)
  try expect(skipped.cancels && skipped.cued == [b.id], "Next did not cancel the slower request")
  try expect(
    session.handle(
      .answer(request: late, DJResponse(reply: "Rock", action: "replace", tracks: [c]))
    ).isEmpty
      && session.current?.id == b.id,
    "A late answer replaced the music after Next")

  // Bug (a): pause from the chat, resume with the button, the continuation still comes.
  session = playingAlone(a)
  _ = session.handle(.ask("pause", source: .library))
  _ = session.handle(.resume)
  _ = session.handle(.playback(.playing(true)))
  let nearEnd = session.handle(.playback(.progress(elapsed: 200, duration: 220)))
  try expect(nearEnd.requests.count == 1, "Pause then resume blocked the automatic continuation")
  try expect(
    session.handle(.playback(.progress(elapsed: 201, duration: 220))).requests.isEmpty,
    "The continuation was requested twice for the same song")

  // Bug (b): while signing in, the continuation waits without spending its attempt.
  session = ListeningSession()
  _ = session.handle(.play(a, source: .library))
  _ = session.handle(.playback(.playing(true)))
  try expect(
    session.handle(.playback(.progress(elapsed: 200, duration: 220))).requests.isEmpty,
    "A continuation was sent before the account was ready")
  try expect(
    session.handle(.accountReady(true)).requests.count == 1,
    "The deferred continuation did not start once the account was ready")

  // An automatic answer full of repetitions gets one broader second chance, then appends.
  session = playingAlone(a)
  let first = session.handle(.playback(.progress(elapsed: 200, duration: 220))).requests[0]
  let broader = session.handle(
    .answer(request: first, DJResponse(reply: "Encore A", action: "append", tracks: [a])))
  try expect(broader.requests.count == 1, "A stale continuation was not retried more broadly")
  let refill = session.handle(
    .answer(request: broader.requests[0], DJResponse(reply: "B", action: "append", tracks: [b])))
  try expect(
    session.upcoming.map(\.id) == [b.id] && refill.cued.isEmpty,
    "A background refill interrupted the song instead of queueing")

  // Three unavailable clips in a row stop the music with an explanation.
  session = playingAlone(a)
  for song in [b, c, d] { _ = session.handle(.enqueue(song, source: .library)) }
  _ = session.handle(.playback(.unavailable))
  _ = session.handle(.playback(.unavailable))
  let stopped = session.handle(.playback(.unavailable))
  try expect(
    stopped.pauses && session.notice.contains("indisponibles"),
    "Repeated unavailable clips did not stop with a notice")

  // Duplicates stay out of the File, with a banner rather than a silent no-op.
  session = playingAlone(a)
  _ = session.handle(.enqueue(b, source: .library))
  try expect(
    session.handle(.enqueue(b, source: .library)).banners == ["Ce morceau est déjà à suivre."],
    "A duplicate was queued twice")

  // Turning continuous play off stops a background refill but keeps the direction.
  session = playingAlone(a)
  _ = session.handle(.playback(.progress(elapsed: 200, duration: 220)))
  try expect(session.handle(.continuous(false)).cancels, "Continuous off kept refilling")

  // Reproduce: current MJ, three external cards, "le trois" must mean card 3.
  let items = try JSONDecoder().decode(
    [DiscoveryItem].self,
    from: JSONSerialization.data(
      withJSONObject: [b, c, d].map {
        ["video": ["id": $0.id, "title": $0.title], "inLibrary": false]
      }))
  session = playingAlone(a)
  let search = session.handle(.ask("cherche Omer Adam sur YouTube", source: .all)).requests[0]
  _ = session.handle(
    .answer(
      request: search,
      DJResponse(reply: "Trois propositions", action: "keep", tracks: [], discoveries: items)))
  let queuedCard = session.handle(.ask("Mets le trois en file d'attente", source: .all))
  try expect(
    queuedCard.requests.isEmpty && queuedCard.cued.isEmpty && session.upcoming.map(\.id) == [d.id],
    "Third suggestion was re-searched or replaced the current song")
  let immediate = session.handle(.ask("Joue le deuxième maintenant", source: .all))
  try expect(
    immediate.requests.isEmpty && immediate.cued == [c.id], "Immediate choice did not cue card 2")
  let all = session.handle(.ask("Mets les trois", source: .all))
  try expect(
    all.cued == [b.id] && session.upcoming.map(\.id) == [c.id, d.id], "Plural three lost card order"
  )
  let nextCard = session.handle(.ask("next", source: .all))
  try expect(
    nextCard.cued == [c.id] && nextCard.requests.isEmpty,
    "Next after suggestions did not advance locally")
  try expect(
    session.handle(.ask("pause", source: .all)).pauses, "Pause after card selection failed")
  let invalid = session.handle(.ask("joue le 8", source: .all))
  try expect(
    invalid.cued.isEmpty && invalid.requests.isEmpty && session.current?.id == c.id,
    "Invalid card number chose another song")
  try expect(
    DJSuggestionCommand.parse("joue les trois petits cochons", count: 3) == nil,
    "Named song mistaken for a card reference")
  let context = ChatMessage(role: "assistant", content: "Propositions", discoveries: items)
    .contextContent
  try expect(
    context.contains(d.id) && context.contains("position"), "Visible cards lost from AI context")

  print(
    "Listening session checks passed: requests, late answers, pause/resume, sign-in, refill, unavailable"
  )
}
