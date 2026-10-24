import AVFoundation
import AppKit
import Combine
import RecallAudio
import RecallKit
import UniformTypeIdentifiers

@MainActor
final class AppModel: NSObject, ObservableObject, AVAudioPlayerDelegate, AVSpeechSynthesizerDelegate
{
  @Published var tracks: [Track] = []
  @Published var results: [Track] = []
  @Published var query = ""
  @Published var libraryCount = 0
  @Published var playlists: [LibraryPlaylist] = []
  @Published var selectedPlaylist = "" { didSet { search() } }
  @Published var playlistLink = ""
  @Published var importing = false
  @Published var importProgress = ""
  @Published var hasYouTubeKey = false
  @Published var hasMore = false
  private var youtubeKey = ""
  private var syncTask: Task<Void, Never>?
  private var importTask: Task<Void, Never>?
  private var sourceGeneration = UUID()
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
        sourceGeneration = UUID()
        syncTask?.cancel()
        syncTask = nil
        syncing = false
        importTask?.cancel()
        importing = false
        selectedPlaylist = ""
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
      let credentials = try await Task.detached { () -> (String, Connection?, String) in
        (
          try KeychainStore.string("gemini") ?? "", try KeychainStore.connection(),
          try KeychainStore.string("youtube") ?? ""
        )
      }.value
      geminiKey = credentials.0
      connection = credentials.1
      hasKey = !geminiKey.isEmpty
      hasServer = connection != nil
      youtubeKey = credentials.2
      hasYouTubeKey = !youtubeKey.isEmpty
    } catch { self.error = error.localizedDescription }
  }
  var connectedURL: String { connection?.url ?? "" }
  private var source: LibraryStore.Source { useServer ? .server : .local }
  private func loadActiveLibrary() {
    do {
      libraryCount = try store.count(source)
      playlists = try store.playlists(source)
      tracks = try store.search("", source: source)
      results = tracks
      hasMore = tracks.count == 100
    } catch { self.error = error.localizedDescription }
  }
  func importLibrary() {
    guard !importing else { return }
    let panel = NSOpenPanel()
    panel.allowedContentTypes = [.json]
    panel.allowsMultipleSelection = false
    guard panel.runModal() == .OK, let url = panel.url else { return }
    useServer = false
    importing = true
    importProgress = "Lecture de la bibliothèque…"
    let generation = sourceGeneration
    let store = self.store
    importTask = Task {
      defer { if sourceGeneration == generation { importing = false } }
      do {
        let document = try await Task.detached {
          try LibraryDocument.parse(
            Data(contentsOf: url), fallbackTitle: url.deletingPathExtension().lastPathComponent)
        }.value
        try Task.checkCancellation()
        guard sourceGeneration == generation, !useServer else { return }
        try await Task.detached { try store.commit(document, source: .local) }.value
        guard sourceGeneration == generation else { return }
        loadActiveLibrary()
        notice = "\(document.playlists.count) playlists importées sur ce Mac."
        search()
      } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
    }
  }
  func copyServerLocally() {
    guard !importing else { return }
    useServer = false
    importing = true
    importProgress = "Copie de la bibliothèque…"
    let generation = sourceGeneration
    let store = self.store
    importTask = Task {
      defer { if sourceGeneration == generation { importing = false } }
      do {
        let document = try await Task.detached { try LibraryDocument.parse(store.export(.server)) }
          .value
        try Task.checkCancellation()
        guard sourceGeneration == generation else { return }
        try await Task.detached { try store.commit(document, source: .local) }.value
        guard sourceGeneration == generation else { return }
        loadActiveLibrary()
        notice = "Ta bibliothèque est copiée sur ce Mac. Le serveur reste disponible."
        search()
      } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
    }
  }
  func importPlaylist() {
    guard !importing else { return }
    guard hasYouTubeKey else {
      error = "Ajoute ta clé YouTube dans Réglages pour importer une playlist par lien."
      return
    }
    let link = playlistLink
    do { _ = try YouTubePlaylistLink.id(from: link) } catch {
      self.error = error.localizedDescription
      return
    }
    useServer = false
    importing = true
    error = ""
    importProgress = "Connexion à YouTube…"
    let generation = sourceGeneration
    let key = youtubeKey
    let store = self.store
    let importer = YouTubePlaylistImporter(
      directory: store.directory.appendingPathComponent("imports"))
    importTask = Task {
      defer { if sourceGeneration == generation { importing = false } }
      do {
        let result = try await importer.load(link: link, key: key) { [weak self] count in
          if self?.sourceGeneration == generation {
            self?.importProgress = "\(count) entrées récupérées…"
          }
        }
        try Task.checkCancellation()
        guard sourceGeneration == generation, !useServer else { return }
        try await Task.detached { try store.commit(result.document, source: .local) }.value
        try? importer.finish(link: link)
        guard sourceGeneration == generation else { return }
        loadActiveLibrary()
        notice =
          "Playlist importée sur ce Mac : \(result.document.tracks.count) vidéos. \(result.skipped) indisponibles ignorées."
        playlistLink = ""
        search()
      } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
    }
  }
  func cancelImport() {
    importTask?.cancel()
    importProgress = "Import interrompu. Recolle le même lien pour reprendre."
  }
  func exportLibrary() {
    let panel = NSSavePanel()
    panel.allowedContentTypes = [.json]
    panel.nameFieldStringValue = "Recall-bibliotheque.json"
    guard panel.runModal() == .OK, let url = panel.url else { return }
    let source = self.source
    let store = self.store
    Task {
      do {
        try await Task.detached { try store.export(source).write(to: url, options: .atomic) }.value
      } catch { self.error = error.localizedDescription }
    }
  }
  func sync() {
    guard !syncing, let connection else { return }
    useServer = true
    syncing = true
    error = ""
    let generation = sourceGeneration
    let store = self.store
    syncTask = Task {
      defer { if sourceGeneration == generation { syncing = false } }
      do {
        let object = try await HTTPClient().server(connection, path: "export")
        let data = try JSONSerialization.data(withJSONObject: object)
        let document = try await Task.detached { try LibraryDocument.parse(data) }.value
        try Task.checkCancellation()
        guard sourceGeneration == generation, useServer else { return }
        // Destination is captured and explicit. A later mode change cannot write local data.
        try await Task.detached { try store.commit(document, source: .server, replace: true) }.value
        guard sourceGeneration == generation, useServer else { return }
        loadActiveLibrary()
        notice = "\(libraryCount) vidéos synchronisées depuis ton serveur."
        search()
      } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
    }
  }
  func search(more: Bool = false) {
    searchTask?.cancel()
    let value = query
    let source = self.source
    let playlist = selectedPlaylist.isEmpty ? nil : selectedPlaylist
    let generation = sourceGeneration
    let offset = more ? results.count : 0
    let store = self.store
    let connection = self.connection
    searchTask = Task {
      do {
        try await Task.sleep(nanoseconds: 250_000_000)
        let found: [Track]
        if source == .server, let connection, playlist == nil, !value.isEmpty {
          // Existing server search remains available; local cached browsing is paginated.
          found = more ? [] : try await HTTPClient().search(connection, query: value)
        } else {
          found = try await Task.detached {
            try store.search(value, source: source, playlist: playlist, offset: offset)
          }.value
        }
        try Task.checkCancellation()
        guard sourceGeneration == generation else { return }
        results = more ? results + found : found
        hasMore = found.count == 100
      } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
    }
  }
  func send(_ text: String? = nil, automatic: Bool = false) {
    let text = (text ?? prompt).trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty, !busy else { return }
    guard !loadingCredentials else {
      prompt = text
      notice = "Connexion en cours. Ta demande reste prête à envoyer."
      return
    }
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
          let store = self.store
          let server = useServer ? connection : nil
          response = try await GeminiDJ(key: key, model: model).turn(
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
            queue.append(contentsOf: response.tracks)
          } else {
            queue = response.tracks
            position = 0
            playCurrent()
          }
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
        } else if useServer, let connection = self.connection {
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
