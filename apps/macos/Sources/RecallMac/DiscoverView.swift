import RecallKit
import SwiftUI

/// One search across the account's playlists and YouTube, with the DJ panel alongside.
struct DiscoverView: View {
  let openDJ: () -> Void
  @EnvironmentObject var discovery: DiscoveryModel
  @EnvironmentObject var library: LibraryModel
  @EnvironmentObject var session: Session
  @EnvironmentObject var dj: DJModel
  @State private var showAllLibrary = false
  private var visibleLibrary: [Track] {
    discovery.scope == .all && !showAllLibrary
      ? Array(discovery.libraryTracks.prefix(3)) : discovery.libraryTracks
  }
  var body: some View {
    VStack(spacing: 12) {
      HStack(spacing: 12) {
        VStack(alignment: .leading, spacing: 16) {
          PageHeader(title: "Découvrir", subtitle: "Cherche dans tes playlists et sur YouTube.")
          HStack(spacing: 8) {
            SearchField(
              prompt: "Un titre, un artiste, une envie…", text: $discovery.query,
              onSubmit: { discovery.search() }
            ).accessibilityLabel("Rechercher un morceau")
            Button("Rechercher") { discovery.search() }.buttonStyle(.borderedProminent)
              .disabled(
                discovery.query.trimmingCharacters(in: .whitespacesAndNewlines).count < 2
                  || !session.hasServer)
          }
          ViewThatFits(in: .horizontal) {
            HStack {
              scopes
              Spacer()
              playlistPicker
            }
            VStack(alignment: .leading) {
              scopes
              playlistPicker
            }
          }
          if !session.hasServer {
            Button("Continuer avec Google") { session.showOnboarding = true }
          }
          results
        }.padding(20).frame(maxWidth: .infinity).glassPanel()
        ViewThatFits(in: .horizontal) {
          DJView(model: dj, panelOnly: true).frame(width: 350).glassPanel()
          EmptyView()
        }.frame(maxWidth: 350)
      }
      NowPlayingBar(model: dj, player: dj.player, openDJ: openDJ)
    }.padding(16)
      .onChange(of: discovery.submittedQuery) { _, _ in showAllLibrary = false }
      .onChange(of: discovery.scope) { _, _ in if discovery.searched { discovery.search() } }
      .onChange(of: discovery.playlistID) { _, _ in
        if discovery.searched && discovery.scope != .youtube { discovery.search() }
      }
  }

  private var results: some View {
    ScrollView {
      LazyVStack(alignment: .leading, spacing: 10) {
        if !discovery.searched {
          EmptyState(
            symbol: "sparkle.magnifyingglass",
            message: "Cherche un morceau : tes playlists, YouTube, ou les deux. La musique continue.")
        }
        if discovery.searched && discovery.scope != .youtube {
          SectionHeader("Dans tes playlists", count: discovery.libraryTotal)
          if !discovery.libraryError.isEmpty { error(discovery.libraryError) }
          ForEach(visibleLibrary.map { ("library:" + $0.id, $0) }, id: \.0) { _, track in
            TrackRow(track: track, artworkWidth: 96, onPlay: { dj.play(track) }) {
              Button {
                dj.enqueue(track)
              } label: {
                Label("À suivre", systemImage: "text.badge.plus")
              }.buttonStyle(.bordered).buttonBorderShape(.capsule)
            }
            Divider()
          }
          if visibleLibrary.count < discovery.libraryTracks.count {
            Button("Voir les autres résultats de mes playlists") { showAllLibrary = true }
              .buttonStyle(.link)
          }
          if discovery.libraryTracks.isEmpty && !discovery.searching
            && discovery.libraryError.isEmpty
          {
            Text("Aucun morceau dans tes playlists pour cette recherche.").foregroundStyle(
              .secondary)
          }
        }
        if discovery.searched && discovery.scope != .library {
          SectionHeader("Sur YouTube")
          if !discovery.youtubeError.isEmpty { error(discovery.youtubeError) }
          ForEach(discovery.youtube.map { ("youtube:" + $0.id, $0) }, id: \.0) { _, item in
            DiscoveryTrackRow(item: item)
            Divider()
          }
          if discovery.youtube.isEmpty && !discovery.searching && discovery.youtubeError.isEmpty {
            Text("Aucun résultat YouTube. Essaie un titre ou un artiste plus précis.")
              .foregroundStyle(.secondary)
          }
          if discovery.nextPage != nil {
            Button("Résultats suivants") { discovery.search(more: true) }
              .disabled(
                discovery.searching
                  || discovery.query.trimmingCharacters(in: .whitespacesAndNewlines)
                    != discovery.submittedQuery)
          }
        }
        if discovery.searching {
          HStack {
            ProgressView().controlSize(.small)
            Text("Recherche en cours…").foregroundStyle(.secondary)
          }
        }
      }.padding(.vertical, 4)
    }
  }
  private var scopes: some View {
    Picker("Chercher dans", selection: $discovery.scope) {
      ForEach(DiscoveryScope.allCases) { Text($0.title).tag($0) }
    }.pickerStyle(.segmented).labelsHidden().fixedSize().neutralSelection()
  }
  private var playlistPicker: some View {
    Picker("Playlist", selection: $discovery.playlistID) {
      Text("Toutes mes playlists").tag("")
      ForEach(library.playlists) { Text($0.title).tag($0.id) }
    }.labelsHidden().frame(maxWidth: 230).disabled(discovery.scope == .youtube)
  }
  private func error(_ message: String) -> some View {
    HStack {
      Label(message, systemImage: "exclamationmark.triangle").foregroundStyle(.orange)
        .font(.callout)
      Button("Réessayer") { discovery.search() }.buttonStyle(.link)
    }
  }
}

/// A YouTube result: listen now, or add it to the account (saved in Mes découvertes).
struct DiscoveryTrackRow: View {
  let item: DiscoveryItem
  var compact = false
  @EnvironmentObject var discovery: DiscoveryModel
  @EnvironmentObject var dj: DJModel
  private var saved: Bool { item.inLibrary || discovery.savedIDs.contains(item.id) }
  var body: some View {
    TrackRow(
      track: item.video, detail: saved ? "Dans ta bibliothèque" : nil,
      artworkWidth: compact ? 72 : 96, persistentActions: true, onPlay: { dj.play(item.video) }
    ) {
      HStack(spacing: 6) {
        Button {
          dj.play(item.video)
        } label: {
          Label("Écouter", systemImage: "play.fill")
        }.help("Lire maintenant ; ta file est remplacée.")
        if saved {
          Button {
            dj.enqueue(item.video)
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
