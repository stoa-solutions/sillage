import SillageKit
import SwiftUI

/// Bibliothèque → Mes artistes: every artist of the library, most played first, each opening
/// its page. The cover is the artist's most played song.
struct LibraryArtistsView: View {
  @EnvironmentObject var session: Session
  @Environment(\.openArtist) private var openArtist
  @State private var artists: [LibraryArtist] = []
  @State private var loaded = false
  @State private var failure = ""
  @State private var filter = ""

  private var shown: [LibraryArtist] {
    let wanted = filter.trimmingCharacters(in: .whitespaces)
    guard !wanted.isEmpty else { return artists }
    return artists.filter {
      $0.name.range(of: wanted, options: [.caseInsensitive, .diacriticInsensitive]) != nil
    }
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      LibraryPageHead(eyebrow: "Ta collection", title: "Mes artistes") {
        Text(
          loaded ? "\(artists.count.formatted()) artistes, les plus écoutés d’abord" : "Chargement…"
        )
      } trailing: {
        EmptyView()
      }.padding(.bottom, 20)
      SearchField(prompt: "Filtrer tes artistes", text: $filter).padding(.bottom, 20)
        .frame(maxWidth: 420)
      ScrollView {
        LazyVGrid(
          columns: [GridItem(.adaptive(minimum: 132, maximum: 170), spacing: 18)],
          alignment: .leading, spacing: 22
        ) {
          ForEach(shown) { artist in
            ArtistTile(artist: artist) { openArtist?(artist.name) }
          }
        }.padding(.bottom, 16)
        if loaded && shown.isEmpty {
          EmptyState(
            symbol: "person.2",
            message: artists.isEmpty
              ? (failure.isEmpty ? "Tes artistes apparaîtront avec ta bibliothèque." : failure)
              : "Aucun artiste ne correspond.")
        } else if !loaded {
          ProgressView().controlSize(.small).frame(maxWidth: .infinity).padding(.top, 40)
        }
      }.scrollIndicators(.never)
    }
    .padding(.top, 28).padding(.horizontal, 32).padding(.bottom, 18)
    .task(id: session.generation) { await load() }
  }

  private func load() async {
    guard let connection = session.connection else { return }
    do {
      artists = try await HTTPClient().libraryArtists(connection)
      failure = ""
    } catch {
      failure = error.localizedDescription
    }
    loaded = true
  }
}

private struct ArtistTile: View {
  let artist: LibraryArtist
  let open: () -> Void
  @State private var hovering = false
  var body: some View {
    Button(action: open) {
      VStack(alignment: .leading, spacing: 7) {
        // hqdefault is 4:3 with bars around 16:9 clips: enlarge it so the circle shows the picture.
        Color.clear.aspectRatio(1, contentMode: .fit)
          .overlay {
            GeometryReader { geometry in
              let side = geometry.size.width
              Artwork.image(
                for: Track(id: artist.coverVideoId, title: artist.name), quality: "hqdefault"
              )
              .frame(width: side / 0.75 * 4 / 3, height: side / 0.75)
              .position(x: side / 2, y: side / 2)
            }
          }
          .clipShape(Circle())
          .overlay(Circle().strokeBorder(Color.sillage(.separator)))
          .opacity(hovering ? 0.85 : 1)
        Text(artist.name).font(.system(size: 13, weight: .semibold)).lineLimit(1)
        Text(detail).font(.system(size: 11)).foregroundStyle(.secondary).lineLimit(1)
      }
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .onHover { hovering = $0 }
    .help("Voir la page de \(artist.name)")
    .accessibilityLabel("\(artist.name), \(detail)")
  }
  private var detail: String {
    let songs = artist.tracks == 1 ? "1 titre" : "\(artist.tracks) titres"
    return artist.plays == 0 ? songs : "\(songs) · \(artist.plays) écoutes"
  }
}
