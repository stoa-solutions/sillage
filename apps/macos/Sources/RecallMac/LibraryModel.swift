import Combine
import AppKit
import RecallKit
import UniformTypeIdentifiers

/// A result row. Playlists may repeat a video, so rows are identified by position, not video.
struct LibraryRow: Identifiable {
  let id: Int
  let track: Track
}

// Browsing, imports, server sync and export of the active source.
@MainActor
final class LibraryModel: ObservableObject {
  @Published private(set) var results: [LibraryRow] = []
  @Published private(set) var playlists: [LibraryPlaylist] = []
  @Published private(set) var libraryCount = 0
  @Published private(set) var hasMore = false
  @Published var query = ""
  @Published var selectedPlaylist = "" { didSet { search() } }
  @Published var playlistLink = ""
  @Published private(set) var importing = false
  @Published private(set) var importProgress = ""
  @Published private(set) var syncing = false
  private let session: Session
  private var store: LibraryStore { session.store }
  private var importTask: Task<Void, Never>?
  private var syncTask: Task<Void, Never>?
  private var searchTask: Task<Void, Never>?
  private nonisolated static let pageSize = 100

  init(session: Session) {
    self.session = session
    do {
      try session.store.prepare()
      reload()
    } catch { session.error = error.localizedDescription }
  }
  /// Called when the source changes: running work belongs to the previous source.
  func reset() {
    syncTask?.cancel()
    syncTask = nil
    syncing = false
    importTask?.cancel()
    importing = false
    searchTask?.cancel()
    selectedPlaylist = ""
    reload()
  }
  private func reload() {
    do {
      libraryCount = try store.count(session.source)
      playlists = try store.playlists(session.source)
      show(try store.search("", source: session.source, limit: Self.pageSize), appending: false)
    } catch { session.error = error.localizedDescription }
  }
  private func show(_ tracks: [Track], appending: Bool) {
    let start = appending ? results.count : 0
    let rows = tracks.enumerated().map { LibraryRow(id: start + $0.offset, track: $0.element) }
    results = appending ? results + rows : rows
    hasMore = tracks.count == Self.pageSize
  }
  func search(more: Bool = false) {
    searchTask?.cancel()
    let value = query
    let source = session.source
    let playlist = selectedPlaylist.isEmpty ? nil : selectedPlaylist
    let generation = session.generation
    let offset = more ? results.count : 0
    let store = self.store
    let connection = session.connection
    searchTask = Task {
      do {
        try await Task.sleep(nanoseconds: 250_000_000)
        let found: [Track]
        if source == .server, let connection, playlist == nil, !value.isEmpty {
          // Server text search is hybrid and returns one page; cached browsing is paginated.
          found = more ? [] : try await HTTPClient().search(connection, query: value)
        } else {
          found = try await Task.detached {
            try store.search(
              value, source: source, playlist: playlist, offset: offset, limit: Self.pageSize)
          }.value
        }
        try Task.checkCancellation()
        guard session.generation == generation else { return }
        show(found, appending: more)
      } catch { if !Task.isCancelled { session.error = error.localizedDescription } }
    }
  }
  func importFile() {
    guard !importing else { return }
    let panel = NSOpenPanel()
    panel.allowedContentTypes = [.json]
    panel.allowsMultipleSelection = false
    guard panel.runModal() == .OK, let url = panel.url else { return }
    runImport("Lecture de la bibliothèque…") { _ in
      let document = try await Task.detached {
        try LibraryDocument.parse(
          Data(contentsOf: url), fallbackTitle: url.deletingPathExtension().lastPathComponent)
      }.value
      return (document, "\(document.playlists.count) playlists importées sur ce Mac.")
    }
  }
  func copyServerLocally() {
    let store = self.store
    runImport("Copie de la bibliothèque…") { _ in
      let document = try await Task.detached { try LibraryDocument.parse(store.export(.server)) }
        .value
      return (document, "Ta bibliothèque est copiée sur ce Mac. Le serveur reste disponible.")
    }
  }
  func importPlaylist() {
    guard !importing else { return }
    guard session.hasYouTubeKey else {
      session.error = "Ajoute ta clé YouTube dans Réglages pour importer une playlist par lien."
      return
    }
    let link = playlistLink
    do { _ = try YouTubePlaylistLink.id(from: link) } catch {
      session.error = error.localizedDescription
      return
    }
    session.error = ""
    let key = session.youtubeKey
    let importer = YouTubePlaylistImporter(
      directory: store.directory.appendingPathComponent("imports"))
    runImport("Connexion à YouTube…") { [weak self] generation in
      let result = try await importer.load(link: link, key: key) { count in
        if self?.session.generation == generation {
          self?.importProgress = "\(count) entrées récupérées…"
        }
      }
      return (
        result.document,
        "Playlist importée sur ce Mac : \(result.document.tracks.count) vidéos. \(result.skipped) indisponibles ignorées."
      )
    } completed: { [weak self] in
      try? importer.finish(link: link)
      self?.playlistLink = ""
    }
  }
  /// Every import writes to the local source only, after the whole document is acquired.
  private func runImport(
    _ progress: String,
    acquire: @escaping (UUID) async throws -> (LibraryDocument, String),
    completed: @escaping () -> Void = {}
  ) {
    guard !importing else { return }
    session.useServer = false
    importing = true
    importProgress = progress
    let generation = session.generation
    let store = self.store
    importTask = Task {
      defer { if session.generation == generation { importing = false } }
      do {
        let (document, notice) = try await acquire(generation)
        try Task.checkCancellation()
        guard session.generation == generation else { return }
        try await Task.detached { try store.commit(document, source: .local) }.value
        completed()
        guard session.generation == generation else { return }
        reload()
        session.notice = notice
        search()
      } catch { if !Task.isCancelled { session.error = error.localizedDescription } }
    }
  }
  func cancelImport() {
    importTask?.cancel()
    importProgress = "Import interrompu. Recolle le même lien dans les 24 h pour reprendre."
  }
  func export() {
    let panel = NSSavePanel()
    panel.allowedContentTypes = [.json]
    panel.nameFieldStringValue = "Recall-bibliotheque.json"
    guard panel.runModal() == .OK, let url = panel.url else { return }
    let source = session.source
    let store = self.store
    Task {
      do {
        try await Task.detached { try store.export(source).write(to: url, options: .atomic) }.value
      } catch { session.error = error.localizedDescription }
    }
  }
  func sync() {
    guard !syncing, let connection = session.connection else { return }
    session.useServer = true
    syncing = true
    session.error = ""
    let generation = session.generation
    let store = self.store
    syncTask = Task {
      defer { if session.generation == generation { syncing = false } }
      do {
        let object = try await HTTPClient().server(connection, path: "export")
        let data = try JSONSerialization.data(withJSONObject: object)
        let document = try await Task.detached { try LibraryDocument.parse(data) }.value
        try Task.checkCancellation()
        guard session.generation == generation else { return }
        // Destination is explicit: a later source change cannot redirect this write.
        try await Task.detached { try store.commit(document, source: .server, replace: true) }.value
        guard session.generation == generation else { return }
        reload()
        session.notice = "\(libraryCount) vidéos synchronisées depuis ton serveur."
        search()
      } catch { if !Task.isCancelled { session.error = error.localizedDescription } }
    }
  }
}
