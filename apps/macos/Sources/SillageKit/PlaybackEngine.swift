import Combine
import Foundation

/// What a player can be asked to play: a YouTube video, or a clip downloaded on this Mac.
public enum PlaybackSource: Sendable, Equatable {
  case youtube(String)
  case file(URL)
}

/// One concrete player behind the playback seam: the embedded YouTube player or AVPlayer.
@MainActor
public protocol PlaybackBackend: AnyObject {
  var onSignal: ((PlaybackSignal) -> Void)? { get set }
  /// A short explanation for the person ("Clique sur Lecture…"); never a session decision.
  var onFailure: ((String) -> Void)? { get set }
  /// Returns once the source can play from `start`.
  func load(_ source: PlaybackSource, at start: Double, autoplay: Bool) async throws
  func play()
  func pause()
  func seek(to seconds: Double)
  func stop()
  /// Effective level, 0…1, already including the DJ voice ducking.
  func setVolume(_ level: Double)
  var position: Double { get }
}

/// Where downloaded clips come from (the Studio cache in the app, a fake in tests).
@MainActor
public protocol ClipSource: AnyObject {
  func clip(for id: String) async throws -> URL
  /// Prepares these videos ahead, nearest first, and lets go of the others.
  func keep(_ ids: [String])
}

/// The playback module. Music starts at once on YouTube; when the downloaded clip is ready it
/// takes over at the same instant with an audio crossfade, so Compact and Studio share one
/// quality. A clip that cannot be prepared or fails falls back to YouTube without a word to the
/// session, which only ever hears "playing", "progress", "ended" or "unavailable".
@MainActor
public final class PlaybackEngine: ObservableObject {
  public enum Player: Sendable, Equatable { case youtube, clip }

  @Published public private(set) var active: Player = .youtube
  @Published public private(set) var track: Track?
  @Published public private(set) var playing = false
  @Published public private(set) var elapsed: Double = 0
  @Published public private(set) var duration: Double = 0
  @Published public private(set) var preparingClip = false
  /// A native-clip failure does not stop healthy YouTube playback, but must remain visible.
  @Published public private(set) var clipFailure: PlaybackFailure?
  /// True during the audio crossfade, while both players are visible.
  @Published public private(set) var fading = false
  @Published public private(set) var failure = ""
  @Published public var volume: Double {
    didSet { applyVolume() }
  }
  /// False: the YouTube player only, nothing is downloaded.
  @Published public private(set) var downloads: Bool

  public var onSignal: ((PlaybackSignal) -> Void)?

  private let youtube: PlaybackBackend
  private let clip: PlaybackBackend
  private let clips: ClipSource
  private let fadeDuration: Double
  private let fadeSteps: Int
  private var generation = 0
  private var clipTask: Task<Void, Never>?
  private var youtubeTask: Task<Void, Never>?
  private var wantsPlayback = true
  private var ducked = false
  private var heldUnavailable = false
  private var heldSignal: PlaybackSignal = .unavailable
  private var failureDelivered = false
  private var clock = PlaybackClock()

  public init(
    youtube: PlaybackBackend, clip: PlaybackBackend, clips: ClipSource, volume: Double = 1,
    downloads: Bool = true, fadeDuration: Double = 0.6, fadeSteps: Int = 12
  ) {
    self.youtube = youtube
    self.clip = clip
    self.clips = clips
    self.volume = volume
    self.downloads = downloads
    self.fadeDuration = fadeDuration
    self.fadeSteps = max(1, fadeSteps)
    youtube.onSignal = { [weak self] in self?.receive($0, from: .youtube) }
    clip.onSignal = { [weak self] in self?.receive($0, from: .clip) }
    youtube.onFailure = { [weak self] in if self?.active == .youtube { self?.failure = $0 } }
    clip.onFailure = { [weak self] in if self?.active == .clip { self?.failure = $0 } }
  }

  /// Interpolated position for smooth displays (lyrics, progress) between player samples.
  public func position(at date: Date = Date()) -> Double { clock.position(at: date) }

  public func cue(_ track: Track, autoplay: Bool = true) {
    generation += 1
    clipTask?.cancel()
    clip.stop()
    self.track = track
    active = .youtube
    fading = false
    playing = false
    elapsed = 0
    duration = 0
    failure = ""
    clipFailure = nil
    heldUnavailable = false
    failureDelivered = false
    wantsPlayback = autoplay
    clock.sample(0, playing: false)
    youtube.setVolume(level)
    let generation = generation
    loadYouTube(track, at: 0)
    if downloads { prepareClip(for: track, generation: generation) }
  }

  public func play() {
    wantsPlayback = true
    backend(active).play()
  }

  public func pause() {
    wantsPlayback = false
    // During the crossfade both players sound: pause both.
    youtube.pause()
    clip.pause()
  }

  public func seek(_ seconds: Double) {
    guard seconds.isFinite, track != nil else { return }
    let target = max(0, duration > 0 ? min(seconds, duration) : seconds)
    elapsed = target
    clock.sample(target, playing: playing)
    backend(active).seek(to: target)
  }

  /// Upcoming tracks, nearest first: their clips are prepared ahead when downloads are on.
  public func prepare(_ upcoming: [Track]) {
    guard downloads else { return }
    clips.keep(([track].compactMap { $0 } + upcoming).map(\.id))
  }

  /// The DJ voice lowers the music while it speaks, then restores it.
  public func duck(_ value: Bool) {
    ducked = value
    applyVolume()
  }

  /// Switches between "downloaded clip in both modes" and "YouTube player only".
  public func setDownloads(_ value: Bool) {
    guard downloads != value else { return }
    downloads = value
    reloadClip()
  }

  /// Quality changed or downloads toggled: back to YouTube at the same instant, then a new clip.
  public func reloadClip() {
    guard let track else { return }
    generation += 1
    failureDelivered = false
    heldUnavailable = false
    clipTask?.cancel()
    fading = false
    if active == .clip {
      let resume = clip.position
      clip.stop()
      active = .youtube
      youtube.setVolume(level)
      loadYouTube(track, at: resume)
    }
    preparingClip = false
    clipFailure = nil
    if downloads { prepareClip(for: track, generation: generation) }
  }

  /// Retry only the native preparation; leave the current YouTube position and transport alone.
  public func retryClip() {
    guard let track, downloads, active == .youtube, !preparingClip else { return }
    clipFailure = nil
    prepareClip(for: track, generation: generation)
  }

  public func reset() {
    generation += 1
    clipTask?.cancel()
    fading = false
    youtubeTask?.cancel()
    youtubeTask = nil
    youtube.stop()
    clip.stop()
    clips.keep([])
    track = nil
    active = .youtube
    playing = false
    elapsed = 0
    duration = 0
    preparingClip = false
    clipFailure = nil
    failure = ""
    heldUnavailable = false
    clock.sample(0, playing: false)
  }

  /// Queue only the latest YouTube load, with transport intent read when it actually runs.
  private func loadYouTube(_ track: Track, at position: Double) {
    youtubeTask?.cancel()
    let expectedGeneration = generation
    youtubeTask = Task { [weak self] in
      guard let self, !Task.isCancelled, generation == expectedGeneration else { return }
      do {
        try await youtube.load(.youtube(track.id), at: position, autoplay: wantsPlayback)
        guard !Task.isCancelled, generation == expectedGeneration else {
          // Reset may have happened while a backend was awaiting readiness. Stop any
          // late start, but never stop a newer song that now owns this backend.
          if self.track == nil { youtube.stop() }
          return
        }
        // A backend may suspend during loading; a newer Pause still wins when it returns.
        if !wantsPlayback { youtube.pause() }
      } catch {
        guard !Task.isCancelled, generation == expectedGeneration else { return }
        receive(.failed(PlaybackFailure(.network)), from: .youtube)
      }
    }
  }

  // MARK: - Clip handover

  private func prepareClip(for track: Track, generation: Int) {
    preparingClip = true
    clipTask = Task { [weak self, clips] in
      do {
        let url = try await clips.clip(for: track.id)
        try Task.checkCancellation()
        await self?.handOver(to: url, generation: generation)
      } catch {
        self?.clipFailed(generation: generation, error: error)
      }
    }
  }

  private func handOver(to url: URL, generation: Int) async {
    guard generation == self.generation else { return }
    let wasPlaying = playing || heldUnavailable && wantsPlayback
    // Start a hair ahead: the clip seeks while YouTube keeps playing.
    let start = heldUnavailable ? elapsed : youtube.position + (wasPlaying ? 0.15 : 0)
    do {
      try await clip.load(.file(url), at: start, autoplay: false)
    } catch {
      clipFailed(generation: generation)
      return
    }
    // A newer song already stopped this clip and may be loading its own: leave it alone.
    guard generation == self.generation else { return }
    heldUnavailable = false
    failure = ""
    if wantsPlayback {
      clip.setVolume(0)
      clip.play()
      active = .clip
      fading = true
      for step in 1...fadeSteps {
        let t = Double(step) / Double(fadeSteps)
        youtube.setVolume(level * (1 - t))
        clip.setVolume(level * t)
        if fadeDuration > 0 {
          try? await Task.sleep(nanoseconds: UInt64(fadeDuration / Double(fadeSteps) * 1e9))
        }
        guard generation == self.generation else { return }
      }
      fading = false
      youtube.pause()
    } else {
      youtube.pause()
      clip.setVolume(level)
      active = .clip
    }
    preparingClip = false
  }

  private func clipFailed(generation: Int, error: Error? = nil) {
    guard generation == self.generation else { return }
    preparingClip = false
    clipFailure = error as? PlaybackFailure ?? PlaybackFailure(.download)
    if heldUnavailable {
      heldUnavailable = false
      // An explicit service failure explains both paths better than a generic iframe refusal.
      let cause = error as? PlaybackFailure
      let signal =
        cause.map {
          !$0.mayTryAnotherTrack && $0.kind != .download ? PlaybackSignal.failed($0) : heldSignal
        } ?? heldSignal
      deliverFailure(signal)
    }
  }

  // MARK: - Signals

  private func receive(_ signal: PlaybackSignal, from player: Player) {
    guard player == active else { return }
    if case .failed = signal {
      handleFailure(signal, from: player)
      return
    }
    if case .unavailable = signal {
      handleFailure(signal, from: player)
      return
    }
    guard !failureDelivered else { return }
    switch signal {
    case .playing(let value):
      if playing != value { playing = value }
      clock.setPlaying(value)
    case .progress(let seconds, let length):
      // Keep the precise clock for lyrics/seeks; refresh ordinary controls at most 4 Hz.
      if abs(seconds - elapsed) >= 0.25 || !playing { elapsed = seconds }
      if length > 0, abs(length - duration) > 0.01 { duration = length }
      clock.sample(seconds, playing: playing)
    case .ended, .unavailable, .failed:
      playing = false
    }
    onSignal?(signal)
  }

  private func handleFailure(_ signal: PlaybackSignal, from player: Player) {
    guard !failureDelivered else { return }
    if player == .youtube && preparingClip {
      heldUnavailable = true
      heldSignal = signal
    } else if player == .clip, let track {
      let resume = clip.position
      clip.stop()
      active = .youtube
      failure = "Lecture locale indisponible. Retour au lecteur YouTube."
      youtube.setVolume(level)
      loadYouTube(track, at: resume)
    } else {
      deliverFailure(signal)
    }
  }

  private func deliverFailure(_ signal: PlaybackSignal) {
    guard !failureDelivered else { return }
    failureDelivered = true
    playing = false
    clock.setPlaying(false)
    if case .failed(let cause) = signal { failure = cause.message }
    onSignal?(signal)
  }

  private var level: Double { ducked ? min(volume, 0.18) : volume }

  private func applyVolume() {
    guard !fading else { return }
    backend(active).setVolume(level)
  }

  private func backend(_ player: Player) -> PlaybackBackend {
    player == .youtube ? youtube : clip
  }
}
