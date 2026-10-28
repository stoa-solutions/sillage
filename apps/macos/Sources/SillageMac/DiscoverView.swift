import SillageKit
import SwiftUI

/// One search across the account's playlists and YouTube (Sillage « Atelier de lumière »).
/// The bar searches while typing; results read as one list with a preview on the right,
/// which folds before the list gets too narrow. Recommendations keep their own grid.
/// The DJ and the queue stay one click away in a panel that opens on demand.
struct DiscoverView: View {
  let openDJ: () -> Void
  @EnvironmentObject var discovery: DiscoveryModel
  @EnvironmentObject var library: LibraryModel
  @EnvironmentObject var session: Session
  @EnvironmentObject var dj: DJModel
  @State private var typing: Task<Void, Never>?
  @State private var selectedID: String?
  @AppStorage("discoverDJPanelCollapsed") private var djCollapsed = true
  @FocusState private var listFocused: Bool
  @AppStorage("discover.recent") private var recentText = ""
  private static let ideas = [
    "Rap français", "Afrobeat", "Jazz doux", "Années 80", "Lo-fi pour travailler",
  ]
  private var recent: [String] { recentText.split(separator: "\n").map(String.init) }

  var body: some View {
    VStack(spacing: 0) {
      GeometryReader { geometry in
        let wide = geometry.size.width >= (djCollapsed ? 780 : 1120)
        HStack(spacing: 0) {
          if wide {
            sidebar.frame(width: LibraryView.sidebarWidth(geometry.size.width))
              .sillageSurface(.sidebar)
            SillageRule(vertical: true)
          }
          main(wide: wide).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .sillageSurface(.reading)
          if !djCollapsed {
            SillageRule(vertical: true)
            DJView(model: dj, panelOnly: true, source: discovery.scope)
              .frame(width: 340).sillageSurface(.sidebar)
              .transition(.move(edge: .trailing).combined(with: .opacity))
          }
        }
      }
      NowPlayingBar(model: dj, player: dj.player, openDJ: openDJ)
    }
    .task(id: session.generation) {
      discovery.loadHome()
      // Recette: a test build can open on results without scripted typing.
      if let query = ProcessInfo.processInfo.environment["SILLAGE_QA_QUERY"],
        discovery.query.isEmpty
      {
        discovery.query = query
      }
    }
    .onChange(of: discovery.query) { _, text in searchWhileTyping(text) }
    .onChange(of: discovery.submittedQuery) { _, _ in selectedID = nil }
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
      Button {
        withAnimation(.easeOut(duration: 0.2)) { djCollapsed.toggle() }
      } label: {
        Label("DJ et file", systemImage: "sidebar.right")
      }.buttonStyle(SillageChipStyle(selected: !djCollapsed))
        .help(djCollapsed ? "Ouvrir le DJ et la file" : "Replier le DJ et la file")
        .accessibilityValue(djCollapsed ? "Replié" : "Ouvert")
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
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(
              "Playlist : "
                + (library.playlists.first { $0.id == discovery.playlistID }?.title
                  ?? "Toutes mes playlists"))
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

  // MARK: Sidebar (same structure as Bibliothèque)

  private var sidebar: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 0) {
        MonoLabel("Découvrir").padding(.horizontal, 12).padding(.bottom, 12)
        LibrarySideRow(title: "Pour toi", symbol: "sparkles", selected: !discovery.searched) {
          showForYou()
        }
        if !recent.isEmpty {
          SillageRule().padding(.horizontal, 12).padding(.vertical, 20)
          HStack {
            MonoLabel("Récentes")
            Spacer()
            Button("Effacer") { recentText = "" }.buttonStyle(.plain).font(.system(size: 11))
              .foregroundStyle(.secondary)
          }.padding(.horizontal, 12).padding(.bottom, 8)
          ForEach(recent.prefix(5), id: \.self) { query in
            LibrarySideRow(
              title: query, symbol: "clock.arrow.circlepath",
              selected: discovery.searched && discovery.submittedQuery == query
            ) { run(query) }
          }
        }
        SillageRule().padding(.horizontal, 12).padding(.vertical, 20)
        MonoLabel("Tes envies").padding(.horizontal, 12).padding(.bottom, 8)
          .help("Les genres les plus présents dans ta bibliothèque et tes écoutes")
        ForEach(ideas, id: \.self) { idea in
          LibrarySideRow(
            title: idea, symbol: "music.note",
            selected: discovery.searched && discovery.submittedQuery == idea
          ) { run(idea) }
        }
        if !library.playlists.isEmpty {
          SillageRule().padding(.horizontal, 12).padding(.vertical, 20)
          MonoLabel("Dans une playlist").padding(.horizontal, 12).padding(.bottom, 8)
          ForEach(library.playlists) { playlist in
            LibraryPlaylistRow(
              title: playlist.title, count: playlist.entries,
              selected: discovery.scope == .library && discovery.playlistID == playlist.id
            ) {
              discovery.scope = .library
              discovery.playlistID = playlist.id
            }
          }
        }
      }.padding(.horizontal, 12).padding(.top, 24).padding(.bottom, 12)
    }
  }

  /// The listener's own genres when the server knows them, else a few starting points.
  private var ideas: [String] {
    let own = (discovery.home?.ideas ?? []).map { $0.prefix(1).uppercased() + $0.dropFirst() }
    return own.isEmpty ? Self.ideas : Array(own.prefix(8))
  }

  private func showForYou() {
    discovery.query = ""
    discovery.clearResults()
  }

  /// When the sidebar is hidden (narrow window or DJ panel open), its shortcuts move here.
  private var shortcuts: some View {
    ScrollView(.horizontal, showsIndicators: false) {
      HStack(spacing: 8) {
        if discovery.searched {
          Chip(title: "Pour toi", symbol: "sparkles", action: showForYou)
        }
        ForEach(recent.prefix(4), id: \.self) { query in
          Chip(title: query, symbol: "clock.arrow.circlepath") { run(query) }
        }
        ForEach(ideas, id: \.self) { idea in
          Chip(title: idea) { run(idea) }
        }
      }
    }
  }

  // MARK: Main

  private func main(wide: Bool) -> some View {
    let rows = self.rows
    return VStack(alignment: .leading, spacing: 0) {
      head(rows).padding(.bottom, 20)
      SearchField(
        prompt: "Un titre, un artiste, une envie…", text: $discovery.query,
        onSubmit: { submit() }, busy: discovery.searching
      ).accessibilityLabel("Rechercher un morceau").padding(.bottom, 12)
      filters.padding(.bottom, 16)
      if !wide { shortcuts.padding(.bottom, 12) }
      if !session.hasServer {
        Button("Continuer avec Google") { session.showOnboarding = true }
          .buttonStyle(LibraryPrimaryButtonStyle()).padding(.bottom, 12)
      }
      if discovery.searched { results(rows) } else { recommendations }
    }.padding(.top, 28).padding(.horizontal, 32).padding(.bottom, 18)
  }

  /// Eyebrow, title and what the page is built from, as in Bibliothèque.
  private func head(_ rows: [DiscoveryRow]) -> some View {
    let playlist =
      discovery.scope == .youtube
      ? nil : library.playlists.first { $0.id == discovery.playlistID }
    return LibraryPageHead(
      eyebrow: discovery.searched ? "Découvrir / Recherche" : "Découvrir / Pour toi",
      title: discovery.searched ? "« \(discovery.submittedQuery) »" : "Pour toi"
    ) {
      if discovery.searched {
        Text(
          [
            discovery.scope.title + (playlist.map { " · " + $0.title } ?? ""),
            rows.isEmpty ? nil : "\(rows.count) résultat\(rows.count > 1 ? "s" : "")",
          ].compactMap { $0 }.joined(separator: ", "))
      } else if let home = discovery.home, !home.basedOn.isEmpty {
        Text("À partir de \(home.basedOn.prefix(6).joined(separator: " · "))").lineLimit(1)
          .help("Tes artistes préférés, tes écoutes récentes et tes genres")
      } else {
        Text("Des artistes que tu ne connais pas encore, selon tes goûts.")
      }
    } trailing: {
      if discovery.searched {
        LibraryLinkButton(title: "Pour toi", symbol: "xmark", action: showForYou)
      } else {
        HStack(spacing: 8) {
          if discovery.homeLoading { ProgressView().controlSize(.small) }
          LibraryLinkButton(title: "D’autres propositions", symbol: "arrow.clockwise") {
            discovery.loadHome(force: true)
          }.disabled(discovery.homeLoading || !session.hasServer)
            .help("Tire d’autres artistes voisins de tes goûts")
        }
      }
    }
  }

  /// « Pour toi » as shelves: each says where it comes from, then its tracks.
  private var recommendations: some View {
    GeometryReader { geometry in
      let compact = geometry.size.width < LibraryColumns.compactBelow
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 0) {
          if let home = discovery.home {
            ForEach(home.sections) { section in
              DiscoveryShelf(section: section, compact: compact).padding(.bottom, 28)
            }
            if let notice = home.notice {
              Text(notice).font(.callout).foregroundStyle(.secondary).padding(.vertical, 8)
            }
            if let empty = home.emptyReason {
              EmptyState(symbol: "sparkles", message: empty)
            }
          } else if discovery.homeLoading {
            HStack(spacing: 8) {
              ProgressView().controlSize(.small)
              Text("Je cherche des artistes proches de tes goûts…").font(.callout)
                .foregroundStyle(.secondary)
            }.frame(maxWidth: .infinity).padding(.top, 60)
          }
          if !discovery.homeError.isEmpty {
            Text(discovery.homeError).font(.callout).foregroundStyle(Color.sillage(.actionText))
              .padding(.vertical, 8)
          }
          if !session.hasServer {
            EmptyState(
              symbol: "person.crop.circle",
              message: "Connecte-toi pour découvrir selon tes écoutes.")
          }
        }.padding(.bottom, 12)
      }.scrollIndicators(.never)
    }
  }

  // MARK: Results

  /// One list: playlist matches first (unless YouTube only), then YouTube videos.
  private var rows: [DiscoveryRow] {
    var rows: [DiscoveryRow] = []
    if discovery.scope != .youtube {
      rows += discovery.libraryTracks.map {
        DiscoveryRow(id: "library:" + $0.id, track: $0, item: nil)
      }
    }
    if discovery.scope != .library {
      rows += discovery.youtube.map {
        DiscoveryRow(id: "youtube:" + $0.id, track: $0.video, item: $0)
      }
    }
    return rows
  }

  /// Rows and the selection are computed once per update, then passed down.
  private func results(_ rows: [DiscoveryRow]) -> some View {
    let selected = rows.first { $0.id == selectedID } ?? rows.first
    return GeometryReader { geometry in
      let preview = geometry.size.width >= 640
      HStack(alignment: .top, spacing: 16) {
        resultList(rows, selected: selected, saveInRows: !preview)
        if preview, let selected { ResultPreview(row: selected, source: discovery.scope) }
      }
    }
  }

  private func resultList(_ rows: [DiscoveryRow], selected: DiscoveryRow?, saveInRows: Bool)
    -> some View
  {
    let lastID = rows.last?.id
    // Same accessory column on every row as soon as one row has a save button.
    let accessorySlot: CGFloat? = saveInRows && rows.contains { $0.item != nil } ? 26 : nil
    return ScrollViewReader { proxy in
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 2) {
          ForEach(Array(rows.enumerated()), id: \.element.id) { position, row in
            SongRow(
              index: position + 1, track: row.track,
              playing: dj.current?.id == row.track.id,
              onPlay: { dj.play(row.track, source: discovery.scope) },
              onEnqueue: { dj.enqueue(row.track, source: discovery.scope) },
              selected: row.id == selected?.id,
              onSelect: {
                selectedID = row.id
                listFocused = true
              },
              accessory: saveInRows && row.item != nil
                ? AnyView(SaveButton(item: row.item!, source: discovery.scope)) : nil,
              onSave: row.item.flatMap(saveAction),
              accessoryWidth: accessorySlot
            )
            .accessibilityAction(named: "Aperçu") { selectedID = row.id }
            .id(row.id)
            .onAppear {
              if row.id == lastID && discovery.nextPage != nil
                && discovery.query.trimmingCharacters(in: .whitespacesAndNewlines)
                  == discovery.submittedQuery
              {
                discovery.search(more: true)
              }
            }
          }
          if !discovery.libraryError.isEmpty && discovery.scope != .youtube {
            error(discovery.libraryError)
          }
          // Both sources usually fail for the same reason: one message, one retry.
          if !discovery.youtubeError.isEmpty && discovery.scope != .library
            && (discovery.youtubeError != discovery.libraryError || discovery.scope == .youtube)
          {
            error(discovery.youtubeError)
          }
          // Cards load more on scroll; the button covers a page too short to scroll.
          if discovery.nextPage != nil && !discovery.searching && discovery.scope != .library {
            Button("Plus de résultats") { discovery.search(more: true) }
              .buttonStyle(SillageChipStyle()).padding(.vertical, 8)
          }
          if rows.isEmpty && discovery.searching {
            HStack(spacing: 8) {
              ProgressView().controlSize(.small)
              Text("Recherche…").font(.callout).foregroundStyle(.secondary)
            }.frame(maxWidth: .infinity).padding(.top, 40)
              .accessibilityElement(children: .combine)
          }
          if rows.isEmpty && !discovery.searching && discovery.libraryError.isEmpty
            && discovery.youtubeError.isEmpty
          {
            EmptyState(
              symbol: "magnifyingglass",
              message: "Aucun résultat. Essaie un titre ou un artiste plus précis.")
          }
        }.padding(.bottom, 12)
      }
      .focusable()
      .focused($listFocused)
      .focusEffectDisabled()
      .onMoveCommand { direction in
        guard let index = rows.firstIndex(where: { $0.id == selected?.id }) else { return }
        let next = direction == .down ? index + 1 : direction == .up ? index - 1 : index
        guard rows.indices.contains(next) else { return }
        selectedID = rows[next].id
        proxy.scrollTo(rows[next].id)
      }
      .onKeyPress(.return) {
        guard let selected else { return .ignored }
        dj.play(selected.track, source: discovery.scope)
        return .handled
      }
    }
    .frame(maxWidth: .infinity)
  }

  /// Saving is offered only for YouTube results not already in the library.
  private func saveAction(_ item: DiscoveryItem) -> (() -> Void)? {
    item.inLibrary || discovery.savedIDs.contains(item.id) ? nil : { discovery.add(item) }
  }

  private func error(_ message: String) -> some View {
    HStack {
      Label(message, systemImage: "exclamationmark.triangle").foregroundStyle(.orange)
        .font(.callout)
      Button("Réessayer") { discovery.search() }.buttonStyle(SillageLinkStyle())
    }.padding(8)
  }
}

struct DiscoveryRow: Identifiable, Equatable {
  let id: String
  let track: Track
  /// The YouTube result, when the row did not come from the person's playlists.
  let item: DiscoveryItem?
  static func == (a: Self, b: Self) -> Bool { a.id == b.id }
}

/// The selected result, larger: cover, song, artist, play with its duration, then the
/// secondary actions. Nothing plays until asked.
private struct ResultPreview: View {
  let row: DiscoveryRow
  let source: DiscoveryScope
  @EnvironmentObject var dj: DJModel
  var body: some View {
    let name = TrackTitle(row.track)
    VStack(alignment: .leading, spacing: 10) {
      // A square cut from the picture itself: YouTube's 4:3 frame letterboxes 16:9 videos,
      // so the image is enlarged past its bands before the centre is kept.
      Color.clear.aspectRatio(1, contentMode: .fit)
        .overlay {
          GeometryReader { geometry in
            let side = geometry.size.width
            Artwork.image(for: row.track, quality: "hqdefault")
              .frame(width: side / 0.75 * 4 / 3, height: side / 0.75)
              .position(x: side / 2, y: side / 2)
          }
        }
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .accessibilityHidden(true)
      Text(name.title).font(.system(size: 20, weight: .semibold)).lineLimit(3)
      Text(name.artist ?? row.track.channel ?? "YouTube").font(.system(size: 15))
        .foregroundStyle(.secondary).lineLimit(1)
      HStack(spacing: 10) {
        Button {
          dj.play(row.track, source: source)
        } label: {
          PlayDisc(size: 40)
        }.buttonStyle(.plain).accessibilityLabel("Lire " + name.title)
        Text(row.track.durationSeconds.map(clock) ?? "").font(.system(size: 13).monospacedDigit())
          .foregroundStyle(.secondary)
        Spacer(minLength: 0)
        IconButton(symbol: "text.badge.plus", help: "Lire ensuite") {
          dj.enqueue(row.track, source: source)
        }
        if let item = row.item { SaveButton(item: item, source: source) }
        IconButton(symbol: "arrow.up.right.square", help: "Ouvrir sur YouTube") {
          NSWorkspace.shared.open(row.track.url)
        }
      }
    }
    .padding(14).frame(width: 260)
    .background(RoundedRectangle(cornerRadius: 12).fill(Color.sillageHover))
    .accessibilityElement(children: .contain).accessibilityLabel("Aperçu")
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
        Image(systemName: "checkmark.circle.fill").foregroundStyle(Color.sillageOrange)
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
      track: item.video, detail: saved ? "Dans ta bibliothèque" : nil, detailColor: .sillageOrange,
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
          }.tint(.sillageOrange).disabled(discovery.addingIDs.contains(item.id))
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

/// A shelf of « Pour toi »: its title, why it is here, then its tracks in table rows.
private struct DiscoveryShelf: View {
  let section: DiscoverySection
  let compact: Bool
  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(alignment: .firstTextBaseline, spacing: 8) {
        Text(section.title).font(.system(size: 15, weight: .semibold))
          .accessibilityAddTraits(.isHeader)
        Text(String(format: "%02d", section.items.count))
          .font(.system(size: 10, design: .monospaced)).foregroundStyle(.secondary)
        Spacer()
        MonoLabel(source, uppercase: false)
      }.padding(.bottom, 4)
      if !section.reason.isEmpty {
        Text(section.reason).font(.system(size: 12)).foregroundStyle(.secondary)
          .padding(.bottom, 10)
      }
      SillageRule()
      ForEach(section.items) { suggestion in
        DiscoverySuggestionRow(suggestion: suggestion, compact: compact)
      }
    }
  }
  private var source: String {
    switch section.kind {
    case "neighbours": "Voisins d’écoute · ListenBrainz"
    case "genre": "Genre de ta bibliothèque"
    default: "Tes artistes"
    }
  }
}

/// A suggested track: song and artist, why it is suggested, duration, then queue and keep.
private struct DiscoverySuggestionRow: View {
  let suggestion: DiscoverySuggestion
  let compact: Bool
  @EnvironmentObject var dj: DJModel
  @State private var hovering = false
  var body: some View {
    let track = suggestion.video
    let name = TrackTitle(track)
    let playing = dj.current?.id == track.id
    HStack(spacing: 12) {
      TableSongCell(
        track: track, name: name, subtitle: suggestion.artist ?? name.artist, playing: playing,
        onPlay: play)
      if !compact {
        Text(suggestion.reason).font(.system(size: 11)).foregroundStyle(.secondary)
          .lineLimit(2).frame(width: 240, alignment: .leading)
      }
      Text(track.durationSeconds.map(clock) ?? "").font(.system(size: 11, design: .monospaced))
        .foregroundStyle(.secondary).frame(width: LibraryColumns.duration, alignment: .trailing)
      HStack(spacing: 2) {
        IconButton(symbol: "text.badge.plus", help: "Lire ensuite") {
          dj.enqueue(track, source: .all)
        }.opacity(hovering ? 1 : 0)
        SaveButton(item: suggestion.item, source: .all)
      }.frame(width: 56, alignment: .trailing)
    }
    .modifier(
      TableRowFrame(
        track: track, name: name, playing: playing, onPlay: play,
        onEnqueue: { dj.enqueue(track, source: .all) }, hovering: $hovering)
    )
    .help(suggestion.reason)
  }
  private func play() { dj.play(suggestion.video, source: .all) }
}
