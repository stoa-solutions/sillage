import RecallKit
import SwiftUI

/// Playlists on the left, the chosen one on the right as a dense song list, as in Spotify.
/// Rows load while scrolling; a narrow window swaps the sidebar for a playlist menu.
struct LibraryView: View {
  let onPlay: () -> Void
  @EnvironmentObject var session: Session
  @EnvironmentObject var library: LibraryModel
  @EnvironmentObject var dj: DJModel
  @State private var adding = false
  @State private var deleting: ServerPlaylistSummary?

  var body: some View {
    VStack(spacing: 12) {
      GeometryReader { geometry in
        let wide = geometry.size.width >= 780
        HStack(spacing: 12) {
          if wide && session.hasServer {
            sidebar.frame(width: 230).glassPanel()
          }
          main(wide: wide).glassPanel()
        }
      }
      NowPlayingBar(model: dj, player: dj.player, openDJ: onPlay)
    }.padding(16)
      .task(id: session.generation) { await library.watchEnrichment() }
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

  private var sidebar: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack {
        Text("Playlists").font(.headline)
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
      }.padding(.horizontal, 14).padding(.top, 14).padding(.bottom, 8)
      ScrollView {
        VStack(spacing: 2) {
          playlistItem(
            id: "", title: "Toutes les vidéos", count: library.libraryCount,
            symbol: "music.note.list")
          ForEach(library.playlists) { playlist in
            playlistItem(id: playlist.id, title: playlist.title, count: playlist.entries)
              .contextMenu {
                Button("Retirer de ma bibliothèque…", systemImage: "trash", role: .destructive) {
                  deleting = playlist
                }
              }
          }
        }.padding(.horizontal, 8)
      }
      if library.importing {
        importStatus.padding(12)
      }
    }
  }

  private func playlistItem(id: String, title: String, count: Int, symbol: String? = nil)
    -> some View
  {
    let selected = library.selectedPlaylist == id
    return Button {
      library.selectedPlaylist = id
    } label: {
      HStack(spacing: 10) {
        PlaylistTile(title: title, symbol: symbol, size: 36)
        VStack(alignment: .leading, spacing: 1) {
          Text(title).font(.callout.weight(.medium)).lineLimit(1)
          Text("\(count) vidéos").font(.caption).foregroundStyle(.secondary)
        }
        Spacer(minLength: 0)
      }
      .padding(6)
      .background(
        RoundedRectangle(cornerRadius: 8).fill(.white.opacity(selected ? 0.1 : 0))
      )
      .contentShape(Rectangle())
    }.buttonStyle(.plain).accessibilityAddTraits(selected ? .isSelected : [])
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
        header(wide: wide).padding(20)
        songs
      }
    }
  }

  private var deletingBinding: Binding<Bool> {
    Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } })
  }
  private var title: String { library.selectedPlaylistSummary?.title ?? "Toutes les vidéos" }
  private var count: Int { library.selectedPlaylistSummary?.entries ?? library.libraryCount }

  private func header(wide: Bool) -> some View {
    VStack(alignment: .leading, spacing: 16) {
      HStack(alignment: .bottom, spacing: 18) {
        PlaylistTile(
          title: title, symbol: library.selectedPlaylist.isEmpty ? "music.note.list" : nil,
          size: 104
        ).shadow(color: .black.opacity(0.4), radius: 12, y: 6)
        VStack(alignment: .leading, spacing: 6) {
          Text(library.selectedPlaylist.isEmpty ? "Bibliothèque" : "Playlist").font(.callout)
            .foregroundStyle(.secondary)
          if wide {
            Text(title).font(.system(size: 34, weight: .bold)).lineLimit(1)
              .minimumScaleFactor(0.6)
          } else {
            playlistMenu
          }
          HStack(spacing: 10) {
            Text("\(count) vidéos").foregroundStyle(.secondary)
            enrichmentChip
          }.font(.callout)
        }
      }
      HStack(spacing: 12) {
        Button(action: playAll) { PlayDisc(size: 44) }.buttonStyle(.plain)
          .disabled(library.results.isEmpty).help("Lire depuis le début")
          .accessibilityLabel("Lire \(title)")
        IconButton(symbol: "shuffle", help: "Lire dans un ordre aléatoire", action: shuffle)
          .font(.title3).disabled(library.results.isEmpty)
        if let playlist = library.selectedPlaylistSummary {
          Menu {
            Button("Retirer de ma bibliothèque…", systemImage: "trash", role: .destructive) {
              deleting = playlist
            }
          } label: {
            Image(systemName: "ellipsis").font(.title3).frame(width: 26, height: 26)
              .contentShape(Rectangle())
          }.menuStyle(.button).buttonStyle(.plain).menuIndicator(.hidden).fixedSize()
            .foregroundStyle(.secondary).help("Plus d’actions pour cette playlist")
            .accessibilityLabel("Plus d’actions pour \(playlist.title)")
        }
        if !wide {
          IconButton(symbol: "plus", help: "Ajouter une playlist YouTube") { adding = true }
            .font(.title3)
            .popover(isPresented: $adding, arrowEdge: .bottom) { importForm.padding(16) }
        }
        Spacer()
        SearchField(prompt: "Filtrer : artiste, titre, souvenir…", text: $library.query)
          .frame(maxWidth: 300)
          .onChange(of: library.query) { _, _ in library.search() }
      }
      if !wide && library.importing { importStatus }
    }
  }

  private var playlistMenu: some View {
    Menu {
      Button("Toutes les vidéos") { library.selectedPlaylist = "" }
      Divider()
      ForEach(library.playlists) { playlist in
        Button(playlist.title) { library.selectedPlaylist = playlist.id }
      }
    } label: {
      HStack(spacing: 6) {
        Text(title).font(.system(size: 28, weight: .bold)).lineLimit(1)
        Image(systemName: "chevron.down").font(.callout.weight(.semibold))
          .foregroundStyle(.secondary)
      }
    }.menuStyle(.button).buttonStyle(.plain).menuIndicator(.hidden).fixedSize()
  }

  @ViewBuilder private var enrichmentChip: some View {
    if let progress = library.enrichment, progress.enabled, progress.remaining > 0 {
      EnrichmentChip(progress: progress, error: library.enrichmentError)
    }
  }

  private var songs: some View {
    ScrollView {
      LazyVStack(spacing: 0) {
        ForEach(library.results) { row in
          SongRow(
            index: row.id + 1, track: row.track, playing: dj.current?.id == row.track.id,
            onPlay: { play(row.track) }, onEnqueue: { dj.enqueue(row.track) }
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
      }.padding(.horizontal, 10).padding(.bottom, 12)
    }
    .id("\(library.selectedPlaylist)|\(library.query)")
    .overlay {
      if library.searching && library.results.isEmpty {
        ProgressView()
      } else if library.results.isEmpty && !library.query.isEmpty && !library.searching {
        EmptyState(symbol: "magnifyingglass", message: "Aucun morceau ne correspond.")
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
      Button("Annuler") { library.cancelImport() }.buttonStyle(.link)
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
      .background(Capsule().fill(.white.opacity(0.07)))
    }.buttonStyle(.plain).help("Détails de l’enrichissement MusicBrainz")
      .popover(isPresented: $open) {
        EnrichmentProgressView(progress: progress, error: error).padding(12).frame(width: 420)
      }
  }
}
