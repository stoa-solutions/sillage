import Combine
import Foundation
import SillageAudio
import SillageKit

/// A queued track. The DJ may queue a track twice, so entries are identified by position.
struct QueueEntry: Identifiable {
  let id: Int
  let track: Track
}

/// Carries out the Session d'écoute: every click, chat message and player signal becomes an
/// event; every effect becomes a cue, a server request, a voice line or a banner. The rules
/// live in `ListeningSession`, tested on their own; this model only connects them to the Mac.
@MainActor
final class DJModel: ObservableObject {
  private(set) var listening = ListeningSession()
  let listeningChanges = PassthroughSubject<ListeningSession, Never>()
  @Published var prompt = ""
  @Published var showingRules = false
  @Published private(set) var rulesText = ""
  private var rulesTask: Task<Void, Never>?
  @Published var searchScope: DiscoveryScope = .library
  let agents: DJAgentsModel
  let taste: TasteModel
  let player = Player()
  let microphone = Microphone()
  lazy var voice = VoiceOutput(engine: player.engine)
  private let session: Session
  private var work: Task<Void, Never>?
  private var microphoneSource: DiscoveryScope = .library
  private var subscriptions: Set<AnyCancellable> = []
  private let journal = DJJournal()
  private var journalRequests: [Int: (UUID, DiscoveryScope)] = [:]
  private var journalSource: DiscoveryScope = .library

  var messages: [ChatMessage] { listening.messages }
  var queue: [Track] { listening.queue.tracks }
  var position: Int { listening.queue.position }
  var history: [PlaybackHistoryEntry] { listening.queue.history }
  var busy: Bool { listening.busy }
  var waiting: [WaitingMessage] { listening.waiting }
  var waitingForNext: Bool { listening.waitingForNext }
  var playbackBlocked: Bool { listening.playbackBlocked }
  var continuationNotice: String { listening.notice }
  var current: Track? { listening.current }
  var allUpcoming: [QueueEntry] {
    queue.indices.dropFirst(position + 1).map { QueueEntry(id: $0, track: queue[$0]) }
  }
  var upcoming: [QueueEntry] { Array(allUpcoming.prefix(3)) }
  var spoken: Bool {
    get { listening.spoken }
    set { dispatch(.spoken(newValue)) }
  }
  var continuous: Bool {
    get { listening.continuous }
    set { dispatch(.continuous(newValue)) }
  }

  init(session: Session) {
    self.session = session
    agents = DJAgentsModel(session: session)
    taste = TasteModel(session: session)
    journal.onSyncIssue = { [weak session] failed in
      let notice = "Le journal du DJ attend sa synchronisation. La lecture continue."
      if failed {
        session?.notice = notice
      } else if session?.notice == notice {
        session?.notice = ""
      }
    }
    microphone.onText = { [weak self] text in
      guard let self else { return }
      self.send(text, source: self.microphoneSource)
    }
    microphone.onError = { [weak self] text in self?.session.error = text }
    microphone.objectWillChange.sink { [weak self] _ in
      // Published fires before the value is stored.
      Task { @MainActor in self?.restoreAfterDictation() }
    }.store(in: &subscriptions)
    player.engine.onSignal = { [weak self] in self?.dispatch(.playback($0)) }
    session.$loadingCredentials.sink { [weak self] loading in
      // Published fires before the value is stored: read the new value, not the session.
      guard let self else { return }
      Task { @MainActor in
        let ready = !loading && self.session.hasServer
        self.dispatch(.accountReady(ready))
        if ready { await self.agents.load() }
      }
    }.store(in: &subscriptions)
    voice.onFallback = { [weak self] in
      self?.session.notice = "Voix locale macOS utilisée pour cette réponse."
    }
    voice.onCloudPlayback = { [weak self] in
      if self?.session.notice == "Voix locale macOS utilisée pour cette réponse." {
        self?.session.notice = ""
      }
    }
  }

  // MARK: - Gestures

  /// The account changed: the File and the chat belonged to the previous library.
  func reset() {
    journal.reset()
    journalRequests = [:]
    journalSource = .library
    rulesTask?.cancel()
    showingRules = false
    rulesText = ""
    work?.cancel()
    work = nil
    microphone.stop()
    voice.stop()
    voice.clearPreparation()
    player.engine.reset()
    objectWillChange.send()
    listening = ListeningSession()
    listeningChanges.send(listening)
    prompt = ""
    searchScope = .library
    agents.reset()
    taste.reset()
    dispatch(.accountReady(!session.loadingCredentials && session.hasServer))
  }
  func send(_ text: String? = nil, source: DiscoveryScope? = nil) {
    let text = (text ?? prompt).trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else { return }
    guard !session.loadingCredentials else {
      prompt = text
      session.notice = "Connexion en cours. Ta demande reste prête à envoyer."
      return
    }
    prompt = ""
    microphone.stop()
    if DJCommand.parse(text) == .rules {
      showRules()
      return
    }
    dispatch(.ask(text, source: source ?? searchScope))
  }
  private func showRules() {
    showingRules = true
    rulesText = "Chargement des règles…"
    rulesTask?.cancel()
    guard let connection = session.connection else {
      rulesText = "Connecte ton compte pour consulter les règles du DJ."
      return
    }
    rulesTask = Task { [weak self] in
      do {
        // The rules as the DJ receives them, with the profile of the agent chosen here.
        let agent =
          self?.agents.selectedID.addingPercentEncoding(withAllowedCharacters: .alphanumerics)
          ?? DJAgent.defaultID
        let response = try await HTTPClient().server(
          connection, path: "dj/rules?agentId=" + agent)
        try Task.checkCancellation()
        self?.rulesText = response["prompt"] as? String ?? "Règles indisponibles."
      } catch {
        guard !Task.isCancelled else { return }
        self?.rulesText = "Impossible de charger les règles. Réessaie avec /prompt."
      }
    }
  }

  func play(_ track: Track, source: DiscoveryScope = .library) {
    dispatch(.play(track, source: source))
  }
  func enqueue(_ track: Track, source: DiscoveryScope = .library) {
    dispatch(.enqueue(track, source: source))
  }
  func next() { dispatch(.next) }
  func playUpcoming(at index: Int) { dispatch(.playUpcoming(index)) }
  func moveUpcoming(from source: Int, to destination: Int) {
    dispatch(.moveUpcoming(from: source, to: destination))
  }
  func retryContinuation() { dispatch(.retryContinuation) }
  /// « Envoyer maintenant » : the DJ stops its current answer and takes this message.
  func sendNow(_ id: Int) {
    voice.stop()
    dispatch(.sendNow(id))
  }
  func discardWaiting(_ id: Int) { dispatch(.discardWaiting(id)) }
  func retryPlayback() { dispatch(.resume) }
  /// "Annuler": stops the search in progress, the dictation and the voice.
  func cancel() {
    microphone.stop()
    voice.stop()
    dispatch(.cancel)
  }
  func togglePlayback() { dispatch(player.playing ? .pause : .resume) }
  func pause() { dispatch(.pause) }
  func seek(_ seconds: Double) { player.seek(seconds) }
  func toggleMicrophone(source: DiscoveryScope? = nil) {
    if !microphone.active { microphoneSource = source ?? searchScope }
    voice.stop()
    // The music steps back so dictation hears the person, not the song.
    if !microphone.active { stepBackForDictation() }
    Task { await microphone.toggle() }
  }
  private var duckedForDictation = false
  private func stepBackForDictation() {
    let choice = UserDefaults.standard.string(forKey: "dictationMusic")
    if DictationMusic(rawValue: choice ?? "") == .pause {
      dispatch(.pause)
    } else {
      duckedForDictation = true
      player.engine.duck(true)
    }
  }
  /// Restores the music once the dictation is over, whatever ended it.
  private func restoreAfterDictation() {
    guard duckedForDictation, !microphone.active else { return }
    duckedForDictation = false
    player.engine.duck(false)
  }
  func stopVoice() { voice.stop() }

  // MARK: - Effects

  private func dispatch(_ event: ListeningSession.Event) {
    journal.use(session.connection)
    let previousMessages = listening.messages
    var next = listening
    let effects = next.handle(event)
    for effect in effects {
      if case .send(let id, let request) = effect { journalRequests[id] = (UUID(), request.scope) }
    }
    if journalRequests.count > 64 {
      for id in journalRequests.keys.sorted().prefix(journalRequests.count - 64) {
        journalRequests[id] = nil
      }
    }
    var requestId: UUID?
    let action: String?
    switch event {
    case .ask(_, let source):
      journalSource = source
      action = "ask"
    case .play(_, let source):
      journalSource = source
      action = "play"
    case .enqueue(_, let source):
      journalSource = source
      action = "enqueue"
    case .next: action = "next"
    case .pause: action = "pause"
    case .resume: action = "resume"
    case .cancel: action = "cancel"
    case .sendNow: action = "send_now"
    case .discardWaiting: action = "discard_waiting"
    case .retryContinuation: action = "retry_continuation"
    case .playUpcoming: action = "play_upcoming"
    case .moveUpcoming: action = "reorder"
    case .answer(let id, _):
      requestId = journalRequests[id]?.0
      journalSource = journalRequests[id]?.1 ?? journalSource
      action =
        previousMessages.last?.id == next.messages.last?.id && effects.isEmpty
        ? "answer_ignored" : "answer_received"
    case .failed(let id, _):
      requestId = journalRequests[id]?.0
      journalSource = journalRequests[id]?.1 ?? journalSource
      action = "request_failed"
    case .playback(.ended): action = "ended"
    case .playback(.failed), .playback(.unavailable): action = "playback_failed"
    default: action = nil
    }
    if requestId == nil {
      for effect in effects {
        if case .send(let id, let request) = effect {
          requestId = journalRequests[id]?.0
          journalSource = request.scope
        }
      }
    }
    if action != nil || previousMessages.last?.id != next.messages.last?.id {
      journal.capture(
        before: previousMessages, after: next.messages, action: action, scope: journalSource,
        visibleScope: searchScope, requestId: requestId, current: next.current,
        upcoming: Array(next.upcoming))
    }
    // Progress still drives preparation and continuation precisely. Only meaningful session
    // changes invalidate the chat/history; the player's clock owns the time display.
    let notify: Bool
    if case .playback(.progress) = event { notify = !effects.isEmpty } else { notify = true }
    if notify { objectWillChange.send() }
    listening = next
    if notify { listeningChanges.send(next) }
    for effect in effects { run(effect) }
  }

  private func run(_ effect: ListeningSession.Effect) {
    switch effect {
    case .cue(let track, let autoplay): player.engine.cue(track, autoplay: autoplay)
    case .prepare(let tracks): player.engine.prepare(tracks)
    case .play: player.engine.play()
    case .pause: player.engine.pause()
    case .send(let id, let request): ask(id, request)
    case .cancelRequest:
      work?.cancel()
      work = nil
    case .speak(let text): speak(text)
    case .prepareSpeech(let text):
      guard session.usingCloudVoice, let connection = session.connection else { return }
      voice.prepare(text, context: connection.token, using: synthesis(connection))
    case .stopSpeech: voice.stop()
    case .clearPreparedSpeech: voice.clearPreparation()
    case .banner(let text): session.notice = text
    case .error(let message): session.error = message
    }
  }

  /// Google accounts use their own encrypted server credential and scoped catalog.
  private func ask(_ id: Int, _ request: DJRequest) {
    work?.cancel()
    guard let connection = session.connection else {
      dispatch(
        .failed(
          request: id, message: "Connecte ton serveur dans Réglages pour retrouver ta bibliothèque."
        ))
      return
    }
    var request = request
    request.conversationId = journal.conversationId
    request.requestId = journalRequests[id]?.0 ?? UUID()
    // Read when the request leaves, so a refill uses the agent chosen at that moment.
    request.agentId = agents.selectedID
    work = Task { [weak self] in
      do {
        let response = try await ServerDJ(connection: connection).turn(request)
        try Task.checkCancellation()
        self?.dispatch(.answer(request: id, response))
      } catch {
        guard !Task.isCancelled else { return }
        self?.dispatch(.failed(request: id, message: error.localizedDescription))
      }
    }
  }

  private func speak(_ text: String) {
    if !session.usingCloudVoice {
      voice.speakLocally(text)
      return
    }
    let connection = session.connection
    voice.speak(text, context: connection?.token ?? "", using: synthesis(connection))
  }

  private func synthesis(_ connection: Connection?) -> (String) async throws -> Data {
    return { text in
      guard let connection else { throw SillageError.message("Voix indisponible.") }
      var object: [String: Any] = [:]
      let started = Date()
      for attempt in 0..<3 {
        do {
          object = try await HTTPClient().server(
            connection, path: "dj/speech", body: ["text": String(text.prefix(600))])
          break
        } catch let error as HTTPServiceError
          where [429, 502, 503].contains(error.status) && attempt < 2
          && Date().timeIntervalSince(started) < 8
        {
          // A cancelled previous utterance may still hold the server's per-account lease briefly.
          try await Task.sleep(nanoseconds: UInt64(attempt + 1) * 1_000_000_000)
        }
      }
      guard let encoded = object["audio"] as? String, let bytes = Data(base64Encoded: encoded)
      else { throw SillageError.message("Voix indisponible.") }
      return bytes
    }
  }
}
