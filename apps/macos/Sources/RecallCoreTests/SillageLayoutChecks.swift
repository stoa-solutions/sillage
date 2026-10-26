import Foundation
import RecallKit

/// Sillage UI spec: Compact near 520 × 224, panel capped at 560, reading windows near
/// 1080 × 760, frames always inside the usable screen. Palette text roles reach 4.5:1.
func sillageLayoutChecks() throws {
  let screen = LayoutRect(x: 0, y: 0, width: 1512, height: 944)
  let reading = LayoutRect(x: 100, y: 84, width: 1080, height: 760)

  // Back to Compact from a reading window: pocket width, content height, top edge kept.
  let rest = RecallWindowLayout.compactFrame(
    from: reading, rememberedWidth: nil, restHeight: 224, panelOpen: false, visible: screen)
  try expect(
    rest.width == 520 && rest.height == 224 && rest.maxY == reading.maxY && rest.x == 100,
    "Compact did not return to its pocket size under the same top edge: \(rest)")
  let open = RecallWindowLayout.compactFrame(
    from: rest, rememberedWidth: 560, restHeight: 224, panelOpen: true, visible: screen)
  try expect(
    open.height == 560 && open.width == 560 && open.maxY == rest.maxY,
    "Opening the panel did not grow to its ceiling from the top edge: \(open)")
  let wide = RecallWindowLayout.compactFrame(
    from: rest, rememberedWidth: 900, restHeight: 224, panelOpen: false, visible: screen)
  try expect(wide.width == 620, "Compact grew past its maximum width")
  // Ten folds and reopenings never drift.
  var frame = rest
  for _ in 0..<10 {
    frame = RecallWindowLayout.compactFrame(
      from: frame, rememberedWidth: 520, restHeight: 224, panelOpen: true, visible: screen)
    frame = RecallWindowLayout.compactFrame(
      from: frame, rememberedWidth: 520, restHeight: 224, panelOpen: false, visible: screen)
  }
  try expect(frame == rest, "Folding the panel ten times moved the window: \(frame)")

  // Near the bottom edge of a small screen: the open panel stays reachable.
  let small = LayoutRect(x: 1512, y: 0, width: 1280, height: 500)
  let low = LayoutRect(x: 1600, y: 10, width: 520, height: 224)
  let fitted = RecallWindowLayout.compactFrame(
    from: low, rememberedWidth: 520, restHeight: 224, panelOpen: true, visible: small)
  try expect(
    fitted.height == 500 && fitted.y >= small.y && fitted.maxY <= small.maxY
      && fitted.x >= small.x && fitted.maxX <= small.maxX,
    "Open panel left the usable screen: \(fitted)")

  // A pocket parked near the bottom: opening pushes the window up, folding returns it home.
  let parked = LayoutRect(x: 200, y: 10, width: 520, height: 224)
  let lifted = RecallWindowLayout.compactFrame(
    from: parked, rememberedWidth: 520, restHeight: 224, panelOpen: true, visible: screen,
    anchorTop: parked.maxY)
  let home = RecallWindowLayout.compactFrame(
    from: lifted, rememberedWidth: 520, restHeight: 224, panelOpen: false, visible: screen,
    anchorTop: parked.maxY)
  try expect(
    lifted.y == 0 && home == parked, "Folding near the bottom edge left the pocket raised: \(home)")

  // Reading pages: preferred size first, then the size the person chose; always on screen.
  let first = RecallWindowLayout.readingFrame(from: rest, rememberedSize: nil, visible: screen)
  try expect(
    first.width == 1080 && first.height == 760 && first.maxY == rest.maxY && first.x == rest.x,
    "Reading window did not open at its preferred size from the Compact top edge: \(first)")
  // The chosen size comes back where the window is now, not where it was resized.
  let restored = RecallWindowLayout.readingFrame(
    from: rest, rememberedSize: (1300, 820), visible: screen)
  try expect(
    restored.width == 1300 && restored.height == 820 && restored.x == rest.x
      && restored.maxY == rest.maxY,
    "Reading window forgot the chosen size or jumped to an old place: \(restored)")
  let laptop = LayoutRect(x: 0, y: 0, width: 1024, height: 640)
  let squeezed = RecallWindowLayout.readingFrame(from: rest, rememberedSize: nil, visible: laptop)
  try expect(
    squeezed.width == 1024 && squeezed.height == 640 && squeezed.x == 0 && squeezed.y == 0,
    "Reading window grew past a small screen: \(squeezed)")
  try expect(
    RecallWindowLayout.needsReadingSize(LayoutRect(x: 0, y: 0, width: 760, height: 572))
      && !RecallWindowLayout.needsReadingSize(reading),
    "A pocket-sized window restored on a reading page would stay without its sidebar")
  try expect(
    RecallWindowLayout.minimumWidth(studio: false, reading: false) <= 520
      && RecallWindowLayout.minimumHeight(studio: false, reading: false) <= 224
      && RecallWindowLayout.minimumWidth(studio: false, reading: true) <= 1080,
    "A global minimum still exceeds the pocket or reading targets")

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
  print(
    "Sillage layout checks passed: pocket, panel ceiling, drift, screen edges, reading size, contrast"
  )
}
