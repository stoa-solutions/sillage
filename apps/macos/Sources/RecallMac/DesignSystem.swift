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
        if let metadata = track.musicMetadata { MusicMetadataView(metadata: metadata) }
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

/// The player bar under Bibliothèque and Découvrir, edge to edge on the chrome material.
/// Stable height; its thumbnail is the mini-clip of the shared player, or the cover when no
/// clip can show (nothing playing, failure). Clicking it opens the DJ page.
struct NowPlayingBar: View {
  @ObservedObject var model: DJModel
  @ObservedObject var player: Player
  var openDJ: () -> Void
  var body: some View {
    HStack(spacing: 16) {
      Button(action: openDJ) { thumbnail }.buttonStyle(.plain).help("Ouvrir le DJ")
        .accessibilityLabel("Ouvrir le DJ")
      VStack(alignment: .leading, spacing: 2) {
        TrackHeadline(
          track: model.current, detail: "Choisis un morceau ou parle au DJ.",
          titleFont: .system(size: 13, weight: .semibold), detailFont: .system(size: 12))
        if !player.failure.isEmpty {
          Text(player.failure).font(.caption).foregroundStyle(.orange).lineLimit(1)
        }
      }.frame(minWidth: 120, maxWidth: 240, alignment: .leading).clipped()
      Spacer(minLength: 8)
      Button {
        model.togglePlayback()
      } label: {
        Image(systemName: player.playing ? "pause.fill" : "play.fill")
          .font(.system(size: 14, weight: .bold)).frame(width: 34, height: 34)
          .foregroundStyle(Color.sillage(.primaryIcon))
          .background(Circle().fill(Color.sillage(.primaryFill)))
      }.buttonStyle(.plain).disabled(model.current == nil)
        .accessibilityLabel(player.playing ? "Pause" : "Lecture")
      Button {
        model.next()
      } label: {
        Image(systemName: "forward.fill").frame(width: 28, height: 28).contentShape(Rectangle())
      }.buttonStyle(.plain).disabled(model.current == nil).accessibilityLabel("Morceau suivant")
      HStack(spacing: 8) {
        Text(clock(player.elapsed)).font(.caption.monospacedDigit()).foregroundStyle(.secondary)
          .frame(width: 38, alignment: .trailing)
          // The slider already speaks the position.
          .accessibilityHidden(true)
        SillageSlider(
          value: Binding(get: { player.elapsed }, set: { player.seek($0) }),
          range: 0...max(1, player.duration), step: 5
        )
        .disabled(player.duration <= 0).accessibilityLabel("Position du morceau")
        .accessibilityValue(clock(player.elapsed))
      }.frame(minWidth: 140, maxWidth: 260)
      Spacer(minLength: 8)
      VolumeControl(player: player)
    }
    .padding(.horizontal, 16).frame(height: 68)
    .sillageSurface(.chrome)
    .overlay(alignment: .top) { SillageRule() }
  }

  @ViewBuilder private var thumbnail: some View {
    Group {
      if let track = model.current {
        if player.failure.isEmpty {
          // The shared player moves here while no other page shows it.
          VideoSurface(player: player, cornerRadius: 6, interactive: false)
            .overlay { if player.preparingClip && !player.playing { coverOverlay(track) } }
        } else {
          Artwork(track: track, showsDuration: false)
        }
      } else {
        RoundedRectangle(cornerRadius: 6).fill(Color.sillageHover)
      }
    }
    .frame(width: 84, height: 47.25).clipShape(RoundedRectangle(cornerRadius: 6))
  }

  private func coverOverlay(_ track: Track) -> some View {
    Artwork(track: track, showsDuration: false).allowsHitTesting(false)
  }
}

/// Music volume; the speaker mutes and restores the previous level. In the pocket format the
/// speaker opens the slider in a popover, so the row stays as airy as the planche.
struct VolumeControl: View {
  @ObservedObject var player: Player
  var compact = false
  @State private var beforeMute = 1.0
  @State private var open = false
  var body: some View {
    if compact {
      Button {
        open.toggle()
      } label: {
        speaker
      }.buttonStyle(.plain).foregroundStyle(.secondary)
        .accessibilityLabel("Volume de la musique")
        .accessibilityValue("\(Int((player.volume * 100).rounded())) %")
        .help("Volume de la musique")
        .popover(isPresented: $open, arrowEdge: .bottom) {
          HStack(spacing: 8) {
            muteButton
            slider.frame(width: 140)
          }.padding(12)
        }
    } else {
      HStack(spacing: 6) {
        muteButton
        slider.frame(width: 90)
      }.help("Volume de la musique")
    }
  }

  private var speaker: some View {
    Image(systemName: player.volume == 0 ? "speaker.slash.fill" : "speaker.wave.2.fill")
      .frame(width: 22, height: 22).contentShape(Rectangle())
  }
  private var muteButton: some View {
    Button {
      if player.volume > 0 {
        beforeMute = player.volume
        player.volume = 0
      } else {
        player.volume = max(beforeMute, 0.1)
      }
    } label: {
      speaker
    }.buttonStyle(.plain).foregroundStyle(.secondary)
      .accessibilityLabel(player.volume == 0 ? "Remettre le son" : "Couper le son")
  }
  private var slider: some View {
    SillageSlider(value: $player.volume)
      .accessibilityLabel("Volume de la musique")
      .accessibilityValue("\(Int((player.volume * 100).rounded())) %")
  }
}

/// Search field shared by Bibliothèque and Découvrir. Same size whatever its state: empty,
/// typing, searching (a spinner replaces the clear button), focus (an orange outline).
/// Escape clears it.
struct SearchField: View {
  let prompt: String
  @Binding var text: String
  var onSubmit: () -> Void = {}
  var busy = false
  @FocusState private var focused: Bool
  var body: some View {
    HStack(spacing: 8) {
      Image(systemName: "magnifyingglass").foregroundStyle(.secondary).accessibilityHidden(true)
      TextField(prompt, text: $text).textFieldStyle(.plain).font(.system(size: 14))
        .focused($focused).onSubmit(onSubmit).onExitCommand { text = "" }
      ZStack {
        if busy {
          ProgressView().controlSize(.small).accessibilityLabel("Recherche en cours")
        } else if !text.isEmpty {
          Button {
            text = ""
          } label: {
            Image(systemName: "xmark.circle.fill").foregroundStyle(.tertiary)
          }.buttonStyle(.plain).accessibilityLabel("Effacer la recherche")
        }
      }.frame(width: 18, height: 18)
    }
    .padding(.horizontal, 12).frame(height: 36)
    .background(Color.sillageHover, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
    .overlay(
      RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(
        focused ? Color.sillage(.focus) : Color.sillage(.separator).opacity(0.6),
        lineWidth: focused ? 1.5 : 1))
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
        .lineLimit(1).fixedSize(horizontal: true, vertical: false)
        .foregroundStyle(configuration.isOn ? Color.primary : Color.secondary)
        .padding(.horizontal, 12).padding(.vertical, 6)
        .background {
          Capsule().fill(Color.primary.opacity(configuration.isOn ? 0.14 : 0.04))
            .overlay(
              Capsule().strokeBorder(Color.primary.opacity(configuration.isOn ? 0.22 : 0.1)))
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
        Capsule().fill(Color.primary.opacity(configuration.isPressed ? 0.14 : 0.04))
          .overlay(Capsule().strokeBorder(Color.primary.opacity(0.1)))
      }.contentShape(Capsule())
  }
}

/// Toolbar toggle: macOS draws the glass around toolbar items, so only the content changes.
struct ToolbarToggleStyle: ToggleStyle {
  func makeBody(configuration: Configuration) -> some View {
    Button {
      configuration.isOn.toggle()
    } label: {
      configuration.label
        .foregroundStyle(configuration.isOn ? Color.primary : Color.secondary)
        .symbolVariant(configuration.isOn ? .fill : .none)
    }.accessibilityValue(configuration.isOn ? "Activé" : "Désactivé")
  }
}

/// Segmented pickers select in neutral grey; the accent is kept for actions.
extension View {
  func neutralSelection() -> some View { tint(Color(white: 0.42)) }
}

/// Inline text action (Réessayer, Annuler): the palette's action text, underlined on hover,
/// instead of the system link blue.
struct SillageLinkStyle: ButtonStyle {
  @State private var hovering = false
  func makeBody(configuration: Configuration) -> some View {
    configuration.label.foregroundStyle(Color.sillage(.actionText))
      .underline(hovering).opacity(configuration.isPressed ? 0.7 : 1)
      .contentShape(Rectangle()).onHover { hovering = $0 }
  }
}
