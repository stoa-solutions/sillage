import SillageKit
import SwiftUI

/// Découvrir, only what is new to the listener: « Pour toi », their scenes and the world
/// around an artist, each made of artists they have never heard. From any shelf, an artist
/// opens its own page: the listener wanders freely, with « Retour » to step back. The search
/// looks only outside the library. The DJ and the queue stay one click away.
struct DiscoverView: View {
  let openDJ: () -> Void
  @EnvironmentObject var discovery: DiscoveryModel
  @EnvironmentObject var session: Session
  @EnvironmentObject var dj: DJModel
  @State private var typing: Task<Void, Never>?
  @State private var selectedID: String?
  @AppStorage("discoverDJPanelCollapsed") private var djCollapsed = true
  @FocusState private var listFocused: Bool

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
            DJView(model: dj, panelOnly: true, source: .all)
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
  }

  // MARK: Search

  private func submit() {
    typing?.cancel()
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

  // MARK: Sidebar (same structure as Bibliothèque)

  /// What the listener can explore: their scenes and their artists, known by the server.
  private var scenes: [String] { (discovery.page ?? discovery.home)?.scenes ?? [] }
  private var artists: [String] { (discovery.page ?? discovery.home)?.artists ?? [] }

  private var sidebar: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 0) {
        MonoLabel("Découvrir").padding(.horizontal, 12).padding(.bottom, 12)
        LibrarySideRow(title: "Pour toi", symbol: "sparkles", selected: isHere(.forYou)) {
          discovery.open(.forYou)
        }
        if !scenes.isEmpty {
          SillageRule().padding(.horizontal, 12).padding(.vertical, 20)
          MonoLabel("Tes scènes").padding(.horizontal, 12).padding(.bottom, 8)
            .help("Tes genres les plus écoutés : des artistes de ces scènes que tu n’as pas encore")
          ForEach(scenes, id: \.self) { genre in
            LibrarySideRow(
              title: capitalized(genre), symbol: "waveform", selected: isHere(.scene(genre))
            ) { discovery.open(.scene(genre)) }
          }
        }
        if !artists.isEmpty {
          SillageRule().padding(.horizontal, 12).padding(.vertical, 20)
          MonoLabel("Tes artistes").padding(.horizontal, 12).padding(.bottom, 8)
            .help("Pars d’un artiste que tu aimes : ses voisins et ses collaborations")
          ForEach(artists, id: \.self) { name in
            LibrarySideRow(title: name, symbol: "person", selected: isHere(.artist(name))) {
              discovery.open(.artist(name))
            }
          }
        }
      }.padding(.horizontal, 12).padding(.top, 24).padding(.bottom, 12)
    }
  }

  private func isHere(_ place: DiscoveryPlace) -> Bool {
    !discovery.searched && discovery.place == place
  }

  /// When the sidebar is hidden (narrow window or DJ panel open), its places move here.
  private var shortcuts: some View {
    ScrollView(.horizontal, showsIndicators: false) {
      HStack(spacing: 8) {
        Chip(title: "Pour toi", symbol: "sparkles", selected: isHere(.forYou)) {
          discovery.open(.forYou)
        }
        ForEach(scenes.prefix(6), id: \.self) { genre in
          Chip(title: capitalized(genre), selected: isHere(.scene(genre))) {
            discovery.open(.scene(genre))
          }
        }
      }
    }
  }

  // MARK: Main

  private func main(wide: Bool) -> some View {
    let rows = self.rows
    return VStack(alignment: .leading, spacing: 0) {
      // An artist's page is headed by its own banner; only the way back stays above it.
      if case .artist = discovery.place, !discovery.searched {
        artistBar.padding(.bottom, 14)
      } else {
        head(rows).padding(.bottom, 20)
      }
      HStack(spacing: 8) {
        SearchField(
          prompt: "Un artiste, un titre que tu n’as pas encore…", text: $discovery.query,
          onSubmit: { submit() }, busy: discovery.searching
        ).accessibilityLabel("Chercher de la musique nouvelle")
        Button {
          withAnimation(.easeOut(duration: 0.2)) { djCollapsed.toggle() }
        } label: {
          Label("DJ et file", systemImage: "sidebar.right")
        }.buttonStyle(SillageChipStyle(selected: !djCollapsed))
          .help(djCollapsed ? "Ouvrir le DJ et la file" : "Replier le DJ et la file")
          .accessibilityValue(djCollapsed ? "Replié" : "Ouvert")
      }.padding(.bottom, 16)
      if !wide { shortcuts.padding(.bottom, 12) }
      if !session.hasServer {
        Button("Continuer avec Google") { session.showOnboarding = true }
          .buttonStyle(LibraryPrimaryButtonStyle()).padding(.bottom, 12)
      }
      if discovery.searched { results(rows) } else { shelves }
    }.padding(.top, 28).padding(.horizontal, 32).padding(.bottom, 18)
  }

  /// Eyebrow, title and what the page is built from, as in Bibliothèque.
  private func head(_ rows: [DiscoveryRow]) -> some View {
    LibraryPageHead(eyebrow: eyebrow, title: title) {
      if discovery.searched {
        Text(
          rows.isEmpty
            ? "Hors de ta bibliothèque"
            : "\(rows.count) résultat\(rows.count > 1 ? "s" : ""), hors de ta bibliothèque")
      } else {
        switch discovery.place {
        case .forYou:
          if let home = discovery.home, !home.basedOn.isEmpty {
            Text("À partir de \(home.basedOn.prefix(6).joined(separator: " · "))").lineLimit(1)
              .help("Tes artistes préférés et tes écoutes")
          } else {
            Text("Des artistes que tu ne connais pas encore, selon tes goûts.")
          }
        case .scene:
          Text("Des artistes de cette scène que tu n’as jamais écoutés.")
        case .artist:
          Text("Ses titres, ses voisins d’écoute et ses collaborations.")
        }
      }
    } trailing: {
      HStack(spacing: 8) {
        if discovery.searched {
          LibraryLinkButton(title: "Fermer la recherche", symbol: "xmark") {
            discovery.query = ""
            discovery.clearResults()
          }
        } else {
          if !discovery.trail.isEmpty {
            LibraryLinkButton(title: "Retour", symbol: "chevron.left") { discovery.back() }
          }
          if loading { ProgressView().controlSize(.small) }
          LibraryLinkButton(title: "D’autres propositions", symbol: "arrow.clockwise") {
            if discovery.place == .forYou {
              discovery.loadHome(force: true)
            } else {
              discovery.loadPage(force: true)
            }
          }.disabled(loading || !session.hasServer)
            .help("Tire d’autres artistes")
        }
      }
    }
  }

  private var artistBar: some View {
    HStack(spacing: 12) {
      if !discovery.trail.isEmpty {
        LibraryLinkButton(title: "Retour", symbol: "chevron.left") { discovery.back() }
      }
      MonoLabel("Découvrir / Artiste")
      Spacer(minLength: 0)
      if loading { ProgressView().controlSize(.small) }
    }
  }

  private var eyebrow: String {
    if discovery.searched { return "Découvrir / Recherche" }
    return switch discovery.place {
    case .forYou: "Découvrir / Pour toi"
    case .scene: "Découvrir / Scène"
    case .artist: "Découvrir / Artiste"
    }
  }
  private var title: String {
    if discovery.searched { return "« \(discovery.submittedQuery) »" }
    return switch discovery.place {
    case .forYou: "Pour toi"
    case .scene(let genre): capitalized(genre)
    case .artist(let name): name
    }
  }
  private var loading: Bool {
    discovery.place == .forYou ? discovery.homeLoading : discovery.pageLoading
  }

  /// The current place as shelves: each says where it comes from, then its tracks.
  private var shelves: some View {
    let forYou = discovery.place == .forYou
    let content = forYou ? discovery.home : discovery.page
    let failure = forYou ? discovery.homeError : discovery.pageError
    return GeometryReader { geometry in
      let compact = geometry.size.width < LibraryColumns.compactBelow
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 0) {
          if case .artist(let name) = discovery.place, !discovery.searched {
            ArtistHero(name: name).padding(.bottom, 28).id(name)
          }
          if let content {
            ForEach(content.sections) { section in
              DiscoveryShelf(section: section, compact: compact).padding(.bottom, 28)
            }
            if let notice = content.notice {
              Text(notice).font(.callout).foregroundStyle(.secondary).padding(.vertical, 8)
            }
            if let empty = content.emptyReason {
              EmptyState(symbol: "sparkles", message: empty)
            }
          } else if loading {
            HStack(spacing: 8) {
              ProgressView().controlSize(.small)
              Text(waiting).font(.callout).foregroundStyle(.secondary)
            }.frame(maxWidth: .infinity).padding(.top, 60)
          }
          if !failure.isEmpty {
            Text(failure).font(.callout).foregroundStyle(Color.sillage(.actionText))
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

  private var waiting: String {
    switch discovery.place {
    case .forYou: "Je cherche des artistes proches de tes goûts…"
    case .scene(let genre): "Je cherche des artistes \(genre) que tu n’as pas…"
    case .artist(let name): "Je cherche autour de \(name)…"
    }
  }

  // MARK: Results

  /// YouTube only, without what the library already has.
  private var rows: [DiscoveryRow] {
    discovery.youtube.filter { !$0.inLibrary }.map {
      DiscoveryRow(id: "youtube:" + $0.id, track: $0.video, item: $0)
    }
  }

  /// Rows and the selection are computed once per update, then passed down.
  private func results(_ rows: [DiscoveryRow]) -> some View {
    let selected = rows.first { $0.id == selectedID } ?? rows.first
    return GeometryReader { geometry in
      let preview = geometry.size.width >= 640
      HStack(alignment: .top, spacing: 16) {
        resultList(rows, selected: selected, saveInRows: !preview)
        if preview, let selected { ResultPreview(row: selected, source: .youtube) }
      }
    }
  }

  private func resultList(_ rows: [DiscoveryRow], selected: DiscoveryRow?, saveInRows: Bool)
    -> some View
  {
    let lastID = rows.last?.id
    let accessorySlot: CGFloat? = saveInRows && !rows.isEmpty ? 26 : nil
    return ScrollViewReader { proxy in
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 2) {
          ForEach(Array(rows.enumerated()), id: \.element.id) { position, row in
            SongRow(
              index: position + 1, track: row.track,
              playing: dj.current?.id == row.track.id,
              onPlay: { dj.play(row.track, source: .youtube) },
              onEnqueue: { dj.enqueue(row.track, source: .youtube) },
              selected: row.id == selected?.id,
              onSelect: {
                selectedID = row.id
                listFocused = true
              },
              accessory: saveInRows && row.item != nil
                ? AnyView(SaveButton(item: row.item!, source: .youtube)) : nil,
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
          if !discovery.youtubeError.isEmpty { error(discovery.youtubeError) }
          // Cards load more on scroll; the button covers a page too short to scroll.
          if discovery.nextPage != nil && !discovery.searching {
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
          if rows.isEmpty && !discovery.searching && discovery.youtubeError.isEmpty {
            EmptyState(
              symbol: "magnifyingglass",
              message: "Rien de nouveau pour cette recherche. Essaie un artiste ou un titre.")
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
        dj.play(selected.track, source: .youtube)
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

/// « digital cumbia » → « Digital cumbia », for a title or a row.
func capitalized(_ genre: String) -> String { genre.prefix(1).uppercased() + genre.dropFirst() }

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
      if let artist = name.artist {
        ArtistLink(text: artist, font: .system(size: 15))
      } else {
        Text(row.track.channel ?? "YouTube").font(.system(size: 15))
          .foregroundStyle(.secondary).lineLimit(1)
      }
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
  @EnvironmentObject var discovery: DiscoveryModel
  /// The artists of the shelf, in order, except the one whose page this already is.
  private var artists: [String] {
    var seen = Set<String>()
    return section.items.compactMap(\.artist).filter { name in
      if case .artist(let here) = discovery.place, here == name { return false }
      return seen.insert(name).inserted
    }
  }
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
          .padding(.bottom, 8)
      }
      if !artists.isEmpty {
        // Each new artist opens its own page: the listener goes wherever they like.
        HStack(spacing: 6) {
          ForEach(artists, id: \.self) { name in
            Button {
              discovery.open(.artist(name))
            } label: {
              Label(name, systemImage: "arrow.up.right").labelStyle(.titleAndIcon)
            }.buttonStyle(SillageChipStyle()).controlSize(.small)
              .help("Explorer autour de \(name)")
          }
        }.padding(.bottom, 10)
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
    case "collaborations": "Collaborations · MusicBrainz"
    case "scene": "Scène · MusicBrainz"
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
