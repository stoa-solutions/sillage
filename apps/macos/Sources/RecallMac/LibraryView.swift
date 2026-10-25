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
        Button("Importer JSON…") { library.importFile() }.disabled(library.importing)
        if session.hasServer && session.useServer {
          Button(library.syncing ? "Synchronisation…" : "Actualiser YouTube") {
            library.sync(refreshYouTube: true)
          }.disabled(
            library.syncing)
        }
      }
      if session.hasServer {
        Picker("Bibliothèque", selection: $session.useServer) {
          Text("Sur ce Mac").tag(false)
          Text("Mon serveur").tag(true)
        }.pickerStyle(.segmented)
      }
      if session.useServer {
        Button("Garder une copie sur ce Mac") { library.copyServerLocally() }.disabled(
          library.importing || library.syncing)
      }
      HStack {
        TextField("Coller le lien d’une playlist YouTube…", text: $library.playlistLink)
          .textFieldStyle(.roundedBorder)
          .onSubmit { library.importPlaylist() }
        Button("Importer sur ce Mac") { library.importPlaylist() }.disabled(
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
          Text("Import YouTube via ton serveur personnel · aucune clé YouTube à saisir.").font(
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
            Text("\(playlist.title) · \(playlist.videoIDs.count)").tag(playlist.id)
          }
        }
      }
      TextField("Un artiste, un titre, un souvenir…", text: $library.query).textFieldStyle(
        .roundedBorder
      ).onChange(of: library.query) { _, _ in library.search() }
      Text(
        session.useServer
          ? "Recherche hybride sur ton serveur privé."
          : "Recherche locale dans les titres et métadonnées."
      ).font(.caption).foregroundStyle(.secondary)
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
      if library.hasMore { Button("Afficher plus") { library.search(more: true) } }
      if library.libraryCount == 0 {
        Text(
          "Colle une playlist YouTube ou importe un export Recall / yt-dlp. Ta bibliothèque reste sur ce Mac."
        ).foregroundStyle(.secondary)
      }
    }.padding(28)
  }
}
