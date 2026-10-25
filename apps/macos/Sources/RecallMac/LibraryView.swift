import RecallKit
import SwiftUI

struct LibraryView: View {
  let onPlay: () -> Void
  @EnvironmentObject var session: Session
  @EnvironmentObject var library: LibraryModel
  @EnvironmentObject var dj: DJModel
  var body: some View {
    VStack(spacing: 12) {
      VStack(alignment: .leading, spacing: 16) {
        PageHeader(
          title: "Bibliothèque",
          subtitle: session.hasServer
            ? "\(library.libraryCount) vidéos sur ton compte" : "Connecte ton compte pour la retrouver"
        ) {
          if session.hasServer {
            Button {
              library.sync(refreshYouTube: true)
            } label: {
              Label(
                library.syncing ? "Synchronisation…" : "Actualiser", systemImage: "arrow.clockwise")
            }.buttonStyle(GlassButtonStyle(emphasized: true))
              .disabled(library.syncing || library.importing)
              .help("Récupérer les nouveautés de tes playlists YouTube")
          }
        }
        if !session.hasServer && !session.loadingCredentials {
          Button("Continuer avec Google") { session.showOnboarding = true }
            .buttonStyle(.borderedProminent)
        }
        importRow
        ViewThatFits(in: .horizontal) {
          HStack(spacing: 12) { search; playlistPicker.frame(maxWidth: 240) }
          VStack(alignment: .leading) { search; playlistPicker }
        }
        List(library.results) { row in
          TrackRow(track: row.track, detail: summary(row.track.description), onPlay: { play(row.track) }) {
            HStack(spacing: 6) {
              Button {
                dj.enqueue(row.track)
              } label: {
                Image(systemName: "text.badge.plus")
              }.help("Lire ensuite").accessibilityLabel("Lire ensuite : \(row.track.title)")
              Button {
                play(row.track)
              } label: {
                Image(systemName: "play.fill")
              }.help("Lire maintenant").accessibilityLabel("Lire " + row.track.title)
            }.buttonStyle(.borderless)
          }.listRowSeparator(.visible)
        }.listStyle(.plain).scrollContentBackground(.hidden)
          .id("\(library.currentPage)-\(library.pageSize)-\(library.selectedPlaylist)")
          .overlay {
            if library.searching {
              ProgressView().padding().glassPanel(radius: 10)
            } else if library.libraryCount == 0 && session.hasServer {
              EmptyState(
                symbol: "music.note.list",
                message: "Colle le lien d’une playlist YouTube pour remplir ta bibliothèque.")
            } else if library.results.isEmpty && !library.query.isEmpty {
              EmptyState(symbol: "magnifyingglass", message: "Aucun morceau ne correspond.")
            }
          }
        ViewThatFits(in: .horizontal) {
          HStack { pages(numbered: true) }
          HStack { pages(numbered: false) }
        }
      }.padding(20).glassPanel()
      NowPlayingBar(model: dj, player: dj.player, openDJ: onPlay)
    }.padding(16)
  }

  private func play(_ track: Track) {
    dj.play(track)
    onPlay()
  }

  private var importRow: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack(spacing: 8) {
        HStack(spacing: 8) {
          Image(systemName: "link").foregroundStyle(.secondary)
          TextField("Coller le lien d’une playlist YouTube", text: $library.playlistLink)
            .textFieldStyle(.plain).onSubmit { library.importPlaylist() }
        }.padding(.horizontal, 12).padding(.vertical, 9)
          .background(.quaternary.opacity(0.6), in: RoundedRectangle(cornerRadius: 12))
        Button("Ajouter") { library.importPlaylist() }.buttonStyle(.borderedProminent)
          .disabled(
            library.importing || library.playlistLink.isEmpty || session.loadingCredentials)
      }.help("Playlists publiques ou non répertoriées ; aucune clé YouTube à saisir.")
      if library.importing {
        HStack {
          ProgressView().controlSize(.small)
          Text(library.importProgress)
          Button("Annuler") { library.cancelImport() }.buttonStyle(.link)
        }.font(.caption)
      }
    }
  }

  private var search: some View {
    SearchField(prompt: "Un artiste, un titre, un souvenir…", text: $library.query)
      .onChange(of: library.query) { _, _ in library.search() }
  }

  @ViewBuilder private var playlistPicker: some View {
    if !library.playlists.isEmpty {
      Picker("Playlist", selection: $library.selectedPlaylist) {
        Text("Toutes les playlists").tag("")
        ForEach(library.playlists) { playlist in
          Text("\(playlist.title) (\(playlist.entries))").tag(playlist.id)
        }
      }.labelsHidden()
    }
  }

  @ViewBuilder private func pages(numbered: Bool) -> some View {
    Text(library.resultRange).font(.caption).foregroundStyle(.secondary).fixedSize()
    Spacer()
    Button {
      library.goToPage(library.currentPage - 1)
    } label: {
      Image(systemName: "chevron.left")
    }.accessibilityLabel("Page précédente").disabled(
      library.currentPage <= 1 || library.searching)
    if numbered {
      ForEach(Array(library.visiblePages.enumerated()), id: \.element) { index, page in
        if index > 0 && page > library.visiblePages[index - 1] + 1 { Text("…") }
        Button("\(page)") { library.goToPage(page) }
          .fontWeight(page == library.currentPage ? .bold : .regular)
          .tint(page == library.currentPage ? Color.recall : Color.secondary)
          .accessibilityLabel("Page \(page) sur \(library.pageCount)")
          .disabled(library.searching)
      }
    } else {
      Text("\(library.currentPage) / \(library.pageCount)").font(.caption.monospacedDigit())
    }
    Button {
      library.goToPage(library.currentPage + 1)
    } label: {
      Image(systemName: "chevron.right")
    }.accessibilityLabel("Page suivante").disabled(
      library.currentPage >= library.pageCount || library.searching)
    Picker("Par page", selection: $library.pageSize) {
      Text("25").tag(25)
      Text("50").tag(50)
      Text("100").tag(100)
    }.labelsHidden().fixedSize().disabled(library.searching).help("Résultats par page")
  }
}

/// Start of a YouTube description without the "Provided to YouTube by" line and links.
private func summary(_ description: String?) -> String? {
  let lines = (description ?? "").split(whereSeparator: \.isNewline)
    .filter { !$0.hasPrefix("Provided to YouTube by") }
    .map { line in
      line.split(separator: " ").filter { !$0.contains("http") && !$0.hasPrefix("www.") }
        .joined(separator: " ")
    }.filter { !$0.isEmpty }
  let text = lines.prefix(3).joined(separator: " ")
  return text.isEmpty ? nil : text
}
