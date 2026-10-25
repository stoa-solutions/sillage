import AppKit
import Combine
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
  @Published private(set) var currentPage = 1
  @Published private(set) var totalResults = 0
  @Published private(set) var searching = false
  @Published var pageSize = 50 { didSet { search() } }
  var pageCount: Int { max(1, (totalResults + pageSize - 1) / pageSize) }
  var visiblePages: [Int] {
    let anchor = min(currentPage, pageCount)
    return Array(Set([1, pageCount] + Array(max(1, anchor - 2)...min(pageCount, anchor + 2)))).sorted()
  }
  var resultRange: String {
    guard totalResults > 0 else { return "Aucun résultat" }
    let first = (currentPage - 1) * pageSize + 1
    return "\(first)–\(first + results.count - 1) sur \(totalResults)"
  }
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

  init(session: Session) {
    self.session = session
    do {
      try session.store.prepare()
      reload()
      search()
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
    query = ""
    selectedPlaylist = ""
    reload()
    search()
  }
  private func reload() {
    do {
      libraryCount = try store.count(session.source)
      playlists = try store.playlists(session.source)
      if !selectedPlaylist.isEmpty && !playlists.contains(where: { $0.id == selectedPlaylist }) {
        selectedPlaylist = ""
      }
    } catch { session.error = error.localizedDescription }
  }
  func goToPage(_ page: Int) {
    guard (1...pageCount).contains(page) else { return }
    search(page: page)
  }
  func search(page: Int = 1) {
    searchTask?.cancel()
    let value = query.trimmingCharacters(in: .whitespacesAndNewlines)
    let source = session.source
    let playlist = selectedPlaylist.isEmpty ? nil : selectedPlaylist
    let generation = session.generation
    let size = pageSize
    let requestedPage = max(1, page)
    let offset = (requestedPage - 1) * size
    let store = self.store
    let connection = session.connection
    searching = true
    searchTask = Task {
      defer { if !Task.isCancelled { searching = false } }
      do {
        try await Task.sleep(nanoseconds: 250_000_000)
        let found: LibrarySearchPage
        if source == .server, let connection, playlist == nil, !value.isEmpty {
          found = try await HTTPClient().searchPage(connection, query: value, offset: offset, limit: size)
        } else {
          found = try await Task.detached {
            try store.searchPage(value, source: source, playlist: playlist, offset: offset, limit: size)
          }.value
        }
        try Task.checkCancellation()
        guard session.generation == generation else { return }
        totalResults = found.total
        let lastPage = max(1, (found.total + size - 1) / size)
        if requestedPage > lastPage { search(page: lastPage); return }
        currentPage = requestedPage
        results = found.tracks.enumerated().map { LibraryRow(id: offset + $0.offset, track: $0.element) }
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
    Task {
      if session.connection == nil { await session.refreshCredentials() }
      startPlaylistImport()
    }
  }
  private func startPlaylistImport() {
    guard !importing else { return }
    let link = playlistLink
    do { _ = try YouTubePlaylistLink.id(from: link) } catch {
      session.error = error.localizedDescription
      return
    }
    guard let connection = session.connection else {
      session.error =
        "Connecte ton serveur dans Réglages ou importe ton fichier de connexion privé. Aucune clé YouTube n’est nécessaire sur le Mac."
      return
    }
    let importer = ServerPlaylistImporter(connection: connection)
    let destination = session.source
    session.error = ""
    runImport("Ajout de la playlist via YouTube…", destination: destination) { _ in
      let document = try await importer.load(link: link)
      return (
        document,
        "Playlist ajoutée \(destination == .server ? "au serveur" : "sur ce Mac") : \(document.tracks.count) vidéos."
      )
    } completed: { [weak self] in
      self?.playlistLink = ""
      self?.query = ""
      self?.selectedPlaylist = (try? YouTubePlaylistLink.id(from: link)) ?? ""
    }
  }
  /// The destination is captured before acquisition; imports merge without removing other playlists.
  private func runImport(
    _ progress: String,
    destination: LibraryStore.Source = .local,
    acquire: @escaping (UUID) async throws -> (LibraryDocument, String),
    completed: @escaping () -> Void = {}
  ) {
    guard !importing else { return }
    syncTask?.cancel()
    syncing = false
    session.useServer = destination == .server
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
        try await Task.detached { try store.commit(document, source: destination) }.value
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
    importProgress =
      "Attente interrompue sur ce Mac. Le serveur peut terminer la synchronisation ; réimporte le même lien pour récupérer la playlist."
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
  func sync(refreshYouTube: Bool = false) {
    guard !syncing, !importing, let connection = session.connection else { return }
    session.useServer = true
    syncing = true
    session.error = ""
    let generation = session.generation
    let store = self.store
    syncTask = Task {
      defer { if session.generation == generation { syncing = false } }
      do {
        if refreshYouTube {
          let overview = try await HTTPClient().server(connection, path: "playlists")
          for row in overview["playlists"] as? [[String: Any]] ?? [] {
            guard let id = row["id"] as? String else { continue }
            _ = try await ServerPlaylistImporter(connection: connection).load(
              link: "https://www.youtube.com/playlist?list=" + id)
          }
        }
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
        search(page: currentPage)
      } catch { if !Task.isCancelled { session.error = error.localizedDescription } }
    }
  }
}
