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
  private var prefetchedPosition: Int?
  private var unavailableCount = 0
  let player = Player()
  let microphone = Microphone()
  private let session: Session
  lazy var voice = VoiceOutput(player: player)
  private var work: Task<Void, Never>?
  private var lastRequest = ""
  var current: Track? { queue.indices.contains(position) ? queue[position] : nil }
  var upcoming: [QueueEntry] {
    queue.indices.dropFirst(position + 1).prefix(3).map { QueueEntry(id: $0, track: queue[$0]) }
  }

  init(session: Session) {
    self.session = session
    microphone.onText = { [weak self] text in self?.send(text) }
    microphone.onError = { [weak self] text in self?.session.error = text }
    player.onProgress = { [weak self] in
      if let self, player.playing, player.elapsed > 2 { unavailableCount = 0 }
      self?.prepareNextVoice()
      self?.prepareContinuation()
    }
    player.onEnded = { [weak self] in
      guard let self else { return }
      playback.markEnded()
      if continuous { next() }
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
    lastRequest = ""
    continuationNotice = ""
    prefetchedPosition = nil
    player.reset()
  }
  func send(_ text: String? = nil, automatic: Bool = false) {
    let text = (text ?? prompt).trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty, !busy else { return }
    guard !session.loadingCredentials else {
      prompt = text
      session.notice = "Connexion en cours. Ta demande reste prête à envoyer."
      return
    }
    microphone.stop()
    if !automatic {
      voice.stop()
      voice.clearPreparation()
      prefetchedPosition = nil
      unavailableCount = 0
    }
    continuationNotice = ""
    session.error = ""
    busy = true
    automaticRequest = automatic
    let id = UUID()
    requestID = id
    if !automatic { prompt = "" }
    let history = messages
    if !automatic {
      lastRequest = text
      messages.append(ChatMessage(role: "user", content: text))
    }
    let excluded = Set((historyTracks + queue).suffix(100).map(\.id))
    work = Task {
      defer {
        if requestID == id {
          busy = false
          waitingForNext = false
          automaticRequest = false
        }
      }
      do {
        let response = try await respond(to: text, history: history, excluded: excluded)
        try Task.checkCancellation()
        guard requestID == id else { return }
        messages.append(ChatMessage(role: "assistant", content: response.reply))
        messages = Array(messages.suffix(24))
        let oldCount = queue.count
        let changed = playback.apply(response, automatic: automatic)
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
          session.error = error.localizedDescription
          continuationNotice = "La recherche n’a pas abouti. Tu peux réessayer."
        }
      }
    }
  }
  /// Google accounts use their own encrypted server credential and scoped catalog.
  private func respond(to text: String, history: [ChatMessage], excluded: Set<String>)
    async throws -> DJResponse
  {
    guard let connection = session.connection else {
      throw RecallError.message(
        "Connecte ton serveur dans Réglages pour retrouver ta bibliothèque.")
    }
    let request = DJRequest(message: text, history: history, queued: excluded)
    return try await ServerDJ(connection: connection).turn(request)
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
      "On continue avec \(track.title).", context: connection.token, using: synthesis(connection))
  }
  private var historyTracks: [Track] { playback.history.map(\.track) }

  func cancel() {
    requestID = UUID()
    work?.cancel()
    work = nil
    prefetchedPosition = position
    busy = false
    automaticRequest = false
    if waitingForNext { continuationNotice = "Recherche annulée. Réessaie quand tu veux." }
    waitingForNext = false
    voice.clearPreparation()
    microphone.stop()
    voice.stop()
  }
  func play(_ track: Track) {
    cancel()
    lastRequest = "Des morceaux dans l’esprit de \(track.title), \(track.channel ?? "")."
    playback.replace([track])
    unavailableCount = 0
    playCurrent()
  }
  private func playCurrent() {
    continuationNotice = ""
    waitingForNext = false
    prefetchedPosition = nil
    if let current {
      player.cue(current)
      player.prepareNext(upcoming.first?.track)
    }
  }
  func next(outcome: PlaybackOutcome = .skipped, userInitiated: Bool = true) {
    guard current != nil else { return }
    if userInitiated { unavailableCount = 0 }
    voice.stop()
    if playback.requestNext(outcome: outcome) {
      playCurrent()
      announceCurrent()
    } else {
      player.command("pause")
      waitingForNext = true
      if !busy { requestContinuation() }
    }
  }
  func retryContinuation() {
    guard !busy else { return }
    waitingForNext = playback.ended
    requestContinuation()
  }
  private func requestContinuation() {
    let context = lastRequest.isEmpty ? (current?.title ?? "la même ambiance") : lastRequest
    send(
      "Continue ma demande : \(context). Cherche de nouveaux vrais morceaux dans la bibliothèque, sans répétition. Si la recherche ne donne rien, essaie une formulation plus courte de la même ambiance ou du même artiste, sans inventer de titre ni remplacer un titre précis absent. Ajoute-les à la file. Exclue les type beats et hommages sauf demande explicite.",
      automatic: true)
  }
  private func prepareContinuation() {
    guard continuous, player.playing, !busy, current != nil, allUpcoming.isEmpty,
      player.duration > 0, player.duration - player.elapsed > 0,
      player.duration - player.elapsed <= 30, prefetchedPosition != position
    else { return }
    prefetchedPosition = position
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
    voice.stop()
    voice.clearPreparation()
    unavailableCount = 0
    playCurrent()
    announceCurrent()
  }
  private func announceCurrent() {
    guard spoken, let current else { return }
    let announcement = "On continue avec \(current.title)."
    messages.append(ChatMessage(role: "assistant", content: announcement))
    messages = Array(messages.suffix(24))
    speak(announcement)
  }
  func toggleMicrophone() {
    voice.stop()
    player.command("pause")
    Task { await microphone.toggle() }
  }
  func stopVoice() { voice.stop() }
}
