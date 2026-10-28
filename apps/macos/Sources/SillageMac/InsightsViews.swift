import SillageKit
import SwiftUI

// Around the music: the quality actually playing, the artist's page, the Studio card that
// offers it while a song plays, and « Le morceau » with what people say. Everything appears
// in sequence, in Stoa glass; « Réduire les animations » keeps a plain fade.

/// Opens an artist's page in Découvrir, from anywhere a name is shown.
private struct OpenArtistKey: EnvironmentKey {
  static let defaultValue: ((String) -> Void)? = nil
}
/// Opens any page (artist, album) over the current tab.
private struct OpenRouteKey: EnvironmentKey {
  static let defaultValue: ((AppRoute) -> Void)? = nil
}
extension EnvironmentValues {
  var openArtist: ((String) -> Void)? {
    get { self[OpenArtistKey.self] }
    set { self[OpenArtistKey.self] = newValue }
  }
  var openRoute: ((AppRoute) -> Void)? {
    get { self[OpenRouteKey.self] }
    set { self[OpenRouteKey.self] = newValue }
  }
}

/// An artist's name that opens its page: secondary text, ink and underline on hover. Without
/// a way to open pages (Réglages, the menu bar), it stays plain text.
struct ArtistLink: View {
  /// What is shown: a credit line such as « Kaytranada, H.E.R. ».
  let text: String
  var font: Font = .system(size: 12)
  var color: Color = .secondary
  @Environment(\.openArtist) private var openArtist
  @State private var hovering = false
  var body: some View {
    if let openArtist, let lead = TrackTitle.lead(of: text) {
      Button {
        openArtist(lead)
      } label: {
        Text(text).font(font).lineLimit(1)
          .foregroundStyle(hovering ? Color.primary : color)
          .underline(hovering, color: .secondary)
      }
      .buttonStyle(.plain).onHover { hovering = $0 }
      .help("Découvrir \(lead)").accessibilityHint("Ouvre la page de l’artiste")
    } else {
      Text(text).font(font).foregroundStyle(color).lineLimit(1)
    }
  }
}

/// VoiceOver reaches the same page from a whole row: « Voir l’artiste ».
private struct ArtistAction: ViewModifier {
  let credit: String?
  @Environment(\.openArtist) private var openArtist
  func body(content: Content) -> some View {
    if let openArtist, let lead = credit.flatMap(TrackTitle.lead) {
      content.accessibilityAction(named: "Voir l’artiste") { openArtist(lead) }
    } else {
      content
    }
  }
}
extension View {
  func artistAction(_ credit: String?) -> some View { modifier(ArtistAction(credit: credit)) }
}

/// Elements of a block arrive one after the other: a short rise out of a blur, in order.
private struct Reveal: ViewModifier {
  let order: Int
  @State private var shown = false
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  func body(content: Content) -> some View {
    content
      .opacity(shown ? 1 : 0)
      .offset(y: shown || reduceMotion ? 0 : 10)
      .blur(radius: shown || reduceMotion ? 0 : 6)
      .onAppear {
        let animation: Animation =
          reduceMotion
          ? .easeOut(duration: 0.2)
          : .spring(response: 0.55, dampingFraction: 0.86).delay(Double(order) * 0.09)
        withAnimation(animation) { shown = true }
      }
  }
}
extension View {
  func reveal(_ order: Int) -> some View { modifier(Reveal(order: order)) }
}

/// A remote picture that fades in once loaded, and keeps its frame meanwhile.
struct RemotePicture: View {
  let url: URL?
  var placeholder = "person.fill"
  var body: some View {
    AsyncImage(url: url, transaction: Transaction(animation: .easeOut(duration: 0.35))) { phase in
      switch phase {
      case .success(let image): image.resizable().scaledToFill().transition(.opacity)
      default:
        Rectangle().fill(Color.sillage(.selection)).overlay {
          Image(systemName: placeholder).font(.system(size: 18, weight: .medium))
            .foregroundStyle(.tertiary)
        }
      }
    }
    .accessibilityHidden(true)
  }
}

// MARK: Quality

/// « 1080p · AAC 128 kb/s » in small mono type, faint until hovered; a click tells the rest.
struct QualityBadge: View {
  @ObservedObject var player: Player
  var onStage = false
  @State private var hovering = false
  @State private var showing = false
  var body: some View {
    if let quality = player.streamQuality, !quality.summary.isEmpty {
      Button {
        showing.toggle()
      } label: {
        HStack(spacing: 5) {
          if quality.origin == .clip {
            Circle().fill(Color.sillageOrange).frame(width: 4, height: 4)
          }
          Text(quality.summary)
        }
        .font(.system(size: 10, design: .monospaced)).tracking(0.4)
        .foregroundStyle(.secondary)
        .padding(.horizontal, 7).padding(.vertical, 3)
        .background {
          Capsule().fill(Color.primary.opacity(hovering || showing ? 0.08 : 0))
        }
        .opacity(hovering || showing ? 1 : onStage ? 0.75 : 0.6)
        .contentShape(Capsule())
      }
      .buttonStyle(.plain)
      .onHover { hovering = $0 }
      .animation(.easeOut(duration: 0.15), value: hovering)
      .help("Qualité de lecture")
      .accessibilityLabel("Qualité de lecture : \(quality.summary)")
      .popover(isPresented: $showing, arrowEdge: .top) { QualityDetail(quality: quality) }
      .transition(.opacity)
      .id(quality.summary)
    }
  }
}

private struct QualityDetail: View {
  let quality: StreamQuality
  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      MonoLabel("En lecture")
      row(
        "Source",
        quality.origin == .clip ? "Clip téléchargé, lu par macOS" : "Lecteur YouTube intégré")
      row("Vidéo", quality.videoDetail ?? "Inconnue")
      row(
        "Audio",
        quality.audioDetail
          ?? (quality.origin == .youtube ? "Choisi par YouTube, non communiqué" : "Inconnu"))
      Text(
        quality.origin == .clip
          ? "Lu depuis le fichier sur ton Mac : la qualité ne varie pas pendant le morceau."
          : "YouTube adapte la définition à ta connexion pendant la lecture. Studio lit le clip téléchargé quand il est prêt."
      )
      .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
    }
    .padding(18).frame(width: 300, alignment: .leading)
  }
  private func row(_ title: String, _ value: String) -> some View {
    HStack(alignment: .firstTextBaseline) {
      Text(title).font(.callout).foregroundStyle(.secondary).frame(width: 60, alignment: .leading)
      Text(value).font(.system(.callout, design: .monospaced)).textSelection(.enabled)
    }
  }
}

// MARK: Studio card

/// While a song plays in Studio, its artist steps in for a moment: portrait, name, a line,
/// and the way to its page. It leaves on its own, and stays while the pointer is on it.
struct StudioArtistCard: View {
  let track: Track?
  @ObservedObject var player: Player
  @EnvironmentObject var insights: InsightsModel
  @Environment(\.openArtist) private var openArtist
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var hovering = false
  @State private var dismissed: String?
  static let window: ClosedRange<Double> = 14...42

  private var name: String? { track.flatMap { TrackTitle($0).leadArtist } }
  private var profile: ArtistProfile? {
    guard let name, let profile = insights.artist(name), profile.found,
      profile.teaser != nil || profile.portrait != nil
    else { return nil }
    return profile
  }
  private var visible: Bool {
    guard profile != nil, let track, dismissed != track.id else { return false }
    return hovering || Self.window.contains(player.elapsed)
  }

  var body: some View {
    ZStack(alignment: .topLeading) {
      if visible, let profile, let track {
        card(profile).id(track.id)
          .transition(
            reduceMotion
              ? .opacity
              : .asymmetric(
                insertion: .opacity.combined(with: .offset(x: -24)),
                removal: .opacity.combined(with: .scale(scale: 0.96, anchor: .topLeading))))
      }
    }
    .animation(reduceMotion ? .easeOut(duration: 0.2) : .smooth(duration: 0.6), value: visible)
  }

  private func card(_ profile: ArtistProfile) -> some View {
    HStack(alignment: .top, spacing: 14) {
      RemotePicture(url: profile.portrait ?? profile.photo)
        .frame(width: 56, height: 56).clipShape(Circle())
        .overlay(Circle().strokeBorder(.white.opacity(0.25)))
        .reveal(0)
      VStack(alignment: .leading, spacing: 5) {
        MonoLabel("L’artiste").reveal(1)
        Text(profile.name).font(.system(size: 17, weight: .semibold)).reveal(1)
        if let teaser = profile.teaser {
          Text(teaser).font(.system(size: 12)).foregroundStyle(.secondary).lineLimit(3)
            .fixedSize(horizontal: false, vertical: true).reveal(2)
        }
        HStack(spacing: 10) {
          if let openArtist {
            Button {
              openArtist(profile.name)
            } label: {
              Label("Découvrir l’artiste", systemImage: "arrow.right")
                .labelStyle(TrailingIconLabelStyle())
            }.buttonStyle(SillageChipStyle(selected: false))
          }
          if let audience = profile.audience {
            Text(audience).font(.system(size: 10.5, design: .monospaced)).foregroundStyle(
              .secondary)
          }
        }.padding(.top, 4).reveal(3)
      }
      Button {
        dismissed = track?.id
      } label: {
        Image(systemName: "xmark").font(.system(size: 10, weight: .semibold))
          .frame(width: 20, height: 20).contentShape(Circle())
      }.buttonStyle(.plain).foregroundStyle(.secondary).accessibilityLabel("Masquer")
    }
    .padding(16).frame(width: 360, alignment: .leading)
    .glassPanel(radius: 18)
    .onHover { hovering = $0 }
  }
}

private struct TrailingIconLabelStyle: LabelStyle {
  func makeBody(configuration: Configuration) -> some View {
    HStack(spacing: 6) {
      configuration.title
      configuration.icon.imageScale(.small)
    }
  }
}

// MARK: « Le morceau »

/// The song playing: who made it, what the catalogues say, and what listeners write under it.
struct TrackInsightsPanel: View {
  let track: Track?
  @EnvironmentObject var insights: InsightsModel
  @EnvironmentObject var session: Session
  @Environment(\.openArtist) private var openArtist

  var body: some View {
    ScrollView {
      if let track {
        content(track).id(track.id).padding(16)
      } else {
        EmptyState(
          symbol: "music.note", message: "Lance un morceau pour voir son artiste et ce qu’on en dit."
        ).padding(.top, 40)
      }
    }
    .scrollIndicators(.never)
  }

  private func content(_ track: Track) -> some View {
    let name = TrackTitle(track)
    let lead = name.leadArtist
    let profile = lead.flatMap { insights.artist($0) }
    let video = insights.video(track.id)
    return VStack(alignment: .leading, spacing: 20) {
      // The artist, then a door to its page.
      if let lead {
        Button {
          openArtist?(lead)
        } label: {
          HStack(spacing: 12) {
            RemotePicture(url: profile?.portrait ?? profile?.photo)
              .frame(width: 46, height: 46).clipShape(Circle())
            VStack(alignment: .leading, spacing: 3) {
              Text(profile?.name ?? lead).font(.headline)
              let facts = [profile?.description.map(capitalized), profile?.audience]
                .compactMap { $0 }.joined(separator: " · ")
              if !facts.isEmpty {
                Text(facts).font(.caption).foregroundStyle(.secondary).lineLimit(2)
              }
            }
            Spacer(minLength: 0)
            if openArtist != nil {
              Image(systemName: "chevron.right").font(.caption.weight(.semibold))
                .foregroundStyle(.tertiary)
            }
          }
          .padding(10)
          .background(Color.sillageHover, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
          .contentShape(Rectangle())
        }
        .buttonStyle(.plain).disabled(openArtist == nil).help("Ouvrir la page de \(lead)")
        .reveal(0)
      }
      if let metadata = track.musicMetadata, metadata.matched {
        block("Le morceau", order: 1) {
          VStack(alignment: .leading, spacing: 4) {
            if !metadata.featured.isEmpty { Text("Avec \(metadata.featured)") }
            if let album = metadata.albums.first { Text("Album : \(album.title)") }
            if !metadata.genres.isEmpty {
              Text(metadata.genres.prefix(4).joined(separator: " · ")).foregroundStyle(.secondary)
            }
          }.font(.callout)
        }
      }
      if let song = video?.song {
        block("L’histoire", order: 2) {
          VStack(alignment: .leading, spacing: 6) {
            if let description = song.description {
              Text(capitalized(description)).font(.callout.weight(.medium))
            }
            Text(song.text).font(.callout).lineSpacing(2).lineLimit(8)
              .fixedSize(horizontal: false, vertical: true).textSelection(.enabled)
            Link("Lire sur Wikipedia", destination: song.url).font(.caption)
          }
        }
      }
      if let video {
        if video.views != nil || video.likes != nil {
          HStack(spacing: 18) {
            if let views = video.views { stat(compactCount(views), "vues") }
            if let likes = video.likes { stat(compactCount(likes), "j’aime") }
            if let count = video.commentCount { stat(compactCount(count), "commentaires") }
          }.reveal(3)
        }
        if !video.comments.isEmpty {
          block("Ce qu’on en dit", order: 4) {
            VStack(alignment: .leading, spacing: 10) {
              ForEach(Array(video.comments.enumerated()), id: \.element.id) { index, comment in
                CommentRow(comment: comment).reveal(5 + index)
              }
              Text("Les commentaires YouTube les mieux classés de cette vidéo.")
                .font(.caption2).foregroundStyle(.tertiary)
            }
          }
        }
      } else if insights.loading(video: track.id) {
        HStack(spacing: 8) {
          ProgressView().controlSize(.small)
          Text("Je regarde ce qu’on en dit…").font(.caption).foregroundStyle(.secondary)
        }
      } else if insights.didFail(video: track.id) {
        Button("Réessayer") {
          insights.loadVideo(
            track.id, artist: lead, title: name.title, connection: session.connection, retry: true)
        }.buttonStyle(SillageLinkStyle()).font(.caption)
      }
    }
  }

  private func block<Content: View>(
    _ title: String, order: Int, @ViewBuilder content: () -> Content
  ) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      MonoLabel(title)
      content()
    }.frame(maxWidth: .infinity, alignment: .leading).reveal(order)
  }

  private func stat(_ value: String, _ label: String) -> some View {
    VStack(alignment: .leading, spacing: 1) {
      Text(value).font(.system(size: 17, weight: .semibold)).monospacedDigit()
      Text(label).font(.caption).foregroundStyle(.secondary)
    }
  }
}

private struct CommentRow: View {
  let comment: VideoInsights.Comment
  @State private var expanded = false
  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      HStack(spacing: 6) {
        Text(comment.author).font(.system(size: 11, weight: .semibold)).lineLimit(1)
        Spacer(minLength: 0)
        if comment.likes > 0 {
          Label(compactCount(comment.likes), systemImage: "hand.thumbsup")
            .font(.system(size: 10.5, design: .monospaced)).foregroundStyle(.secondary)
        }
      }
      Text(comment.text).font(.callout).lineLimit(expanded ? nil : 4)
        .fixedSize(horizontal: false, vertical: true).textSelection(.enabled)
        .onTapGesture { withAnimation(.easeInOut(duration: 0.2)) { expanded.toggle() } }
    }
    .padding(10)
    .background(Color.sillageHover, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
  }
}
