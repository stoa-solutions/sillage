/// A window frame in screen points, origin at the bottom left as AppKit reports it.
public struct LayoutRect: Equatable, Sendable, CustomStringConvertible {
  public var x: Double
  public var y: Double
  public var width: Double
  public var height: Double
  public init(x: Double, y: Double, width: Double, height: Double) {
    self.x = x
    self.y = y
    self.width = width
    self.height = height
  }
  public var maxX: Double { x + width }
  public var maxY: Double { y + height }
  public var description: String { "(\(x), \(y), \(width) × \(height))" }
}

/// Window sizes per presentation (Sillage UI spec): Compact sized to its content near
/// 520 × 224 with a 560 pt ceiling when its panel opens, reading pages near 1080 × 760.
/// Pure geometry, shared by the scene and the automated layout checks; AppKit only applies it.
public enum RecallWindowLayout {
  public static let compactRestWidth = 520.0
  public static let compactMinimumWidth = 440.0
  public static let compactMaximumWidth = 620.0
  public static let compactPanelCeiling = 560.0
  public static let readingPreferredWidth = 1080.0
  public static let readingPreferredHeight = 760.0

  /// Below this, reading pages fold their sidebar; a window restored smaller than this (or
  /// lower than 600) at launch on a reading page gets the reading size back.
  public static let readingComfortWidth = 900.0
  public static func needsReadingSize(_ frame: LayoutRect) -> Bool {
    frame.width < readingComfortWidth || frame.height < 600
  }

  /// Content minimums only protect the controls; the presentation sets the real size.
  public static func minimumWidth(studio: Bool, reading: Bool) -> Double {
    studio || reading ? 760 : compactMinimumWidth
  }
  public static func minimumHeight(studio: Bool, reading: Bool) -> Double {
    studio || reading ? 520 : 120
  }

  /// Compact keeps its top edge: the window grows or shrinks downwards with the panel.
  /// `anchorTop` is where the pocket's top edge was before the panel had to push the window
  /// away from the screen's bottom, so folding brings the pocket back home.
  public static func compactFrame(
    from current: LayoutRect, rememberedWidth: Double?, restHeight: Double, panelOpen: Bool,
    visible: LayoutRect, anchorTop: Double? = nil
  ) -> LayoutRect {
    let width = min(
      max(rememberedWidth ?? compactRestWidth, compactMinimumWidth), compactMaximumWidth)
    let height = panelOpen ? max(compactPanelCeiling, restHeight) : restHeight
    let top = anchorTop ?? current.maxY
    let frame = LayoutRect(x: current.x, y: top - height, width: width, height: height)
    return constrain(frame, to: visible)
  }

  /// The size the person last chose for reading pages, else the preferred one, opened from
  /// where the window is now (same left and top edges).
  public static func readingFrame(
    from current: LayoutRect, rememberedSize: (width: Double, height: Double)?,
    visible: LayoutRect
  ) -> LayoutRect {
    let width = rememberedSize?.width ?? readingPreferredWidth
    let height = rememberedSize?.height ?? readingPreferredHeight
    let frame = LayoutRect(x: current.x, y: current.maxY - height, width: width, height: height)
    return constrain(frame, to: visible)
  }

  /// Never larger than the usable screen, never partly outside it.
  public static func constrain(_ frame: LayoutRect, to visible: LayoutRect) -> LayoutRect {
    let width = min(frame.width, visible.width)
    let height = min(frame.height, visible.height)
    return LayoutRect(
      x: min(max(frame.x, visible.x), visible.maxX - width),
      y: min(max(frame.y, visible.y), visible.maxY - height), width: width, height: height)
  }
}
