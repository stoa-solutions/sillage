import RecallKit
import SwiftUI

struct LibraryView: View {
  let onPlay: () -> Void
  @EnvironmentObject var session: Session
  @EnvironmentObject var library: LibraryModel
  @EnvironmentObject var dj: DJModel
  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      HStack(alignment: .firstTextBaseline) {
        VStack(alignment: .leading, spacing: 2) {
          Text("Bibliothèque").font(.largeTitle.bold())
          Text(
            session.hasServer
              ? "\(library.libraryCount) vidéos sur ton serveur" : "Serveur à connecter"
          ).foregroundStyle(.secondary)
        }
        Spacer()
        if session.hasServer {
          Button {
            library.sync(refreshYouTube: true)
          } label: {
            Label(
              library.syncing ? "Synchronisation…" : "Actualiser YouTube",
              systemImage: "arrow.clockwise")
          }.disabled(library.syncing || library.importing)
        }
      }
      if !session.hasServer {
        if session.loadingCredentials {
          Text("Connexion au serveur en cours…").font(.caption)
        } else {
          Button("Connecter mon serveur") { session.showOnboarding = true }
            .buttonStyle(.borderedProminent)
        }
      }
      VStack(alignment: .leading, spacing: 6) {
        HStack {
          TextField("Lien d’une playlist YouTube", text: $library.playlistLink)
            .textFieldStyle(.roundedBorder)
            .onSubmit { library.importPlaylist() }
          Button("Ajouter") { library.importPlaylist() }.disabled(
            library.importing || library.playlistLink.isEmpty || session.loadingCredentials)
        }
        if library.importing {
          HStack {
            ProgressView().controlSize(.small)
            Text(library.importProgress)
            Button("Annuler") { library.cancelImport() }.buttonStyle(.link)
          }.font(.caption)
        } else {
          Text("Playlists publiques ou non répertoriées. Aucune clé YouTube à saisir.")
            .font(.caption).foregroundStyle(.secondary)
        }
      }
      Divider()
      ViewThatFits(in: .horizontal) {
        HStack { search; playlistPicker.frame(maxWidth: 240) }
        VStack(alignment: .leading) { search; playlistPicker }
      }
      List(library.results) { row in
        TrackRow(track: row.track) {
          dj.play(row.track)
          onPlay()
        }
      }.scrollContentBackground(.hidden)
        .id("\(library.currentPage)-\(library.pageSize)-\(library.selectedPlaylist)")
        .overlay {
          if library.searching {
            ProgressView().padding().background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10))
          } else if library.libraryCount == 0 && session.hasServer {
            Text("Colle le lien d’une playlist YouTube pour remplir ta bibliothèque.")
              .foregroundStyle(.secondary)
          }
        }
      ViewThatFits(in: .horizontal) {
        HStack { pages(numbered: true) }
        HStack { pages(numbered: false) }
      }
    }.padding(20)
  }

  private var search: some View {
    TextField("Un artiste, un titre, un souvenir…", text: $library.query)
      .textFieldStyle(.roundedBorder)
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
          .tint(page == library.currentPage ? Color.accentColor : Color.secondary)
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

/// A library video: YouTube thumbnail, channel with its avatar, start of the description.
private struct TrackRow: View {
  let track: Track
  let play: () -> Void
  @State private var hovering = false
  var body: some View {
    HStack(alignment: .top, spacing: 12) {
      Button(action: play) {
        AsyncImage(url: URL(string: "https://i.ytimg.com/vi/\(track.id)/mqdefault.jpg")) {
          image in image.resizable().scaledToFill()
        } placeholder: {
          Color.secondary.opacity(0.15)
        }
        .frame(width: 128, height: 72).clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay {
          if hovering {
            Image(systemName: "play.fill").font(.title2).foregroundStyle(.white)
              .frame(maxWidth: .infinity, maxHeight: .infinity)
              .background(.black.opacity(0.35), in: RoundedRectangle(cornerRadius: 8))
          }
        }
        .overlay(alignment: .bottomTrailing) {
          if let duration = track.durationSeconds, duration > 0 {
            Text(clock(duration)).font(.caption2.monospacedDigit().weight(.medium))
              .foregroundStyle(.white).padding(.horizontal, 4).padding(.vertical, 1)
              .background(.black.opacity(0.7), in: RoundedRectangle(cornerRadius: 4)).padding(4)
          }
        }
      }.buttonStyle(.plain).onHover { hovering = $0 }.accessibilityLabel("Lire " + track.title)
      VStack(alignment: .leading, spacing: 5) {
        Text(track.title).fontWeight(.medium).lineLimit(2)
        if let channel = track.channel, !channel.isEmpty {
          HStack(spacing: 6) {
            ChannelAvatar(name: channel)
            Text(channelName(channel)).font(.callout).foregroundStyle(.secondary).lineLimit(1)
          }
        }
        if let summary = summary(track.description) {
          Text(summary).font(.caption).foregroundStyle(.tertiary).lineLimit(2)
        }
      }
    }.padding(.vertical, 4).contentShape(Rectangle()).onTapGesture(count: 2, perform: play)
  }
  /// Skips YouTube's "Provided to YouTube by" line and links, and keeps the first real sentences.
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
}

/// YouTube's auto-generated artist channels end in " - Topic"; the artist name is what matters.
private func channelName(_ channel: String) -> String {
  channel.hasSuffix(" - Topic") ? String(channel.dropLast(8)) : channel
}

/// Initial on a colour derived from the channel name, so a channel keeps its colour everywhere.
private struct ChannelAvatar: View {
  let name: String
  var body: some View {
    let label = channelName(name)
    let seed = label.unicodeScalars.reduce(0) { ($0 &* 31 &+ Int($1.value)) & 0xFFFF }
    Circle().fill(Color(hue: Double(seed % 360) / 360, saturation: 0.45, brightness: 0.62))
      .frame(width: 20, height: 20)
      .overlay {
        Text(label.first.map { String($0).uppercased() } ?? "?")
          .font(.system(size: 10, weight: .bold)).foregroundStyle(.white)
      }.accessibilityHidden(true)
  }
}
