import RecallKit
import SwiftUI

/// « J’aime » / « Je n’aime pas » on a track, next to the transport controls or in Mon goût.
/// A second press withdraws it.
struct TasteButtons: View {
  @ObservedObject var taste: TasteModel
  let track: Track?
  var size: CGFloat = 28

  var body: some View {
    HStack(spacing: 2) {
      button(.like, symbol: "hand.thumbsup", label: "J’aime")
        .help("J’aime : le DJ le proposera plus souvent")
      button(.dislike, symbol: "hand.thumbsdown", label: "Je n’aime pas")
        .help(
          "Je n’aime pas : écarté des propositions pendant \(taste.dislikeDays) jours, toujours jouable si tu le demandes par son nom"
        )
    }
    .disabled(track == nil)
    .task(id: track?.id) { if let id = track?.id { await taste.load(id) } }
  }

  private func button(_ opinion: TrackOpinion, symbol: String, label: String) -> some View {
    let active = track.map { taste.opinion($0.id) == opinion } ?? false
    return Button {
      if let id = track?.id { taste.toggle(opinion, for: id) }
    } label: {
      Image(systemName: active ? symbol + ".fill" : symbol)
        .foregroundStyle(active ? Color.recall : .secondary)
        .frame(width: size, height: size).contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .accessibilityLabel(label)
    .accessibilityAddTraits(active ? .isSelected : [])
  }
}

/// Réglages → Goût: what an opinion does, and how long « Je n’aime pas » keeps a track away.
struct TasteSettingsSection: View {
  @ObservedObject var taste: TasteModel
  var body: some View {
    Section("Tes avis") {
      Label {
        VStack(alignment: .leading, spacing: 2) {
          Text("J’aime")
          Text("Le DJ propose ce titre plus souvent et s’en inspire pour la suite.")
            .font(.caption).foregroundStyle(.secondary)
        }
      } icon: {
        Image(systemName: "hand.thumbsup").foregroundStyle(Color.recall)
      }
      Label {
        VStack(alignment: .leading, spacing: 2) {
          Text("Je n’aime pas")
          Text(
            "Le titre sort des propositions pour un temps. Demandé par son nom, il passe toujours."
          )
          .font(.caption).foregroundStyle(.secondary)
        }
      } icon: {
        Image(systemName: "hand.thumbsdown").foregroundStyle(Color.recall)
      }
      Text(
        "Les boutons sont à côté de « suivant », dans le lecteur et la barre des menus. Ils ne modifient aucune playlist."
      )
      .font(.caption).foregroundStyle(.secondary)
    }
    Section("Je n’aime pas") {
      Stepper(
        value: Binding(
          get: { taste.dislikeDays },
          set: { days in Task { await taste.saveDislikeDays(days) } }),
        in: TasteLimits.dislikeDays
      ) {
        LabeledContent("Écarter pendant") {
          Text("\(taste.dislikeDays) jour\(taste.dislikeDays > 1 ? "s" : "")")
            .monospacedDigit()
        }
      }
      Text(
        "Passé ce délai, le titre revient peu à peu : son poids baisse de moitié à chaque nouveau délai."
      )
      .font(.caption).foregroundStyle(.secondary)
      if !taste.error.isEmpty {
        Text(taste.error).font(.caption).foregroundStyle(.orange)
      }
    }
    Section("Découverte") {
      LabeledContent("Part de découverte", value: "1 titre sur 4")
      Text(
        "Même quand tes favoris sont nombreux, une place sur quatre va à un titre que tu n’as pas encore aimé ou beaucoup écouté."
      )
      .font(.caption).foregroundStyle(.secondary)
    }
    .task { await taste.loadSettings() }
  }
}
