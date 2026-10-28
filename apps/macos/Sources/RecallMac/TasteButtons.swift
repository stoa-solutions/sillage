import RecallKit
import SwiftUI

/// 👍 / 👎 on the track playing, next to the transport controls. A second press withdraws it.
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
          "Je n’aime pas : écarté des propositions pendant \(taste.dislikeDays) jours, toujours jouable si tu le demandes"
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

/// Réglages → DJ et voix: how long a 👎 keeps a track out of the DJ's proposals.
struct TasteSettingsSection: View {
  @ObservedObject var taste: TasteModel
  var body: some View {
    Section("Goût") {
      Stepper(
        value: Binding(
          get: { taste.dislikeDays },
          set: { days in Task { await taste.saveDislikeDays(days) } }),
        in: TasteLimits.dislikeDays
      ) {
        Text(
          "Un 👎 écarte un titre pendant \(taste.dislikeDays) jour\(taste.dislikeDays > 1 ? "s" : "")"
        )
      }
      Text(
        "Ensuite, il revient peu à peu. Un titre demandé par son nom passe toujours. 👍 et 👎 n’ajoutent ni ne retirent rien de tes playlists."
      )
      .font(.caption).foregroundStyle(.secondary)
      if !taste.error.isEmpty {
        Text(taste.error).font(.caption).foregroundStyle(.orange)
      }
    }
    .task { await taste.loadSettings() }
  }
}
