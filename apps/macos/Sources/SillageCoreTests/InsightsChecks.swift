import Foundation
import SillageKit

@MainActor
func insightsChecks() async throws {
  // The lead artist opens the page; « & » is one act.
  let leads: [(String, String?, String?)] = [
    ("Kaytranada, H.E.R. - Intimidated", nil, "Kaytranada"),
    ("Pahua feat. Barzo - Cactus", nil, "Pahua"),
    ("Simon & Garfunkel - The Boxer", nil, "Simon & Garfunkel"),
    ("Self Care", "Mac Miller - Topic", "Mac Miller"),
    ("(Official Video)", nil, nil),
  ]
  for (title, channel, lead) in leads {
    let found = TrackTitle(title: title, channel: channel).leadArtist
    try expect(found == lead, "Lead artist of \"\(title)\" read as \(found ?? "nobody")")
  }

  // Quality says what it knows, never more.
  let clip = StreamQuality(
    origin: .clip, height: 1080, frameRate: 29.97, videoCodec: "H.264", audioCodec: "AAC",
    audioKbps: 128, sampleRate: 44_100, channels: 2)
  try expect(clip.summary == "1080p · AAC 128 kb/s", "Clip summary: \(clip.summary)")
  try expect(
    clip.audioDetail == "AAC · 128 kb/s · 44,1 kHz · stéréo", "Audio detail: \(clip.audioDetail ?? "")")
  try expect(clip.videoDetail == "1080p · H.264 · 30 i/s", "Video detail: \(clip.videoDetail ?? "")")
  try expect(
    StreamQuality.youtube("hd720")?.summary == "720p · audio YouTube", "YouTube 720p summary")
  try expect(StreamQuality.youtube("hd2160")?.resolution == "4K", "YouTube 4K label")
  try expect(StreamQuality.youtube("unknown") == nil, "Unknown YouTube quality shown")
  try expect(StreamQuality.codecName(0x6176_3031) == "AV1", "av01 codec name")
  try expect(compactCount(1_831_427_477) == "1,8 Md", "Count \(compactCount(1_831_427_477))")
  try expect(compactCount(12_400) == "12 k", "Count \(compactCount(12_400))")
  try expect(compactCount(950) == "950", "Small count")

  // One request per artist, shared; a failure can be retried; an account change starts over.
  let a = try Connection(url: "https://sillage.example.com", token: String(repeating: "a", count: 32))
  let json = #"""
    {"name":"Phoenix","description":"groupe de pop rock français","bio":{"text":"Phoenix est un groupe de pop rock français. Il est formé à Versailles en 1995. Le groupe connaît un succès international.","source":"Wikipedia","url":"https://fr.wikipedia.org/wiki/Phoenix_(groupe)"},"banner":null,"portrait":null,"photo":null,"audience":"7,26 M auditeurs/mois","kind":"Groupe","origin":"Versailles, France","active":"Depuis 1995","genres":["indie pop"],"releases":[],"related":[{"name":"Air","portrait":null}],"links":{"youtubeMusic":null,"wikipedia":null,"musicbrainz":null},"found":true}
    """#
  let profile = try JSONDecoder().decode(ArtistProfile.self, from: Data(json.utf8))
  try expect(profile.facts == "Groupe · Versailles, France · Depuis 1995", "Facts: \(profile.facts)")
  try expect(
    profile.teaser == "Phoenix est un groupe de pop rock français. Il est formé à Versailles en 1995.",
    "Teaser: \(profile.teaser ?? "")")
  var asked: [String] = []
  var failing = true
  let model = InsightsModel(
    fetchArtist: { _, name in
      asked.append(name)
      if failing { throw SillageError.message("down") }
      return profile
    },
    fetchVideo: { _, _, _, _ in throw SillageError.message("unused") })
  model.loadArtist("Phoenix", connection: a)
  model.loadArtist("phoenix", connection: a)
  for _ in 0..<20 where model.loading(artist: "Phoenix") { await Task.yield() }
  try expect(asked == ["Phoenix"], "Artist asked \(asked.count) times")
  try expect(model.didFail(artist: "Phoenix"), "Failure not remembered")
  model.loadArtist("Phoenix", connection: a)
  try expect(asked.count == 1, "A failed artist retried without asking")
  failing = false
  model.loadArtist("Phoenix", connection: a, retry: true)
  for _ in 0..<20 where model.loading(artist: "Phoenix") { await Task.yield() }
  try expect(model.artist("PHOENIX")?.name == "Phoenix", "Artist not kept across spellings")
  let album = try JSONDecoder().decode(
    Album.self,
    from: Data(
      #"{"browseId":"MPREb_U72FqcwqU1Q","title":"Bankrupt!","artist":"Phoenix","kind":"Album","year":"2013","summary":null,"description":null,"artwork":null,"tracks":[{"videoId":"tBsRvthVhdw","title":"Entertainment","position":1,"durationSeconds":220,"plays":null,"inLibrary":false}]}"#
        .utf8))
  let first = album.track(album.tracks[0])
  try expect(
    TrackTitle(first).artist == "Phoenix" && first.durationSeconds == 220,
    "Album track credited to \(TrackTitle(first).artist ?? "nobody")")
  print("Insights checks passed: lead artist, quality, counts, shared artist pages, albums")
}
