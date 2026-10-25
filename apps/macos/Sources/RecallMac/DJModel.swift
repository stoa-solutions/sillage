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
  let player = Player()
  let microphone = Microphone()
  private let session: Session
  private lazy var voice = VoiceOutput(player: player)
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
    player.onEnded = { [weak self] in
      self?.playback.markEnded()
      self?.next()
    }
    player.onUnavailable = { [weak self] in
      guard let self else { return }
      if position + 1 < queue.count {
        playback.advance()
        playCurrent()
      } else {
        session.error =
          "Ce titre est indisponible dans le lecteur. Ouvre-le sur YouTube ou choisis un autre morceau."
      }
    }
    voice.onFallback = { [weak self] in
      self?.session.notice = "Voix locale macOS utilisée pour cette réponse."
    }
  }
  /// Called when the source changes: the queue came from the previous library.
  func reset() {
    cancel()
    playback.reset()
    messages = []
    prompt = ""
    lastRequest = ""
    player.command("pause")
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
    voice.stop()
    session.error = ""
    busy = true
    prompt = ""
    let history = messages
    if !automatic {
      lastRequest = text
      messages.append(ChatMessage(role: "user", content: text))
    }
    let excluded = Set(queue.suffix(100).map(\.id))
    work = Task {
      defer { busy = false }
      do {
        let response = try await respond(to: text, history: history, excluded: excluded)
        try Task.checkCancellation()
        messages.append(ChatMessage(role: "assistant", content: response.reply))
        messages = Array(messages.suffix(24))
        if playback.apply(response, automatic: automatic) { playCurrent() }
        if spoken { speak(response.reply) }
      } catch { if !Task.isCancelled { session.error = error.localizedDescription } }
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
    if !session.googleAccount, !session.geminiKey.isEmpty {
      return try await LocalDJ(
        model: GeminiDJ(key: session.geminiKey, model: session.model),
        library: ServerLibrarySearch(connection: connection)
      ).turn(request)
    }
    return try await ServerDJ(connection: connection).turn(request)
  }
  private func speak(_ text: String) {
    if !session.cloudVoice {
      voice.speakLocally(text)
      return
    }
    let key = session.geminiKey
    let model = session.model
    let connection = session.connection
    voice.speak(text) { text in
      if !key.isEmpty { return try await GeminiDJ(key: key, model: model).speech(text) }
      guard let connection else { throw RecallError.message("Voix indisponible.") }
      let object = try await HTTPClient().server(
        connection, path: "dj/speech", body: ["text": String(text.prefix(600))])
      guard let encoded = object["audio"] as? String, let bytes = Data(base64Encoded: encoded)
      else { throw RecallError.message("Voix indisponible.") }
      return bytes
    }
  }
  func cancel() {
    work?.cancel()
    microphone.stop()
    voice.stop()
  }
  func play(_ track: Track) {
    playback.replace([track])
    playCurrent()
  }
  private func playCurrent() {
    if let current { player.cue(current) }
  }
  func next() {
    if playback.advance() {
      playCurrent()
    } else if continuous, !queue.isEmpty {
      playback.markEnded()
      send(
        "Continue ma demande : \(lastRequest). Cherche de nouveaux vrais morceaux dans la bibliothèque, sans répétition. Ajoute-les à la file. Exclue les type beats et hommages sauf si je les ai demandés.",
        automatic: true)
    }
  }
  func toggleMicrophone() {
    voice.stop()
    player.command("pause")
    Task { await microphone.toggle() }
  }
  func stopVoice() { voice.stop() }
}
