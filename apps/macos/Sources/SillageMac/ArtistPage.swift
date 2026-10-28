import SillageKit
import SwiftUI

/// A page opened over the current tab; « Retour » (⌘[) goes back to where it came from.
enum AppRoute: Hashable {
  case artist(String)
}

/// What the artist page needs from the server for this account: the listener's own songs by
/// the artist, and what is around it (its songs they lack, neighbours, collaborations).
@MainActor final class ArtistPageModel: ObservableObject {
  @Published private(set) var owned: [OwnedTrack] = []
  @Published private(set) var ownedLoaded = false
  @Published private(set) var around: DiscoveryHome?
  @Published private(set) var aroundLoading = false
  @Published private(set) var aroundError = ""
  private var tasks: [Task<Void, Never>] = []

  func load(_ name: String, connection: Connection?) {
    tasks.forEach { $0.cancel() }
    guard let connection else { return }
    aroundLoading = true
    tasks = [
      Task {
        let found = (try? await HTTPClient().artistInLibrary(connection, name: name)) ?? []
        guard !Task.isCancelled else { return }
        owned = found
        ownedLoaded = true
      },
      Task {
        do {
          let page = try await HTTPClient().discoveryPage(connection, artist: name)
          guard !Task.isCancelled else { return }
          around = page
        } catch {
          guard !Task.isCancelled else { return }
          aroundError = error.localizedDescription
        }
        aroundLoading = false
      },
    ]
  }
  deinit { tasks.forEach { $0.cancel() } }
}

/// One artist, from anywhere: banner, « Chez toi », « À découvrir », discography,
/// collaborations and related artists. Still: nothing moves in on its own.
struct ArtistPage: View {
  let name: String
  /// Where « Retour » leads: the tab, or the artist seen before.
  let backTitle: String
  let back: () -> Void
  let openDJ: () -> Void
  @EnvironmentObject var insights: InsightsModel
  @EnvironmentObject var session: Session
  @EnvironmentObject var dj: DJModel
  @StateObject private var page = ArtistPageModel()
  @State private var expanded = false
  @State private var launched = false

  private var profile: ArtistProfile? {
    insights.artist(name).flatMap { $0.found ? $0 : nil }
  }
  /// The server's sections, by role on this page.
  private func section(_ kind: String, idPrefix: String? = nil) -> DiscoverySection? {
    around?.sections.first { $0.kind == kind && (idPrefix.map($0.id.hasPrefix) ?? true) }
  }
  private var around: DiscoveryHome? { page.around }
  /// « Plus loin » and anything else the server adds, after the shelves placed above.
  private var further: [DiscoverySection] {
    let placed = Set(
      [section("artists", idPrefix: "songs:"), section("collaborations"), section("neighbours")]
        .compactMap { $0?.id })
    return around?.sections.filter { !placed.contains($0.id) && !$0.items.isEmpty } ?? []
  }

  var body: some View {
    VStack(spacing: 0) {
      GeometryReader { geometry in
        let compact = geometry.size.width < LibraryColumns.compactBelow
        ScrollView {
          VStack(alignment: .leading, spacing: 30) {
            topBar
            header
            ownShelf(compact: compact)
            if let songs = section("artists", idPrefix: "songs:"), !songs.items.isEmpty {
              DiscoveryShelf(section: songs, compact: compact, title: "À découvrir", hiding: name)
            }
            if let releases = profile?.releases, !releases.isEmpty { discography(releases) }
            if let together = section("collaborations"), !together.items.isEmpty {
              DiscoveryShelf(
                section: together, compact: compact, title: "Avec \(name)", hiding: name)
            }
            relatedArtists
            if let near = section("neighbours"), !near.items.isEmpty {
              DiscoveryShelf(section: near, compact: compact, hiding: name)
            }
            ForEach(further) { DiscoveryShelf(section: $0, compact: compact, hiding: name) }
            if page.aroundLoading {
              HStack(spacing: 8) {
                ProgressView().controlSize(.small)
                Text("Je cherche autour de \(name)…").font(.callout).foregroundStyle(.secondary)
              }
            } else if !page.aroundError.isEmpty {
              Text(page.aroundError).font(.callout).foregroundStyle(Color.sillage(.actionText))
            }
          }
          .padding(.top, 20).padding(.horizontal, 32).padding(.bottom, 24)
          .frame(maxWidth: .infinity, alignment: .leading)
        }
        .scrollIndicators(.never)
      }
      NowPlayingBar(model: dj, player: dj.player, openDJ: openDJ)
    }
    .sillageSurface(.reading)
    .task(id: name) {
      insights.loadArtist(name, connection: session.connection)
      page.load(name, connection: session.connection)
    }
  }

  // MARK: Top

  private var topBar: some View {
    HStack(spacing: 12) {
      LibraryLinkButton(title: backTitle, symbol: "chevron.left", action: back)
        .keyboardShortcut("[", modifiers: .command)
        .help("Retour (⌘[)")
      Spacer(minLength: 0)
      Button {
        dj.send("Lance un set autour de \(name)", source: .all)
        launched = true
      } label: {
        Label(launched ? "Le DJ prépare le set" : "Lancer l’artiste", systemImage: "waveform")
      }
      .buttonStyle(LibraryPrimaryButtonStyle()).disabled(launched || !session.hasServer)
      .help("Le DJ lance un set autour de \(name)")
    }
  }

  @ViewBuilder private var header: some View {
    if let profile {
      VStack(alignment: .leading, spacing: 14) {
        ArtistBanner(profile: profile)
        if let bio = profile.bio {
          VStack(alignment: .leading, spacing: 6) {
            Text(bio.text).font(.system(size: 13)).lineSpacing(3)
              .lineLimit(expanded ? nil : 3).fixedSize(horizontal: false, vertical: true)
              .textSelection(.enabled)
            HStack(spacing: 14) {
              if bio.text.count > 220 {
                LibraryLinkButton(title: expanded ? "Réduire" : "Lire la suite") {
                  expanded.toggle()
                }
              }
              ArtistLinks(profile: profile)
            }
          }.frame(maxWidth: 720, alignment: .leading)
        } else {
          ArtistLinks(profile: profile)
        }
      }
    } else {
      VStack(alignment: .leading, spacing: 8) {
        MonoLabel("Artiste")
        Text(name).font(.system(size: 32, weight: .semibold)).tracking(-1).lineLimit(1)
          .accessibilityAddTraits(.isHeader)
        if insights.loading(artist: name) {
          ProgressView().controlSize(.small)
        }
      }
    }
  }

  // MARK: Shelves

  @ViewBuilder private func ownShelf(compact: Bool) -> some View {
    if !page.owned.isEmpty {
      VStack(alignment: .leading, spacing: 0) {
        shelfTitle("Chez toi", count: page.owned.count)
        Text("Ses titres dans ta bibliothèque, les plus écoutés d’abord.")
          .font(.system(size: 12)).foregroundStyle(.secondary).padding(.bottom, 8)
        SillageRule()
        ForEach(page.owned.prefix(expandedOwn ? 50 : 8)) { owned in
          OwnedRow(owned: owned)
        }
        if page.owned.count > 8 {
          LibraryLinkButton(title: expandedOwn ? "Moins" : "Tout voir (\(page.owned.count))") {
            expandedOwn.toggle()
          }.padding(.top, 8)
        }
      }
    }
  }
  @State private var expandedOwn = false

  private func discography(_ releases: [ArtistProfile.Release]) -> some View {
    VStack(alignment: .leading, spacing: 10) {
      shelfTitle("Discographie", count: releases.count)
      ScrollView(.horizontal, showsIndicators: false) {
        HStack(alignment: .top, spacing: 14) {
          ForEach(releases) { ReleaseTile(release: $0) }
        }
      }
    }
  }

  @ViewBuilder private var relatedArtists: some View {
    if let related = profile?.related, !related.isEmpty {
      VStack(alignment: .leading, spacing: 10) {
        shelfTitle("Artistes proches", count: related.count)
        ScrollView(.horizontal, showsIndicators: false) {
          HStack(alignment: .top, spacing: 16) {
            ForEach(related) { RelatedArtistTile(artist: $0) }
          }
        }
      }
    }
  }

  private func shelfTitle(_ title: String, count: Int) -> some View {
    HStack(alignment: .firstTextBaseline, spacing: 8) {
      Text(title).font(.system(size: 15, weight: .semibold)).accessibilityAddTraits(.isHeader)
      Text(String(format: "%02d", count)).font(.system(size: 10, design: .monospaced))
        .foregroundStyle(.secondary)
    }.padding(.bottom, 4)
  }
}

/// Wide picture, portrait, name, what it is, facts and genres.
struct ArtistBanner: View {
  let profile: ArtistProfile
  var body: some View {
    ZStack(alignment: .bottomLeading) {
      Group {
        if let banner = profile.banner {
          RemotePicture(url: banner)
        } else {
          // Without a banner, the portrait blurred into a backdrop of its own colours.
          RemotePicture(url: profile.portrait ?? profile.photo).blur(radius: 40).opacity(0.7)
        }
      }
      .frame(height: 220).frame(maxWidth: .infinity).clipped()
      LinearGradient(
        colors: [.black.opacity(0), .black.opacity(0.65)], startPoint: .center, endPoint: .bottom)
      HStack(alignment: .bottom, spacing: 14) {
        RemotePicture(url: profile.portrait ?? profile.photo)
          .frame(width: 72, height: 72).clipShape(Circle())
          .overlay(Circle().strokeBorder(.white.opacity(0.35), lineWidth: 1))
          .shadow(color: .black.opacity(0.3), radius: 8, y: 3)
        VStack(alignment: .leading, spacing: 4) {
          Text(profile.name).font(.system(size: 30, weight: .bold)).tracking(-0.8)
            .minimumScaleFactor(0.7).accessibilityAddTraits(.isHeader)
          if let description = profile.description {
            Text(capitalized(description)).font(.system(size: 13, weight: .medium))
          }
          let line = [profile.facts, profile.audience ?? ""].filter { !$0.isEmpty }
            .joined(separator: " · ")
          if !line.isEmpty {
            Text(line).font(.system(size: 11, design: .monospaced)).opacity(0.8)
          }
          if !profile.genres.isEmpty {
            HStack(spacing: 6) {
              ForEach(profile.genres.prefix(4), id: \.self) { genre in
                Text(genre).font(.system(size: 10.5, weight: .medium))
                  .padding(.horizontal, 8).padding(.vertical, 3)
                  .background(.ultraThinMaterial, in: Capsule())
              }
            }.padding(.top, 2)
          }
        }
        .foregroundStyle(.white).lineLimit(1)
        Spacer(minLength: 0)
      }.padding(16)
    }
    .frame(height: 220)
    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    .overlay(
      RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Color.sillage(.separator))
    )
    .environment(\.colorScheme, .dark)
  }
}

private struct ArtistLinks: View {
  let profile: ArtistProfile
  var body: some View {
    HStack(spacing: 14) {
      if let url = profile.bio?.url ?? profile.links.wikipedia {
        Link(destination: url) { Label("Wikipedia", systemImage: "book") }
      }
      if let url = profile.links.youtubeMusic {
        Link(destination: url) { Label("YouTube Music", systemImage: "music.note") }
      }
      if let url = profile.links.musicbrainz {
        Link(destination: url) { Label("MusicBrainz", systemImage: "link") }
      }
    }
    .font(.system(size: 12)).foregroundStyle(.secondary).labelStyle(.titleAndIcon)
  }
}

private struct ReleaseTile: View {
  let release: ArtistProfile.Release
  var body: some View {
    let tile = VStack(alignment: .leading, spacing: 6) {
      RemotePicture(url: release.artwork, placeholder: "square.stack")
        .frame(width: 112, height: 112)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
      Text(release.title).font(.system(size: 12, weight: .medium)).lineLimit(1)
      Text([release.kind, release.year].compactMap { $0 }.joined(separator: " · "))
        .font(.system(size: 10.5, design: .monospaced)).foregroundStyle(.secondary)
    }
    .frame(width: 112, alignment: .leading)
    if let url = release.url {
      Link(destination: url) { tile }.buttonStyle(.plain).help("Ouvrir sur YouTube Music")
    } else {
      tile
    }
  }
}

/// A related artist: round portrait and name; opens its page.
private struct RelatedArtistTile: View {
  let artist: ArtistProfile.Related
  @Environment(\.openArtist) private var openArtist
  var body: some View {
    Button {
      openArtist?(artist.name)
    } label: {
      VStack(spacing: 7) {
        RemotePicture(url: artist.portrait).frame(width: 84, height: 84).clipShape(Circle())
          .overlay(Circle().strokeBorder(Color.sillage(.separator)))
        Text(artist.name).font(.system(size: 12, weight: .medium)).lineLimit(1)
      }.frame(width: 96)
    }
    .buttonStyle(.plain).disabled(openArtist == nil)
    .help("Voir la page de \(artist.name)")
  }
}

/// A song of the listener's: title, how often they played it, duration and « Lire ensuite ».
private struct OwnedRow: View {
  let owned: OwnedTrack
  @EnvironmentObject var dj: DJModel
  @State private var hovering = false
  var body: some View {
    let track = owned.video
    let name = TrackTitle(track)
    let playing = dj.current?.id == track.id
    HStack(spacing: 12) {
      TableSongCell(
        track: track, name: name, subtitle: plays, subtitleIsArtist: false, playing: playing,
        onPlay: { dj.play(track, source: .library) })
      Text(track.durationSeconds.map(clock) ?? "").font(.system(size: 11, design: .monospaced))
        .foregroundStyle(.secondary).frame(width: LibraryColumns.duration, alignment: .trailing)
      HStack(spacing: 2) {
        if hovering {
          IconButton(symbol: "text.badge.plus", help: "Lire ensuite") {
            dj.enqueue(track, source: .library)
          }
        }
      }.frame(width: LibraryColumns.actions, alignment: .trailing)
    }
    .modifier(
      TableRowFrame(
        track: track, name: name, playing: playing, onPlay: { dj.play(track, source: .library) },
        onEnqueue: { dj.enqueue(track, source: .library) }, hovering: $hovering))
  }
  private var plays: String {
    switch owned.plays {
    case 0: "Jamais écouté"
    case 1: "Écouté 1 fois"
    default: "Écouté \(owned.plays) fois"
    }
  }
}
