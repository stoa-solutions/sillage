import Combine
import Foundation
import RecallAudio
import RecallKit

/// A queued track. The DJ may queue a track twice, so entries are identified by position.
struct QueueEntry: Identifiable {
  let id: Int
  let track: Track
}

// Conversation, play queue, microphone and voice. Library access goes through `session`.
@MainActor
final class DJModel: ObservableObject {
  @Published private(set) var messages: [ChatMessage] = []
  @Published var prompt = ""
  @Published var searchScope: DiscoveryScope = .library
  @Published private var playback = PlaybackQueue()
  var queue: [Track] { playback.tracks }
  var position: Int { playback.position }
  @Published private(set) var busy = false
  @Published var spoken = true
  @Published var continuous = true
  @Published private(set) var continuationNotice = ""
  @Published private(set) var waitingForNext = false
  var history: [PlaybackHistoryEntry] { playback.history }
  var allUpcoming: [QueueEntry] {
    queue.indices.dropFirst(position + 1).map { QueueEntry(id: $0, track: queue[$0]) }
  }
  private var requestID = UUID()
  private var automaticRequest = false
  private var composition = DJComposition()
  private var unavailableCount = 0
  private var microphoneSource: DiscoveryScope = .library
  let player = Player()
  let microphone = Microphone()
  private let session: Session
  lazy var voice = VoiceOutput(player: player)
  private var work: Task<Void, Never>?

  var current: Track? { queue.indices.contains(position) ? queue[position] : nil }
  var upcoming: [QueueEntry] {
    queue.indices.dropFirst(position + 1).prefix(3).map { QueueEntry(id: $0, track: queue[$0]) }
  }

  init(session: Session) {
    self.session = session
    microphone.onText = { [weak self] text in
      guard let self else { return }
      self.send(text, source: self.microphoneSource)
    }
    microphone.onError = { [weak self] text in self?.session.error = text }
    player.onProgress = { [weak self] in
      if let self, player.playing, player.elapsed > 2 { unavailableCount = 0 }
      self?.prepareNextVoice()
      self?.prepareContinuation()
    }
    player.onEnded = { [weak self] in
      guard let self else { return }
      playback.markEnded()
      if continuous { next(userInitiated: false) }
    }
    player.onUnavailable = { [weak self] in
      guard let self else { return }
      unavailableCount += 1
      if unavailableCount < 3 {
        next(outcome: .unavailable, userInitiated: false)
      } else {
        cancel()
        playback.stop(outcome: .unavailable)
        player.command("pause")
        continuationNotice =
          "Plusieurs clips sont indisponibles. Réessaie ou choisis un titre dans À suivre."
        waitingForNext = false
      }
    }

    voice.onFallback = { [weak self] in
      self?.session.notice = "Voix locale macOS utilisée pour cette réponse."
    }
    voice.onCloudPlayback = { [weak self] in
      if self?.session.notice == "Voix locale macOS utilisée pour cette réponse." {
        self?.session.notice = ""
      }
    }
  }
  /// Called when the source changes: the queue came from the previous library.
  func reset() {
    cancel()
    playback.reset()
    messages = []
    prompt = ""
    searchScope = .library
    continuationNotice = ""
    composition.reset()
    player.reset()
  }
  func send(_ text: String? = nil, automatic: Bool = false, source: DiscoveryScope? = nil) {
    let text = (text ?? prompt).trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else { return }
    if automatic && busy { return }
    guard !session.loadingCredentials else {
      prompt = text
      session.notice = "Connexion en cours. Ta demande reste prête à envoyer."
      return
    }
    if !automatic, DJTransportCommand.parse(text) == .next, current != nil {
      prompt = ""
      microphone.stop()
      messages.append(ChatMessage(role: "user", content: text))
      next()
      return
    }
    if !automatic && busy { cancel() }
    microphone.stop()
    if !automatic {
      voice.stop()
      voice.clearPreparation()
      unavailableCount = 0
    }
    continuationNotice = ""
    session.error = ""
    busy = true
    automaticRequest = automatic
    let id = UUID()
    requestID = id
    if !automatic { prompt = "" }
    let source = source ?? searchScope
    let history = messages
    if !automatic {
      messages.append(ChatMessage(role: "user", content: text))
    }
    work = Task {
      defer {
        if requestID == id {
          busy = false
          waitingForNext = false
          automaticRequest = false
        }
      }
      do {
        var response = try await respond(
          to: text, history: history, automatic: automatic, source: source)
        try Task.checkCancellation()
        guard requestID == id else { return }
        if automatic { response = playback.freshContinuation(response) }
        if !automatic, response.action != "keep", !response.tracks.isEmpty {
          composition.direct(text, source: source)
        }
        messages.append(
          ChatMessage(role: "assistant", content: response.reply, discoveries: response.discoveries)
        )
        messages = Array(messages.suffix(24))
        let oldCount = queue.count
        let changed = playback.apply(response, automatic: automatic)
        if automatic { composition.finish(added: queue.count > oldCount || changed) }
        if changed {
          playCurrent()
        } else {
          player.prepareNext(upcoming.first?.track)
          prepareNextVoice()
        }
        if automatic && queue.count == oldCount && !changed {
          continuationNotice =
            "Pas de nouveau morceau trouvé. Réessaie ou précise ton envie dans DJ."
        } else if waitingForNext && !changed {
          continuationNotice = "Aucune suite ajoutée. Précise un titre ou réessaie."
        }
        // A background refill must not interrupt the current song with a premature announcement.
        if spoken && (!automatic || changed) { speak(response.reply) }
      } catch {
        if !Task.isCancelled && requestID == id {
          if automatic { composition.finish(added: false) }
          session.error = error.localizedDescription
          continuationNotice = "La recherche n’a pas abouti. Tu peux réessayer."
        }
      }
    }
  }
  /// Google accounts use their own encrypted server credential and scoped catalog.
  private func respond(
    to text: String, history: [ChatMessage], automatic: Bool, source: DiscoveryScope
  )
    async throws -> DJResponse
  {
    guard let connection = session.connection else {
      throw RecallError.message(
        "Connecte ton serveur dans Réglages pour retrouver ta bibliothèque.")
    }
    let dj = ServerDJ(connection: connection)
    if automatic {
      return try await composition.continueSession(history: history, queue: playback) {
        try await dj.turn($0)
      }
    }
    var request = composition.userRequest(text, history: history, queue: playback)
    request.scope = source
    return try await dj.turn(request)
  }
  private func speak(_ text: String) {
    if !session.cloudVoice {
      voice.speakLocally(text)
      return
    }
    let connection = session.connection
    voice.speak(text, context: connection?.token ?? "", using: synthesis(connection))
  }
  private func synthesis(_ connection: Connection?) -> (String) async throws -> Data {
    return { text in
      guard let connection else { throw RecallError.message("Voix indisponible.") }
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
      else { throw RecallError.message("Voix indisponible.") }
      return bytes
    }
  }
  private func prepareNextVoice() {
    guard continuous, spoken, session.cloudVoice, player.playing,
      player.duration > 0, player.duration - player.elapsed > 0,
      player.duration - player.elapsed <= 20,
      let track = upcoming.first?.track, let connection = session.connection
    else { return }
    voice.prepare(
      TrackTitle(track).announcement, context: connection.token, using: synthesis(connection))
  }

  func cancel() {
    requestID = UUID()
    work?.cancel()
    work = nil
    composition.cancel()
    busy = false
    automaticRequest = false
    if waitingForNext { continuationNotice = "Recherche annulée. Réessaie quand tu veux." }
    waitingForNext = false
    voice.clearPreparation()
    microphone.stop()
    voice.stop()
  }
  func play(_ track: Track, source: DiscoveryScope = .library) {
    cancel()
    composition.direct(
      "Des morceaux dans l’esprit de \(TrackTitle(track).spoken).", source: source)
    playback.replace([track])
    unavailableCount = 0
    playCurrent()
  }
  private func playCurrent() {
    continuationNotice = ""
    waitingForNext = false
    if let current {
      player.cue(current)
      player.prepareNext(upcoming.first?.track)
    }
  }
  func enqueue(_ track: Track, source: DiscoveryScope = .library) {
    if allUpcoming.contains(where: { $0.track.id == track.id }) {
      session.notice = "Ce morceau est déjà à suivre."
      return
    }
    let changed = playback.apply(
      DJResponse(reply: "", action: "append", tracks: [track]), automatic: false)
    if changed {
      composition.direct(
        "Des morceaux dans l’esprit de \(TrackTitle(track).spoken).", source: source)
      playCurrent()
    } else {
      player.prepareNext(upcoming.first?.track)
    }
    session.notice = "À suivre : " + TrackTitle(track).spoken
  }
  func next(outcome: PlaybackOutcome = .skipped, userInitiated: Bool = true) {
    guard current != nil else { return }
    if userInitiated {
      unavailableCount = 0
      // A late manual search must not undo a more recent Next. Keep automatic refill alive.
      if busy && !automaticRequest {
        cancel()
        composition.resume()
      }
    }
    voice.stop()
    if playback.requestNext(outcome: outcome) {
      playCurrent()
      announceCurrent()
    } else {
      player.command("pause")
      waitingForNext = true
      if !busy { requestContinuation(retry: userInitiated) }
    }
  }
  func retryContinuation() {
    guard !busy else { return }
    waitingForNext = playback.ended
    requestContinuation(retry: true)
  }
  private func requestContinuation(retry: Bool = false) {
    guard let tail = queue.last?.id else { return }
    guard composition.begin(tail: tail, retry: retry) else {
      waitingForNext = false
      if allUpcoming.isEmpty {
        continuationNotice =
          "La suite disponible est épuisée. Donne une nouvelle direction au DJ ou réessaie."
      }
      return
    }
    send("Préparer la suite", automatic: true)
  }
  private func prepareContinuation() {
    guard continuous, player.playing, !busy, current != nil, allUpcoming.count <= 1,
      player.duration > 0, player.duration - player.elapsed > 0,
      player.duration - player.elapsed <= 30
    else { return }
    guard !composition.needsDirection else { return }
    requestContinuation()
  }
  func continuousChanged() {
    if !continuous && automaticRequest && !waitingForNext { cancel() }
  }
  func moveUpcoming(from source: Int, to destination: Int) {
    guard playback.moveUpcoming(from: source, to: destination) else { return }
    voice.clearPreparation()
    player.prepareNext(upcoming.first?.track)
    prepareNextVoice()
  }
  func playUpcoming(at index: Int) {
    guard index > position, queue.indices.contains(index) else { return }
    cancel()
    guard playback.playUpcoming(at: index) else { return }
    composition.resume()
    voice.stop()
    voice.clearPreparation()
    unavailableCount = 0
    playCurrent()
    announceCurrent()
  }
  private func announceCurrent() {
    guard spoken, let current else { return }
    let announcement = TrackTitle(current).announcement
    messages.append(ChatMessage(role: "assistant", content: announcement))
    messages = Array(messages.suffix(24))
    speak(announcement)
  }
  func toggleMicrophone(source: DiscoveryScope? = nil) {
    if !microphone.active { microphoneSource = source ?? searchScope }
    if busy { cancel() }
    voice.stop()
    player.command("pause")
    Task { await microphone.toggle() }
  }
  func stopVoice() { voice.stop() }
}
