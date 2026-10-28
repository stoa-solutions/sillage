import SillageKit

func trackTitleChecks() throws {
  let cases: [(String, String?, String, String?)] = [
    ("Midnight Oil - Beds Are Burning", "MidnightOilVEVO", "Beds Are Burning", "Midnight Oil"),
    ("Self Care", "Mac Miller - Topic", "Self Care", "Mac Miller"),
    ("KeBlack - Bazardée (Clip Officiel)", "KeBlackOfficiel", "Bazardée", "KeBlack"),
    ("King Krule — Rock Bottom [Official Video]", "Rinse FM", "Rock Bottom", "King Krule"),
    (
      "Dexter and The Moonrocks - Freakin’ Out (Official Music Video)", "DexterMoonrocksVEVO",
      "Freakin’ Out", "Dexter and The Moonrocks"
    ),
    ("Mk.gee - Fool [Full EP]", "Nice Guys", "Fool [Full EP]", "Mk.gee"),
    (
      "Girls That Dance (feat. Kaytranada)", "Channel Tres", "Girls That Dance (feat. Kaytranada)",
      "Channel Tres"
    ),
    ("(Official Video)", nil, "(Official Video)", nil),
    (
      "Masego Symone (Live Performance) | Open Mic", "Genius",
      "Masego Symone (Live Performance) | Open Mic", "Genius"
    ),
  ]
  for (title, channel, song, artist) in cases {
    let parsed = TrackTitle(title: title, channel: channel)
    try expect(
      parsed.title == song && parsed.artist == artist,
      "Track title \"\(title)\" read as \"\(parsed.title)\" by \(parsed.artist ?? "nobody")")
  }
  try expect(
    TrackTitle(
      title: "Midnight Oil - Beds Are Burning (Official Video)", channel: "MidnightOilVEVO"
    ).announcement == "On continue avec Beds Are Burning, de Midnight Oil.",
    "Announcement kept upload decorations")
  print("Track title checks passed: \(cases.count) YouTube titles")
}
