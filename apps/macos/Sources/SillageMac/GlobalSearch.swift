import SillageKit
import SwiftUI

/// One search for everything (⌘F): artists, the library, and what is new on YouTube. Each
/// part answers on its own; typing again cancels what was asked before.
@MainActor final class GlobalSearchModel: ObservableObject {
  /// An artist to suggest: one of the listener's first, then YouTube Music's.
  struct Suggestion: Identifiable, Equatable {
    let name: String
    let picture: URL?
    let detail: String?
    var id: String { name.lowercased() }
  }
  @Published var query = ""
  @Published private(set) var artists: [Suggestion] = []
  /// The library's artists, asked once per account, to match while typing.
  private var mine: [LibraryArtist] = []
  private var mineAccount: String?
  @Published private(set) var library: [Track] = []
  @Published private(set) var discover: [DiscoveryItem] = []
  @Published private(set) var loading: Set<String> = []
  private var task: Task<Void, Never>?

  func run(_ connection: Connection?) {
    task?.cancel()
    let text = query.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let connection, text.count >= 2 else {
      artists = []
      library = []
      discover = []
      loading = []
      return
    }
    loading = ["artists", "library", "discover"]
    task = Task {
      try? await Task.sleep(for: .milliseconds(280))
      guard !Task.isCancelled else { return }
      if mineAccount != connection.token {
        mine = (try? await HTTPClient().libraryArtists(connection)) ?? []
        mineAccount = connection.token
      }
      let own = Self.matching(mine, text)
      artists = own
      // A word cut short brings namesakes: YouTube Music is asked from three letters.
      let asksCatalog = text.count >= 3
      async let hits: [ArtistHit]? =
        asksCatalog ? try? HTTPClient().searchArtists(connection, query: text) : nil
      async let owned = try? HTTPClient().searchPage(connection, query: text, limit: 6)
      async let fresh = try? HTTPClient().discover(connection, query: text)
      let found: [ArtistHit] = await hits ?? []
      guard !Task.isCancelled else { return }
      let known = Set(own.map(\.id))
      let others: [Suggestion] = found.map {
        Suggestion(name: $0.name, picture: $0.portrait, detail: $0.audience)
      }
      artists = Array((own + others.filter { !known.contains($0.id) }).prefix(10))
      loading.remove("artists")
      let page = await owned
      guard !Task.isCancelled else { return }
      library = page?.tracks ?? []
      loading.remove("library")
      let results = await fresh
      guard !Task.isCancelled else { return }
      discover = Array((results?.results ?? []).filter { !$0.inLibrary }.prefix(6))
      loading.remove("discover")
    }
  }
  /// The listener's artists whose name, or one of its words, starts with what is typed; then
  /// those that merely contain it. Most played first.
  static func matching(_ artists: [LibraryArtist], _ text: String) -> [Suggestion] {
    let fold = { (value: String) in
      value.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: nil)
    }
    let wanted = fold(text)
    func rank(_ artist: LibraryArtist) -> Int? {
      let name = fold(artist.name)
      if name.hasPrefix(wanted) { return 0 }
      if name.split(separator: " ").contains(where: { $0.hasPrefix(wanted) }) { return 1 }
      return name.contains(wanted) ? 2 : nil
    }
    var ranked: [(artist: LibraryArtist, rank: Int)] = []
    for artist in artists {
      if let value = rank(artist) { ranked.append((artist, value)) }
    }
    ranked.sort { $0.rank != $1.rank ? $0.rank < $1.rank : $0.artist.plays > $1.artist.plays }
    return ranked.prefix(5).map { entry in
      let artist = entry.artist
      let songs = artist.tracks == 1 ? "1 titre" : "\(artist.tracks) titres"
      return Suggestion(
        name: artist.name,
        picture: URL(string: "https://i.ytimg.com/vi/" + artist.coverVideoId + "/mqdefault.jpg"),
        detail: "Chez toi · " + songs)
    }
  }

  func clear() {
    task?.cancel()
    query = ""
    artists = []
    library = []
    discover = []
    loading = []
  }
}

/// The search panel over the window: a field, then Artistes, Dans ta bibliothèque, À découvrir.
struct GlobalSearchPanel: View {
  @ObservedObject var model: GlobalSearchModel
  let close: () -> Void
  @EnvironmentObject var session: Session
  @EnvironmentObject var dj: DJModel
  @Environment(\.openArtist) private var openArtist
  @FocusState private var focused: Bool

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(spacing: 10) {
        Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
        TextField("Un artiste, un titre, chez toi ou à découvrir", text: $model.query)
          .textFieldStyle(.plain).font(.system(size: 17)).focused($focused)
          .onSubmit(openFirst)
        if !model.loading.isEmpty { ProgressView().controlSize(.small) }
        Button(action: close) {
          Image(systemName: "xmark.circle.fill").foregroundStyle(.tertiary)
        }.buttonStyle(.plain).keyboardShortcut(.cancelAction).accessibilityLabel("Fermer")
      }
      .padding(.horizontal, 18).frame(height: 54)
      if !model.query.trimmingCharacters(in: .whitespaces).isEmpty {
        SillageRule()
        ScrollView {
          VStack(alignment: .leading, spacing: 18) {
            if !model.artists.isEmpty { artists }
            if !model.library.isEmpty {
              group("Dans ta bibliothèque") {
                ForEach(model.library) { track in
                  ResultLine(track: track) { play(track, .library) }
                }
              }
            }
            if !model.discover.isEmpty {
              group("À découvrir") {
                ForEach(model.discover) { item in
                  ResultLine(track: item.video) { play(item.video, .youtube) }
                }
              }
            }
            if model.loading.isEmpty && model.artists.isEmpty && model.library.isEmpty
              && model.discover.isEmpty && model.query.count >= 2
            {
              Text("Rien trouvé pour « \(model.query) ».").font(.callout)
                .foregroundStyle(.secondary)
            }
          }.padding(18)
        }
        .frame(maxHeight: 460)
        .scrollIndicators(.never)
      }
    }
    .frame(width: 640)
    .glassPanel(radius: 18)
    .shadow(color: .black.opacity(0.25), radius: 30, y: 12)
    .onAppear { focused = true }
    .onChange(of: model.query) { _, _ in model.run(session.connection) }
  }

  private var artists: some View {
    group("Artistes") {
      ScrollView(.horizontal, showsIndicators: false) {
        HStack(alignment: .top, spacing: 14) {
          ForEach(model.artists) { hit in
            Button {
              openArtist?(hit.name)
              close()
            } label: {
              VStack(spacing: 6) {
                RemotePicture(url: hit.picture).frame(width: 64, height: 64).clipShape(Circle())
                Text(hit.name).font(.system(size: 12, weight: .medium)).lineLimit(1)
                if let detail = hit.detail {
                  Text(detail).font(.system(size: 10)).foregroundStyle(.secondary).lineLimit(1)
                }
              }.frame(width: 92)
            }.buttonStyle(.plain).help("Voir la page de \(hit.name)")
          }
        }
      }
    }
  }

  private func group<Content: View>(_ title: String, @ViewBuilder content: () -> Content)
    -> some View
  {
    VStack(alignment: .leading, spacing: 8) {
      MonoLabel(title)
      content()
    }
  }

  private func play(_ track: Track, _ source: DiscoveryScope) {
    dj.play(track, source: source)
    close()
  }

  /// Entrée: the first artist, else the first song.
  private func openFirst() {
    if let hit = model.artists.first {
      openArtist?(hit.name)
      close()
    } else if let track = model.library.first {
      play(track, .library)
    } else if let item = model.discover.first {
      play(item.video, .youtube)
    }
  }
}

private struct ResultLine: View {
  let track: Track
  let play: () -> Void
  @State private var hovering = false
  var body: some View {
    let name = TrackTitle(track)
    Button(action: play) {
      HStack(spacing: 10) {
        Artwork.image(for: track, quality: "mqdefault").frame(width: 48, height: 27)
          .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
        VStack(alignment: .leading, spacing: 1) {
          Text(name.title).font(.system(size: 13, weight: .medium)).lineLimit(1)
          Text(name.artist ?? track.channel ?? "YouTube").font(.system(size: 11))
            .foregroundStyle(.secondary).lineLimit(1)
        }
        Spacer(minLength: 0)
        Text(track.durationSeconds.map(clock) ?? "").font(.system(size: 11, design: .monospaced))
          .foregroundStyle(.secondary)
      }
      .padding(.horizontal, 6).padding(.vertical, 4)
      .background(
        RoundedRectangle(cornerRadius: 6).fill(hovering ? Color.sillageHover : .clear))
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain).onHover { hovering = $0 }
    .help("Lire \(name.title)")
  }
}
