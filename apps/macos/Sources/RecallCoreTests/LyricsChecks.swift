import RecallKit

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
  print("Lyrics checks passed: order, interpolation, gaps, corrections, statuses")
}
