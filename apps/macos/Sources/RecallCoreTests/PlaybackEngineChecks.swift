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
  func load(_ source: PlaybackSource, at start: Double, autoplay: Bool) async throws {
    if failLoad { throw RecallError.message("load failed") }
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
  for _ in 0..<2000 {
    if condition() { return }
    await Task.yield()
  }
  throw RecallError.message("Playback engine did not settle")
}

@MainActor
func playbackEngineChecks() async throws {
  let song = Track(id: "aaaaaaaaaaa", title: "A")
  let other = Track(id: "bbbbbbbbbbb", title: "B")

  // Music starts at once on YouTube, then the clip takes over at the same instant.
  var youtube = FakePlayer(), clip = FakePlayer(), clips = FakeClips()
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

  // Paused when the clip arrives: switch silently, stay paused.
  youtube = FakePlayer(); clip = FakePlayer(); clips = FakeClips()
  engine = PlaybackEngine(youtube: youtube, clip: clip, clips: clips, fadeDuration: 0)
  engine.cue(song)
  try await settle { clips.waiting[song.id] != nil }
  engine.pause()
  clips.deliver(song.id)
  try await settle { engine.active == .clip }
  try expect(!clip.playing && !youtube.playing, "A paused song started playing at the handover")

  // No clip: YouTube keeps playing, the session hears nothing unusual.
  youtube = FakePlayer(); clip = FakePlayer(); clips = FakeClips()
  engine = PlaybackEngine(youtube: youtube, clip: clip, clips: clips, fadeDuration: 0)
  heard = []
  engine.onSignal = { heard.append($0) }
  engine.cue(song)
  try await settle { clips.waiting[song.id] != nil }
  clips.fail(song.id)
  try await settle { !engine.preparingClip }
  try expect(engine.active == .youtube && heard.isEmpty, "A missing clip disturbed playback")

  // YouTube refuses to embed, but the clip comes: no skip.
  youtube = FakePlayer(); clip = FakePlayer(); clips = FakeClips()
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
  youtube = FakePlayer(); clip = FakePlayer(); clips = FakeClips()
  engine = PlaybackEngine(youtube: youtube, clip: clip, clips: clips, fadeDuration: 0)
  heard = []
  engine.onSignal = { heard.append($0) }
  engine.cue(song)
  try await settle { clips.waiting[song.id] != nil }
  youtube.onSignal?(.unavailable)
  clips.fail(song.id)
  try await settle { heard == [.unavailable] }

  // A clip failing mid-song falls back to YouTube at the same instant.
  youtube = FakePlayer(); clip = FakePlayer(); clips = FakeClips()
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
  youtube = FakePlayer(); clip = FakePlayer(); clips = FakeClips()
  engine = PlaybackEngine(youtube: youtube, clip: clip, clips: clips, fadeDuration: 0)
  engine.cue(song)
  try await settle { clips.waiting[song.id] != nil }
  engine.cue(other)
  try await settle { clips.waiting[other.id] != nil }
  clips.deliver(song.id)
  for _ in 0..<50 { await Task.yield() }
  try expect(engine.active == .youtube && clip.loaded.isEmpty, "A stale clip replaced the new song")

  // YouTube only: nothing is downloaded or prepared.
  youtube = FakePlayer(); clip = FakePlayer(); clips = FakeClips()
  engine = PlaybackEngine(youtube: youtube, clip: clip, clips: clips, downloads: false)
  engine.cue(song)
  engine.prepare([other])
  try await settle { youtube.loaded.count == 1 }
  try expect(
    clips.waiting.isEmpty && clips.kept.isEmpty && !engine.preparingClip,
    "YouTube-only mode still downloaded clips")

  // Upcoming tracks are prepared ahead, current first; the voice ducks the sounding player.
  youtube = FakePlayer(); clip = FakePlayer(); clips = FakeClips()
  engine = PlaybackEngine(youtube: youtube, clip: clip, clips: clips, volume: 1, fadeDuration: 0)
  engine.cue(song)
  engine.prepare([other])
  try expect(clips.kept == [song.id, other.id], "Upcoming clips were not prepared in order")
  engine.duck(true)
  try expect(youtube.volume <= 0.18, "The DJ voice did not lower the music")
  engine.duck(false)
  try expect(youtube.volume == 1, "The music was not restored after the voice")

  print("Playback engine checks passed: instant start, crossfade handover, pause, fallbacks, stale clips, YouTube only")
}
