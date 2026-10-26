import AppKit
import RecallKit
import SwiftUI

// Sillage appearance (docs/design.md, Sillage UI spec): the system chooses light or dark;
// both show the same content in the same places. Colours come from SillagePalette only.

extension Color {
  /// A palette role that follows the window's appearance, including automatic switches.
  static func sillage(_ role: SillageRole) -> Color {
    Color(
      nsColor: NSColor(name: nil) { appearance in
        let dark = appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
        let (red, green, blue) = SillagePalette.components(
          SillagePalette(dark ? .dark : .light)[role])
        return NSColor(srgbRed: red, green: green, blue: blue, alpha: 1)
      })
  }
  /// Hover and pressed tints that read on paper and on graphite alike.
  static let sillageHover = Color.primary.opacity(0.06)
  static let sillagePressed = Color.primary.opacity(0.1)
  /// The selected capsule of a neutral control: white on paper, chalk on graphite, ink text.
  static let sillageSelectedFill = Color(
    nsColor: NSColor(name: nil) { appearance in
      appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
        ? NSColor(srgbRed: 0xF5 / 255, green: 0xF3 / 255, blue: 0xEE / 255, alpha: 1) : .white
    })
}

/// Materials of the three layers: the frame (navigation, player bar), the sidebar and the
/// reading surface. Starting alpha values from the spec, tuned on the rendered window.
enum SillageLayer {
  case chrome, sidebar, reading
  var veil: Double {
    switch self {
    case .chrome: 0.4
    case .sidebar: 0.46
    case .reading: 0.54
    }
  }
}

struct SillageSurface: ViewModifier {
  let layer: SillageLayer
  @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
  @Environment(\.colorSchemeContrast) private var contrast
  func body(content: Content) -> some View {
    content.background {
      if reduceTransparency {
        Color.sillage(.reading)
      } else {
        ZStack {
          Rectangle().fill(layer == .reading ? .thinMaterial : .ultraThinMaterial)
          Color.sillage(layer == .sidebar ? .canvas : .reading)
            .opacity(contrast == .increased ? min(1, layer.veil + 0.08) : layer.veil)
        }
      }
    }
  }
}

extension View {
  func sillageSurface(_ layer: SillageLayer) -> some View { modifier(SillageSurface(layer: layer)) }
}

/// A thin rule between surfaces; stronger with Increase Contrast.
struct SillageRule: View {
  var vertical = false
  @Environment(\.colorSchemeContrast) private var contrast
  var body: some View {
    Color.sillage(.separator).opacity(contrast == .increased ? 1 : 0.7)
      .frame(width: vertical ? 1 : nil, height: vertical ? nil : 1)
      .accessibilityHidden(true)
  }
}

/// The Stoa image chosen in Apparence, still and softened behind every reading surface.
/// Never moves, never takes clicks or focus; Reduce Transparency keeps only the canvas.
struct SillageBackdrop: View {
  @ObservedObject private var appearance = AppearanceModel.shared
  @Environment(\.colorScheme) private var scheme
  @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
  var body: some View {
    GeometryReader { geometry in
      ZStack {
        Color.sillage(.canvas)
        if !reduceTransparency, let image = appearance.image {
          Image(nsImage: image).resizable().scaledToFill()
            .frame(width: geometry.size.width, height: geometry.size.height).clipped()
            .blur(radius: 14).opacity(scheme == .dark ? 0.8 : 0.95)
          Color.sillage(.canvas).opacity(scheme == .dark ? 0.2 : 0.08)
        }
      }
    }
    .ignoresSafeArea().allowsHitTesting(false).accessibilityHidden(true)
  }
}

/// Neutral capsule chip: white (or chalk) with ink text when selected, a quiet tint otherwise.
/// Selection also shows as a trait and a checkmark-free weight change, never by colour alone.
struct SillageChipStyle: ButtonStyle {
  var selected = false
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(.callout.weight(selected ? .semibold : .medium))
      .foregroundStyle(selected ? Color.sillage(.primaryIcon) : Color.primary.opacity(0.85))
      .padding(.horizontal, 12).padding(.vertical, 5)
      .background {
        Capsule().fill(
          selected
            ? Color.sillageSelectedFill
            : (configuration.isPressed ? Color.sillagePressed : Color.sillageHover)
        )
        .shadow(color: .black.opacity(selected ? 0.12 : 0), radius: 2, y: 1)
      }
      .contentShape(Capsule())
  }
}
