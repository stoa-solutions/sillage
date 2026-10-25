import Foundation
import RecallKit

extension Array where Element == ListeningSession.Effect {
  fileprivate var sentRequests: [DJRequest] {
    compactMap {
      if case .send(_, let request) = $0 { return request }
      return nil
    }
  }
  fileprivate var requests: [Int] {
    compactMap { if case .send(let id, _) = $0 { return id } else { return nil } }
  }
  fileprivate var cued: [String] {
    compactMap { if case .cue(let t, _) = $0 { return t.id } else { return nil } }
  }
  fileprivate var autoplay: [Bool] {
    compactMap {
      if case .cue(_, let autoplay) = $0 { return autoplay }
      return nil
    }
  }
  fileprivate var stopsSpeech: Bool {
    contains {
      if case .stopSpeech = $0 { return true }
      return false
    }
  }
  fileprivate var speaks: Bool {
    contains {
      if case .speak = $0 { return true }
      return false
    }
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
    stopped.pauses && session.playbackBlocked && session.upcoming.map(\.id) == [d.id],
    "Repeated unavailable clips did not stop with a notice")

  // Service failures do not consume the current track, mark it unavailable, or search again.
  for failure in [
    PlaybackFailure(.authentication), PlaybackFailure(.network),
    PlaybackFailure.youtube(code: 153), PlaybackFailure.youtube(code: 999),
  ] {
    session = playingAlone(a)
    for song in [b, c, d] { _ = session.handle(.enqueue(song, source: .all)) }
    let previousHistory = session.queue.history.count
    let failureEffects = session.handle(.playback(.failed(failure)))
    try expect(
      session.current?.id == a.id && session.upcoming.map(\.id) == [b.id, c.id, d.id]
        && session.queue.history.count == previousHistory && failureEffects.pauses
        && failureEffects.cued.isEmpty && session.playbackBlocked,
      "A provider failure consumed the queue")
    _ = session.handle(.playback(.progress(elapsed: 199, duration: 200)))
    _ = session.handle(.playback(.ended))
    _ = session.handle(.playback(.failed(failure)))
    try expect(
      session.current?.id == a.id && !session.busy, "Stale signals restarted a blocked session")
    let retry = session.handle(.resume)
    try expect(
      retry.cued.first == a.id && !session.playbackBlocked
        && session.upcoming.count == 3, "Retry did not keep the current selection")
  }

  session = playingAlone(a)
  let pendingChoice = session.handle(.ask("Joue un autre titre", source: .all)).requests[0]
  _ = session.handle(.playback(.failed(PlaybackFailure(.network))))
  let recovered = session.handle(
    .answer(
      request: pendingChoice,
      DJResponse(reply: "Le suivant", action: "replace", tracks: [b])))
  try expect(
    recovered.cued == [b.id] && recovered.autoplay == [true] && !session.playbackBlocked,
    "A provider error cancelled the person's pending selection or manufactured a Pause")

  // Duplicates stay out of the File, with a banner rather than a silent no-op.
  session = playingAlone(a)
  _ = session.handle(.enqueue(b, source: .library))
  try expect(
    session.handle(.enqueue(b, source: .library)).banners == [
      "Ce morceau est déjà joué ou à suivre. Utilise Écouter pour le rejouer."
    ],
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

  session = playingAlone(a)
  _ = session.handle(.enqueue(b, source: .library))
  let suite = session.handle(.ask("/suite 5", source: .all))
  try expect(suite.requests.count == 1, "Slash suite did not send a single composition request")
  let prepared = session.handle(
    .answer(
      request: suite.requests[0],
      DJResponse(reply: "Je lance A", action: "append", tracks: [a, b, c, c, d])))
  try expect(
    prepared.cued.isEmpty && session.current?.id == a.id
      && session.upcoming.map(\.id) == [b.id, c.id, d.id],
    "Manual preparation replayed current/queued music or interrupted playback")
  try expect(session.handle(.ask("/pause", source: .all)).pauses, "Slash pause called the provider")
  try expect(
    session.handle(.ask("/suite 99", source: .all)).requests.isEmpty,
    "Invalid command reached provider")
  try expect(
    session.handle(.ask("/aide", source: .all)).requests.isEmpty, "Help consumed an AI turn")
  try expect(DJCommand.parse("/suite") == .prepare(5), "Default suite was not five songs")
  try expect(DJCommand.parse("/suite 8") == .prepare(8), "Explicit suite length lost")

  // The last transport intent wins over a slower answer, for both manual and automatic turns.
  session = playingAlone(a)
  let delayed = session.handle(.ask("Joue du jazz", source: .library)).requests[0]
  let paused = session.handle(.ask("Tu peux mettre la musique en pause stp", source: .library))
  try expect(paused.pauses && paused.stopsSpeech, "Natural pause did not stop music and voice")
  let afterPause = session.handle(
    .answer(
      request: delayed,
      DJResponse(reply: "Je lance B", action: "replace", tracks: [b])))
  try expect(
    afterPause.cued == [b.id] && afterPause.autoplay == [false] && !afterPause.speaks,
    "A late selection overrode the user's newer Pause")
  _ = session.handle(.resume)
  let explicit = session.handle(.ask("Joue C", source: .library)).requests[0]
  _ = session.handle(.pause)
  _ = session.handle(.resume)
  let resumed = session.handle(
    .answer(
      request: explicit,
      DJResponse(reply: "C", action: "replace", tracks: [c])))
  try expect(resumed.autoplay == [true], "An explicit Resume before the answer was ignored")

  session = playingAlone(a)
  let pendingNext = session.handle(.next).requests[0]
  _ = session.handle(.pause)
  let pausedRefill = session.handle(
    .answer(
      request: pendingNext,
      DJResponse(reply: "B", action: "append", tracks: [b])))
  try expect(
    pausedRefill.autoplay == [false] && !pausedRefill.speaks,
    "A refill restarted music after Pause at the queue tail")
  _ = session.handle(.next)
  _ = session.handle(.pause)
  let preparePaused = session.handle(.ask("/suite 5", source: .library)).requests[0]
  let preparedPaused = session.handle(
    .answer(
      request: preparePaused,
      DJResponse(reply: "C", action: "append", tracks: [c])))
  try expect(
    preparedPaused.autoplay == [false], "Manual preparation resumed a paused, exhausted queue")
  let replacement = session.handle(.play(d, source: .library))
  try expect(
    replacement.stopsSpeech && replacement.autoplay == [true],
    "Direct selection did not stop obsolete speech or start its selected song")

  session = playingAlone(a)
  _ = session.handle(.pause)
  let newerSelection = session.handle(.ask("Joue B maintenant", source: .library)).requests[0]
  let selectedAfterPause = session.handle(
    .answer(
      request: newerSelection,
      DJResponse(reply: "B", action: "replace", tracks: [b])))
  try expect(
    selectedAfterPause.autoplay == [true], "A new play request remained stuck on an old Pause")

  session = playingAlone(a)
  _ = session.handle(.pause)
  let browse = session.handle(.ask("Cherche du jazz", source: .library)).requests[0]
  let browseAnswer = session.handle(
    .answer(
      request: browse,
      DJResponse(reply: "Voici des propositions", action: "keep", tracks: [])))
  try expect(
    browseAnswer.speaks && browseAnswer.cued.isEmpty,
    "A new chat request on paused music lost its spoken response")

  for text in [
    "Tu peux mettre en pause stp", "arrête la musique", "Peux-tu stopper la musique ?",
    "stop la musique", "mets-moi en pause",
  ] {
    guard case .pause? = DJTransportCommand.parse(text) else {
      throw RecallError.message("Natural pause was not recognized: " + text)
    }
  }
  for text in ["Tu peux passer au suivant stp", "Peux-tu changer de morceau ?"] {
    guard case .next? = DJTransportCommand.parse(text) else {
      throw RecallError.message("Natural next was not recognized: " + text)
    }
  }
  for text in ["Tu peux reprendre la lecture stp", "peux-tu mettre play"] {
    guard case .resume? = DJTransportCommand.parse(text) else {
      throw RecallError.message("Natural resume was not recognized: " + text)
    }
  }
  for text in [
    "Ne mets pas en pause", "ne passe pas au suivant", "sans changer de morceau",
    "joue Don't Stop Me Now", "next de Tyga", "pause puis joue du jazz", "non stop",
  ] {
    try expect(
      DJTransportCommand.parse(text) == nil,
      "Negation, song title or compound request was intercepted: " + text)
  }

  // Follow-ups refer to the shown choices, not an unrelated track still playing.
  session = playingAlone(a)
  let discover = session.handle(.ask("Cherche Acid Coco", source: .all)).requests[0]
  _ = session.handle(
    .answer(
      request: discover,
      DJResponse(
        reply: "Deux choix", action: "keep", tracks: [], discoveries: Array(items.prefix(2)))))
  let alternatives = session.handle(.ask("d’autre", source: .all)).sentRequests[0]
  try expect(
    Set(alternatives.rejectedIds) == Set([b.id, c.id]),
    "Explicit alternatives did not reject the displayed choices")
  try expect(
    alternatives.discoveryContext.map(\.id) == [b.id, c.id]
      && alternatives.playbackContext?.current?.id == a.id,
    "Discovery choices were confused with current playback")
  let except = session.handle(.ask("met tout ce que tu trouve sauf ces deux la", source: .all))
  try expect(
    except.cued.isEmpty && except.sentRequests.count == 1
      && Set(except.sentRequests[0].rejectedIds) == Set([b.id, c.id]),
    "All except these two replayed the two suggestion cards")
  let normalBrowse = session.handle(.ask("Cherche du jazz", source: .all)).sentRequests[0]
  try expect(
    normalBrowse.rejectedIds.isEmpty && normalBrowse.queued.contains(a.id),
    "Explicit refusals leaked into a new musical direction or replaced playback exclusions")
  session = playingAlone(a)
  let noCards = session.handle(.ask("d'autres morceaux", source: .all)).sentRequests[0]
  try expect(
    noCards.rejectedIds.isEmpty && noCards.discoveryContext.isEmpty,
    "Alternatives without cards invented a rejection")
  try expect(
    !DJDiscoveryFollowUp.rejectsSuggestions("je ne veux pas d'autres morceaux"),
    "A negated request for alternatives rejected the choices")

  try expect(
    DJDiscoveryFollowUp.rejectsSuggestions("sauf ces deux-là", cardCount: 2),
    "An exact two-card refusal was ignored")
  try expect(
    !DJDiscoveryFollowUp.rejectsSuggestions("sauf ces deux-là", cardCount: 3),
    "An ambiguous two-card refusal rejected all three cards")
  try expect(
    DJDiscoveryFollowUp.rejectsSuggestions("d'autres morceaux", cardCount: 3),
    "A request for different suggestions lost its whole-group reference")

  // Two failed automatic chances block polling, but a deliberate Next gets one fresh turn.
  session = playingAlone(a)
  let prefetch = session.handle(.playback(.progress(elapsed: 190, duration: 220))).requests[0]
  let broaden = session.handle(
    .answer(
      request: prefetch,
      DJResponse(reply: "Vide", action: "keep", tracks: []))
  ).requests[0]
  _ = session.handle(
    .answer(
      request: broaden,
      DJResponse(reply: "Toujours vide", action: "keep", tracks: [])))
  try expect(
    session.handle(.playback(.progress(elapsed: 195, duration: 220))).requests.isEmpty,
    "An exhausted automatic continuation looped")
  let deliberateRetry = session.handle(.next)
  try expect(
    deliberateRetry.requests.count == 1 && session.waitingForNext,
    "Explicit Next was blocked by exhausted background preparation")
  try expect(
    session.handle(.playback(.progress(elapsed: 196, duration: 220))).requests.isEmpty,
    "Progress duplicated the deliberate continuation request")

  print(
    "Listening session checks passed: requests, late answers, pause/resume, sign-in, refill, unavailable"
  )
}
