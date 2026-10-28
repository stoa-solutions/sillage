import Foundation
import SillageKit

/// Sillage UI spec: Compact near 520 × 224, panel capped at 560, reading windows near
/// 1080 × 760, frames always inside the usable screen. Palette text roles reach 4.5:1.
func sillageLayoutChecks() throws {
  let screen = LayoutRect(x: 0, y: 0, width: 1512, height: 944)
  let reading = LayoutRect(x: 100, y: 84, width: 1080, height: 760)

  // Back to Compact from a reading window: pocket width, content height, top edge kept.
  let rest = SillageWindowLayout.compactFrame(
    from: reading, rememberedWidth: nil, restHeight: 224, panelOpen: false, visible: screen)
  try expect(
    rest.width == 520 && rest.height == 224 && rest.maxY == reading.maxY && rest.x == 100,
    "Compact did not return to its pocket size under the same top edge: \(rest)")
  let open = SillageWindowLayout.compactFrame(
    from: rest, rememberedWidth: 560, restHeight: 224, panelOpen: true, visible: screen)
  try expect(
    open.height == 560 && open.width == 560 && open.maxY == rest.maxY,
    "Opening the panel did not grow to its ceiling from the top edge: \(open)")
  let wide = SillageWindowLayout.compactFrame(
    from: rest, rememberedWidth: 900, restHeight: 224, panelOpen: false, visible: screen)
  try expect(wide.width == 620, "Compact grew past its maximum width")
  // Ten folds and reopenings never drift.
  var frame = rest
  for _ in 0..<10 {
    frame = SillageWindowLayout.compactFrame(
      from: frame, rememberedWidth: 520, restHeight: 224, panelOpen: true, visible: screen)
    frame = SillageWindowLayout.compactFrame(
      from: frame, rememberedWidth: 520, restHeight: 224, panelOpen: false, visible: screen)
  }
  try expect(frame == rest, "Folding the panel ten times moved the window: \(frame)")

  // Near the bottom edge of a small screen: the open panel stays reachable.
  let small = LayoutRect(x: 1512, y: 0, width: 1280, height: 500)
  let low = LayoutRect(x: 1600, y: 10, width: 520, height: 224)
  let fitted = SillageWindowLayout.compactFrame(
    from: low, rememberedWidth: 520, restHeight: 224, panelOpen: true, visible: small)
  try expect(
    fitted.height == 500 && fitted.y >= small.y && fitted.maxY <= small.maxY
      && fitted.x >= small.x && fitted.maxX <= small.maxX,
    "Open panel left the usable screen: \(fitted)")

  // A pocket parked near the bottom: opening pushes the window up, folding returns it home.
  let parked = LayoutRect(x: 200, y: 10, width: 520, height: 224)
  let lifted = SillageWindowLayout.compactFrame(
    from: parked, rememberedWidth: 520, restHeight: 224, panelOpen: true, visible: screen,
    anchorTop: parked.maxY)
  let home = SillageWindowLayout.compactFrame(
    from: lifted, rememberedWidth: 520, restHeight: 224, panelOpen: false, visible: screen,
    anchorTop: parked.maxY)
  try expect(
    lifted.y == 0 && home == parked, "Folding near the bottom edge left the pocket raised: \(home)")

  // Reading pages: preferred size first, then the size the person chose; always on screen.
  let first = SillageWindowLayout.readingFrame(from: rest, rememberedSize: nil, visible: screen)
  try expect(
    first.width == 1080 && first.height == 760 && first.maxY == rest.maxY && first.x == rest.x,
    "Reading window did not open at its preferred size from the Compact top edge: \(first)")
  // The chosen size comes back where the window is now, not where it was resized.
  let restored = SillageWindowLayout.readingFrame(
    from: rest, rememberedSize: (1300, 820), visible: screen)
  try expect(
    restored.width == 1300 && restored.height == 820 && restored.x == rest.x
      && restored.maxY == rest.maxY,
    "Reading window forgot the chosen size or jumped to an old place: \(restored)")
  let laptop = LayoutRect(x: 0, y: 0, width: 1024, height: 640)
  let squeezed = SillageWindowLayout.readingFrame(from: rest, rememberedSize: nil, visible: laptop)
  try expect(
    squeezed.width == 1024 && squeezed.height == 640 && squeezed.x == 0 && squeezed.y == 0,
    "Reading window grew past a small screen: \(squeezed)")
  try expect(
    SillageWindowLayout.needsReadingSize(LayoutRect(x: 0, y: 0, width: 760, height: 572))
      && !SillageWindowLayout.needsReadingSize(reading),
    "A pocket-sized window restored on a reading page would stay without its sidebar")
  try expect(
    SillageWindowLayout.minimumWidth(studio: false, reading: false) <= 520
      && SillageWindowLayout.minimumHeight(studio: false, reading: false) <= 224
      && SillageWindowLayout.minimumWidth(studio: false, reading: true) <= 1080,
    "A global minimum still exceeds the pocket or reading targets")
  // Compact: resizing never cuts the pocket, nor an open panel below its controls, and the
  // open minimum stays within the panel's default height.
  let folded = SillageWindowLayout.compactMinimumHeight(restHeight: 224, panelOpen: false)
  let opened = SillageWindowLayout.compactMinimumHeight(restHeight: 224, panelOpen: true)
  try expect(
    folded == 224 && opened == 224 + SillageWindowLayout.compactPanelMinimum
      && opened <= max(SillageWindowLayout.compactPanelCeiling, 224 + 260)
      && SillageWindowLayout.compactMinimumHeight(restHeight: 0, panelOpen: false) == 120,
    "Compact can be resized below its pocket or open panel: \(folded), \(opened)")

  // Palette: one source for colour roles; small text stays readable in both appearances.
  for appearance in [SillageAppearance.light, .dark] {
    let palette = SillagePalette(appearance)
    for role in [SillageRole.text, .secondaryText, .actionText] {
      for surface in [SillageRole.reading, .canvas] {
        let ratio = SillagePalette.contrast(palette[role], palette[surface])
        try expect(
          ratio >= 4.5, "\(role) on \(surface) in \(appearance) is only \(ratio):1")
      }
    }
    try expect(
      SillagePalette.contrast(palette[.primaryIcon], palette[.primaryFill]) >= 4.5,
      "Icon on the orange button is unreadable in \(appearance)")
    for role in [SillageRole.text, .secondaryText, .actionText] {
      let ratio = SillagePalette.contrast(palette[role], palette[.selection])
      try expect(ratio >= 4.5, "\(role) on a selected row in \(appearance) is only \(ratio):1")
    }
    try expect(
      SillagePalette.contrast(palette[.focus], palette[.reading]) >= 3,
      "Focus indication is too faint in \(appearance)")
  }
  let graphite = SillagePalette(.dark)
  try expect(
    graphite[.actionText] != SillagePalette.orange
      && abs(SillagePalette.contrast(SillagePalette.orange, graphite[.reading]) - 4.442) < 0.01,
    "Orange small text on graphite would fail 4.5:1 (spec measures 4.442:1)")
  for failure in [
    URLError(.notConnectedToInternet) as Error, URLError(.cannotFindHost),
    NSError(domain: NSPOSIXErrorDomain, code: 1),
  ] {
    let message = HTTPClient.transportError(failure).localizedDescription
    try expect(
      message.hasPrefix("Connexion au serveur impossible"),
      "A network failure would show a system message: \(message)")
  }
  try expect(
    (HTTPClient.transportError(URLError(.cancelled)) as? URLError)?.code == .cancelled,
    "Cancelled requests must stay recognisable")
  try expect(
    SillagePalette.contrast(SillagePalette(.dark)[.playingText], SillagePalette(.dark)[.reading])
      > 4.4
      && SillagePalette.contrast(
        SillagePalette(.light)[.playingText], SillagePalette(.light)[.reading]) >= 4.5,
    "Playing title colour drifted from the board")
  print(
    "Sillage layout checks passed: pocket, panel ceiling, drift, screen edges, reading size, contrast"
  )
}
