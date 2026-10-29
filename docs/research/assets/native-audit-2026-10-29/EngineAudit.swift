import AVFoundation
import Combine
import Foundation
import SillageKit

@MainActor final class Backend: PlaybackBackend {
  var onSignal: ((PlaybackSignal) -> Void)?
  var onFailure: ((String) -> Void)?
  var position: Double = 0
  func load(_ source: PlaybackSource, at start: Double, autoplay: Bool) async throws { position = start }
  func play() {}
  func pause() {}
  func stop() {}
  func seek(to seconds: Double) { position = seconds }
  func setVolume(_ level: Double) {}
}
@MainActor final class Clips: ClipSource {
  func clip(for id: String) async throws -> URL { throw CancellationError() }
  func keep(_ ids: [String]) {}
}

@main struct EngineAudit {
  @MainActor static func main() async throws {
    let youtube = Backend()
    let engine = PlaybackEngine(youtube: youtube, clip: Backend(), clips: Clips(), downloads: false)
    youtube.onSignal?(.progress(elapsed: 10, duration: 180))
    var publications = 0
    var delivered = 0
    let watch = engine.objectWillChange.sink { publications += 1 }
    engine.onSignal = { _ in delivered += 1 }
    for _ in 0..<40 { youtube.onSignal?(.progress(elapsed: 10, duration: 180)) }
    let paused = publications
    let pausedDelivered = delivered
    youtube.onSignal?(.playing(true))
    publications = 0
    delivered = 0
    for step in 1...100 { youtube.onSignal?(.progress(elapsed: 10 + Double(step)/10, duration: 180)) }
    let playing = publications
    let playingDelivered = delivered
    watch.cancel()

    let clip = ClipPlayer()
    let started = ContinuousClock.now
    try await clip.load(.file(URL(fileURLWithPath: CommandLine.arguments[1])), at: 1.25, autoplay: false)
    let load = started.duration(to: .now)
    let initialPosition = clip.position
    clip.player.isMuted = true
    clip.play()
    try await Task.sleep(for: .milliseconds(650))
    let advancedPosition = clip.position
    clip.pause()
    clip.seek(to: 2.375)
    try await Task.sleep(for: .milliseconds(250))
    let seekPosition = clip.position
    clip.stop()
    let report: [String: Any] = [
      "pausedIdenticalSamples": 40, "pausedPublications": paused,
      "pausedDeliveredSignals": pausedDelivered, "playingSamples": 100,
      "playingPublications": playing, "playingDeliveredSignals": playingDelivered,
      "nativeLoadSeconds": Double(load.components.seconds) + Double(load.components.attoseconds)/1e18,
      "nativeStartPosition": initialPosition, "nativeAdvancedPosition": advancedPosition,
      "nativeSeekTarget": 2.375, "nativeSeekPosition": seekPosition,
      "nativeStopped": clip.player.currentItem == nil && clip.player.rate == 0,
    ]
    print(String(data: try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]), encoding: .utf8)!)
  }
}
