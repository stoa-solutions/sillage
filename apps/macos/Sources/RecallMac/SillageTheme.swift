import AppKit
import CoreImage
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
  /// Selected row on glass: the palette's selection (text contrast checked), nearly opaque.
  static let sillageSelectionGlass = Color.sillage(.selection).opacity(0.92)
  /// The selected capsule of a neutral control: white on paper, chalk on graphite, ink text.
  private static let chalk: NSColor = {
    let (red, green, blue) = SillagePalette.components(SillagePalette.chalk)
    return NSColor(srgbRed: red, green: green, blue: blue, alpha: 1)
  }()
  static let sillageSelectedFill = Color(
    nsColor: NSColor(name: nil) { appearance in
      appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
        ? chalk : .white
    })
}

/// Recette only: a test build can render the glass on a Mac where Reduce Transparency is on
/// (`SILLAGE_QA_TRANSPARENCY=1`). The app itself always follows the system setting.
private let qaForcesTransparency =
  ProcessInfo.processInfo.environment["SILLAGE_QA_TRANSPARENCY"] == "1"
func sillageOpaque(_ reduceTransparency: Bool) -> Bool {
  reduceTransparency && !qaForcesTransparency
}

/// The three layers of the Atelier glass: the frame (toolbar zone, player bar), the
/// sidebar and the reading surface. Each is a translucent veil of paper or graphite over the
/// blurred Stoa light, so the orange glows through without carrying any text itself.
/// Veils keep secondary text ≥ 4.5:1 even over the orange (graphite 0.7 on Stoa orange).
enum SillageLayer {
  case chrome, sidebar, reading
  func veil(dark: Bool) -> Double {
    switch (self, dark) {
    case (.chrome, true), (.sidebar, true): 0.74
    case (.reading, true): 0.86
    case (.chrome, false), (.sidebar, false): 0.76
    case (.reading, false): 0.88
    }
  }
  var role: SillageRole { self == .reading ? .reading : .canvas }
}

struct SillageSurface: ViewModifier {
  let layer: SillageLayer
  @Environment(\.colorScheme) private var scheme
  @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
  @Environment(\.colorSchemeContrast) private var contrast
  func body(content: Content) -> some View {
    let dark = scheme == .dark
    content.background {
      if sillageOpaque(reduceTransparency) {
        Color.sillage(layer.role)
      } else {
        ZStack(alignment: .top) {
          Color.sillage(layer.role)
            .opacity(min(1, layer.veil(dark: dark) + (contrast == .increased ? 0.18 : 0)))
          // A faint top light, as on architectural glass.
          LinearGradient(
            colors: [.white.opacity(dark ? 0.05 : 0.25), .clear], startPoint: .top,
            endPoint: .init(x: 0.5, y: 0.25))
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

/// The Stoa light behind every reading surface: the image chosen in Apparence, heavily
/// diffused, with the warm glow of the sculpture rising from the lower right. Still: no
/// motion, no clicks, no focus. Reduce Transparency keeps only the canvas.
struct SillageBackdrop: View {
  @ObservedObject private var appearance = AppearanceModel.shared
  @Environment(\.colorScheme) private var scheme
  @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
  var body: some View {
    let dark = scheme == .dark
    GeometryReader { geometry in
      ZStack {
        Color.sillage(.canvas)
        if !sillageOpaque(reduceTransparency) {
          if let image = appearance.image, let light = SillageLight.prepared(image, dark: dark) {
            // Blurred and warmed once per image, so resizing only rescales a bitmap.
            Image(nsImage: light).resizable().scaledToFill()
              .frame(width: geometry.size.width, height: geometry.size.height).clipped()
              .opacity(dark ? 0.85 : 1)
          }
          RadialGradient(
            colors: [Color.sillage(.primaryFill).opacity(dark ? 0.6 : 0.45), .clear],
            center: .bottomTrailing, startRadius: 0,
            endRadius: max(geometry.size.width, geometry.size.height) * 0.75)
          Color.sillage(.canvas).opacity(dark ? 0.3 : 0.06)
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
      .font(.system(size: 13, weight: selected ? .semibold : .medium))
      .foregroundStyle(selected ? Color.sillage(.primaryIcon) : Color.primary.opacity(0.85))
      .padding(.horizontal, 13).padding(.vertical, 6)
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

/// The Stoa light, prepared once: the chosen image reduced, diffused and warmed (its white
/// walls take the orange), then cached per image and appearance.
@MainActor enum SillageLight {
  private static var cache: [String: NSImage] = [:]
  static func prepared(_ image: NSImage, dark: Bool) -> NSImage? {
    let key = "\(ObjectIdentifier(image).hashValue)-\(dark)"
    if let cached = cache[key] { return cached }
    guard let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { return nil }
    let scale = min(1, 640 / Double(cg.width))
    var output = CIImage(cgImage: cg).transformed(by: .init(scaleX: scale, y: scale))
    let extent = output.extent
    output = output.clampedToExtent().applyingGaussianBlur(sigma: 18).cropped(to: extent)
    let tint: (red: Double, green: Double, blue: Double) = dark ? (1, 0.72, 0.58) : (1, 0.9, 0.84)
    output = output.applyingFilter(
      "CIColorMatrix",
      parameters: [
        "inputRVector": CIVector(x: tint.red, y: 0, z: 0, w: 0),
        "inputGVector": CIVector(x: 0, y: tint.green, z: 0, w: 0),
        "inputBVector": CIVector(x: 0, y: 0, z: tint.blue, w: 0),
      ]
    ).applyingFilter("CIColorControls", parameters: [kCIInputSaturationKey: 1.12])
    guard let rendered = CIContext().createCGImage(output, from: extent) else { return nil }
    let result = NSImage(
      cgImage: rendered, size: NSSize(width: extent.width, height: extent.height))
    // One entry per appearance: a newly chosen image replaces the previous one.
    cache = cache.filter { !$0.key.hasSuffix("-\(dark)") }
    cache[key] = result
    return result
  }
}
