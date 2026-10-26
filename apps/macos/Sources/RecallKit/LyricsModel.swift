import Combine
import Foundation

/// Account-scoped state. Fetching, caching and correction persistence do not depend on the panel.
@MainActor
public final class LyricsModel: ObservableObject {
  public enum CorrectionState: Equatable { case idle, saving, failed }
  @Published public private(set) var lyrics: Lyrics?
  @Published public private(set) var loading = false
  @Published public private(set) var correctionState = CorrectionState.idle
  public private(set) var videoId: String?
  private struct Cached {
    var lyrics: Lyrics
    var expires: Date
    var access: Date
  }
  private var cache: [String: Cached] = [:]
  private var offsets: [String: Int] = [:]
  private var requests: [String: (id: UUID, task: Task<Lyrics, Error>)] = [:]
  private var generation = UUID()
  private var requestID = UUID()
  private var corrections: [String: CorrectionState] = [:]
  private var account: Connection?
  private var loadingTask: Task<Void, Never>?
  private var prefetch: Task<Void, Never>?
  private var prefetchId: String?
  private var saving: [String: (id: UUID, task: Task<Void, Never>)] = [:]
  private let cacheLimit: Int
  private let now: () -> Date
  private let fetch: (Connection, String) async throws -> Lyrics
  private let save: (Connection, String, Int) async throws -> Void

  public init(
    fetch: @escaping (Connection, String) async throws -> Lyrics = {
      try await HTTPClient().lyrics($0, videoId: $1)
    },
    save: @escaping (Connection, String, Int) async throws -> Void = {
      try await HTTPClient().setLyricsOffset($0, videoId: $1, offsetMs: $2)
    },
    cacheLimit: Int = 32, now: @escaping () -> Date = Date.init
  ) {
    self.fetch = fetch
    self.save = save
    self.cacheLimit = max(1, cacheLimit)
    self.now = now
  }

  public func reset() {
    generation = UUID()
    requestID = UUID()
    loadingTask?.cancel()
    prefetch?.cancel()
    for save in saving.values { save.task.cancel() }
    for request in requests.values { request.task.cancel() }
    requests = [:]
    loadingTask = nil
    prefetch = nil
    prefetchId = nil
    saving = [:]
    corrections = [:]
    cache = [:]
    offsets = [:]
    lyrics = nil
    videoId = nil
    account = nil
    loading = false
    correctionState = .idle
  }

  public func show(_ track: Track?, next: Track?, connection: Connection?) {
    if account?.url != connection?.url || account?.token != connection?.token {
      reset()
      account = connection
    }
    guard let connection, let track else {
      loadingTask?.cancel()
      prefetch?.cancel()
      prefetchId = nil
      requestID = UUID()
      videoId = nil
      lyrics = nil
      loading = false
      correctionState = .idle
      return
    }
    if track.id != videoId {
      loadingTask?.cancel()
      requestID = UUID()
      loading = false
      correctionState = corrections[track.id] ?? .idle
      videoId = track.id
      lyrics = cached(track.id)
      if lyrics == nil { load(track.id, connection) }
    }
    let nextId = next?.id == track.id ? nil : next?.id
    guard nextId != prefetchId else { return }
    prefetch?.cancel()
    prefetchId = nextId
    if let nextId, cached(nextId) == nil {
      let generation = generation
      prefetch = Task { [weak self] in
        guard let self else { return }
        let found = try? await result(nextId, connection)
        guard !Task.isCancelled, self.generation == generation, let found else { return }
        store(found, id: nextId)
      }
    }
  }

  public func retry(connection: Connection?) {
    guard let connection, let videoId, matches(connection), !loading else { return }
    load(videoId, connection)
  }

  public func nudge(by deltaMs: Int?, connection: Connection?) {
    guard var current = lyrics, current.status == .synced,
      let videoId, let connection, matches(connection)
    else { return }
    current.offsetMs =
      deltaMs.map {
        Int(min(30000, max(-30000, Double(current.offsetMs) + Double($0))))
      } ?? 0
    offsets[videoId] = current.offsetMs
    lyrics = current
    store(current, id: videoId)
    saving[videoId]?.task.cancel()
    let correction = UUID()
    let offset = current.offsetMs
    let generation = generation
    correctionState = .saving
    corrections[videoId] = .saving
    let task = Task { [weak self, save] in
      let state: CorrectionState
      do {
        try await Task.sleep(for: .milliseconds(800))
        try Task.checkCancellation()
        guard self?.generation == generation else { return }
        try await save(connection, videoId, offset)
        state = .idle
      } catch {
        state = .failed
      }
      guard let self, !Task.isCancelled, self.generation == generation,
        self.saving[videoId]?.id == correction
      else { return }
      self.saving[videoId] = nil
      corrections[videoId] = state
      if self.videoId == videoId { correctionState = state }
    }
    saving[videoId] = (correction, task)
  }

  private func matches(_ connection: Connection) -> Bool {
    account?.url == connection.url && account?.token == connection.token
  }

  /// A prefetched track promoted to current reuses the same network request.
  private func result(_ id: String, _ connection: Connection) async throws -> Lyrics {
    if let existing = requests[id] { return try await existing.task.value }
    let request = UUID()
    let task = Task { [fetch] in try await fetch(connection, id) }
    requests[id] = (request, task)
    defer { if requests[id]?.id == request { requests[id] = nil } }
    return try await task.value
  }

  private func cached(_ id: String) -> Lyrics? {
    guard var entry = cache[id] else { return nil }
    guard entry.expires > now() else {
      cache[id] = nil
      return nil
    }
    entry.access = now()
    cache[id] = entry
    return entry.lyrics
  }

  private func store(_ found: Lyrics, id: String) {
    guard found.status != .unavailable else { return }
    var found = found
    if let offset = offsets[id] { found.offsetMs = offset }
    // Missing lyrics can appear later; never retain a negative result for the whole session.
    let ttl: TimeInterval = found.status == .missing ? 300 : 3600
    cache[id] = Cached(lyrics: found, expires: now().addingTimeInterval(ttl), access: now())
    while cache.count > cacheLimit {
      guard
        let oldest = cache.filter({ $0.key != videoId }).min(by: {
          $0.value.access < $1.value.access
        })?.key
      else { break }
      cache[oldest] = nil
    }
  }

  private func load(_ id: String, _ connection: Connection) {
    loadingTask?.cancel()
    loading = true
    let generation = generation
    let request = UUID()
    requestID = request
    loadingTask = Task { [weak self] in
      guard let self else { return }
      var found = try? await result(id, connection)
      guard !Task.isCancelled, self.generation == generation,
        self.requestID == request, self.videoId == id
      else { return }
      if let offset = offsets[id] { found?.offsetMs = offset }
      loading = false
      lyrics = found ?? Lyrics(status: .unavailable, lines: [])
      if let found { store(found, id: id) }
    }
  }
}
