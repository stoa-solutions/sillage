import AVFoundation

/// The downloaded clip, played natively with frame-accurate seeks. A load is superseded by a
/// newer load or by `stop()`: it then throws `CancellationError` exactly once and never seeks or
/// plays the item that replaced it.
@MainActor
public final class ClipPlayer: PlaybackBackend {
  public var onSignal: ((PlaybackSignal) -> Void)?
  public var onFailure: ((String) -> Void)?
  public let player = AVPlayer()
  public private(set) var videoHeight = 0
  private var pendingLoad: (id: UUID, continuation: CheckedContinuation<Void, Error>)?
  private var itemObservation: NSKeyValueObservation?
  private var statusObservation: NSKeyValueObservation?
  private var endObserver: NSObjectProtocol?
  private var timeObserver: Any?
  private var seekRequest: UUID?

  public var position: Double {
    let time = player.currentTime().seconds
    return time.isFinite ? time : 0
  }

  public init() {
    statusObservation = player.observe(\.timeControlStatus) { [weak self] native, _ in
      Task { @MainActor in
        guard let self, native.currentItem != nil, self.pendingLoad == nil else { return }
        self.onSignal?(.playing(native.timeControlStatus == .playing))
      }
    }
    endObserver = NotificationCenter.default.addObserver(
      forName: .AVPlayerItemDidPlayToEndTime, object: nil, queue: .main
    ) { [weak self] event in
      let item = event.object as? AVPlayerItem
      Task { @MainActor in
        guard let self, item === self.player.currentItem else { return }
        self.onSignal?(.ended)
      }
    }
    timeObserver = player.addPeriodicTimeObserver(
      forInterval: CMTime(seconds: 0.1, preferredTimescale: 600), queue: .main
    ) { [weak self] time in
      Task { @MainActor in
        guard let self, let item = self.player.currentItem, self.seekRequest == nil,
          self.pendingLoad == nil
        else { return }
        let length = item.duration.seconds
        self.videoHeight = Int(item.presentationSize.height)
        self.onSignal?(
          .progress(
            elapsed: time.seconds.isFinite ? time.seconds : 0,
            duration: length.isFinite ? length : 0))
      }
    }
  }

  public func load(_ source: PlaybackSource, at start: Double, autoplay: Bool) async throws {
    guard case .file(let url) = source else { return }
    finishLoad(throwing: CancellationError())
    let item = AVPlayerItem(url: url)
    let id = UUID()
    player.replaceCurrentItem(with: item)
    try await withTaskCancellationHandler {
      try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
        pendingLoad = (id, continuation)
        itemObservation = item.observe(\.status, options: [.initial, .new]) { [weak self] item, _ in
          Task { @MainActor in self?.statusChanged(item, load: id) }
        }
      }
    } onCancel: {
      Task { @MainActor [weak self] in self?.finishLoad(id: id, throwing: CancellationError()) }
    }
    // Another load or a stop may have replaced the item while it was preparing.
    guard player.currentItem === item else { throw CancellationError() }
    await player.seek(
      to: CMTime(seconds: start, preferredTimescale: 600), toleranceBefore: .zero,
      toleranceAfter: .zero)
    guard player.currentItem === item else { throw CancellationError() }
    if autoplay { player.play() }
  }

  public func play() { player.play() }
  public func pause() { player.pause() }
  public func seek(to seconds: Double) {
    let request = UUID()
    seekRequest = request
    player.currentItem?.cancelPendingSeeks()
    player.seek(
      to: CMTime(seconds: seconds, preferredTimescale: 1000), toleranceBefore: .zero,
      toleranceAfter: .zero
    ) { [weak self] finished in
      Task { @MainActor in
        guard let self, self.seekRequest == request else { return }
        self.seekRequest = nil
        if !finished { self.onFailure?("Le déplacement n’a pas abouti. Réessaie.") }
      }
    }
  }
  public func stop() {
    finishLoad(throwing: CancellationError())
    player.pause()
    player.replaceCurrentItem(with: nil)
    itemObservation = nil
    videoHeight = 0
  }
  public func setVolume(_ level: Double) { player.volume = Float(level) }

  private func statusChanged(_ item: AVPlayerItem, load id: UUID) {
    guard player.currentItem === item else { return }
    switch item.status {
    case .readyToPlay:
      finishLoad(id: id, throwing: nil)
    case .failed:
      if pendingLoad?.id == id {
        finishLoad(id: id, throwing: item.error ?? RecallError.message("Clip illisible."))
      } else {
        onSignal?(.unavailable)
      }
    default: break
    }
  }

  /// Resumes the pending load exactly once; `id` limits it to that load.
  private func finishLoad(id: UUID? = nil, throwing error: Error?) {
    guard let pending = pendingLoad, id == nil || pending.id == id else { return }
    pendingLoad = nil
    if let error {
      pending.continuation.resume(throwing: error)
    } else {
      pending.continuation.resume()
    }
  }
}
