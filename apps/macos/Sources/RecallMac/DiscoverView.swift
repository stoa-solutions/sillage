import RecallKit
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
    "Soul", "House", "Acoustique", "Live sessions",
  ]
  private var recent: [String] { recentText.split(separator: "\n").map(String.init) }

  var body: some View {
    VStack(spacing: 0) {
      HStack(spacing: 0) {
        VStack(alignment: .leading, spacing: 12) {
          SearchField(
            prompt: "Un titre, un artiste, une envie…", text: $discovery.query,
            onSubmit: { submit() }, busy: discovery.searching
          ).accessibilityLabel("Rechercher un morceau")
          filters
          if !session.hasServer {
            Button("Continuer avec Google") { session.showOnboarding = true }
              .buttonStyle(.borderedProminent)
          }
          if discovery.searched {
            results
          } else {
            ScrollView { start }.scrollIndicators(.automatic)
          }
        }.padding(.top, 12).padding(.horizontal, 16)
          .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
          .sillageSurface(.reading)
        if !djCollapsed {
          SillageRule(vertical: true)
          DJView(model: dj, panelOnly: true, source: discovery.scope)
            .frame(width: 340).sillageSurface(.sidebar)
            .transition(.move(edge: .trailing).combined(with: .opacity))
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
                    discovery.playlistID == playlist.id
                      ? Color.sillage(.selection) : Color.sillageHover)
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
  private var results: some View {
    let rows = self.rows
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
    return ScrollViewReader { proxy in
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 2) {
          ForEach(rows) { row in
            DiscoveryResultRow(
              row: row, selected: row.id == selected?.id, playing: dj.current?.id == row.track.id,
              source: discovery.scope, showsSave: saveInRows,
              select: {
                selectedID = row.id
                listFocused = true
              }
            )
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
          if !discovery.youtubeError.isEmpty && discovery.scope != .library {
            error(discovery.youtubeError)
          }
          // Cards load more on scroll; the button covers a page too short to scroll.
          if discovery.nextPage != nil && !discovery.searching && discovery.scope != .library {
            Button("Plus de résultats") { discovery.search(more: true) }
              .buttonStyle(SillageChipStyle()).padding(.vertical, 8)
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

  private func error(_ message: String) -> some View {
    HStack {
      Label(message, systemImage: "exclamationmark.triangle").foregroundStyle(.orange)
        .font(.callout)
      Button("Réessayer") { discovery.search() }.buttonStyle(.link)
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

/// A search result in the list: thumbnail, song on up to two lines, artist, duration and the
/// queue action. One click selects (preview), a double click or Return plays.
private struct DiscoveryResultRow: View {
  let row: DiscoveryRow
  let selected: Bool
  let playing: Bool
  let source: DiscoveryScope
  /// When the preview is folded, saving a YouTube result stays on the row itself.
  var showsSave = false
  let select: () -> Void
  @EnvironmentObject var dj: DJModel
  @EnvironmentObject var discovery: DiscoveryModel
  @State private var hovering = false
  var body: some View {
    let name = TrackTitle(row.track)
    HStack(spacing: 12) {
      Artwork(track: row.track, showsDuration: false).frame(width: 96)
      VStack(alignment: .leading, spacing: 3) {
        Text(name.title).font(.system(size: 14, weight: .medium)).lineLimit(2)
          .foregroundStyle(playing ? Color.sillage(.actionText) : Color.primary)
        Text(name.artist ?? row.track.channel ?? "YouTube").font(.system(size: 12))
          .foregroundStyle(.secondary).lineLimit(1)
      }.frame(maxWidth: .infinity, alignment: .leading)
      if playing {
        // The playing song is marked by a symbol too, never by colour alone.
        Image(systemName: "speaker.wave.2.fill").font(.system(size: 11))
          .foregroundStyle(Color.sillage(.primaryFill)).accessibilityHidden(true)
      }
      Text(row.track.durationSeconds.map(clock) ?? "").font(.system(size: 12).monospacedDigit())
        .foregroundStyle(.secondary)
      IconButton(symbol: "text.badge.plus", help: "Lire ensuite") {
        dj.enqueue(row.track, source: source)
      }
      if showsSave, let item = row.item { SaveButton(item: item, source: source) }
    }
    .padding(.horizontal, 8).padding(.vertical, 8)
    .overlay(alignment: .bottom) {
      if !selected { SillageRule().opacity(0.5).padding(.leading, 116) }
    }
    .background {
      RoundedRectangle(cornerRadius: 8)
        .fill(selected ? Color.sillage(.selection) : hovering ? Color.sillageHover : .clear)
        .overlay {
          if selected {
            RoundedRectangle(cornerRadius: 8).strokeBorder(
              Color.sillage(.primaryFill), lineWidth: 1.5)
          }
        }
    }
    .contentShape(Rectangle())
    .onHover { hovering = $0 }
    .onTapGesture(count: 2) { dj.play(row.track, source: source) }
    .onTapGesture(perform: select)
    .help(name.artist.map { "\(name.title), \($0)" } ?? name.title)
    .accessibilityElement(children: .contain)
    .accessibilityLabel(name.artist.map { "\(name.title), \($0)" } ?? name.title)
    .accessibilityValue(
      [selected ? "Sélectionné" : nil, playing ? "En lecture" : nil].compactMap { $0 }
        .joined(separator: ", ")
    )
    .accessibilityAddTraits(selected ? .isSelected : [])
    .accessibilityAction(named: "Lire") { dj.play(row.track, source: source) }
    .accessibilityAction(named: "Lire ensuite") { dj.enqueue(row.track, source: source) }
    .accessibilityAction(named: "Aperçu", select)
    .accessibilityAction(named: "Ouvrir sur YouTube") { NSWorkspace.shared.open(row.track.url) }
    .modifier(SaveAction(item: row.item))
    .contextMenu {
      Button("Lire maintenant", systemImage: "play.fill") { dj.play(row.track, source: source) }
      Button("Lire ensuite", systemImage: "text.badge.plus") {
        dj.enqueue(row.track, source: source)
      }
      if let item = row.item, !(item.inLibrary || discovery.savedIDs.contains(item.id)) {
        Button("Ajouter à Mes découvertes", systemImage: "plus.circle") { discovery.add(item) }
      }
      Divider()
      Button("Ouvrir sur YouTube", systemImage: "arrow.up.right.square") {
        NSWorkspace.shared.open(row.track.url)
      }
    }
  }
}

/// VoiceOver can save a YouTube result from its row, whatever the window width. The action
/// list changes, never the row's identity, so focus stays on the row just saved.
private struct SaveAction: ViewModifier {
  let item: DiscoveryItem?
  @EnvironmentObject var discovery: DiscoveryModel
  func body(content: Content) -> some View {
    content.accessibilityActions {
      if let item, !(item.inLibrary || discovery.savedIDs.contains(item.id)) {
        Button("Ajouter à Mes découvertes") { discovery.add(item) }
      }
    }
  }
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
