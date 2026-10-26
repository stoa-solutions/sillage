import RecallKit
import SwiftUI

/// Reading pages use the Sillage reading material; only the Studio DJ stage is immersive.
/// Context is inherited by panels, including the shared DJ chat and mini-player.
enum Surface { case standard, immersive, reading }

private struct SurfaceKey: EnvironmentKey { static let defaultValue = Surface.standard }
extension EnvironmentValues {
  var surface: Surface {
    get { self[SurfaceKey.self] }
    set { self[SurfaceKey.self] = newValue }
  }
}

/// A grouped surface with rounded corners (12 pt): Sillage reading material in both
/// appearances, the dark glass over the Studio clip. Reduce Transparency makes both opaque.
struct GlassPanel: ViewModifier {
  @Environment(\.surface) private var surface
  @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
  @Environment(\.colorSchemeContrast) private var contrast
  var radius: CGFloat = 12

  func body(content: Content) -> some View {
    let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
    content.background {
      switch surface {
      case .standard, .reading:
        Color.clear.sillageSurface(.reading).clipShape(shape)
          .overlay(
            shape.strokeBorder(Color.sillage(.separator).opacity(contrast == .increased ? 1 : 0.6)))
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
  func glassPanel(radius: CGFloat = 12) -> some View { modifier(GlassPanel(radius: radius)) }
}

/// The clip keeps playing across navigation; its presentation follows the page context.
struct StageBackground: View {
  @ObservedObject var player: Player
  let current: Track?
  @Environment(\.surface) private var surface
  @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @Environment(\.studioControlsVisible) private var controlsVisible
  private var immersive: Bool { surface == .immersive }

  var body: some View {
    ZStack {
      Color.black
      if current == nil {
        IdleBackground()
      } else if immersive || !reduceTransparency {
        // YouTube first, the downloaded clip fading in over it: the stage never jumps.
        VideoSurface(player: player, fill: true)
          .frame(maxWidth: .infinity, maxHeight: .infinity).clipped()
      }
      if current != nil && immersive {
        LinearGradient(
          colors: [.clear, .black.opacity(0.8)], startPoint: .center, endPoint: .bottom
        )
        .opacity(controlsVisible ? 1 : 0)
      } else if current != nil {
        Color.black.opacity(0.55)
      }
    }
    .animation(reduceMotion ? nil : .easeInOut(duration: 0.25), value: surface)
    .accessibilityHidden(true)
  }
}
