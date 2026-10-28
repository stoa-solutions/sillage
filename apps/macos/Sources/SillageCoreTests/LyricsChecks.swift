import Foundation
import SillageKit

func lyricsChecks() throws {
  let lyrics = try Lyrics.decode([
    "status": "synced", "offsetMs": 0, "durationDeltaMs": 8000, "source": ["name": "LRCLIB"],
    "lines": [
      ["startMs": 12650, "endMs": 16710, "text": "Okay"],
      ["startMs": 6180, "endMs": 12650, "text": "Mhm, mhm"],
      ["startMs": 18970, "endMs": 22750, "text": "Yeah"],
      ["startMs": -5, "endMs": 1, "text": "invalid"],
    ],
  ])
  try expect(
    lyrics.lines.map(\.text) == ["Mhm, mhm", "Okay", "Yeah"] && lyrics.sourceName == "LRCLIB",
    "Lyrics lines were not sorted and validated")
  try expect(lyrics.position(at: 2).index == nil, "A line was shown before the singing starts")
  let middle = lyrics.position(at: 14.68)
  try expect(
    middle.index == 1 && abs(middle.progress - 0.5) < 0.01, "Line progress is not interpolated")
  let pause = lyrics.position(at: 17.5)
  try expect(
    pause.index == 1 && pause.progress == 1, "The previous line did not stay complete in a gap")
  try expect(lyrics.position(at: 400).index == 2, "The last line was lost at the end of the song")
  var delayed = lyrics
  delayed.offsetMs = 8000
  try expect(
    delayed.position(at: 14.68).index == 0 && delayed.start(of: 1) == 20.65,
    "A positive correction did not delay the lyrics")
  delayed.offsetMs = -7000
  try expect(
    delayed.position(at: 0).index == 0 && delayed.start(of: 0) == 0,
    "An earlier correction did not start the first line at the very beginning")
  let instrumental = try Lyrics.decode(["status": "instrumental", "lines": []])
  try expect(
    instrumental.status == .instrumental && instrumental.position(at: 30).index == nil,
    "Instrumental lyrics were not recognised")
  var failed = false
  do { _ = try Lyrics.decode(["status": "bogus"]) } catch { failed = true }
  try expect(failed, "An unknown lyrics status was accepted")
  let invalid = try Lyrics.decode([
    "status": "synced", "lines": [["startMs": -1, "endMs": 2, "text": "invalid"]],
    "text": "Fallback text", "offsetMs": Int.max, "durationDeltaMs": Int.min,
  ])
  try expect(
    invalid.status == .plain && invalid.offsetMs == 30000,
    "Malformed synced lyrics did not degrade to readable text")
  try expect(invalid.durationDeltaMs == -86_400_000, "Malformed duration gap was not bounded")
  try expect(
    lyrics.position(at: .nan).index == nil && lyrics.position(at: .infinity).index == nil,
    "An invalid clock sample reached lyric timing")
  try expect(
    lyrics.position(at: Double.greatestFiniteMagnitude).index == 2,
    "A large clock sample crashed the lyrics panel")
  try expect(
    lyrics.start(of: -1) == 0 && lyrics.start(of: 999) == 0,
    "A stale line selection crashed seeking")
  let duplicates = Lyrics(
    status: .synced,
    lines: [
      LyricsLine(startMs: 1000, endMs: 2000, text: "First"),
      LyricsLine(startMs: 1000, endMs: 2500, text: "Translation"),
      LyricsLine(startMs: 3000, endMs: 4000, text: "Next"),
    ])
  try expect(
    duplicates.lines.count == 2 && duplicates.lines[0].text == "First\nTranslation",
    "Simultaneous lyrics hid one of the lines")
  var exact = duplicates
  exact.offsetMs = 1234
  try expect(
    exact.start(of: 1) == 4.234 && exact.position(at: 4.234).index == 1,
    "Click target and displayed line use different offset conventions")
  try expect(
    Lyrics(status: .synced, lines: []).status == .missing,
    "Empty timed lyrics produced a blank synced panel")
  var clock = PlaybackClock()
  let start = Date(timeIntervalSince1970: 1000)
  clock.sample(42.25, playing: true, at: start)
  try expect(
    abs(clock.position(at: start.addingTimeInterval(0.1)) - 42.35) < 0.001,
    "Opening lyrics must use the player's current time")
  clock.setPlaying(false, at: start.addingTimeInterval(0.1))
  try expect(
    abs(clock.position(at: start.addingTimeInterval(5)) - 42.35) < 0.001,
    "Paused lyrics must not advance")
  clock.sample(6.18, playing: false, at: start.addingTimeInterval(6))
  try expect(lyrics.position(at: clock.position()).index == 0, "Backward seek did not reset lyrics")
  clock.setPlaying(true, at: start.addingTimeInterval(7))
  try expect(
    clock.position(at: start.addingTimeInterval(20)) == 6.68,
    "A stalled player must not advance the lyrics indefinitely")
  print("Lyrics checks passed: order, interpolation, gaps, corrections, statuses")
}
