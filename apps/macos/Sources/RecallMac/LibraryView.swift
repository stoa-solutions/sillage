import RecallKit
import SwiftUI

/// Sillage « Atelier de lumière »: one surface, playlists on the left, the filter on top,
/// a small collection header and a dense song list. Rows load while scrolling; a narrow
/// window swaps the sidebar for a playlist menu on the title.
struct LibraryView: View {
  let onPlay: () -> Void
  @EnvironmentObject var session: Session
  @EnvironmentObject var library: LibraryModel
  @EnvironmentObject var dj: DJModel
  @State private var adding = false
  @State private var deleting: ServerPlaylistSummary?
  @State private var showingHistory = false
  // Recette: a test build can open on Mon goût (SILLAGE_QA_LIBRARY=taste) without a click.
  private static let qaTaste = ProcessInfo.processInfo.environment["SILLAGE_QA_LIBRARY"] == "taste"
  @State private var showingTaste = qaTaste
  @EnvironmentObject var history: ListeningHistoryModel

  var body: some View {
    VStack(spacing: 0) {
      GeometryReader { geometry in
        let wide = geometry.size.width >= 780
        HStack(spacing: 0) {
          if wide && session.hasServer {
            sidebar.frame(width: Self.sidebarWidth(geometry.size.width))
              .sillageSurface(.sidebar)
            SillageRule(vertical: true)
          }
          main(wide: wide).frame(maxWidth: .infinity, maxHeight: .infinity)
            .sillageSurface(.reading)
        }
      }
      NowPlayingBar(model: dj, player: dj.player, openDJ: onPlay)
    }
    .task(id: session.generation) { await library.watchEnrichment() }
    .onChange(of: session.generation) { _, _ in
      showingHistory = false
      showingTaste = Self.qaTaste
    }
    .confirmationDialog(
      "Retirer « \(deleting?.title ?? "") » ?", isPresented: deletingBinding,
      titleVisibility: .visible, presenting: deleting
    ) { playlist in
      Button("Retirer", role: .destructive) { library.deletePlaylist(playlist) }
    } message: { playlist in
      Text(
        playlist.syncEnabled
          ? "Ses vidéos quittent ta bibliothèque, sauf celles présentes dans une autre de tes playlists. La playlist reste intacte sur YouTube ; tu pourras la rajouter avec son lien."
          : "Ses vidéos quittent ta bibliothèque, sauf celles présentes dans une autre de tes playlists."
      )
    }
  }

  // MARK: Sidebar

  /// The 2026-10-28 board gives the sidebar about a fifth of the window, within readable bounds.
  static func sidebarWidth(_ window: CGFloat) -> CGFloat { min(max(window * 0.21, 250), 290) }

  private var sidebar: some View {
    VStack(alignment: .leading, spacing: 0) {
      ScrollView {
        VStack(alignment: .leading, spacing: 0) {
          MonoLabel("Bibliothèque").padding(.horizontal, 12).padding(.bottom, 12)
          LibrarySideRow(
            title: "Toutes les vidéos", symbol: "music.note.list",
            count: library.libraryCount,
            selected: !showingHistory && !showingTaste && library.selectedPlaylist.isEmpty
          ) { showPlaylist("") }
          LibrarySideRow(title: "Mon goût", symbol: "waveform", selected: showingTaste) {
            showingHistory = false
            showingTaste = true
          }
          LibrarySideRow(
            title: "Écoutes récentes", symbol: "clock.arrow.circlepath", selected: showingHistory,
            action: openHistory)
          SillageRule().padding(.horizontal, 12).padding(.vertical, 20)
          HStack(spacing: 2) {
            MonoLabel("Tes playlists")
            Spacer()
            IconButton(symbol: "plus", help: "Ajouter une playlist YouTube") { adding = true }
              .popover(isPresented: $adding, arrowEdge: .bottom) { importForm.padding(16) }
            IconButton(
              symbol: "arrow.clockwise", help: "Récupérer les nouveautés de tes playlists YouTube"
            ) { library.sync(refreshYouTube: true) }
            .disabled(library.syncing || library.importing)
            .rotationEffect(.degrees(library.syncing ? 360 : 0))
            .animation(
              library.syncing ? .linear(duration: 1).repeatForever(autoreverses: false) : .default,
              value: library.syncing)
          }.padding(.leading, 12).padding(.bottom, 8)
          ForEach(library.playlists) { playlist in
            LibraryPlaylistRow(
              title: playlist.title, count: playlist.entries,
              selected: !showingHistory && !showingTaste
                && library.selectedPlaylist == playlist.id
            ) { showPlaylist(playlist.id) }
            .contextMenu {
              Button("Retirer de ma bibliothèque…", systemImage: "trash", role: .destructive) {
                deleting = playlist
              }
            }
          }
        }.padding(.horizontal, 12).padding(.top, 24).padding(.bottom, 12)
      }
      if library.importing {
        importStatus.padding(12)
      }
    }
  }

  private func showPlaylist(_ id: String) {
    showingHistory = false
    showingTaste = false
    library.selectedPlaylist = id
  }

  private func openHistory() {
    showingTaste = false
    showingHistory = true
    history.load(session)
  }

  // MARK: Main

  @ViewBuilder private func main(wide: Bool) -> some View {
    if !session.hasServer {
      VStack(spacing: 14) {
        EmptyState(
          symbol: "person.crop.circle",
          message: "Connecte ton compte pour retrouver ta bibliothèque.")
        Button("Continuer avec Google") { session.showOnboarding = true }
          .buttonStyle(.borderedProminent).disabled(session.loadingCredentials)
      }.frame(maxWidth: .infinity, maxHeight: .infinity)
    } else if showingTaste {
      TasteOverviewView(
        taste: dj.taste, current: dj.current, play: play, enqueue: { dj.enqueue($0) },
        explore: { showPlaylist("") })
    } else if showingHistory {
      ListeningHistoryView(
        model: history, play: play, enqueue: { dj.enqueue($0) },
        clear: { history.clear(session) }, refresh: { history.load(session) },
        loadMore: { history.load(session, more: true) })
    } else if library.overviewLoaded && library.libraryCount == 0 && !library.syncing {
      VStack(alignment: .leading, spacing: 16) {
        Text("Ta bibliothèque est vide").font(.largeTitle.bold())
        Text("Colle le lien d’une playlist YouTube, publique ou non répertoriée.")
          .foregroundStyle(.secondary)
        importForm.frame(maxWidth: 520)
        if library.importing { importStatus }
      }.padding(32).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    } else {
      VStack(alignment: .leading, spacing: 0) {
        head(wide: wide).padding(.bottom, 24)
        controls(wide: wide).padding(.bottom, 20)
        if !wide && library.importing { importStatus.padding(.bottom, 12) }
        songs
      }.padding(.top, 28).padding(.horizontal, 32).padding(.bottom, 18)
    }
  }

  private var deletingBinding: Binding<Bool> {
    Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } })
  }
  private var title: String { library.selectedPlaylistSummary?.title ?? "Toutes les vidéos" }
  private var count: Int { library.selectedPlaylistSummary?.entries ?? library.libraryCount }

  /// Eyebrow, title and counts; Mon goût one click away on the right.
  private func head(wide: Bool) -> some View {
    LibraryPageHead(
      eyebrow: library.selectedPlaylist.isEmpty ? "Ta collection" : "Playlist",
      title: title
    ) {
      HStack(spacing: 8) {
        Text("\(count.formatted()) titres").font(.system(size: 11, design: .monospaced))
        if library.selectedPlaylist.isEmpty && !library.playlists.isEmpty {
          Circle().fill(.secondary).frame(width: 3, height: 3)
          Text(
            "\(library.playlists.count) playlist\(library.playlists.count > 1 ? "s" : "")"
          ).font(.system(size: 11))
        }
        enrichmentChip
      }
    } trailing: {
      if wide {
        LibraryLinkButton(title: "Mon goût", trailingSymbol: "chevron.right") {
          showingHistory = false
          showingTaste = true
        }
      } else {
        playlistMenu
      }
    }
  }

  /// Play, shuffle, the playlist's own actions, then the filter on the right.
  private func controls(wide: Bool) -> some View {
    HStack(spacing: 10) {
      Button(action: playAll) { Label("Tout lire", systemImage: "play.fill") }
        .buttonStyle(LibraryPrimaryButtonStyle()).disabled(library.results.isEmpty)
        .help("Lire depuis le début").accessibilityLabel("Lire \(title)")
      Button(action: shuffle) { Label("Aléatoire", systemImage: "shuffle") }
        .buttonStyle(LibrarySecondaryButtonStyle()).disabled(library.results.isEmpty)
        .help("Lire dans un ordre aléatoire")
      if let playlist = library.selectedPlaylistSummary {
        Menu {
          Button("Retirer de ma bibliothèque…", systemImage: "trash", role: .destructive) {
            deleting = playlist
          }
        } label: {
          Image(systemName: "ellipsis").frame(width: 36, height: 36)
            .background(
              RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Color.sillageHover))
            .contentShape(Rectangle())
        }.menuStyle(.button).buttonStyle(.plain).menuIndicator(.hidden).fixedSize()
          .foregroundStyle(.secondary).help("Plus d’actions pour cette playlist")
          .accessibilityLabel("Plus d’actions pour \(playlist.title)")
      }
      if !wide {
        IconButton(symbol: "plus", help: "Ajouter une playlist YouTube") { adding = true }
          .popover(isPresented: $adding, arrowEdge: .bottom) { importForm.padding(16) }
      }
      Spacer(minLength: 12)
      SearchField(prompt: "Filtrer : artiste, titre, souvenir…", text: $library.query)
        .onChange(of: library.query) { _, _ in library.search() }
        .accessibilityLabel("Filtrer la bibliothèque")
        .frame(maxWidth: 324)
    }
  }

  private var playlistMenu: some View {
    Menu {
      Button("Mon goût") {
        showingHistory = false
        showingTaste = true
      }
      Button("Écoutes récentes", action: openHistory)
      Divider()
      Button("Toutes les vidéos") {
        showingHistory = false
        showingTaste = false
        library.selectedPlaylist = ""
      }
      Divider()
      ForEach(library.playlists) { playlist in
        Button(playlist.title) {
          showingHistory = false
          showingTaste = false
          library.selectedPlaylist = playlist.id
        }
      }
    } label: {
      // A narrow window has no sidebar: the collections live in this menu.
      HStack(spacing: 6) {
        Image(systemName: "rectangle.stack").font(.system(size: 14))
        Text("Collections").font(.system(size: 12))
        Image(systemName: "chevron.down").font(.system(size: 10, weight: .semibold))
      }.foregroundStyle(.secondary)
        .accessibilityElement(children: .ignore).accessibilityLabel("Collection : \(title)")
    }.menuStyle(.button).buttonStyle(.plain).menuIndicator(.hidden).fixedSize()
  }

  @ViewBuilder private var enrichmentChip: some View {
    // Shown while work remains that the rounded percentage can still reveal.
    if let progress = library.enrichment, progress.enabled, progress.remaining > 0,
      progress.fraction < 0.995
    {
      EnrichmentChip(progress: progress, error: library.enrichmentError)
    }
  }

  private var songs: some View {
    GeometryReader { geometry in
      let compact = geometry.size.width < LibraryColumns.compactBelow
      VStack(spacing: 0) {
        TableHeaderRow {
          MonoLabel("#").frame(width: 26)
          MonoLabel("Titre").frame(maxWidth: .infinity, alignment: .leading)
          if !compact {
            MonoLabel("Artiste").frame(width: LibraryColumns.artist, alignment: .leading)
          }
          MonoLabel("Durée").frame(width: LibraryColumns.duration, alignment: .trailing)
          Color.clear.frame(width: LibraryColumns.actions, height: 1)
        }
        ScrollView {
          LazyVStack(spacing: 0) {
            ForEach(library.results) { row in
              LibraryTableRow(
                index: row.id + 1, track: row.track, playing: dj.current?.id == row.track.id,
                compact: compact, onPlay: { play(row.track) },
                onEnqueue: { dj.enqueue(row.track) }
              )
              .onAppear {
                if row.id == library.results.count - 10 || row.id == library.results.count - 1 {
                  library.search(more: true)
                }
              }
            }
            if library.loadingMore {
              ProgressView().controlSize(.small).padding(12)
            }
          }
        }
        // A legacy scroller would narrow the rows and shift their columns off the header.
        .scrollIndicators(.never)
        .id("\(library.selectedPlaylist)|\(library.query)")
        .overlay {
          if library.searching && library.results.isEmpty {
            ProgressView()
          } else if library.results.isEmpty && !library.query.isEmpty && !library.searching {
            EmptyState(symbol: "magnifyingglass", message: "Aucun morceau ne correspond.")
          }
        }
        HStack {
          MonoLabel(
            library.query.isEmpty
              ? "\(count.formatted()) titres dans \(library.selectedPlaylist.isEmpty ? "ta bibliothèque" : "cette playlist")"
              : "\(library.results.count.formatted()) titres trouvés", uppercase: false)
          Spacer()
          Text("Les playlists restent intactes sur YouTube.").font(.system(size: 10))
            .foregroundStyle(.secondary)
        }.padding(.horizontal, 10).padding(.top, 12)
      }
    }
  }

  // MARK: Import

  private var importForm: some View {
    VStack(alignment: .leading, spacing: 10) {
      Text("Ajouter une playlist YouTube").font(.headline)
      HStack(spacing: 8) {
        HStack(spacing: 8) {
          Image(systemName: "link").foregroundStyle(.secondary)
          TextField("youtube.com/playlist?list=…", text: $library.playlistLink)
            .textFieldStyle(.plain).onSubmit(importPlaylist)
        }.padding(.horizontal, 12).padding(.vertical, 9)
          .background(.quaternary.opacity(0.6), in: RoundedRectangle(cornerRadius: 10))
          .frame(minWidth: 300)
        Button("Ajouter", action: importPlaylist).buttonStyle(.borderedProminent)
          .disabled(
            library.importing || library.playlistLink.isEmpty || session.loadingCredentials)
      }
      Text("Publique ou non répertoriée, aucune clé YouTube à saisir.").font(.caption)
        .foregroundStyle(.secondary)
    }
  }

  private var importStatus: some View {
    HStack(spacing: 8) {
      ProgressView().controlSize(.small)
      Text(library.importProgress).lineLimit(2)
      Spacer(minLength: 0)
      Button("Annuler") { library.cancelImport() }.buttonStyle(SillageLinkStyle())
    }.font(.caption)
  }

  private func importPlaylist() {
    adding = false
    library.importPlaylist()
  }

  // MARK: Playback

  /// The loaded rows, from the first: one plays, the next ones go to À suivre.
  private func playAll() { start(library.results.map(\.track)) }
  private func shuffle() { start(library.results.map(\.track).shuffled()) }
  private func start(_ tracks: [Track]) {
    guard let first = tracks.first else { return }
    dj.play(first)
    for track in tracks.dropFirst().prefix(24) { dj.enqueue(track) }
    onPlay()
  }
  private func play(_ track: Track) {
    dj.play(track)
    onPlay()
  }
}

/// Enrichment progress in one short line; the details open on click.
private struct EnrichmentChip: View {
  let progress: EnrichmentProgress
  let error: String
  @State private var open = false
  var body: some View {
    Button {
      open = true
    } label: {
      HStack(spacing: 6) {
        ProgressView(value: progress.fraction).progressViewStyle(.circular).controlSize(.mini)
          .tint(.recall)
        Text("Enrichissement \(Int((progress.fraction * 100).rounded())) %")
      }
      .foregroundStyle(.secondary)
      .padding(.horizontal, 8).padding(.vertical, 3)
      .background(Capsule().fill(Color.sillageHover))
    }.buttonStyle(.plain).help("Détails de l’enrichissement MusicBrainz")
      .popover(isPresented: $open) {
        EnrichmentProgressView(progress: progress, error: error).padding(12).frame(width: 420)
      }
  }
}

/// A sidebar entry: glyph, title, optional count; an orange edge marks the selection.
private struct LibrarySideRow: View {
  let title: String
  let symbol: String
  var count: Int? = nil
  let selected: Bool
  let action: () -> Void
  @State private var hovering = false
  var body: some View {
    Button(action: action) {
      HStack(spacing: 10) {
        Image(systemName: symbol).font(.system(size: 15))
          .foregroundStyle(selected ? Color.sillage(.actionText) : .secondary)
          .frame(width: 20).accessibilityHidden(true)
        Text(title).font(.system(size: 13, weight: selected ? .semibold : .regular))
          .foregroundStyle(selected ? Color.primary : .secondary).lineLimit(1)
        Spacer(minLength: 4)
        if let count {
          Text(count.formatted()).font(.system(size: 11, design: .monospaced))
            .foregroundStyle(.secondary)
        }
      }
      .padding(.horizontal, 12).frame(height: 44)
      .modifier(LibrarySelection(selected: selected, hovering: hovering))
    }.buttonStyle(.plain).onHover { hovering = $0 }
      .accessibilityAddTraits(selected ? .isSelected : []).padding(.vertical, 2)
  }
}

/// A playlist in the sidebar: its tile, title and number of titles.
private struct LibraryPlaylistRow: View {
  let title: String
  let count: Int
  let selected: Bool
  let action: () -> Void
  @State private var hovering = false
  var body: some View {
    Button(action: action) {
      HStack(spacing: 10) {
        PlaylistTile(title: title, size: 34)
        VStack(alignment: .leading, spacing: 2) {
          Text(title).font(.system(size: 12, weight: .medium)).lineLimit(1).help(title)
          Text("\(count.formatted()) titre\(count > 1 ? "s" : "")").font(.system(size: 11))
            .foregroundStyle(.secondary)
        }
        Spacer(minLength: 0)
      }
      .padding(.horizontal, 12).frame(height: 64)
      .modifier(LibrarySelection(selected: selected, hovering: hovering))
    }.buttonStyle(.plain).onHover { hovering = $0 }
      .accessibilityAddTraits(selected ? .isSelected : [])
  }
}

private struct LibrarySelection: ViewModifier {
  let selected: Bool
  let hovering: Bool
  func body(content: Content) -> some View {
    content
      .background(
        RoundedRectangle(cornerRadius: 8, style: .continuous).fill(
          selected ? Color.sillageSelectionGlass : hovering ? Color.sillageHover : .clear)
      )
      .overlay(alignment: .leading) {
        if selected {
          Capsule().fill(Color.sillage(.primaryFill)).frame(width: 3, height: 20)
        }
      }
      .contentShape(Rectangle())
  }
}
