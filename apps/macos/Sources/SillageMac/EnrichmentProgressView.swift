import SillageKit
import SwiftUI

struct EnrichmentProgressView: View {
  let progress: EnrichmentProgress?
  let error: String
  var body: some View {
    if let progress {
      VStack(alignment: .leading, spacing: 6) {
        HStack {
          Label(progress.title, systemImage: "sparkle.magnifyingglass").font(
            .subheadline.weight(.medium))
          Spacer()
          Text("\(progress.processed) / \(progress.total) traités").monospacedDigit().font(.caption)
        }
        ProgressView(value: progress.fraction).tint(.sillageOrange)
          .accessibilityLabel("Progression de l’enrichissement musical")
        Text(
          "\(progress.matched) enrichis · \(progress.ambiguous) ambigus · \(progress.notFound) sans correspondance"
        )
        .font(.caption).foregroundStyle(.secondary)
        if progress.enabled && progress.remaining > 0 {
          Text(
            "\(progress.remaining) à traiter · \(progress.queued + progress.running) en cours ou en attente · lots de \(progress.batchSize) maximum"
          )
          .font(.caption).foregroundStyle(.secondary)
        } else if !progress.enabled {
          Text("Le traitement de toute ta bibliothèque n’est pas activé.")
            .font(.caption).foregroundStyle(.secondary)
        }
        if progress.awaitingYoutube > 0 {
          Text("\(progress.awaitingYoutube) attendent leurs informations YouTube.").font(.caption)
        }
        if progress.unavailable > 0 {
          Text("\(progress.unavailable) vidéos indisponibles, non traitées.").font(.caption)
        }
        if progress.retrying + progress.failed > 0 {
          Text(
            "\(progress.retrying) réessais différés · \(progress.failed) échecs, repris au plus une fois par jour."
          )
          .font(.caption).foregroundStyle(.orange)
        }
        if !error.isEmpty {
          Text(error).font(.caption).foregroundStyle(.orange)
        } else {
          Text(
            "MusicBrainz · Les cas incertains restent sans attribution. Le serveur continue quand l’app est fermée."
          )
          .font(.caption).foregroundStyle(.secondary)
        }
      }.padding(12).background(.quaternary.opacity(0.35), in: RoundedRectangle(cornerRadius: 12))
    } else if !error.isEmpty {
      Label(error, systemImage: "info.circle").font(.caption).foregroundStyle(.secondary)
    }
  }
}
