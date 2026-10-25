import RecallKit
import SwiftUI

struct LibraryView: View {
  let onPlay: () -> Void
  @EnvironmentObject var session: Session
  @EnvironmentObject var library: LibraryModel
  @EnvironmentObject var dj: DJModel
  var body: some View {
    VStack(alignment: .leading, spacing: 20) {
      HStack {
        Text("Ta bibliothèque.").font(.largeTitle)
        Spacer()
        if session.hasServer {
          Button(library.syncing ? "Synchronisation…" : "Actualiser YouTube") {
            library.sync(refreshYouTube: true)
          }.disabled(
            library.syncing || library.importing)
        }
      }
      if !session.hasServer {
        if session.loadingCredentials {
          Text("Connexion au serveur en cours…").font(.caption)
        } else {
          Button("Connecter mon serveur") { session.showOnboarding = true }
        }
      }
      Text("Ajouter une playlist YouTube").font(.headline)
      HStack {
        TextField("Coller le lien d’une playlist YouTube…", text: $library.playlistLink)
          .textFieldStyle(.roundedBorder)
          .onSubmit { library.importPlaylist() }
        Button("Ajouter au serveur") { library.importPlaylist() }.disabled(
          library.importing || library.playlistLink.isEmpty || session.loadingCredentials)
      }
      if library.importing {
        HStack {
          ProgressView().controlSize(.small)
          Text(library.importProgress).font(.caption)
          Button("Annuler") { library.cancelImport() }
        }
      } else {
        HStack {
          Text(
            "Playlists publiques ou non répertoriées · colle un lien pour en ajouter une autre. Aucune clé YouTube à saisir."
          ).font(
            .caption
          )
          .foregroundStyle(.secondary)
          SettingsLink { Text("Configurer") }
        }
      }
      if !library.playlists.isEmpty {
        Picker("Playlist", selection: $library.selectedPlaylist) {
          Text("Toutes les playlists").tag("")
          ForEach(library.playlists) { playlist in
            Text("\(playlist.title) · \(playlist.entries)").tag(playlist.id)
          }
        }
      }
      TextField("Un artiste, un titre, un souvenir…", text: $library.query).textFieldStyle(
        .roundedBorder
      ).onChange(of: library.query) { _, _ in library.search() }
      Text("Recherche sur le serveur · aucune bibliothèque enregistrée sur ce Mac.")
        .font(.caption).foregroundStyle(.secondary)
      List(library.results) { row in
        HStack {
          VStack(alignment: .leading) {
            Text(row.track.title)
            Text(row.track.channel ?? "").font(.caption).foregroundStyle(.secondary)
          }
          Spacer()
          Button {
            dj.play(row.track)
            onPlay()
          } label: {
            Image(systemName: "play.fill")
          }.buttonStyle(.borderless).accessibilityLabel("Lire " + row.track.title)
        }
      }.scrollContentBackground(.hidden)
        .id("\(library.currentPage)-\(library.pageSize)-\(library.selectedPlaylist)")
        .overlay {
          if library.searching {
            ProgressView().padding().background(.regularMaterial).clipShape(
              RoundedRectangle(cornerRadius: 10))
          }
        }
      HStack {
        Text(library.resultRange).font(.caption).foregroundStyle(.secondary)
        Spacer()
        Button {
          library.goToPage(library.currentPage - 1)
        } label: {
          Image(systemName: "chevron.left")
        }.accessibilityLabel("Page précédente").disabled(
          library.currentPage <= 1 || library.searching)
        ForEach(Array(library.visiblePages.enumerated()), id: \.element) { index, page in
          if index > 0 && page > library.visiblePages[index - 1] + 1 { Text("…") }
          Button("\(page)") { library.goToPage(page) }
            .fontWeight(page == library.currentPage ? .bold : .regular)
            .tint(page == library.currentPage ? Color.accentColor : Color.secondary)
            .accessibilityLabel("Page \(page) sur \(library.pageCount)")
            .disabled(library.searching)
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
        }.fixedSize().disabled(library.searching)
      }
      if library.libraryCount == 0 {
        Text(
          "Colle le lien d’une playlist YouTube pour l’ajouter à ton serveur."
        ).foregroundStyle(.secondary)
      }
    }.padding(28)
  }
}
