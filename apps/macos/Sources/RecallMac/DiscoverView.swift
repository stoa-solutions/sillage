import RecallKit
import SwiftUI

/// One search across the account's playlists and YouTube, with the DJ panel alongside.
/// A Raycast-like bar searches while typing; results read like YouTube Music: the best match
/// large, songs from the playlists as a list, YouTube videos as cards.
struct DiscoverView: View {
  let openDJ: () -> Void
  @EnvironmentObject var discovery: DiscoveryModel
  @EnvironmentObject var library: LibraryModel
  @EnvironmentObject var session: Session
  @EnvironmentObject var dj: DJModel
  @State private var showAllLibrary = false
  @State private var typing: Task<Void, Never>?
  @AppStorage("discover.recent") private var recentText = ""
  private static let ideas = [
    "Rap français", "Afrobeat", "Jazz doux", "Années 80", "Lo-fi pour travailler",
    "Soul", "House", "Acoustique", "Live sessions",
  ]
  private var recent: [String] { recentText.split(separator: "\n").map(String.init) }

  var body: some View {
    VStack(spacing: 12) {
      HStack(spacing: 12) {
        VStack(alignment: .leading, spacing: 14) {
          CommandBar(
            prompt: "Un titre, un artiste, une envie…", text: $discovery.query,
            onSubmit: { submit() }
          ) {
            if discovery.searching { ProgressView().controlSize(.small) }
          }.accessibilityLabel("Rechercher un morceau")
          filters
          if !session.hasServer {
            Button("Continuer avec Google") { session.showOnboarding = true }
              .buttonStyle(.borderedProminent)
          }
          ScrollView {
            if discovery.searched { results } else { start }
          }.scrollIndicators(.automatic)
        }.padding(20).frame(maxWidth: .infinity).glassPanel()
        DJView(model: dj, panelOnly: true, source: discovery.scope)
      }
      NowPlayingBar(model: dj, player: dj.player, openDJ: openDJ)
    }.padding(16)
      .task(id: session.generation) { discovery.loadHome() }
      .onChange(of: discovery.query) { _, text in searchWhileTyping(text) }
      .onChange(of: discovery.submittedQuery) { _, _ in showAllLibrary = false }
      .onChange(of: discovery.scope) { _, _ in
        if discovery.searched { discovery.search() }
      }
      .onChange(of: discovery.playlistID) { _, _ in
        if discovery.searched && discovery.scope != .youtube { discovery.search() }
      }
  }

  // MARK: Search

  private var filters: some View {
    HStack(spacing: 8) {
      ForEach(DiscoveryScope.allCases) { scope in
        Chip(title: scope.title, selected: discovery.scope == scope) { discovery.scope = scope }
      }
      Spacer()
      if discovery.scope != .youtube && !library.playlists.isEmpty {
        Menu {
          Button("Toutes mes playlists") { discovery.playlistID = "" }
          Divider()
          ForEach(library.playlists) { playlist in
            Button(playlist.title) { discovery.playlistID = playlist.id }
          }
        } label: {
          HStack(spacing: 4) {
            Text(
              library.playlists.first { $0.id == discovery.playlistID }?.title
                ?? "Toutes mes playlists"
            ).lineLimit(1)
            Image(systemName: "chevron.down").imageScale(.small)
          }.font(.callout).foregroundStyle(.secondary)
        }.menuStyle(.button).buttonStyle(.plain).menuIndicator(.hidden).fixedSize()
      }
    }
  }

  /// Only a deliberate search (Return or a chip) is remembered, never a pause while typing.
  private func submit() {
    typing?.cancel()
    remember(discovery.query.trimmingCharacters(in: .whitespacesAndNewlines))
    discovery.search()
  }

  /// Searching starts once typing pauses; the music and the DJ are never interrupted.
  private func searchWhileTyping(_ text: String) {
    typing?.cancel()
    let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
    if value.isEmpty {
      discovery.clearResults()
      return
    }
    guard value.count >= 2, value != discovery.submittedQuery, session.hasServer else { return }
    typing = Task {
      try? await Task.sleep(for: .milliseconds(450))
      guard !Task.isCancelled else { return }
      discovery.search()
    }
  }

  private func remember(_ query: String) {
    guard !query.isEmpty else { return }
    let list = [query] + recent.filter { $0.caseInsensitiveCompare(query) != .orderedSame }
    recentText = list.prefix(8).joined(separator: "\n")
  }

  private func run(_ query: String) {
    discovery.query = query
    submit()
  }

  // MARK: Before searching

  private var start: some View {
    VStack(alignment: .leading, spacing: 24) {
      recommendations
      if !recent.isEmpty {
        VStack(alignment: .leading, spacing: 10) {
          HStack {
            Text("Recherches récentes").font(.headline)
            Spacer()
            Button("Effacer") { recentText = "" }.buttonStyle(.plain).font(.callout)
              .foregroundStyle(.secondary)
          }
          FlowChips(items: recent, symbol: "clock.arrow.circlepath", action: run)
        }
      }
      if let artist = dj.current.flatMap({ TrackTitle($0).artist }) {
        VStack(alignment: .leading, spacing: 10) {
          Text("Autour de ce que tu écoutes").font(.headline)
          FlowChips(
            items: [artist, "\(artist) live", "\(artist) remix"], symbol: "sparkles", action: run)
        }
      }
      VStack(alignment: .leading, spacing: 10) {
        Text("Des envies pour commencer").font(.headline)
        FlowChips(items: Self.ideas, action: run)
      }
      if !library.playlists.isEmpty {
        VStack(alignment: .leading, spacing: 10) {
          Text("Chercher dans une playlist").font(.headline)
          LazyVGrid(
            columns: [GridItem(.adaptive(minimum: 200), spacing: 10, alignment: .leading)],
            spacing: 10
          ) {
            ForEach(library.playlists.prefix(8)) { playlist in
              Button {
                discovery.scope = .library
                discovery.playlistID = playlist.id
              } label: {
                HStack(spacing: 10) {
                  PlaylistTile(title: playlist.title, size: 40)
                  VStack(alignment: .leading, spacing: 1) {
                    Text(playlist.title).font(.callout.weight(.medium)).lineLimit(1)
                    Text("\(playlist.entries) vidéos").font(.caption).foregroundStyle(.secondary)
                  }
                  Spacer(minLength: 0)
                }
                .padding(8)
                .background(
                  RoundedRectangle(cornerRadius: 10).fill(
                    .white.opacity(discovery.playlistID == playlist.id ? 0.12 : 0.05))
                )
                .contentShape(Rectangle())
              }.buttonStyle(.plain)
            }
          }
        }
      }
    }.frame(maxWidth: .infinity, alignment: .leading).padding(.top, 8)
  }

  private var recommendations: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack {
        Text("À découvrir pour toi").font(.headline)
        Spacer()
        if discovery.homeLoading { ProgressView().controlSize(.small) }
        Button("Actualiser") { discovery.loadHome(force: true) }
          .buttonStyle(.plain).font(.callout).foregroundStyle(.secondary)
          .disabled(discovery.homeLoading || !session.hasServer)
      }
      if let home = discovery.home {
        LazyVGrid(
          columns: [GridItem(.adaptive(minimum: 190, maximum: 280), spacing: 16, alignment: .top)],
          alignment: .leading, spacing: 20
        ) {
          ForEach(home.suggestions) { suggestion in
            VStack(alignment: .leading, spacing: 6) {
              ResultCard(
                track: suggestion.video, onPlay: { dj.play(suggestion.video, source: .all) }
              ) {
                HStack(spacing: 4) {
                  IconButton(symbol: "text.badge.plus", help: "Lire ensuite") {
                    dj.enqueue(suggestion.video, source: .all)
                  }
                  SaveButton(
                    item: DiscoveryItem(video: suggestion.video, inLibrary: suggestion.inLibrary),
                    source: .all)
                }
              }
              Text(suggestion.reason).font(.caption).foregroundStyle(.secondary).lineLimit(2)
            }
          }
        }
        if let notice = home.notice { Text(notice).font(.callout).foregroundStyle(.secondary) }
        if let empty = home.emptyReason { Text(empty).font(.callout).foregroundStyle(.secondary) }
      }
      if !discovery.homeError.isEmpty {
        Text(discovery.homeError).font(.callout).foregroundStyle(.orange)
      }
      if !session.hasServer {
        Text("Connecte-toi pour découvrir selon tes écoutes.").foregroundStyle(.secondary)
      }
    }
  }

  // MARK: Results

  private var best: Track? {
    discovery.scope == .youtube
      ? discovery.youtube.first?.video
      : discovery.libraryTracks.first ?? discovery.youtube.first?.video
  }
  /// The best result shows once: the lists below leave it out while its card is visible.
  private var bestShown: String? { showAllLibrary && discovery.scope != .youtube ? nil : best?.id }
  private var libraryShown: [Track] {
    let others = discovery.libraryTracks.filter { $0.id != bestShown }
    return showAllLibrary ? others : Array(others.prefix(4))
  }

  private var results: some View {
    LazyVStack(alignment: .leading, spacing: 24) {
      if let best, !showAllLibrary || discovery.scope == .youtube {
        ViewThatFits(in: .horizontal) {
          HStack(alignment: .top, spacing: 20) {
            bestResult(best).frame(width: 300)
            songsSection.frame(maxWidth: .infinity)
          }
          VStack(alignment: .leading, spacing: 20) {
            bestResult(best).frame(maxWidth: 360)
            songsSection
          }
        }
      } else if discovery.scope != .youtube {
        songsSection
      }
      if discovery.scope != .library { youtubeSection }
    }.padding(.vertical, 4)
  }

  private func bestResult(_ track: Track) -> some View {
    let name = TrackTitle(track)
    return VStack(alignment: .leading, spacing: 12) {
      Text("Meilleur résultat").font(.headline)
      VStack(alignment: .leading, spacing: 10) {
        Artwork(track: track)
        Text(name.title).font(.title2.bold()).lineLimit(2)
        HStack(spacing: 6) {
          ChannelAvatar(name: name.artist ?? track.channel ?? "?", photo: track.channelAvatarURL)
          Text(name.artist ?? track.channel ?? "YouTube").foregroundStyle(.secondary).lineLimit(1)
        }
        HStack(spacing: 10) {
          Button {
            dj.play(track, source: discovery.scope)
          } label: {
            PlayDisc(size: 44)
          }
          .buttonStyle(.plain).accessibilityLabel("Lire " + name.title)
          IconButton(symbol: "text.badge.plus", help: "Lire ensuite") {
            dj.enqueue(track, source: discovery.scope)
          }.font(.title3)
        }
      }
      .padding(14)
      .background(RoundedRectangle(cornerRadius: 12).fill(.white.opacity(0.05)))
    }
  }

  @ViewBuilder private var songsSection: some View {
    let tracks =
      discovery.scope == .youtube
      ? Array(discovery.youtube.dropFirst().prefix(4).map(\.video)) : libraryShown
    if discovery.scope != .youtube || !tracks.isEmpty {
      VStack(alignment: .leading, spacing: 8) {
        HStack {
          Text(discovery.scope == .youtube ? "Morceaux" : "Dans tes playlists").font(.headline)
          if discovery.scope != .youtube && discovery.libraryTotal > 0 {
            Text("\(discovery.libraryTotal)").foregroundStyle(.secondary)
          }
          Spacer()
          if discovery.scope != .youtube && discovery.libraryTracks.count > 4 {
            Button(showAllLibrary ? "Réduire" : "Tout voir") { showAllLibrary.toggle() }
              .buttonStyle(.plain).font(.callout.weight(.medium)).foregroundStyle(.secondary)
          }
        }
        if !discovery.libraryError.isEmpty && discovery.scope != .youtube {
          error(discovery.libraryError)
        }
        ForEach(tracks, id: \.id) { track in
          SongRow(
            index: nil, track: track, playing: dj.current?.id == track.id,
            onPlay: { dj.play(track, source: discovery.scope) },
            onEnqueue: { dj.enqueue(track, source: discovery.scope) })
        }
        if tracks.isEmpty && !discovery.searching && discovery.libraryError.isEmpty {
          Text("Rien dans tes playlists pour cette recherche.").foregroundStyle(.secondary)
            .padding(.vertical, 8)
        }
      }
    }
  }

  private var youtubeSection: some View {
    let items =
      discovery.scope == .youtube
      ? Array(discovery.youtube.dropFirst(5))
      : discovery.youtube.filter { $0.id != bestShown }
    return VStack(alignment: .leading, spacing: 12) {
      Text("Sur YouTube").font(.headline)
      if !discovery.youtubeError.isEmpty { error(discovery.youtubeError) }
      LazyVGrid(
        columns: [GridItem(.adaptive(minimum: 190, maximum: 280), spacing: 16, alignment: .top)],
        alignment: .leading, spacing: 20
      ) {
        ForEach(items) { item in
          ResultCard(track: item.video, onPlay: { dj.play(item.video, source: discovery.scope) }) {
            SaveButton(item: item, source: discovery.scope)
          }
          .onAppear {
            if item.id == discovery.youtube.last?.id && discovery.nextPage != nil
              && discovery.query.trimmingCharacters(in: .whitespacesAndNewlines)
                == discovery.submittedQuery
            {
              discovery.search(more: true)
            }
          }
        }
      }
      // Cards load more on scroll; the button covers a page too short to scroll.
      if discovery.nextPage != nil && !discovery.searching {
        Button("Plus de résultats") { discovery.search(more: true) }.buttonStyle(.plain)
          .font(.callout.weight(.medium)).foregroundStyle(.secondary)
          .disabled(
            discovery.query.trimmingCharacters(in: .whitespacesAndNewlines)
              != discovery.submittedQuery)
      }
      if discovery.youtube.isEmpty && !discovery.searching && discovery.youtubeError.isEmpty {
        Text("Aucun résultat YouTube. Essaie un titre ou un artiste plus précis.")
          .foregroundStyle(.secondary)
      }
    }
  }

  private func error(_ message: String) -> some View {
    HStack {
      Label(message, systemImage: "exclamationmark.triangle").foregroundStyle(.orange)
        .font(.callout)
      Button("Réessayer") { discovery.search() }.buttonStyle(.link)
    }
  }
}

/// Add a YouTube result to Mes découvertes; once saved it offers Lire ensuite instead.
private struct SaveButton: View {
  let item: DiscoveryItem
  let source: DiscoveryScope
  @EnvironmentObject var discovery: DiscoveryModel
  @EnvironmentObject var dj: DJModel
  private var saved: Bool { item.inLibrary || discovery.savedIDs.contains(item.id) }
  var body: some View {
    if saved {
      Menu {
        Button("Lire ensuite", systemImage: "text.badge.plus") {
          dj.enqueue(item.video, source: source)
        }
      } label: {
        Image(systemName: "checkmark.circle.fill").foregroundStyle(Color.recall)
          .frame(width: 26, height: 26)
      }.menuStyle(.button).buttonStyle(.plain).menuIndicator(.hidden).fixedSize()
        .help("Dans ta bibliothèque").accessibilityLabel("Dans ta bibliothèque")
    } else if discovery.addingIDs.contains(item.id) {
      ProgressView().controlSize(.small).frame(width: 26, height: 26)
    } else {
      IconButton(symbol: "plus.circle", help: "Ajouter à Mes découvertes") {
        discovery.add(item)
      }
    }
  }
}

/// Chips that wrap onto several lines.
private struct FlowChips: View {
  let items: [String]
  var symbol: String? = nil
  let action: (String) -> Void
  var body: some View {
    FlowLayout(spacing: 8) {
      ForEach(items, id: \.self) { item in
        Chip(title: item, symbol: symbol) { action(item) }
      }
    }
  }
}

private struct FlowLayout: Layout {
  var spacing: CGFloat
  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    let width = proposal.width ?? .infinity
    var x: CGFloat = 0
    var y: CGFloat = 0
    var line: CGFloat = 0
    var widest: CGFloat = 0
    for view in subviews {
      let size = view.sizeThatFits(.unspecified)
      if x > 0 && x + size.width > width {
        y += line + spacing
        x = 0
        line = 0
      }
      x += size.width + spacing
      widest = max(widest, x - spacing)
      line = max(line, size.height)
    }
    return CGSize(width: min(widest, width), height: y + line)
  }
  func placeSubviews(
    in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()
  ) {
    var x = bounds.minX
    var y = bounds.minY
    var line: CGFloat = 0
    for view in subviews {
      let size = view.sizeThatFits(.unspecified)
      if x > bounds.minX && x + size.width > bounds.maxX {
        y += line + spacing
        x = bounds.minX
        line = 0
      }
      view.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
      x += size.width + spacing
      line = max(line, size.height)
    }
  }
}

/// A YouTube result: listen now, or add it to the account (saved in Mes découvertes).
struct DiscoveryTrackRow: View {
  let item: DiscoveryItem
  var compact = false
  var source: DiscoveryScope = .library
  @EnvironmentObject var discovery: DiscoveryModel
  @EnvironmentObject var dj: DJModel
  private var saved: Bool { item.inLibrary || discovery.savedIDs.contains(item.id) }
  var body: some View {
    TrackRow(
      track: item.video, detail: saved ? "Dans ta bibliothèque" : nil, detailColor: .recall,
      artworkWidth: compact ? 72 : 140, persistentActions: true,
      onPlay: { dj.play(item.video, source: source) }
    ) {
      HStack(spacing: 6) {
        Button {
          dj.play(item.video, source: source)
        } label: {
          Label("Écouter", systemImage: "play.fill")
        }.help("Lire maintenant ; ta file est remplacée.")
        if saved {
          Button {
            dj.enqueue(item.video, source: source)
          } label: {
            Label("À suivre", systemImage: "text.badge.plus")
          }
        } else {
          Button {
            discovery.add(item)
          } label: {
            Label(discovery.addingIDs.contains(item.id) ? "Ajout…" : "Ajouter", systemImage: "plus")
          }.tint(.recall).disabled(discovery.addingIDs.contains(item.id))
            .accessibilityLabel("Ajouter à ma bibliothèque : " + item.video.title)
        }
      }.buttonStyle(.bordered).buttonBorderShape(.capsule).controlSize(compact ? .small : .regular)
        .labelStyle(compact ? AnyLabelStyle(.iconOnly) : AnyLabelStyle(.titleAndIcon))
    }
  }
}

/// Lets a row pick its label style at runtime.
struct AnyLabelStyle: LabelStyle {
  private let make: (Configuration) -> AnyView
  init<S: LabelStyle>(_ style: S) { make = { AnyView(style.makeBody(configuration: $0)) } }
  func makeBody(configuration: Configuration) -> some View { make(configuration) }
}
