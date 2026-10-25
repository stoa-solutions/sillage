import RecallKit
import SwiftUI

/// A small addition to the shared row, without changing any page or player layout.
struct MusicMetadataView: View {
  let metadata: MusicMetadata
  @State private var showingSource = false
  var body: some View {
    VStack(alignment: .leading, spacing: 3) {
      if metadata.matched && !metadata.featured.isEmpty {
        Text("Avec \(metadata.featured)").font(.caption).foregroundStyle(.secondary).lineLimit(1)
      }
      Button {
        showingSource = true
      } label: {
        HStack(spacing: 5) {
          Text(metadata.summary.isEmpty ? "Crédits MusicBrainz" : metadata.summary).lineLimit(2)
          Image(systemName: "info.circle")
        }.font(.caption).foregroundStyle(.secondary)
      }.buttonStyle(.plain).accessibilityLabel("Détails MusicBrainz")
        .popover(isPresented: $showingSource) {
          VStack(alignment: .leading, spacing: 10) {
            Text("À propos de ce morceau").font(.headline)
            if metadata.matched {
              Text(metadata.artists.map(\.name).joined(separator: ", "))
              if !metadata.albums.isEmpty {
                Text("Albums répertoriés : " + metadata.albums.map(\.title).joined(separator: ", "))
              }
              Text(
                metadata.genres.isEmpty
                  ? "Genre du morceau : non renseigné"
                  : "Genres du morceau : " + metadata.genres.joined(separator: ", "))
              if !metadata.artistGenres.isEmpty {
                Text(
                  "Styles associés à l’artiste : " + metadata.artistGenres.joined(separator: ", "))
                Text("Ces styles décrivent l’artiste, pas nécessairement ce morceau.").font(
                  .caption
                ).foregroundStyle(.secondary)
              }
              Text(
                "Rapprochement par titre, artiste et durée. Les crédits proviennent du catalogue communautaire MusicBrainz."
              ).font(.caption).foregroundStyle(.secondary)
            } else {
              Text(
                metadata.reason
                  ?? "Aucune information attribuée pour éviter une mauvaise correspondance.")
            }
            if let url = metadata.sourceURL {
              Link("Voir la fiche MusicBrainz ↗", destination: url)
            }
            Text("Vérifié le " + String(metadata.checkedAt.prefix(10))).font(.caption)
              .foregroundStyle(.secondary)
          }.padding(20).frame(width: 360).textSelection(.enabled)
        }
    }
  }
}
