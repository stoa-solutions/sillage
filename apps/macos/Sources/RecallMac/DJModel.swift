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
  @Published private(set) var queue: [Track] = []
  @Published private(set) var position = 0
  @Published private(set) var busy = false
  @Published var spoken = true
  @Published var continuous = true
  let player = Player()
  let microphone = Microphone()
  private let session: Session
  private lazy var voice = VoiceOutput(player: player)
  private var work: Task<Void, Never>?
  var current: Track? { queue.indices.contains(position) ? queue[position] : nil }
  var upcoming: [QueueEntry] {
    queue.indices.dropFirst(position + 1).prefix(3).map { QueueEntry(id: $0, track: queue[$0]) }
  }

  init(session: Session) {
    self.session = session
    microphone.onText = { [weak self] text in self?.send(text) }
    microphone.onError = { [weak self] text in self?.session.error = text }
    player.onEnded = { [weak self] in self?.next() }
    player.onUnavailable = { [weak self] in
      guard let self else { return }
      if position + 1 < queue.count {
        position += 1
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
    queue = []
    position = 0
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
    if !automatic { messages.append(ChatMessage(role: "user", content: text)) }
    let excluded = Set(queue.suffix(100).map(\.id))
    work = Task {
      defer { busy = false }
      do {
        let response = try await respond(to: text, history: history, excluded: excluded)
        try Task.checkCancellation()
        messages.append(ChatMessage(role: "assistant", content: response.reply))
        messages = Array(messages.suffix(24))
        if !response.tracks.isEmpty {
          if response.action == "append", position < queue.count {
            queue.append(contentsOf: response.tracks)
          } else {
            queue = response.tracks
            position = 0
            playCurrent()
          }
        }
        if spoken { speak(response.reply) }
      } catch { if !Task.isCancelled { session.error = error.localizedDescription } }
    }
  }
  /// With a personal Gemini key the Mac runs the DJ itself and searches the active source;
  /// otherwise the connected server runs it with its own key.
  private func respond(to text: String, history: [ChatMessage], excluded: Set<String>)
    async throws -> DJResponse
  {
    let connection = session.connection
    if session.useServer && connection == nil {
      throw RecallError.message("Connecte ton serveur dans Réglages ou repasse sur ce Mac.")
    }
    if !session.geminiKey.isEmpty {
      let store = session.store
      let server = session.useServer ? connection : nil
      return try await GeminiDJ(key: session.geminiKey, model: session.model).turn(
        message: text, history: history, excluded: excluded
      ) { query, includeQueued in
        if let server {
          return try await HTTPClient().mcpSearch(
            server, query: query, includeQueued: includeQueued)
        }
        return try await Task.detached {
          try store.search(
            query, source: .local, limit: 30, excluded: includeQueued ? [] : excluded)
        }.value
      }
    }
    if session.useServer, let connection {
      let object = try await HTTPClient().server(
        connection, path: "dj/chat",
        body: [
          "message": String(text.prefix(1500)),
          "history": history.suffix(12).map { ["role": $0.role, "content": $0.content] },
          "excludeIds": Array(excluded),
        ])
      return try JSONDecoder().decode(
        DJResponse.self, from: JSONSerialization.data(withJSONObject: object))
    }
    throw RecallError.message("Ajoute ta clé Gemini dans Réglages pour activer ton DJ.")
  }
  private func speak(_ text: String) {
    let key = session.geminiKey
    let model = session.model
    let connection = session.useServer ? session.connection : nil
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
    queue = [track]
    position = 0
    playCurrent()
  }
  private func playCurrent() { if let current { player.cue(current) } }
  func next() {
    if position + 1 < queue.count {
      position += 1
      playCurrent()
    } else if continuous, !queue.isEmpty {
      send(
        "Continue avec d’autres titres de ma bibliothèque dans le même esprit, sans répétition.",
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
