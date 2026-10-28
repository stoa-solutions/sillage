import RecallKit
import SwiftUI

struct AppearanceSettings: View {
  @ObservedObject private var appearance = AppearanceModel.shared
  @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
  var body: some View {
    Form {
      Section {
        ZStack(alignment: .bottomLeading) {
          IdleBackground()
          VStack(alignment: .leading, spacing: 6) {
            Text("Prêt quand tu l’es").font(.title2.weight(.semibold))
            Text("Un artiste, une ambiance, une envie…").font(.callout)
          }.foregroundStyle(.white).padding(22)
        }.frame(height: 210).clipShape(RoundedRectangle(cornerRadius: 16))
          .accessibilityElement(children: .ignore).accessibilityLabel("Aperçu du fond sans musique")
        Text(
          "Ce fond apparaît quand aucun morceau n’est sélectionné. La vidéo et la pochette reprennent leur place dès la lecture."
        )
        .font(.callout).foregroundStyle(.secondary)
      }
      Section("Fond sans musique") {
        Picker(
          "Image",
          selection: Binding(
            get: { appearance.preferences.backdrop }, set: { appearance.select($0) })
        ) {
          Text("Stoa · Passage").tag(IdleBackdrop.stoa)
          if appearance.personalImage != nil { Text("Mon image").tag(IdleBackdrop.personal) }
          Text("Fond uni").tag(IdleBackdrop.none)
        }
        HStack {
          Button(appearance.importing ? "Préparation…" : "Choisir une image…") {
            appearance.chooseImage()
          }
          .disabled(appearance.importing)
          Spacer()
          Text("JPEG, PNG, HEIC, WebP · 30 Mo max").font(.caption).foregroundStyle(.secondary)
        }
        Text(
          "L’image est copiée sur ce Mac, sans envoi au serveur. Déplacer l’original ne change pas ton fond."
        )
        .font(.caption).foregroundStyle(.secondary)
      }
      Section("Lisibilité") {
        LabeledContent(
          "Voile sombre",
          value: appearance.preferences.dimming.formatted(.percent.precision(.fractionLength(0))))
        Slider(
          value: Binding(get: { appearance.preferences.dimming }, set: { appearance.dim($0) }),
          in: 0.25...0.85, step: 0.05
        )
        .accessibilityLabel("Opacité du voile sombre")
        .disabled(appearance.preferences.backdrop == .none)
        Text(
          "Plus le voile est fort, plus le fond est discret. Les panneaux de lecture gardent leur contraste."
        )
        .font(.caption).foregroundStyle(.secondary)
        if reduceTransparency {
          Label(
            "macOS réduit la transparence des panneaux. Ton image de fond reste visible.",
            systemImage: "accessibility"
          )
          .font(.callout)
        }
      }
      if !appearance.error.isEmpty { Text(appearance.error).foregroundStyle(.orange) }
      Section {
        Button("Rétablir l’apparence Stoa") { appearance.reset() }.disabled(appearance.importing)
        Text("Réglages enregistrés automatiquement sur ce Mac.").font(.caption).foregroundStyle(
          .secondary)
      }
    }.formStyle(.grouped).scrollContentBackground(.hidden)
  }
}
