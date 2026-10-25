import RecallKit
import SwiftUI

struct DiscoverView: View {
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
      HStack(spacing: 16) {
        VStack(alignment: .leading, spacing: 18) {
          VStack(alignment: .leading, spacing: 4) {
            Text("Découvrir").font(.system(size: 42, weight: .bold))
            Text("Une recherche, deux horizons.").font(.title3).foregroundStyle(.secondary)
          }
          HStack {
            Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
            TextField("Un titre, un artiste, une envie…", text: $discovery.query)
              .textFieldStyle(.plain).onSubmit { discovery.search() }
              .accessibilityLabel("Rechercher un morceau")
            Button("Rechercher") { discovery.search() }.buttonStyle(.borderedProminent)
              .buttonBorderShape(.capsule)
              .disabled(
                discovery.query.trimmingCharacters(in: .whitespacesAndNewlines).count < 2
                  || !session.hasServer)
          }.padding(10).background(.white.opacity(0.05), in: RoundedRectangle(cornerRadius: 14))
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
          ScrollView {
            LazyVStack(alignment: .leading, spacing: 16) {
              if !discovery.searched {
                ContentUnavailableView(
                  "Qu’as-tu envie de découvrir ?", systemImage: "magnifyingglass",
                  description: Text(
                    "Cherche dans tes playlists, sur YouTube, ou les deux. Ta musique continue pendant la recherche."
                  ))
              }
              if discovery.searched && discovery.scope != .youtube {
                resultHeading("Dans tes playlists (\(discovery.libraryTotal))")
                if !discovery.libraryError.isEmpty { error(discovery.libraryError) }
                ForEach(visibleLibrary.map { ("library:" + $0.id, $0) }, id: \.0) { _, track in
                  LibraryDiscoveryRow(track: track)
                  Divider()
                }
                if visibleLibrary.count < discovery.libraryTracks.count {
                  Button("Voir les autres résultats de mes playlists") { showAllLibrary = true }
                }
                if discovery.libraryTracks.isEmpty && !discovery.searching
                  && discovery.libraryError.isEmpty
                {
                  Text("Aucun morceau dans cette sélection de playlists.").foregroundStyle(
                    .secondary)
                }
                if discovery.libraryTotal > discovery.libraryTracks.count
                  && (showAllLibrary || discovery.scope == .library)
                {
                  Text(
                    "Les 25 premiers résultats. Affine ta recherche ou utilise la pagination dans Bibliothèque."
                  ).font(.caption).foregroundStyle(.secondary)
                }
              }
              if discovery.searched && discovery.scope != .library {
                resultHeading("À découvrir sur YouTube")
                if !discovery.youtubeError.isEmpty { error(discovery.youtubeError) }
                ForEach(discovery.youtube.map { ("youtube:" + $0.id, $0) }, id: \.0) { _, item in
                  DiscoveryTrackRow(item: item)
                  Divider()
                }
                if discovery.youtube.isEmpty && !discovery.searching
                  && discovery.youtubeError.isEmpty
                {
                  Text("Aucun résultat YouTube. Essaie un titre ou un artiste plus précis.")
                    .foregroundStyle(.secondary)
                }
                if discovery.nextPage != nil {
                  Button("Résultats suivants") { discovery.search(more: true) }
                    .disabled(
                      discovery.searching
                        || discovery.query.trimmingCharacters(in: .whitespacesAndNewlines)
                          != discovery.submittedQuery
                    )
                }
              }
              if discovery.searching {
                HStack {
                  ProgressView().controlSize(.small)
                  Text("Recherche en cours…")
                }
              }
            }.padding(.vertical, 8)
          }
          Text("Les ajouts sont conservés dans Mes découvertes, sur ton compte Recall.")
            .font(.caption).foregroundStyle(.secondary)
        }.padding(24).frame(maxWidth: .infinity).background(panel)
        DJView(model: dj, panelOnly: true).frame(width: 350).background(panel)
      }
      DiscoveryPlayerBar(model: dj, player: dj.player)
    }.padding(16).background {
      ZStack {
        Color(white: 0.09)
        if let track = dj.current {
          AsyncImage(url: URL(string: "https://i.ytimg.com/vi/\(track.id)/hqdefault.jpg")) {
            image in
            image.resizable().scaledToFill()
          } placeholder: {
            Color.clear
          }
          .blur(radius: 45).opacity(0.16)
        }
      }.clipped().ignoresSafeArea().allowsHitTesting(false)
    }.environment(\.colorScheme, .dark)
      .onChange(of: discovery.submittedQuery) { _, _ in showAllLibrary = false }
      .onChange(of: discovery.scope) { _, _ in if discovery.searched { discovery.search() } }
      .onChange(of: discovery.playlistID) { _, _ in
        if discovery.searched && discovery.scope != .youtube { discovery.search() }
      }
  }
  private var panel: some View {
    RoundedRectangle(cornerRadius: 20).fill(.black.opacity(0.4))
      .overlay(RoundedRectangle(cornerRadius: 20).strokeBorder(.white.opacity(0.08)))
  }
  private var scopes: some View {
    Picker("Chercher dans", selection: $discovery.scope) {
      ForEach(DiscoveryScope.allCases) { Text($0.title).tag($0) }
    }.pickerStyle(.segmented).labelsHidden().fixedSize()
  }
  private var playlistPicker: some View {
    Picker("Playlist", selection: $discovery.playlistID) {
      Text("Toutes mes playlists").tag("")
      ForEach(library.playlists) { Text($0.title).tag($0.id) }
    }.labelsHidden().frame(maxWidth: 230).disabled(discovery.scope == .youtube)
  }
  private func resultHeading(_ title: String) -> some View {
    Text(title).font(.headline).foregroundStyle(.secondary).padding(
      .top, 8)
  }
  private func error(_ message: String) -> some View {
    VStack(alignment: .leading) {
      Text(message).foregroundStyle(.orange).font(.callout)
      Button("Réessayer") { discovery.search() }
    }
  }
}

struct DiscoveryTrackRow: View {
  let item: DiscoveryItem
  var compact = false
  @EnvironmentObject var discovery: DiscoveryModel
  @EnvironmentObject var dj: DJModel
  private var saved: Bool { item.inLibrary || discovery.savedIDs.contains(item.id) }
  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack(alignment: .top, spacing: 12) {
        DiscoveryThumbnail(track: item.video).frame(
          width: compact ? 76 : 140, height: compact ? 48 : 82)
        VStack(alignment: .leading, spacing: 5) {
          Text(item.video.title).fontWeight(.semibold).lineLimit(2)
          Text(item.video.channel ?? "YouTube").font(.caption).foregroundStyle(.secondary)
            .lineLimit(1)
          Text(saved ? "Dans ta bibliothèque" : "YouTube").font(.caption).foregroundStyle(
            saved ? Color.recall : .secondary)
        }.frame(maxWidth: .infinity, alignment: .leading)
      }
      HStack(spacing: 8) {
        Button {
          dj.play(item.video)
        } label: {
          Label("Écouter", systemImage: "play.fill")
        }
        .help("Lire ce morceau maintenant ; ta file sera remplacée.")
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
    }.padding(.vertical, 6)
  }
}
private struct LibraryDiscoveryRow: View {
  let track: Track
  @EnvironmentObject var dj: DJModel
  var body: some View {
    HStack(spacing: 12) {
      DiscoveryThumbnail(track: track).frame(width: 76, height: 48)
      VStack(alignment: .leading, spacing: 4) {
        Text(track.title).fontWeight(.medium).lineLimit(2)
        Text(track.channel ?? "").font(.caption).foregroundStyle(.secondary).lineLimit(1)
      }.frame(maxWidth: .infinity, alignment: .leading)
      Button("À suivre") { dj.enqueue(track) }.buttonStyle(.bordered).buttonBorderShape(.capsule)
    }
  }
}
struct DiscoveryThumbnail: View {
  let track: Track
  var body: some View {
    GeometryReader { geometry in
      AsyncImage(url: URL(string: "https://i.ytimg.com/vi/\(track.id)/mqdefault.jpg")) { image in
        image.resizable().scaledToFill()
      } placeholder: {
        Color.secondary.opacity(0.12)
      }
      .frame(width: geometry.size.width, height: geometry.size.height).clipped()
      .overlay(alignment: .bottomTrailing) {
        if let duration = track.durationSeconds {
          Text(clock(duration)).font(.caption2.monospacedDigit()).padding(3).background(
            .black.opacity(0.7)
          ).padding(3)
        }
      }.clipShape(RoundedRectangle(cornerRadius: 8))
    }.accessibilityHidden(true)
  }
}
private struct DiscoveryPlayerBar: View {
  @ObservedObject var model: DJModel
  @ObservedObject var player: Player
  var body: some View {
    HStack(spacing: 16) {
      if let track = model.current { DiscoveryThumbnail(track: track).frame(width: 64, height: 48) }
      VStack(alignment: .leading, spacing: 4) {
        Text(model.current?.title ?? "Prêt quand tu l’es").fontWeight(.semibold).lineLimit(1)
        Text(
          player.preparingStudio
            ? "Préparation du clip…"
            : model.current?.channel ?? "Choisis un morceau ou parle au DJ."
        )
        .font(.caption).foregroundStyle(.secondary).lineLimit(1)
      }.frame(maxWidth: .infinity, alignment: .leading)
      Button {
        player.command(player.playing ? "pause" : "play")
      } label: {
        Image(systemName: player.playing ? "pause.fill" : "play.fill").padding(10)
      }.buttonStyle(.borderedProminent).buttonBorderShape(.circle).disabled(
        model.current == nil || player.preparingStudio
      )
      .accessibilityLabel(player.playing ? "Pause" : "Lecture")
      Button {
        model.next()
      } label: {
        Image(systemName: "forward.fill")
      }
      .disabled(model.current == nil).accessibilityLabel("Morceau suivant")
      if player.duration > 0 {
        Text(clock(player.elapsed)).font(.caption.monospacedDigit())
        Slider(
          value: Binding(get: { player.elapsed }, set: { player.seek($0) }),
          in: 0...max(1, player.duration)
        )
        .frame(maxWidth: 250).accessibilityLabel("Position du morceau")
      }
      Image(systemName: "speaker.wave.2.fill").foregroundStyle(.secondary)
      Slider(value: $player.volume, in: 0...1).frame(width: 90).accessibilityLabel(
        "Volume de la musique")
    }.padding(16).background(.black.opacity(0.45), in: RoundedRectangle(cornerRadius: 18))
  }
}
