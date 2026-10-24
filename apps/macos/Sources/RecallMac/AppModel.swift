import AVFoundation
import AppKit
import Combine
import RecallKit
import UniformTypeIdentifiers

@MainActor
final class AppModel: NSObject, ObservableObject, AVAudioPlayerDelegate, AVSpeechSynthesizerDelegate
{
  @Published var tracks: [Track] = []
  @Published var results: [Track] = []
  @Published var query = ""
  @Published var messages: [ChatMessage] = []
  @Published var prompt = ""
  @Published var queue: [Track] = []
  @Published var position = 0
  @Published var busy = false
  @Published var syncing = false
  @Published var error = ""
  @Published var notice = ""
  @Published var spoken = true
  @Published var continuous = true
  @Published var model: String { didSet { UserDefaults.standard.set(model, forKey: "djModel") } }
  @Published var useServer: Bool {
    didSet {
      UserDefaults.standard.set(useServer, forKey: "useServer")
      if oldValue != useServer {
        cancel()
        searchTask?.cancel()
        queue = []
        position = 0
        player.command("pause")
        loadActiveLibrary()
      }
    }
  }
  @Published var loadingCredentials = true
  @Published var hasKey = false
  @Published var hasServer = false
  let player = Player()
  let microphone = Microphone()
  private var connection: Connection?
  private var geminiKey = ""
  private var work: Task<Void, Never>?
  private var voiceTask: Task<Void, Never>?
  private var searchTask: Task<Void, Never>?
  private var audio: AVAudioPlayer?
  private let synthesizer = AVSpeechSynthesizer()
  private let store: LibraryStore
  var current: Track? { queue.indices.contains(position) ? queue[position] : nil }
  override init() {
    let directory = FileManager.default.urls(
      for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent(
        "Playlist Recall", isDirectory: true)
    store = LibraryStore(directory: directory)
    model = UserDefaults.standard.string(forKey: "djModel") ?? "gemini-3.5-flash-lite"
    useServer = UserDefaults.standard.object(forKey: "useServer") as? Bool ?? false
    super.init()
    synthesizer.delegate = self
    do {
      try store.prepare()
      loadActiveLibrary()
    } catch { self.error = error.localizedDescription }
    microphone.onText = { [weak self] text in self?.send(text) }
    microphone.onError = { [weak self] text in self?.error = text }
    player.onEnded = { [weak self] in self?.next() }
    player.onUnavailable = { [weak self] in
      guard let self else { return }
      if self.position + 1 < self.queue.count {
        self.position += 1
        self.playCurrent()
      } else {
        self.error =
          "Ce titre est indisponible dans le lecteur. Ouvre-le sur YouTube ou choisis un autre morceau."
      }
    }
  }
  func refreshCredentials() async {
    loadingCredentials = true
    defer { loadingCredentials = false }
    do {
      let credentials = try await Task.detached { () -> (String, Connection?) in
        (try KeychainStore.string("gemini") ?? "", try KeychainStore.connection())
      }.value
      geminiKey = credentials.0
      connection = credentials.1
      hasKey = !geminiKey.isEmpty
      hasServer = connection != nil
    } catch { self.error = error.localizedDescription }
  }
  var connectedURL: String { connection?.url ?? "" }
  private func loadActiveLibrary() {
    do {
      tracks = try store.read(useServer ? .server : .local)
      results = tracks
    } catch { self.error = error.localizedDescription }
  }
  func persist() throws {
    try store.save(tracks, source: useServer ? .server : .local)
    results = tracks
  }
  func importLibrary() {
    let panel = NSOpenPanel()
    panel.allowedContentTypes = [.json]
    panel.allowsMultipleSelection = false
    guard panel.runModal() == .OK, let url = panel.url else { return }
    do {
      let imported = try Catalog.parse(Data(contentsOf: url))
      useServer = false
      var merged = Dictionary(uniqueKeysWithValues: tracks.map { ($0.id, $0) })
      imported.forEach { merged[$0.id] = $0 }
      tracks = merged.values.sorted { $0.id < $1.id }
      try persist()
      notice = "\(imported.count) vidéos importées dans ta bibliothèque locale."
    } catch { self.error = error.localizedDescription }
  }
  func exportLibrary() {
    let panel = NSSavePanel()
    panel.allowedContentTypes = [.json]
    panel.nameFieldStringValue = "Recall-bibliotheque.json"
    guard panel.runModal() == .OK, let url = panel.url else { return }
    do {
      let object: [String: Any] = [
        "videos": tracks.map { track -> [String: Any] in
          var row: [String: Any] = [
            "id": track.id, "title": track.title, "description": track.description ?? "",
          ]
          row["channel"] = track.channel
          row["durationSeconds"] = track.durationSeconds
          return row
        }
      ]
      try JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted]).write(
        to: url, options: .atomic)
    } catch { self.error = error.localizedDescription }
  }
  func sync() {
    guard !syncing else { return }
    useServer = true
    syncing = true
    error = ""
    Task {
      defer { syncing = false }
      do {
        guard let connection = self.connection else {
          throw RecallError.message("Configure ton serveur ou importe une bibliothèque JSON.")
        }
        let object = try await HTTPClient().server(connection, path: "export")
        tracks = try Catalog.parse(JSONSerialization.data(withJSONObject: object))
        try persist()
        notice = "\(tracks.count) vidéos synchronisées depuis ton serveur."
      } catch { self.error = error.localizedDescription }
    }
  }
  func search() {
    searchTask?.cancel()
    let value = query
    searchTask = Task {
      try? await Task.sleep(nanoseconds: 250_000_000)
      guard !Task.isCancelled else { return }
      do {
        let found: [Track]
        if useServer, let connection = self.connection {
          found = try await HTTPClient().search(connection, query: value)
        } else {
          found = value.isEmpty ? tracks : Catalog.search(value, tracks: tracks)
        }
        guard !Task.isCancelled else { return }
        results = found
      } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
    }
  }
  func send(_ text: String? = nil, automatic: Bool = false) {
    let text = (text ?? prompt).trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty, !busy else { return }
    microphone.stop()
    stopVoice()
    error = ""
    busy = true
    prompt = ""
    let history = messages
    if !automatic { messages.append(ChatMessage(role: "user", content: text)) }
    let excluded = Set(queue.suffix(100).map(\.id))
    work = Task {
      defer { busy = false }
      do {
        let key = geminiKey
        let connection = self.connection
        let response: DJResponse
        if !key.isEmpty {
          let localTracks = tracks
          let server = useServer ? connection : nil
          response = try await GeminiDJ(key: key, model: model).turn(
            message: text, history: history, excluded: excluded
          ) { query, includeQueued in
            if let server {
              return try await HTTPClient().mcpSearch(
                server, query: query, includeQueued: includeQueued)
            }
            return Catalog.search(
              query, tracks: localTracks, excluded: includeQueued ? [] : excluded)
          }
        } else if useServer, let connection {
          let object = try await HTTPClient().server(
            connection, path: "dj/chat",
            body: [
              "message": String(text.prefix(1500)),
              "history": history.suffix(12).map { ["role": $0.role, "content": $0.content] },
              "excludeIds": Array(excluded),
            ])
          response = try JSONDecoder().decode(
            DJResponse.self, from: JSONSerialization.data(withJSONObject: object))
        } else {
          throw RecallError.message("Ajoute ta clé Gemini dans Réglages pour activer ton DJ.")
        }
        try Task.checkCancellation()
        messages.append(ChatMessage(role: "assistant", content: response.reply))
        messages = Array(messages.suffix(24))
        if !response.tracks.isEmpty {
          if response.action == "append", position < queue.count {
            queue = Array(queue.dropFirst(position)) + response.tracks
          } else {
            queue = response.tracks
          }
          position = 0
          playCurrent()
        }
        if spoken { speak(response.reply) }
      } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
    }
  }
  func cancel() {
    work?.cancel()
    microphone.stop()
    stopVoice()
  }
  func play(_ track: Track) {
    queue = [track]
    position = 0
    playCurrent()
  }
  func playCurrent() { if let current { player.cue(current) } }
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
    stopVoice()
    player.command("pause")
    Task { await microphone.toggle() }
  }
  func stopVoice() {
    voiceTask?.cancel()
    audio?.stop()
    audio = nil
    synthesizer.stopSpeaking(at: .immediate)
    player.command("restore")
  }
  private func speak(_ text: String) {
    voiceTask?.cancel()
    voiceTask = Task {
      do {
        let data: Data
        if !geminiKey.isEmpty {
          data = try await GeminiDJ(key: geminiKey, model: model).speech(text)
        } else if let connection = self.connection {
          let object = try await HTTPClient().server(
            connection, path: "dj/speech", body: ["text": String(text.prefix(600))])
          guard let encoded = object["audio"] as? String, let bytes = Data(base64Encoded: encoded)
          else { throw RecallError.message("Voix indisponible.") }
          data = bytes
        } else {
          throw RecallError.message("Voix indisponible.")
        }
        try Task.checkCancellation()
        let sound = try AVAudioPlayer(data: data)
        sound.delegate = self
        audio = sound
        player.command("duck")
        if !sound.play() { throw RecallError.message("L’audio n’a pas démarré.") }
      } catch {
        guard !Task.isCancelled else { return }
        // Local macOS voice keeps the spoken response available during provider outages.
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = AVSpeechSynthesisVoice(language: "fr-FR")
        player.command("duck")
        synthesizer.speak(utterance)
        notice = "Voix locale macOS utilisée pour cette réponse."
      }
    }
  }
  nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
    Task { @MainActor in self.player.command("restore") }
  }
  nonisolated func speechSynthesizer(
    _ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance
  ) { Task { @MainActor in self.player.command("restore") } }
}
