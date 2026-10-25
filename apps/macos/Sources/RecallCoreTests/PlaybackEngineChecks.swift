import Combine
import Foundation
import RecallKit

@MainActor
private final class FakePlayer: PlaybackBackend {
  var onSignal: ((PlaybackSignal) -> Void)?
  var onFailure: ((String) -> Void)?
  var loaded: [(PlaybackSource, Double, Bool)] = []
  var playing = false
  var volume: Double = 1
  var position: Double = 0
  var failLoad = false
  /// When set, loads wait until `release()`; lets a test act while the clip is loading.
  var holdLoads = false
  var held: [CheckedContinuation<Void, Never>] = []
  func release() {
    held.forEach { $0.resume() }
    held = []
  }
  func load(_ source: PlaybackSource, at start: Double, autoplay: Bool) async throws {
    if failLoad { throw RecallError.message("load failed") }
    if holdLoads { await withCheckedContinuation { held.append($0) } }
    loaded.append((source, start, autoplay))
    position = start
    playing = autoplay
  }
  func play() { playing = true }
  func pause() { playing = false }
  func seek(to seconds: Double) { position = seconds }
  func stop() { playing = false }
  func setVolume(_ level: Double) { volume = level }
}

@MainActor
private final class FakeClips: ClipSource {
  var waiting: [String: CheckedContinuation<URL, Error>] = [:]
  var kept: [String] = []
  func clip(for id: String) async throws -> URL {
    try await withCheckedThrowingContinuation { waiting[id] = $0 }
  }
  func keep(_ ids: [String]) { kept = ids }
  func deliver(_ id: String) {
    waiting.removeValue(forKey: id)?.resume(returning: URL(fileURLWithPath: "/tmp/\(id).mp4"))
  }
  func fail(_ id: String) {
    waiting.removeValue(forKey: id)?.resume(throwing: RecallError.message("no clip"))
  }
}

@MainActor
private func settle(_ condition: () -> Bool) async throws {
  // Real time passes too: crossfades in these checks last a fraction of a second.
  for _ in 0..<2000 {
    if condition() { return }
    try await Task.sleep(nanoseconds: 1_000_000)
  }
  throw RecallError.message("Playback engine did not settle")
}

@MainActor
func playbackEngineChecks() async throws {
  let song = Track(id: "aaaaaaaaaaa", title: "A")
  let other = Track(id: "bbbbbbbbbbb", title: "B")

  // Music starts at once on YouTube, then the clip takes over at the same instant.
  var youtube = FakePlayer()
  var clip = FakePlayer()
  var clips = FakeClips()
  var engine = PlaybackEngine(
    youtube: youtube, clip: clip, clips: clips, volume: 0.8, fadeDuration: 0, fadeSteps: 3)
  var heard: [PlaybackSignal] = []
  engine.onSignal = { heard.append($0) }
  engine.cue(song)
  try await settle { youtube.loaded.count == 1 && clips.waiting[song.id] != nil }
  try expect(
    youtube.loaded[0].0 == .youtube(song.id) && engine.active == .youtube && engine.preparingClip,
    "Playback did not start on YouTube while the clip prepared")
  youtube.onSignal?(.playing(true))
  youtube.position = 12
  youtube.onSignal?(.progress(elapsed: 12, duration: 200))
  clips.deliver(song.id)
  try await settle { engine.active == .clip && !engine.preparingClip }
  try expect(
    abs(clip.loaded[0].1 - 12.15) < 0.01 && clip.playing && !youtube.playing,
    "The clip did not take over from YouTube's position")
  try expect(
    abs(clip.volume - 0.8) < 0.001 && youtube.volume < 0.001,
    "The crossfade did not end on the clip at full volume")
  youtube.onSignal?(.progress(elapsed: 99, duration: 200))
  clip.onSignal?(.progress(elapsed: 13, duration: 200))
  try expect(
    engine.elapsed == 13 && heard.last == .progress(elapsed: 13, duration: 200),
    "Signals from the silent player leaked to the session")

  // High-frequency media samples must not redraw ordinary controls at the same rate.
  // Session effects still receive every sample and the interpolation clock keeps precision.
  var timeUpdates = 0
  var durationUpdates = 0
  let timeWatch = engine.$elapsed.dropFirst().sink { _ in timeUpdates += 1 }
  let durationWatch = engine.$duration.dropFirst().sink { _ in durationUpdates += 1 }
  heard = []
  for step in 1...10 {
    clip.onSignal?(.progress(elapsed: 13 + Double(step) / 10, duration: 200))
  }
  try expect(timeUpdates <= 4 && durationUpdates == 0, "Progress invalidated controls too often")
  try expect(heard.count == 10, "Throttling dropped session preparation signals")
  try expect(abs(engine.position(at: Date()) - 14) < 0.1, "Precise playback clock lost samples")
  engine.seek(42.125)
  try expect(engine.elapsed == 42.125, "Explicit seek was delayed by display throttling")
  timeWatch.cancel()
  durationWatch.cancel()

  // Paused when the clip arrives: switch silently, stay paused.
  youtube = FakePlayer()
  clip = FakePlayer()
  clips = FakeClips()
  engine = PlaybackEngine(youtube: youtube, clip: clip, clips: clips, fadeDuration: 0)
  engine.cue(song)
  try await settle { clips.waiting[song.id] != nil }
  engine.pause()
  clips.deliver(song.id)
  try await settle { engine.active == .clip }
  try expect(!clip.playing && !youtube.playing, "A paused song started playing at the handover")

  // No clip: YouTube keeps playing, the session hears nothing unusual.
  youtube = FakePlayer()
  clip = FakePlayer()
  clips = FakeClips()
  engine = PlaybackEngine(youtube: youtube, clip: clip, clips: clips, fadeDuration: 0)
  heard = []
  engine.onSignal = { heard.append($0) }
  engine.cue(song)
  try await settle { clips.waiting[song.id] != nil }
  clips.fail(song.id)
  try await settle { !engine.preparingClip }
  try expect(engine.active == .youtube && heard.isEmpty, "A missing clip disturbed playback")

  // YouTube refuses to embed, but the clip comes: no skip.
  youtube = FakePlayer()
  clip = FakePlayer()
  clips = FakeClips()
  engine = PlaybackEngine(youtube: youtube, clip: clip, clips: clips, fadeDuration: 0)
  heard = []
  engine.onSignal = { heard.append($0) }
  engine.cue(song)
  try await settle { clips.waiting[song.id] != nil }
  youtube.onSignal?(.unavailable)
  try expect(heard.isEmpty, "An embed refusal skipped a song whose clip was on its way")
  clips.deliver(song.id)
  try await settle { engine.active == .clip }
  try expect(clip.playing && heard.isEmpty, "The clip did not rescue the refused embed")

  // Both refuse: now the session hears "unavailable".
  youtube = FakePlayer()
  clip = FakePlayer()
  clips = FakeClips()
  engine = PlaybackEngine(youtube: youtube, clip: clip, clips: clips, fadeDuration: 0)
  heard = []
  engine.onSignal = { heard.append($0) }
  engine.cue(song)
  try await settle { clips.waiting[song.id] != nil }
  youtube.onSignal?(.unavailable)
  clips.fail(song.id)
  try await settle { heard == [.unavailable] }

  // A clip failing mid-song falls back to YouTube at the same instant.
  youtube = FakePlayer()
  clip = FakePlayer()
  clips = FakeClips()
  engine = PlaybackEngine(youtube: youtube, clip: clip, clips: clips, fadeDuration: 0)
  engine.cue(song)
  try await settle { clips.waiting[song.id] != nil }
  clips.deliver(song.id)
  try await settle { engine.active == .clip }
  clip.position = 42
  clip.onSignal?(.unavailable)
  try await settle { youtube.loaded.count == 2 }
  try expect(
    engine.active == .youtube && youtube.loaded[1].1 == 42,
    "A failing clip did not hand back to YouTube at its position")

  // A new song cancels a clip still preparing for the previous one.
  youtube = FakePlayer()
  clip = FakePlayer()
  clips = FakeClips()
  engine = PlaybackEngine(youtube: youtube, clip: clip, clips: clips, fadeDuration: 0)
  engine.cue(song)
  try await settle { clips.waiting[song.id] != nil }
  engine.cue(other)
  try await settle { clips.waiting[other.id] != nil }
  clips.deliver(song.id)
  for _ in 0..<50 { await Task.yield() }
  try expect(engine.active == .youtube && clip.loaded.isEmpty, "A stale clip replaced the new song")

  // YouTube only: nothing is downloaded or prepared.
  youtube = FakePlayer()
  clip = FakePlayer()
  clips = FakeClips()
  engine = PlaybackEngine(youtube: youtube, clip: clip, clips: clips, downloads: false)
  engine.cue(song)
  engine.prepare([other])
  try await settle { youtube.loaded.count == 1 }
  try expect(
    clips.waiting.isEmpty && clips.kept.isEmpty && !engine.preparingClip,
    "YouTube-only mode still downloaded clips")

  // A cue runs on the next actor turn: Pause and Reset must still win before it starts.
  youtube = FakePlayer()
  clip = FakePlayer()
  clips = FakeClips()
  engine = PlaybackEngine(youtube: youtube, clip: clip, clips: clips, downloads: false)
  engine.cue(song)
  engine.pause()
  try await settle { youtube.loaded.count == 1 }
  try expect(
    !youtube.playing && !youtube.loaded[0].2,
    "A queued YouTube load ignored the latest Pause")
  youtube.loaded = []
  engine.cue(other)
  engine.reset()
  for _ in 0..<50 { await Task.yield() }
  try expect(
    youtube.loaded.isEmpty && !youtube.playing && engine.track == nil,
    "A queued YouTube load survived account reset")
  engine.cue(song)
  engine.cue(other)
  try await settle { !youtube.loaded.isEmpty }
  try expect(
    youtube.loaded.map { $0.0 } == [.youtube(other.id)],
    "A superseded YouTube cue reached the backend")

  // Pause while a backend's asynchronous load is suspended must win at completion too.
  youtube = FakePlayer()
  youtube.holdLoads = true
  clip = FakePlayer()
  clips = FakeClips()
  engine = PlaybackEngine(youtube: youtube, clip: clip, clips: clips, downloads: false)
  engine.cue(song)
  try await settle { !youtube.held.isEmpty }
  engine.pause()
  youtube.release()
  try await settle { youtube.loaded.count == 1 }
  try expect(!youtube.playing, "A suspended YouTube load resumed after Pause")

  // A backend that completes after reset must not leave orphan audio playing.
  youtube.loaded = []
  engine.cue(other)
  try await settle { !youtube.held.isEmpty }
  engine.reset()
  youtube.release()
  try await settle { youtube.loaded.count == 1 }
  try expect(
    !youtube.playing && engine.track == nil,
    "A suspended YouTube load left audio playing after reset")

  // Upcoming tracks are prepared ahead, current first; the voice ducks the sounding player.
  youtube = FakePlayer()
  clip = FakePlayer()
  clips = FakeClips()
  engine = PlaybackEngine(youtube: youtube, clip: clip, clips: clips, volume: 1, fadeDuration: 0)
  engine.cue(song)
  engine.prepare([other])
  try expect(clips.kept == [song.id, other.id], "Upcoming clips were not prepared in order")
  engine.duck(true)
  try expect(youtube.volume <= 0.18, "The DJ voice did not lower the music")
  engine.duck(false)
  try expect(youtube.volume == 1, "The music was not restored after the voice")

  // A real crossfade interrupted by a quality change ends cleanly on YouTube.
  youtube = FakePlayer()
  clip = FakePlayer()
  clips = FakeClips()
  engine = PlaybackEngine(
    youtube: youtube, clip: clip, clips: clips, volume: 0.6, fadeDuration: 0.2, fadeSteps: 4)
  engine.cue(song)
  try await settle { clips.waiting[song.id] != nil }
  youtube.onSignal?(.playing(true))
  clips.deliver(song.id)
  try await settle { engine.fading }
  engine.reloadClip()
  try expect(!engine.fading && engine.active == .youtube, "A reload left the crossfade running")
  try await Task.sleep(nanoseconds: 300_000_000)
  try expect(
    !engine.fading && abs(youtube.volume - 0.6) < 0.001,
    "The interrupted crossfade kept changing the volume")
  engine.volume = 0.4
  try expect(abs(youtube.volume - 0.4) < 0.001, "Volume stopped applying after an interrupted fade")

  // Pausing during the crossfade silences both players.
  youtube = FakePlayer()
  clip = FakePlayer()
  clips = FakeClips()
  engine = PlaybackEngine(
    youtube: youtube, clip: clip, clips: clips, fadeDuration: 0.2, fadeSteps: 4)
  engine.cue(song)
  try await settle { clips.waiting[song.id] != nil }
  youtube.onSignal?(.playing(true))
  clips.deliver(song.id)
  try await settle { engine.fading }
  engine.pause()
  try expect(!youtube.playing && !clip.playing, "A pause during the crossfade left YouTube playing")
  try await settle { !engine.fading }

  // Next while the clip is still loading: the old load never takes over the new song.
  youtube = FakePlayer()
  clip = FakePlayer()
  clips = FakeClips()
  clip.holdLoads = true
  engine = PlaybackEngine(youtube: youtube, clip: clip, clips: clips, fadeDuration: 0)
  engine.cue(song)
  try await settle { clips.waiting[song.id] != nil }
  clips.deliver(song.id)
  try await settle { clip.held.count == 1 }
  engine.cue(other)
  clip.release()
  for _ in 0..<50 { await Task.yield() }
  try expect(
    engine.active == .youtube && engine.track?.id == other.id && !clip.playing,
    "A clip still loading for the previous song took over the new one")

  print(
    "Playback engine checks passed: instant start, crossfade handover, pause, fallbacks, stale clips, YouTube only, interrupted fades, Next during load"
  )
}
