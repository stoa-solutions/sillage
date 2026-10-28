import AppKit
import Combine
import MediaPlayer
import SillageKit

/// Publishes the current song to macOS (Control Center, the menu bar's Now Playing, AirPods and
/// the keyboard's media keys) and takes their commands back to the DJ.
@MainActor
final class DeskNowPlaying {
  private let dj: DJModel
  private var subscriptions: Set<AnyCancellable> = []
  private var published: (id: String, playing: Bool, duration: Int)?
  private var publishedElapsed = 0.0
  private var publishedAt = Date()
  private var artwork: (id: String, image: NSImage)?
  private var artworkTask: Task<Void, Never>?

  init(dj: DJModel) {
    self.dj = dj
    let commands = MPRemoteCommandCenter.shared()
    commands.playCommand.addTarget { [weak self] _ in
      MainActor.assumeIsolated { self?.resume() ?? .commandFailed }
    }
    commands.pauseCommand.addTarget { [weak self] _ in
      MainActor.assumeIsolated {
        self?.dj.pause()
        return .success
      }
    }
    commands.togglePlayPauseCommand.addTarget { [weak self] _ in
      MainActor.assumeIsolated {
        guard let self, self.dj.current != nil else { return .noActionableNowPlayingItem }
        self.dj.togglePlayback()
        return .success
      }
    }
    commands.nextTrackCommand.addTarget { [weak self] _ in
      MainActor.assumeIsolated {
        guard let self, self.dj.current != nil else { return .noActionableNowPlayingItem }
        self.dj.next()
        return .success
      }
    }
    commands.changePlaybackPositionCommand.addTarget { [weak self] event in
      MainActor.assumeIsolated {
        guard let self, let event = event as? MPChangePlaybackPositionCommandEvent else {
          return .commandFailed
        }
        self.dj.seek(event.positionTime)
        return .success
      }
    }
    // The DJ decides what came before; there is no previous track to go back to.
    commands.previousTrackCommand.isEnabled = false
    dj.player.objectWillChange.sink { [weak self] _ in
      Task { @MainActor in self?.refresh() }
    }.store(in: &subscriptions)
    dj.listeningChanges.sink { [weak self] _ in
      Task { @MainActor in self?.refresh() }
    }.store(in: &subscriptions)
  }

  private func resume() -> MPRemoteCommandHandlerStatus {
    guard dj.current != nil else { return .noActionableNowPlayingItem }
    if !dj.player.playing { dj.togglePlayback() }
    return .success
  }

  /// Progress ticks are frequent: publish only what macOS cannot extrapolate itself.
  private func refresh() {
    let center = MPNowPlayingInfoCenter.default()
    guard let track = dj.current else {
      if published != nil {
        published = nil
        center.nowPlayingInfo = nil
        center.playbackState = .stopped
      }
      return
    }
    let player = dj.player
    let state = (id: track.id, playing: player.playing, duration: Int(player.duration))
    let expected =
      publishedElapsed + (published?.playing == true ? Date().timeIntervalSince(publishedAt) : 0)
    if let published, published == state, abs(player.elapsed - expected) < 2 { return }
    published = state
    publishedElapsed = player.elapsed
    publishedAt = Date()
    let title = TrackTitle(track)
    var info: [String: Any] = [
      MPMediaItemPropertyTitle: title.title,
      MPMediaItemPropertyArtist: title.artist ?? track.channel ?? "Sillage",
      MPNowPlayingInfoPropertyElapsedPlaybackTime: player.elapsed,
      MPNowPlayingInfoPropertyPlaybackRate: player.playing ? 1.0 : 0.0,
      MPNowPlayingInfoPropertyMediaType: MPNowPlayingInfoMediaType.video.rawValue,
    ]
    if player.duration > 0 { info[MPMediaItemPropertyPlaybackDuration] = player.duration }
    if let artwork, artwork.id == track.id {
      info[MPMediaItemPropertyArtwork] = Self.artwork(artwork.image)
    } else {
      loadArtwork(for: track)
    }
    center.nowPlayingInfo = info
    center.playbackState = player.playing ? .playing : .paused
  }

  private func loadArtwork(for track: Track) {
    artworkTask?.cancel()
    guard let url = URL(string: "https://i.ytimg.com/vi/\(track.id)/hqdefault.jpg") else { return }
    artworkTask = Task { [weak self] in
      guard let (data, _) = try? await URLSession.shared.data(from: url),
        let image = NSImage(data: data), !Task.isCancelled, let self,
        self.dj.current?.id == track.id
      else { return }
      self.artwork = (track.id, image)
      var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
      info[MPMediaItemPropertyArtwork] = Self.artwork(image)
      MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }
  }

  private static func artwork(_ image: NSImage) -> MPMediaItemArtwork {
    MPMediaItemArtwork(boundsSize: image.size) { _ in image }
  }
}
