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
  @Published private(set) var currentPage = 1
  @Published private(set) var totalResults = 0
  @Published private(set) var searching = false
  @Published var pageSize = 50 { didSet { search() } }
  @Published var query = ""
  @Published var selectedPlaylist = "" { didSet { search() } }
  @Published var playlistLink = ""
  @Published private(set) var importing = false
  @Published private(set) var syncing = false
  @Published private(set) var importProgress = ""
  private let session: Session
  private var importTask: Task<Void, Never>?
  private var syncTask: Task<Void, Never>?
  private var searchTask: Task<Void, Never>?

  init(session: Session) { self.session = session }
  var pageCount: Int { max(1, (totalResults + pageSize - 1) / pageSize) }
  var visiblePages: [Int] {
    let anchor = min(currentPage, pageCount)
    return Array(Set([1, pageCount] + Array(max(1, anchor - 2)...min(pageCount, anchor + 2))))
      .sorted()
  }
  var resultRange: String {
    guard totalResults > 0 else { return "Aucun résultat" }
    let first = (currentPage - 1) * pageSize + 1
    return "\(first)–\(first + results.count - 1) sur \(totalResults)"
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
    playlists = []
    libraryCount = 0
    totalResults = 0
    currentPage = 1
    query = ""
    selectedPlaylist = ""
    playlistLink = ""
    session.notice = ""
    sync()
  }
  func goToPage(_ page: Int) {
    guard (1...pageCount).contains(page) else { return }
    search(page: page)
  }
  func search(page: Int = 1) {
    searchTask?.cancel()
    guard let connection = session.connection else {
      searching = false
      results = []
      totalResults = 0
      return
    }
    let value = query.trimmingCharacters(in: .whitespacesAndNewlines)
    let playlist = selectedPlaylist.isEmpty ? nil : selectedPlaylist
    let generation = session.generation
    let size = pageSize
    let requestedPage = max(1, page)
    let offset = (requestedPage - 1) * size
    searching = true
    searchTask = Task {
      defer { if !Task.isCancelled { searching = false } }
      do {
        try await Task.sleep(nanoseconds: 250_000_000)
        let found = try await HTTPClient().searchPage(
          connection, query: value, offset: offset, limit: size, playlist: playlist)
        try Task.checkCancellation()
        guard session.generation == generation else { return }
        totalResults = found.total
        let lastPage = max(1, (found.total + size - 1) / size)
        if requestedPage > lastPage {
          search(page: lastPage)
          return
        }
        currentPage = requestedPage
        results = found.tracks.enumerated().map {
          LibraryRow(id: offset + $0.offset, track: $0.element)
        }
      } catch {
        if !Task.isCancelled {
          results = []
          totalResults = 0
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
          for playlist in overview.playlists {
            _ = try await ServerPlaylistImporter(connection: connection).synchronize(
              link: "https://www.youtube.com/playlist?list=" + playlist.id)
          }
        }
        try await refreshOverview(connection, generation: generation)
        try Task.checkCancellation()
        guard session.generation == generation else { return }
        if refreshYouTube { session.notice = "Playlists YouTube actualisées sur le serveur." }
        if !searching { search(page: currentPage) }
      } catch {
        if !Task.isCancelled {
          session.error = "Connexion au serveur indisponible. " + error.localizedDescription
        }
      }
    }
  }
}
