import Foundation

/// Sillage colour roles from the UI spec, one source for the app (UI-09). Values are sRGB.
public enum SillageAppearance: Sendable { case light, dark }

public enum SillageRole: CaseIterable, Sendable {
  /// Window background behind the materials.
  case canvas
  /// Opaque reading surface; materials fall back to it with Reduce Transparency.
  case reading
  case text, secondaryText
  /// Small action text: deep orange on paper, chalk on graphite (orange there is 4.44:1).
  case actionText
  case focus
  /// The main button: Stoa orange with an ink pictogram in both appearances.
  case primaryFill, primaryIcon
  case selection, separator
}

public struct SillagePalette: Sendable {
  public static let orange: UInt32 = 0xF15A24
  public static let deepOrange: UInt32 = 0xBD3B12
  public static let ink: UInt32 = 0x20201E
  public static let chalk: UInt32 = 0xF5F3EE
  public static let paper: UInt32 = 0xFAF9F6
  public static let graphite: UInt32 = 0x272724

  public let appearance: SillageAppearance
  public init(_ appearance: SillageAppearance) { self.appearance = appearance }

  public subscript(role: SillageRole) -> UInt32 {
    switch (appearance, role) {
    case (.light, .canvas): Self.chalk
    case (.light, .reading): Self.paper
    case (.light, .text): Self.ink
    case (.light, .secondaryText): 0x62625C
    case (.light, .actionText), (.light, .focus): Self.deepOrange
    case (.light, .selection): 0xE7E3DA
    case (.light, .separator): 0xDAD7D0
    case (.dark, .canvas): Self.ink
    case (.dark, .reading): Self.graphite
    case (.dark, .text), (.dark, .actionText): Self.chalk
    case (.dark, .secondaryText): 0xB6B3AC
    case (.dark, .focus): Self.orange
    case (.dark, .selection): 0x373732
    case (.dark, .separator): 0x484843
    case (_, .primaryFill): Self.orange
    case (_, .primaryIcon): Self.ink
    }
  }

  /// WCAG 2 contrast ratio between two opaque sRGB colours.
  public static func contrast(_ first: UInt32, _ second: UInt32) -> Double {
    let (a, b) = (luminance(first), luminance(second))
    return (max(a, b) + 0.05) / (min(a, b) + 0.05)
  }

  public static func components(_ hex: UInt32) -> (red: Double, green: Double, blue: Double) {
    (Double(hex >> 16 & 0xFF) / 255, Double(hex >> 8 & 0xFF) / 255, Double(hex & 0xFF) / 255)
  }

  private static func luminance(_ hex: UInt32) -> Double {
    func linear(_ value: Double) -> Double {
      value <= 0.04045 ? value / 12.92 : pow((value + 0.055) / 1.055, 2.4)
    }
    let (red, green, blue) = components(hex)
    return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue)
  }
}
