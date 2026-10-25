import Combine
import Foundation

/// Account-scoped lyrics state, independent of the SwiftUI panel that presents it.
@MainActor
public final class LyricsModel: ObservableObject {
  @Published public private(set) var lyrics: Lyrics?
  @Published public private(set) var loading = false
  public private(set) var videoId: String?
  private var cache: [String: Lyrics] = [:]
  private var generation = UUID()
  private var requestID = UUID()
  private var account: Connection?
  private var loadingTask: Task<Void, Never>?
  private var prefetch: Task<Void, Never>?
  private var saving: Task<Void, Never>?
  private let fetch: (Connection, String) async throws -> Lyrics
  private let save: (Connection, String, Int) async throws -> Void

  public init(
    fetch: @escaping (Connection, String) async throws -> Lyrics = {
      try await HTTPClient().lyrics($0, videoId: $1)
    },
    save: @escaping (Connection, String, Int) async throws -> Void = {
      try await HTTPClient().setLyricsOffset($0, videoId: $1, offsetMs: $2)
    }
  ) {
    self.fetch = fetch
    self.save = save
  }

  public func reset() {
    generation = UUID()
    requestID = UUID()
    loadingTask?.cancel()
    prefetch?.cancel()
    saving?.cancel()
    loadingTask = nil
    prefetch = nil
    saving = nil
    cache = [:]
    lyrics = nil
    videoId = nil
    account = nil
    loading = false
  }

  public func show(_ track: Track?, next: Track?, connection: Connection?) {
    if account?.url != connection?.url || account?.token != connection?.token {
      reset()
      account = connection
    }
    guard let connection, let track else {
      loadingTask?.cancel()
      requestID = UUID()
      videoId = nil
      lyrics = nil
      loading = false
      return
    }
    if track.id != videoId {
      loadingTask?.cancel()
      requestID = UUID()
      loading = false
      videoId = track.id
      lyrics = cache[track.id]
      if lyrics == nil || lyrics?.status == .unavailable { load(track.id, connection) }
    }
    prefetch?.cancel()
    if let next, cache[next.id] == nil {
      let generation = generation
      prefetch = Task { [weak self, fetch] in
        let found = try? await fetch(connection, next.id)
        guard let self, !Task.isCancelled, self.generation == generation,
          let found, found.status != .unavailable
        else { return }
        self.cache[next.id] = found
      }
    }
  }

  public func retry(connection: Connection?) {
    guard let connection, let videoId, matches(connection) else { return }
    load(videoId, connection)
  }

  public func nudge(by deltaMs: Int?, connection: Connection?) {
    guard var current = lyrics, let videoId, let connection, matches(connection) else { return }
    current.offsetMs = deltaMs.map { min(30000, max(-30000, current.offsetMs + $0)) } ?? 0
    lyrics = current
    cache[videoId] = current
    saving?.cancel()
    let offset = current.offsetMs
    let generation = generation
    saving = Task { [weak self, save] in
      try? await Task.sleep(nanoseconds: 800_000_000)
      guard !Task.isCancelled, self?.generation == generation else { return }
      try? await save(connection, videoId, offset)
    }
  }

  private func matches(_ connection: Connection) -> Bool {
    account?.url == connection.url && account?.token == connection.token
  }

  private func load(_ id: String, _ connection: Connection) {
    loadingTask?.cancel()
    loading = true
    let generation = generation
    let request = UUID()
    requestID = request
    loadingTask = Task { [weak self, fetch] in
      let found = try? await fetch(connection, id)
      guard let self, !Task.isCancelled, self.generation == generation,
        self.requestID == request, self.videoId == id
      else { return }
      self.loading = false
      self.lyrics = found ?? Lyrics(status: .unavailable, lines: [])
      if let found, found.status != .unavailable { self.cache[id] = found }
    }
  }
}
