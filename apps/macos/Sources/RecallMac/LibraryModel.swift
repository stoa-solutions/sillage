import Combine
import Foundation
import RecallKit

struct LibraryRow: Identifiable {
  let id: Int
  let track: Track
}

/// A bounded, in-memory view of the server. No library database or offline copy on the Mac.
@MainActor
final class LibraryModel: ObservableObject {
  @Published private(set) var results: [LibraryRow] = []
  @Published private(set) var playlists: [ServerPlaylistSummary] = []
  @Published private(set) var libraryCount = 0
  @Published private(set) var totalResults = 0
  @Published private(set) var searching = false
  @Published private(set) var loadingMore = false
  /// True once the server overview arrived; before that an empty count means unknown, not empty.
  @Published private(set) var overviewLoaded = false
  @Published var query = ""
  @Published var selectedPlaylist = "" { didSet { search() } }
  @Published var playlistLink = ""
  @Published private(set) var importing = false
  @Published private(set) var syncing = false
  @Published private(set) var importProgress = ""
  @Published private(set) var enrichment: EnrichmentProgress?
  @Published private(set) var enrichmentError = ""
  private let session: Session
  private var importTask: Task<Void, Never>?
  private var syncTask: Task<Void, Never>?
  private var searchTask: Task<Void, Never>?

  init(session: Session) { self.session = session }
  /// Rows load page by page as the list scrolls; nothing beyond the loaded rows lives on the Mac.
  static let pageSize = 50
  var hasMore: Bool { results.count < totalResults }
  var selectedPlaylistSummary: ServerPlaylistSummary? {
    playlists.first { $0.id == selectedPlaylist }
  }
  /// Called on disconnect or a different connection, so the next account never sees old data.
  func reset() {
    importTask?.cancel()
    syncTask?.cancel()
    searchTask?.cancel()
    importing = false
    syncing = false
    searching = false
    results = []
    enrichment = nil
    enrichmentError = ""
    playlists = []
    libraryCount = 0
    totalResults = 0
    loadingMore = false
    overviewLoaded = false
    query = ""
    selectedPlaylist = ""
    playlistLink = ""
    session.notice = ""
    sync()
  }
  /// View-scoped polling; cancellation and generation guard prevent cross-account results.
  func watchEnrichment() async {
    enrichment = nil
    enrichmentError = ""
    guard let connection = session.connection else { return }
    let generation = session.generation
    while !Task.isCancelled && session.generation == generation {
      do {
        let object = try await HTTPClient().server(connection, path: "library/enrichment")
        let progress = try EnrichmentProgress.decode(object)
        try Task.checkCancellation()
        guard session.generation == generation else { return }
        enrichment = progress
        enrichmentError = ""
      } catch {
        guard !Task.isCancelled && session.generation == generation else { return }
        enrichmentError =
          "Suivi momentanément indisponible. Les derniers compteurs peuvent être anciens."
      }
      do { try await Task.sleep(for: .seconds(10)) } catch { return }
    }
  }
  /// A new query or playlist starts from the top; `more` appends the next page.
  func search(more: Bool = false) {
    if more && (searching || loadingMore || !hasMore) { return }
    searchTask?.cancel()
    guard let connection = session.connection else {
      searching = false
      loadingMore = false
      results = []
      totalResults = 0
      return
    }
    let value = query.trimmingCharacters(in: .whitespacesAndNewlines)
    let playlist = selectedPlaylist.isEmpty ? nil : selectedPlaylist
    let generation = session.generation
    let offset = more ? results.count : 0
    if more { loadingMore = true } else { searching = true }
    searchTask = Task {
      defer {
        if !Task.isCancelled {
          searching = false
          loadingMore = false
        }
      }
      do {
        if !more { try await Task.sleep(nanoseconds: 250_000_000) }
        let found = try await HTTPClient().searchPage(
          connection, query: value, offset: offset, limit: Self.pageSize, playlist: playlist)
        try Task.checkCancellation()
        guard session.generation == generation else { return }
        totalResults = found.total
        let rows = found.tracks.enumerated().map {
          LibraryRow(id: offset + $0.offset, track: $0.element)
        }
        results = more ? results + rows : rows
      } catch {
        if !Task.isCancelled {
          if !more {
            results = []
            totalResults = 0
          }
          session.error = "Recherche serveur indisponible. " + error.localizedDescription
        }
      }
    }
  }
  private func refreshOverview(_ connection: Connection, generation: UUID) async throws {
    let overview = try await HTTPClient().libraryOverview(connection)
    try Task.checkCancellation()
    guard session.generation == generation else { return }
    libraryCount = overview.videoCount
    playlists = overview.playlists
    overviewLoaded = true
    if !selectedPlaylist.isEmpty && !playlists.contains(where: { $0.id == selectedPlaylist }) {
      selectedPlaylist = ""
    }
  }
  func importPlaylist() {
    guard !importing else { return }
    guard let connection = session.connection else {
      session.showOnboarding = true
      return
    }
    let link = playlistLink.trimmingCharacters(in: .whitespacesAndNewlines)
    do { _ = try YouTubePlaylistLink.id(from: link) } catch {
      session.error = error.localizedDescription
      return
    }
    syncTask?.cancel()
    syncing = false
    session.error = ""
    importing = true
    importProgress = "Ajout de la playlist sur ton serveur…"
    let generation = session.generation
    importTask = Task {
      defer { if session.generation == generation && !Task.isCancelled { importing = false } }
      do {
        let id = try await ServerPlaylistImporter(connection: connection).synchronize(link: link)
        try await refreshOverview(connection, generation: generation)
        try Task.checkCancellation()
        guard session.generation == generation else { return }
        playlistLink = ""
        query = ""
        selectedPlaylist = id
        let added = playlists.first { $0.id == id }
        session.notice =
          "Playlist ajoutée au serveur : \(added?.title ?? "YouTube") · \(added?.entries ?? 0) entrées."
      } catch {
        if !Task.isCancelled { session.error = error.localizedDescription }
      }
    }
  }
  func cancelImport() {
    importTask?.cancel()
    importing = false
    session.notice =
      "Attente interrompue. Le serveur peut terminer l’import ; actualise la bibliothèque pour le retrouver."
    sync()
  }
  func sync(refreshYouTube: Bool = false) {
    guard !syncing, !importing, let connection = session.connection else { return }
    syncing = true
    let generation = session.generation
    syncTask = Task {
      defer { if session.generation == generation && !Task.isCancelled { syncing = false } }
      do {
        if refreshYouTube {
          let overview = try await HTTPClient().libraryOverview(connection)
          for playlist in overview.playlists where playlist.syncEnabled {
            _ = try await ServerPlaylistImporter(connection: connection).synchronize(
              link: "https://www.youtube.com/playlist?list=" + playlist.id)
          }
        }
        try await refreshOverview(connection, generation: generation)
        try Task.checkCancellation()
        guard session.generation == generation else { return }
        if refreshYouTube { session.notice = "Playlists YouTube actualisées sur le serveur." }
        // Rows already loaded by scrolling stay; only a short list is refreshed from the top.
        if !searching && results.count <= Self.pageSize { search() }
      } catch {
        if !Task.isCancelled {
          session.error = "Connexion au serveur indisponible. " + error.localizedDescription
        }
      }
    }
  }
}
