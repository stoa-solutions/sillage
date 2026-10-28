import Combine
import Foundation
import SillageKit

/// Shared by Discover and DJ result cards; only small request results live on the Mac.
@MainActor final class DiscoveryModel: ObservableObject {
  @Published var query = ""
  @Published var scope: DiscoveryScope = .all
  @Published var playlistID = ""
  @Published private(set) var libraryTracks: [Track] = []
  @Published private(set) var youtube: [DiscoveryItem] = []
  @Published private(set) var savedIDs: Set<String> = []
  @Published private(set) var addingIDs: Set<String> = []
  @Published private(set) var searching = false
  @Published private(set) var searched = false
  @Published private(set) var libraryError = ""
  @Published private(set) var youtubeError = ""
  @Published private(set) var nextPage: String?
  @Published private(set) var submittedQuery = ""
  @Published private(set) var libraryTotal = 0
  @Published private(set) var home: DiscoveryHome?
  @Published private(set) var homeLoading = false
  @Published private(set) var homeError = ""
  private var homeTask: Task<Void, Never>?
  private var homeLoadedAt: Date?
  private let session: Session
  private let library: LibraryModel
  private var task: Task<Void, Never>?
  private var additions: [String: Task<Void, Never>] = [:]
  private var requestID = UUID()
  init(session: Session, library: LibraryModel) {
    self.session = session
    self.library = library
  }
  func reset() {
    homeTask?.cancel()
    homeTask = nil
    home = nil
    homeLoading = false
    homeLoadedAt = nil
    homeError = ""
    task?.cancel()
    additions.values.forEach { $0.cancel() }
    additions = [:]
    requestID = UUID()
    query = ""
    submittedQuery = ""
    playlistID = ""
    libraryTracks = []
    youtube = []
    savedIDs = []
    addingIDs = []
    searching = false
    searched = false
    nextPage = nil
    libraryTotal = 0
    libraryError = ""
    youtubeError = ""
  }
  /// Back to the screen before searching; scope and playlist stay as chosen.
  func clearResults() {
    task?.cancel()
    requestID = UUID()
    submittedQuery = ""
    libraryTracks = []
    youtube = []
    searching = false
    searched = false
    nextPage = nil
    libraryTotal = 0
    libraryError = ""
    youtubeError = ""
  }
  func search(more: Bool = false) {
    let text = query.trimmingCharacters(in: .whitespacesAndNewlines)
    guard text.count >= 2, let connection = session.connection else {
      if !session.hasServer { session.showOnboarding = true }
      return
    }
    guard !more || (nextPage != nil && text == submittedQuery && !searching) else { return }
    task?.cancel()
    let ticket = UUID()
    requestID = ticket
    let generation = session.generation
    let source = scope
    let playlist = playlistID
    let page = more ? (nextPage ?? "") : ""
    searching = true
    searched = true
    submittedQuery = text
    libraryError = ""
    youtubeError = ""
    if !more {
      libraryTracks = []
      youtube = []
      nextPage = nil
      libraryTotal = 0
    }
    task = Task {
      defer { if requestID == ticket { searching = false } }
      if !more && source != .youtube {
        do {
          let result = try await HTTPClient().searchPage(
            connection, query: text, limit: 25, playlist: playlist.isEmpty ? nil : playlist)
          try Task.checkCancellation()
          guard session.generation == generation, requestID == ticket else { return }
          libraryTracks = result.tracks
          libraryTotal = result.total
        } catch {
          guard !Task.isCancelled, session.generation == generation, requestID == ticket else {
            return
          }
          libraryError = error.localizedDescription
        }
      }
      if source != .library {
        do {
          let result = try await HTTPClient().discover(connection, query: text, pageToken: page)
          try Task.checkCancellation()
          guard session.generation == generation, requestID == ticket else { return }
          let known = Set(youtube.map(\.id))
          youtube += result.results.filter { !known.contains($0.id) }
          nextPage = result.nextPageToken
          savedIDs.formUnion(result.results.filter(\.inLibrary).map(\.id))
        } catch {
          guard !Task.isCancelled, session.generation == generation, requestID == ticket else {
            return
          }
          youtubeError = error.localizedDescription
        }
      }
    }
  }
  /// Short-lived view state; account switches cancel the request and discard its results.
  func loadHome(force: Bool = false) {
    guard let connection = session.connection, !homeLoading else { return }
    guard force || homeLoadedAt.map({ Date().timeIntervalSince($0) > 300 }) ?? true else { return }
    let generation = session.generation
    homeLoading = true
    homeError = ""
    homeTask = Task {
      defer { if session.generation == generation { homeLoading = false } }
      do {
        let result = try await HTTPClient().discoveryHome(connection)
        try Task.checkCancellation()
        guard session.generation == generation else { return }
        home = result
        homeLoadedAt = Date()
      } catch {
        guard !Task.isCancelled, session.generation == generation else { return }
        homeError = error.localizedDescription
      }
    }
  }
  func add(_ item: DiscoveryItem) {
    guard !item.inLibrary, !savedIDs.contains(item.id), !addingIDs.contains(item.id),
      let connection = session.connection
    else { return }
    let generation = session.generation
    addingIDs.insert(item.id)
    additions[item.id] = Task {
      defer {
        if session.generation == generation {
          addingIDs.remove(item.id)
          additions[item.id] = nil
        }
      }
      do {
        try await HTTPClient().addDiscovery(connection, id: item.id)
        try Task.checkCancellation()
        guard session.generation == generation else { return }
        savedIDs.insert(item.id)
        session.notice = "Ajouté à Mes découvertes : " + TrackTitle(item.video).spoken
        library.sync()
      } catch {
        if !Task.isCancelled && session.generation == generation {
          session.error = error.localizedDescription
        }
      }
    }
  }
}
