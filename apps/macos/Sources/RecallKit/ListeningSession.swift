import Foundation

/// What the playback module reports, whichever player (YouTube or downloaded clip) is sounding.
public enum PlaybackSignal: Sendable, Equatable {
  case playing(Bool)
  case progress(elapsed: Double, duration: Double)
  case ended
  case unavailable
  case failed(PlaybackFailure)
}

/// Session d'écoute: the File, the musical direction and the automatic continuation of one
/// account, with the chat and notices they produce. Every gesture (click, chat, end of a song,
/// a DJ answer) comes in as an event; what must happen comes out as effects. The session never
/// plays, speaks or calls the network itself, so a whole listening session is a test script.
public struct ListeningSession: Sendable {
  public enum Event: Sendable {
    /// A typed or dictated request; transport phrases ("pause", "suivant") stay local.
    case ask(String, source: DiscoveryScope)
    case play(Track, source: DiscoveryScope)
    case enqueue(Track, source: DiscoveryScope)
    case next
    case playUpcoming(Int)
    case moveUpcoming(from: Int, to: Int)
    case pause
    case resume
    case retryContinuation
    /// The person stops a search in progress ("Annuler").
    case cancel
    case continuous(Bool)
    case spoken(Bool)
    /// Credentials loaded (or not): continuation waits for them instead of failing.
    case accountReady(Bool)
    case playback(PlaybackSignal)
    case answer(request: Int, DJResponse)
    case failed(request: Int, message: String)
  }

  public enum Effect: Sendable {
    case cue(Track, autoplay: Bool)
    /// Upcoming tracks to prepare ahead, nearest first.
    case prepare([Track])
    case play
    case pause
    case send(request: Int, DJRequest)
    case cancelRequest
    case speak(String)
    case prepareSpeech(String)
    case stopSpeech
    case clearPreparedSpeech
    case banner(String)
    case error(String)
  }

  private struct Pending: Sendable {
    let id: Int
    let automatic: Bool
    let text: String
    let source: DiscoveryScope
    let transportRevision: Int
    var broadened = false
  }

  public private(set) var queue = PlaybackQueue()
  public private(set) var messages: [ChatMessage] = []
  /// Why the music stopped or why no continuation came; empty when all is well.
  public private(set) var notice = ""
  public private(set) var playbackBlocked = false
  public private(set) var waitingForNext = false
  public private(set) var continuous = true
  public private(set) var spoken = true
  public private(set) var playing = false
  public private(set) var elapsed: Double = 0
  public private(set) var duration: Double = 0
  public var busy: Bool { pending != nil }
  public var current: Track? {
    queue.tracks.indices.contains(queue.position) ? queue.tracks[queue.position] : nil
  }
  public var upcoming: ArraySlice<Track> { queue.tracks.dropFirst(queue.position + 1) }

  private var composition = DJComposition()
  private var pending: Pending?
  private var lastRequest = 0
  private var unavailableCount = 0
  private var accountReady = false
  private var deferredContinuation = false
  private var preparedSpeechFor: Int?
  // Desired transport is independent from delayed backend signals and network answers.
  private var wantsPlayback = true
  private var transportRevision = 0
  // Session-local refusals survive an empty answer and remain distinct from play history.
  private var rejectedDiscoveryIDs: [String] = []

  /// How many upcoming tracks are prepared ahead (downloaded clip in Studio quality).
  public static let preparedAhead = 3
  static let continuationLead: Double = 30
  static let speechLead: Double = 20

  public init() {}

  public mutating func handle(_ event: Event) -> [Effect] {
    var effects: [Effect] = []
    switch event {
    case .ask(let text, let source): ask(text, source: source, into: &effects)
    case .play(let track, let source):
      rejectedDiscoveryIDs = []
      setPlaybackIntent(true)
      effects += [.stopSpeech, .clearPreparedSpeech]
      cancelPending(into: &effects)
      composition.direct(
        "Des morceaux dans l’esprit de \(TrackTitle(track).spoken).", source: source)
      queue.replace([track])
      unavailableCount = 0
      startCurrent(into: &effects)
    case .enqueue(let track, let source):
      guard
        !queue.freshContinuation(DJResponse(reply: "", action: "append", tracks: [track])).tracks
          .isEmpty
      else {
        effects.append(
          .banner("Ce morceau est déjà joué ou à suivre. Utilise Écouter pour le rejouer."))
        break
      }
      let started = queue.apply(
        DJResponse(reply: "", action: "append", tracks: [track]), automatic: false)
      if started {
        setPlaybackIntent(true)
        composition.direct(
          "Des morceaux dans l’esprit de \(TrackTitle(track).spoken).", source: source)
        startCurrent(into: &effects)
      } else {
        effects.append(.prepare(prepared))
      }
      effects.append(.banner("À suivre : " + TrackTitle(track).spoken))
    case .next: next(userInitiated: true, into: &effects)
    case .playUpcoming(let index):
      guard index > queue.position, queue.tracks.indices.contains(index) else { break }
      cancelPending(into: &effects)
      guard queue.playUpcoming(at: index) else { break }
      setPlaybackIntent(true)
      composition.resume()
      unavailableCount = 0
      effects += [.stopSpeech, .clearPreparedSpeech]
      startCurrent(into: &effects)
      announce(into: &effects)
    case .moveUpcoming(let source, let destination):
      guard queue.moveUpcoming(from: source, to: destination) else { break }
      preparedSpeechFor = nil
      effects += [.clearPreparedSpeech, .prepare(prepared)]
    case .pause:
      // Pausing never touches the musical direction: the continuation resumes with the music.
      setPlaybackIntent(false)
      effects += [.pause, .stopSpeech]
    case .resume:
      setPlaybackIntent(true)
      if playbackBlocked {
        unavailableCount = 0
        composition.resume()
        startCurrent(into: &effects)
      } else {
        effects.append(.play)
      }
    case .retryContinuation:
      guard pending == nil else { break }
      waitingForNext = queue.ended
      requestContinuation(retry: true, into: &effects)
    case .cancel:
      guard pending != nil || waitingForNext else { break }
      if waitingForNext { notice = "Recherche annulée. Réessaie quand tu veux." }
      cancelPending(into: &effects)
      composition.cancel()
      waitingForNext = false
    case .continuous(let value):
      continuous = value
      if !value, let pending, pending.automatic, !waitingForNext { cancelPending(into: &effects) }
    case .spoken(let value):
      spoken = value
      if !value { effects += [.stopSpeech, .clearPreparedSpeech] }
    case .accountReady(let ready):
      accountReady = ready
      if ready && deferredContinuation {
        deferredContinuation = false
        requestContinuation(retry: false, into: &effects)
      }
    case .playback(let signal): playback(signal, into: &effects)
    case .answer(let id, let response): answer(id, response, into: &effects)
    case .failed(let id, let message):
      guard let request = pending, request.id == id else { break }
      pending = nil
      if request.automatic { composition.finish(added: false) }
      waitingForNext = false
      notice = "La recherche n’a pas abouti. Tu peux réessayer."
      effects.append(.error(message))
    }
    return effects
  }

  // MARK: - Requests

  private mutating func ask(_ text: String, source: DiscoveryScope, into effects: inout [Effect]) {
    let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else { return }
    if text.hasPrefix("/") {
      switch DJCommand.parse(text) {
      case .next: ask("next", source: source, into: &effects)
      case .pause: ask("pause", source: source, into: &effects)
      case .resume: ask("play", source: source, into: &effects)
      case .prepare(let count):
        ask(
          "Prépare \(count) nouveaux morceaux à suivre dans le même style, sans répétition et sans interrompre la lecture.",
          source: source, into: &effects)
      case .help:
        say(user: text)
        say(assistant: DJCommand.helpText)
      case .rules:
        say(assistant: "Les règles du DJ sont consultables avec /prompt dans l’app.")
      case .invalid:
        say(user: text)
        say(
          assistant:
            "Commande inconnue ou nombre invalide. Utilise /suite 1 à 8, /suivant, /pause, /reprendre, /prompt ou /aide."
        )
      }
      return
    }
    let cards = latestDiscoveries
    let rejectsCards =
      !cards.isEmpty && DJDiscoveryFollowUp.rejectsSuggestions(text, cardCount: cards.count)
    if rejectsCards {
      for card in cards where !rejectedDiscoveryIDs.contains(card.id) {
        rejectedDiscoveryIDs.append(card.id)
      }
      rejectedDiscoveryIDs = Array(rejectedDiscoveryIDs.suffix(100))
    }
    if let command = DJSuggestionCommand.parse(text, count: cards.count) {
      cancelPending(into: &effects)
      effects += [.stopSpeech, .clearPreparedSpeech]
      say(user: text)
      guard !command.indices.isEmpty, command.indices.allSatisfy({ cards.indices.contains($0) })
      else {
        say(
          assistant:
            "Ce numéro ne correspond à aucune proposition. Choisis une carte affichée ou demande une nouvelle recherche."
        )
        return
      }
      let selected = command.indices.map { cards[$0] }
      let tracks = selected.map(\.video)
      let selectedIDs = Set(tracks.map(\.id))
      rejectedDiscoveryIDs.removeAll { selectedIDs.contains($0) }
      let titles = tracks.map { TrackTitle($0).spoken }.joined(separator: ", puis ")
      // Remember the actual choice, not a reference such as "the third", for future refills.
      lastRequest += 1
      pending = Pending(
        id: lastRequest, automatic: false,
        text: "Des morceaux dans l’esprit de " + titles,
        source: selected.allSatisfy(\.inLibrary) ? .library : .all,
        transportRevision: transportRevision)
      answer(
        lastRequest,
        DJResponse(
          reply: (command.append ? "J’ajoute à la suite : " : "C’est parti : ") + titles,
          action: command.append ? "append" : "replace", tracks: tracks), into: &effects)
      return
    }
    if let command = DJTransportCommand.parse(text) {
      say(user: text)
      guard current != nil else {
        say(assistant: "Aucun morceau en cours. Choisis un titre ou demande une sélection.")
        return
      }
      switch command {
      case .next: next(userInitiated: true, into: &effects)
      case .pause:
        setPlaybackIntent(false)
        effects += [.pause, .stopSpeech]
        say(assistant: "Musique en pause.")
      case .resume:
        setPlaybackIntent(true)
        if playbackBlocked {
          unavailableCount = 0
          composition.resume()
          startCurrent(into: &effects)
        } else {
          effects.append(.play)
        }
        say(assistant: "La lecture reprend.")
      }
      return
    }
    // Refusals apply to this discovery direction, never to a new musical wish.
    if !rejectsCards && !DJPlaybackContext.followsCurrent(text) {
      rejectedDiscoveryIDs = []
    }
    cancelPending(into: &effects)
    effects += [.stopSpeech, .clearPreparedSpeech, .error("")]
    unavailableCount = 0
    notice = ""
    let history = messages
    say(user: text)
    var request = composition.userRequest(text, history: history, queue: queue)
    request.scope = source
    send(request, automatic: false, text: text, source: source, into: &effects)
  }

  private mutating func send(
    _ request: DJRequest, automatic: Bool, text: String, source: DiscoveryScope,
    into effects: inout [Effect]
  ) {
    lastRequest += 1
    pending = Pending(
      id: lastRequest, automatic: automatic, text: text, source: source,
      transportRevision: transportRevision)
    var loggedRequest = withDiscoveryContext(request)
    loggedRequest.trigger = automatic ? .continuation : .user
    effects.append(.send(request: lastRequest, loggedRequest))
  }

  private var latestDiscoveries: [DiscoveryItem] {
    messages.last(where: { !($0.discoveries?.isEmpty ?? true) })?.discoveries ?? []
  }

  private func withDiscoveryContext(_ request: DJRequest) -> DJRequest {
    var request = request
    if pending?.automatic == true { request.trigger = .continuation }
    request.rejectedIds = rejectedDiscoveryIDs
    request.discoveryContext = latestDiscoveries.prefix(8).map { DJDiscoveryContext($0.video) }
    return request
  }

  private mutating func cancelPending(into effects: inout [Effect]) {
    guard pending != nil else { return }
    pending = nil
    effects.append(.cancelRequest)
  }

  private mutating func answer(_ id: Int, _ response: DJResponse, into effects: inout [Effect]) {
    guard var request = pending, request.id == id else { return }
    var response = response
    if !request.automatic && response.action == "append" {
      response = queue.freshContinuation(response)
    }
    if request.automatic {
      response = queue.freshContinuation(response)
      // Exactly two chances for a fresh continuation: the second one broadens the search.
      if (response.tracks.isEmpty || response.action == "keep") && !request.broadened {
        request.broadened = true
        lastRequest += 1
        pending = Pending(
          id: lastRequest, automatic: true, text: request.text, source: request.source,
          transportRevision: request.transportRevision, broadened: true)
        effects.append(
          .send(
            request: lastRequest,
            withDiscoveryContext(
              composition.request(history: messages, queue: queue, broaden: true))))
        return
      }
    } else if response.action != "keep", !response.tracks.isEmpty {
      composition.direct(request.text, source: request.source)
    }
    pending = nil
    messages.append(
      ChatMessage(
        role: "assistant", content: response.reply, discoveries: response.discoveries,
        sources: response.sources))
    messages = Array(messages.suffix(24))
    let before = queue.tracks.count
    let changed = queue.apply(response, automatic: request.automatic)
    let added = queue.tracks.count > before || changed
    if request.automatic { composition.finish(added: added) }
    if changed {
      // An explicit new selection may start music, but never undo a newer Pause.
      if !request.automatic, response.action == "replace",
        request.transportRevision == transportRevision
      {
        wantsPlayback = true
      }
      startCurrent(into: &effects)
    } else {
      effects.append(.prepare(prepared))
    }
    if request.automatic && !added {
      notice = "Pas de nouveau morceau trouvé. Réessaie ou précise ton envie dans DJ."
    } else if waitingForNext && !changed {
      notice = "Aucune suite ajoutée. Précise un titre ou réessaie."
    }
    waitingForNext = false
    // A background refill must not interrupt the current song with a premature announcement.
    // A fresh chat request may speak over an already-paused song. Only a newer Pause
    // suppresses its delayed voice; automatic refills stay silent while paused.
    let maySpeak =
      request.automatic
      ? wantsPlayback : wantsPlayback || request.transportRevision == transportRevision
    if spoken && maySpeak && (!request.automatic || changed) {
      effects.append(.speak(response.reply))
    }
  }

  private mutating func requestContinuation(retry: Bool, into effects: inout [Effect]) {
    guard !playbackBlocked else { return }
    guard accountReady else {
      // Signing in: keep the continuation for later without spending its attempt.
      deferredContinuation = true
      return
    }
    guard let tail = queue.tracks.last?.id else { return }
    guard composition.begin(tail: tail, retry: retry) else {
      waitingForNext = false
      if upcoming.isEmpty {
        notice = "La suite disponible est épuisée. Donne une nouvelle direction au DJ ou réessaie."
      }
      return
    }
    send(
      composition.request(history: messages, queue: queue), automatic: true,
      text: composition.directions.last ?? "", source: composition.source, into: &effects)
  }

  // MARK: - Playback

  private mutating func next(
    outcome: PlaybackOutcome = .skipped, userInitiated: Bool, into effects: inout [Effect]
  ) {
    guard current != nil else { return }
    if userInitiated {
      setPlaybackIntent(true)
      unavailableCount = 0
      composition.resume()
      // A late manual search must not undo a more recent Next; an automatic refill keeps going.
      if let request = pending, !request.automatic {
        cancelPending(into: &effects)
        composition.resume()
      }
    }
    effects.append(.stopSpeech)
    if queue.requestNext(outcome: outcome) {
      startCurrent(into: &effects)
      announce(into: &effects)
    } else {
      effects.append(.pause)
      waitingForNext = true
      if pending == nil { requestContinuation(retry: userInitiated, into: &effects) }
    }
  }

  private mutating func playback(_ signal: PlaybackSignal, into effects: inout [Effect]) {
    switch signal {
    case .playing(let value):
      guard !playbackBlocked else { return }
      playing = value
    case .progress(let elapsed, let duration):
      guard !playbackBlocked else { return }
      self.elapsed = elapsed
      self.duration = duration
      if playing && elapsed > 2 { unavailableCount = 0 }
      let remaining = duration - elapsed
      guard playing, duration > 0, remaining > 0 else { return }
      if continuous, spoken, remaining <= Self.speechLead, preparedSpeechFor != queue.position,
        let next = upcoming.first
      {
        preparedSpeechFor = queue.position
        effects.append(.prepareSpeech(TrackTitle(next).announcement))
      }
      if continuous, pending == nil, upcoming.count <= 1, remaining <= Self.continuationLead,
        !composition.needsDirection
      {
        requestContinuation(retry: false, into: &effects)
      }
    case .ended:
      guard !playbackBlocked else { return }
      playing = false
      queue.markEnded()
      if continuous { next(userInitiated: false, into: &effects) }
    case .unavailable: recover(PlaybackFailure(.videoUnavailable), into: &effects)
    case .failed(let failure): recover(failure, into: &effects)
    }
  }

  private mutating func recover(_ failure: PlaybackFailure, into effects: inout [Effect]) {
    guard !playbackBlocked else { return }
    unavailableCount += 1
    // Only a confirmed per-video refusal can justify skipping. Authentication, network,
    // player configuration and unknown failures keep the current song and all upcoming tracks.
    if failure.mayTryAnotherTrack && unavailableCount < 3 && !upcoming.isEmpty {
      next(outcome: .unavailable, userInitiated: false, into: &effects)
      return
    }
    playbackBlocked = true
    playing = false
    // A provider failure pauses the device, not the person's playback intent. A manual
    // selection already in flight may still recover it; only automatic refills are stopped.
    if pending?.automatic == true { cancelPending(into: &effects) }
    composition.cancel()
    deferredContinuation = false
    waitingForNext = false
    effects += [.pause, .stopSpeech, .clearPreparedSpeech]
    notice = failure.message + " Ta file est conservée. Réessaie ce titre ou choisis le suivant."
  }

  private mutating func setPlaybackIntent(_ value: Bool) {
    transportRevision += 1
    wantsPlayback = value
  }

  private var prepared: [Track] { Array(upcoming.prefix(Self.preparedAhead)) }

  private mutating func startCurrent(into effects: inout [Effect]) {
    playbackBlocked = false
    notice = ""
    waitingForNext = false
    preparedSpeechFor = nil
    elapsed = 0
    duration = 0
    guard let current else { return }
    effects += [.cue(current, autoplay: wantsPlayback), .prepare(prepared)]
  }

  private mutating func announce(into effects: inout [Effect]) {
    guard spoken, let current else { return }
    let announcement = TrackTitle(current).announcement
    say(assistant: announcement)
    effects.append(.speak(announcement))
  }

  private mutating func say(user text: String) {
    messages.append(ChatMessage(role: "user", content: text))
    messages = Array(messages.suffix(24))
  }
  private mutating func say(assistant text: String) {
    messages.append(ChatMessage(role: "assistant", content: text))
    messages = Array(messages.suffix(24))
  }
}
