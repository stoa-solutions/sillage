import RecallKit
import SwiftUI

/// Reading pages use a stable dark surface; only the DJ stage is immersive.
/// Context is inherited by panels, including the shared DJ chat and mini-player.
enum Surface { case standard, immersive, reading }

private struct SurfaceKey: EnvironmentKey { static let defaultValue = Surface.standard }
extension EnvironmentValues {
  var surface: Surface {
    get { self[SurfaceKey.self] }
    set { self[SurfaceKey.self] = newValue }
  }
}

struct GlassPanel: ViewModifier {
  @Environment(\.surface) private var surface
  @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
  var radius: CGFloat = 20

  func body(content: Content) -> some View {
    let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
    content.background {
      switch surface {
      case .standard:
        shape.fill(.background.secondary)
          .overlay(shape.strokeBorder(.separator.opacity(0.5)))
      case .reading:
        // An explicit fill keeps text contrast independent of the clip's brightness.
        shape.fill(Color(white: 0.075).opacity(reduceTransparency ? 1 : 0.94))
          .overlay(shape.strokeBorder(.white.opacity(0.09)))
      case .immersive:
        if reduceTransparency {
          shape.fill(Color(white: 0.075))
        } else {
          shape.fill(.black.opacity(0.35))
            .background(.ultraThinMaterial.opacity(0.5), in: shape)
            .overlay(shape.strokeBorder(.white.opacity(0.1)))
        }
      }
    }.clipShape(shape)
  }
}
extension View {
  func glassPanel(radius: CGFloat = 20) -> some View { modifier(GlassPanel(radius: radius)) }
}

/// The clip keeps playing across navigation; its presentation follows the page context.
struct StageBackground: View {
  @ObservedObject var player: Player
  let current: Track?
  @Environment(\.surface) private var surface
  @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  private var immersive: Bool { surface == .immersive }

  var body: some View {
    ZStack {
      Color.black
      if immersive || !reduceTransparency {
        if player.studioReady {
          StudioPlayerView(player: player.nativePlayer)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .blur(radius: immersive ? 0 : 16).clipped()
        } else if let current {
          Artwork.image(for: current, quality: "hqdefault").blur(radius: 40)
            .opacity(immersive && player.preparingStudio ? 1 : 0.55).clipped()
        }
      }
      if immersive {
        LinearGradient(
          colors: [.clear, .black.opacity(0.8)], startPoint: .center, endPoint: .bottom)
      } else {
        Color.black.opacity(0.72)
      }
    }
    .animation(reduceMotion ? nil : .easeInOut(duration: 0.4), value: player.studioReady)
    .animation(reduceMotion ? nil : .easeInOut(duration: 0.25), value: surface)
    .accessibilityHidden(true)
  }
}

/// Compact uses a still cover; reading pages keep only a restrained hint of its colour.
struct AmbientBackground: View {
  let current: Track?
  @Environment(\.surface) private var surface
  @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  var body: some View {
    ZStack {
      LinearGradient(
        colors: [Color(white: 0.11), Color(white: 0.05)], startPoint: .top, endPoint: .bottom)
      if !reduceTransparency, let current {
        Artwork.image(for: current, quality: "hqdefault").blur(radius: 60)
          .opacity(surface == .reading ? 0.18 : 0.45)
          .clipped().transition(.opacity).id(current.id)
      }
      Color.black.opacity(0.35)
    }.animation(reduceMotion ? nil : .easeInOut(duration: 0.4), value: current?.id)
      .accessibilityHidden(true)
  }
}
