import RecallKit
import SwiftUI

// Shared pieces for every page; docs/design.md explains the rules behind them.

/// Large page title with a short line underneath, the same on every page.
struct PageHeader<Trailing: View>: View {
  let title: String
  let subtitle: String?
  var titleFont: Font = .largeTitle.bold()
  @ViewBuilder var trailing: Trailing
  var body: some View {
    HStack(alignment: .firstTextBaseline) {
      VStack(alignment: .leading, spacing: 2) {
        Text(title).font(titleFont)
        if let subtitle { Text(subtitle).foregroundStyle(.secondary) }
      }
      Spacer()
      trailing
    }
  }
}
extension PageHeader where Trailing == EmptyView {
  init(title: String, subtitle: String?, titleFont: Font = .largeTitle.bold()) {
    self.init(title: title, subtitle: subtitle, titleFont: titleFont) { EmptyView() }
  }
}

/// Section title in sentence case, with an optional count and action.
struct SectionHeader<Trailing: View>: View {
  let title: String
  var count: Int? = nil
  @ViewBuilder var trailing: Trailing
  var body: some View {
    HStack(alignment: .firstTextBaseline) {
      Text(count.map { "\(title) (\($0))" } ?? title).font(.headline)
      Spacer()
      trailing
    }.padding(.top, 4)
  }
}
extension SectionHeader where Trailing == EmptyView {
  init(_ title: String, count: Int? = nil) {
    self.init(title: title, count: count) { EmptyView() }
  }
}

/// One symbol, one sentence, at most one action.
struct EmptyState: View {
  let symbol: String
  let message: String
  var action: (title: String, run: () -> Void)? = nil
  var body: some View {
    VStack(spacing: 12) {
      Image(systemName: symbol).font(.system(size: 28)).foregroundStyle(.tertiary)
      Text(message).foregroundStyle(.secondary).multilineTextAlignment(.center)
      if let action { Button(action.title, action: action.run).buttonStyle(.bordered) }
    }.padding(24).frame(maxWidth: .infinity)
  }
}

/// YouTube thumbnail of a video, with its duration when known.
struct Artwork: View {
  let track: Track
  var showsDuration = true
  var body: some View {
    // A 16:9 frame first, the image filling it: the width alone decides the size.
    Color.clear.aspectRatio(16 / 9, contentMode: .fit)
      .overlay { Self.image(for: track, quality: "mqdefault") }
      .clipped()
      .overlay(alignment: .bottomTrailing) {
        if showsDuration, let duration = track.durationSeconds, duration > 0 {
          Text(clock(duration)).font(.caption2.monospacedDigit().weight(.medium))
            .foregroundStyle(.white).padding(.horizontal, 4).padding(.vertical, 1)
            .background(.black.opacity(0.7), in: RoundedRectangle(cornerRadius: 4)).padding(4)
        }
      }
      .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
      .accessibilityHidden(true)
  }
  static func image(for track: Track, quality: String) -> some View {
    AsyncImage(url: URL(string: "https://i.ytimg.com/vi/\(track.id)/\(quality).jpg")) { image in
      image.resizable().scaledToFill()
    } placeholder: {
      Color.secondary.opacity(0.15)
    }
  }
}

/// The channel's photo when the server has it; otherwise its initial on a colour of its own.
struct ChannelAvatar: View {
  let name: String
  let photo: URL?
  var size: CGFloat = 18
  var body: some View {
    AsyncImage(url: photo) { image in
      image.resizable().scaledToFill()
    } placeholder: {
      let seed = name.unicodeScalars.reduce(0) { ($0 &* 31 &+ Int($1.value)) & 0xFFFF }
      Circle().fill(Color(hue: Double(seed % 360) / 360, saturation: 0.45, brightness: 0.62))
        .overlay {
          Text(name.first.map { String($0).uppercased() } ?? "?")
            .font(.system(size: size * 0.5, weight: .bold)).foregroundStyle(.white)
        }
    }.frame(width: size, height: size).clipShape(Circle()).accessibilityHidden(true)
  }
}

/// Song and artist of a track; changes slide in from below so a new song is noticed.
struct TrackHeadline: View {
  let track: Track?
  var placeholder = "Prêt quand tu l’es"
  var detail = "Dis au DJ ce que tu veux écouter."
  var titleFont: Font = .headline
  var detailFont: Font = .callout
  var lines = 1
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  var body: some View {
    let name = track.map(TrackTitle.init)
    VStack(alignment: .leading, spacing: 3) {
      Text(name?.title ?? placeholder).font(titleFont).lineLimit(lines).minimumScaleFactor(0.7)
      Text(track == nil ? detail : name?.artist ?? "YouTube").font(detailFont)
        .foregroundStyle(.secondary).lineLimit(1)
    }
    .id(track?.id)
    .transition(
      reduceMotion
        ? .opacity : .asymmetric(insertion: .push(from: .bottom), removal: .push(from: .bottom))
    )
    .animation(.easeOut(duration: 0.25), value: track?.id)
    .accessibilityElement(children: .combine)
  }
}

/// A track, the same everywhere: artwork, song, artist with avatar, extras and hover actions.
struct TrackRow<Actions: View>: View {
  let track: Track
  var detail: String? = nil
  var detailColor: Color = .secondary
  var artworkWidth: CGFloat = 96
  /// Keeps actions visible when they are the point of the page (Découvrir).
  var persistentActions = false
  var onPlay: (() -> Void)? = nil
  @ViewBuilder var actions: Actions
  @State private var hovering = false
  var body: some View {
    let name = TrackTitle(track)
    HStack(alignment: .center, spacing: 12) {
      Button {
        onPlay?()
      } label: {
        Artwork(track: track).frame(width: artworkWidth)
          .overlay {
            if hovering, onPlay != nil {
              Image(systemName: "play.fill").font(.title3).foregroundStyle(.white)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(.black.opacity(0.35), in: RoundedRectangle(cornerRadius: 6))
            }
          }
      }.buttonStyle(.plain).disabled(onPlay == nil).accessibilityHidden(true)
      VStack(alignment: .leading, spacing: 4) {
        Text(name.title).fontWeight(.medium).lineLimit(2)
        HStack(spacing: 6) {
          ChannelAvatar(name: name.artist ?? track.channel ?? "?", photo: track.channelAvatarURL)
          Text(name.artist ?? track.channel ?? "YouTube").font(.callout)
            .foregroundStyle(.secondary).lineLimit(1)
        }
        if let detail, !detail.isEmpty {
          Text(detail).font(.caption).foregroundStyle(detailColor).lineLimit(2)
        }
      }.frame(maxWidth: .infinity, alignment: .leading)
      actions.opacity(hovering || persistentActions ? 1 : 0)
        .allowsHitTesting(hovering || persistentActions)
    }
    .padding(.vertical, 4).contentShape(Rectangle())
    .onHover { hovering = $0 }
    .onTapGesture(count: 2) { onPlay?() }
    .accessibilityElement(children: .contain)
    .accessibilityLabel(name.artist.map { "\(name.title), \($0)" } ?? name.title)
    .accessibilityAction(named: "Lire") { onPlay?() }
  }
}
extension TrackRow where Actions == EmptyView {
  init(track: Track, detail: String? = nil, artworkWidth: CGFloat = 96, onPlay: (() -> Void)?) {
    self.init(track: track, detail: detail, artworkWidth: artworkWidth, onPlay: onPlay) {
      EmptyView()
    }
  }
}

/// Mini player shown under Library and Découvrir, so the music is always one click away.
struct NowPlayingBar: View {
  @ObservedObject var model: DJModel
  @ObservedObject var player: Player
  var openDJ: () -> Void
  var body: some View {
    HStack(spacing: 14) {
      Group {
        if let track = model.current {
          Artwork(track: track, showsDuration: false).frame(width: 72)
        } else {
          RoundedRectangle(cornerRadius: 6).fill(.quaternary).frame(width: 72, height: 40.5)
        }
      }.onTapGesture(perform: openDJ).help("Ouvrir le DJ")
      VStack(alignment: .leading, spacing: 4) {
        TrackHeadline(
          track: model.current, detail: "Choisis un morceau ou parle au DJ.",
          titleFont: .callout.weight(.semibold), detailFont: .caption)
        if player.preparingStudio {
          HStack(spacing: 6) {
            ProgressView().controlSize(.mini)
            Text("Préparation du clip…").font(.caption).foregroundStyle(.secondary)
          }
        } else if !player.failure.isEmpty {
          Text(player.failure).font(.caption).foregroundStyle(.orange).lineLimit(2)
        }
      }.frame(maxWidth: .infinity, alignment: .leading).clipped()
      Button {
        player.command(player.playing ? "pause" : "play")
      } label: {
        Image(systemName: player.playing ? "pause.fill" : "play.fill").frame(width: 34, height: 34)
          .foregroundStyle(Color(nsColor: .windowBackgroundColor))
          .background(Circle().fill(Color.recall))
      }.buttonStyle(.plain).disabled(model.current == nil || player.preparingStudio)
        .accessibilityLabel(player.playing ? "Pause" : "Lecture")
      Button {
        model.next()
      } label: {
        Image(systemName: "forward.fill").frame(width: 28, height: 28)
      }.buttonStyle(.plain).disabled(model.current == nil).accessibilityLabel("Morceau suivant")
      if player.duration > 0 {
        Text(clock(player.elapsed)).font(.caption.monospacedDigit()).foregroundStyle(.secondary)
        Slider(
          value: Binding(get: { player.elapsed }, set: { player.seek($0) }),
          in: 0...max(1, player.duration)
        ).frame(maxWidth: 220).controlSize(.small).accessibilityLabel("Position du morceau")
      }
      VolumeControl(player: player)
    }.padding(.horizontal, 14).padding(.vertical, 10).glassPanel(radius: 16)
  }
}

/// Music volume; the speaker mutes and restores the previous level.
struct VolumeControl: View {
  @ObservedObject var player: Player
  @State private var beforeMute = 1.0
  var body: some View {
    HStack(spacing: 6) {
      Button {
        if player.volume > 0 {
          beforeMute = player.volume
          player.volume = 0
        } else {
          player.volume = max(beforeMute, 0.1)
        }
      } label: {
        Image(systemName: player.volume == 0 ? "speaker.slash.fill" : "speaker.wave.2.fill")
          .frame(width: 20)
      }.buttonStyle(.plain).foregroundStyle(.secondary)
        .accessibilityLabel(player.volume == 0 ? "Remettre le son" : "Couper le son")
      Slider(value: $player.volume, in: 0...1).frame(width: 90).controlSize(.small)
        .accessibilityLabel("Volume de la musique")
    }.help("Volume de la musique")
  }
}

/// Search field shared by Library and Découvrir.
struct SearchField: View {
  let prompt: String
  @Binding var text: String
  var onSubmit: () -> Void = {}
  var body: some View {
    HStack(spacing: 8) {
      Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
      TextField(prompt, text: $text).textFieldStyle(.plain).onSubmit(onSubmit)
      if !text.isEmpty {
        Button {
          text = ""
        } label: {
          Image(systemName: "xmark.circle.fill").foregroundStyle(.tertiary)
        }.buttonStyle(.plain).accessibilityLabel("Effacer la recherche")
      }
    }.padding(.horizontal, 12).padding(.vertical, 9)
      .background(.quaternary.opacity(0.6), in: RoundedRectangle(cornerRadius: 12))
  }
}

/// Sober glass capsule for toggles: on reads white on light glass, off reads grey and outlined.
/// Green stays for real accents (play, progress, the sung line).
struct GlassToggleStyle: ToggleStyle {
  func makeBody(configuration: Configuration) -> some View {
    Button {
      configuration.isOn.toggle()
    } label: {
      configuration.label.labelStyle(.titleAndIcon).font(.callout.weight(.medium))
        .foregroundStyle(configuration.isOn ? Color.primary : Color.secondary)
        .padding(.horizontal, 12).padding(.vertical, 6)
        .background {
          Capsule().fill(.white.opacity(configuration.isOn ? 0.16 : 0.04))
            .overlay(Capsule().strokeBorder(.white.opacity(configuration.isOn ? 0.22 : 0.1)))
        }.contentShape(Capsule())
    }.buttonStyle(.plain).accessibilityValue(configuration.isOn ? "Activé" : "Désactivé")
      .animation(.easeOut(duration: 0.15), value: configuration.isOn)
  }
}

/// Same capsule for plain buttons placed beside those toggles, or for suggestions.
struct GlassButtonStyle: ButtonStyle {
  var emphasized = false
  func makeBody(configuration: Configuration) -> some View {
    configuration.label.font(.callout.weight(.medium))
      .foregroundStyle(emphasized ? Color.primary : Color.secondary)
      .padding(.horizontal, 10).padding(.vertical, 6)
      .background {
        Capsule().fill(.white.opacity(configuration.isPressed ? 0.16 : 0.04))
          .overlay(Capsule().strokeBorder(.white.opacity(0.1)))
      }.contentShape(Capsule())
  }
}

/// Toolbar toggle: macOS draws the glass around toolbar items, so only the content changes.
struct ToolbarToggleStyle: ToggleStyle {
  func makeBody(configuration: Configuration) -> some View {
    Button {
      configuration.isOn.toggle()
    } label: {
      configuration.label.labelStyle(.titleAndIcon)
        .foregroundStyle(configuration.isOn ? Color.primary : Color.secondary)
        .symbolVariant(configuration.isOn ? .fill : .none)
    }.accessibilityValue(configuration.isOn ? "Activé" : "Désactivé")
  }
}

/// Segmented pickers select in neutral grey; the accent is kept for actions.
extension View {
  func neutralSelection() -> some View { tint(Color(white: 0.42)) }
}
