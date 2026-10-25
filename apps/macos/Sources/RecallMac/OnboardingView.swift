import RecallKit
import SwiftUI

struct OnboardingView: View {
  @EnvironmentObject var session: Session
  @State private var key = ""
  @State private var busy = false
  @State private var error = ""
  var body: some View {
    VStack(alignment: .leading, spacing: 20) {
      Text("Bienvenue dans Recall.").font(.largeTitle)
      Text("Tes playlists, ton DJ, ton compte.")
      if !session.googleAccount {
        Text(
          "Connecte-toi avec Google. Ta bibliothèque reste privée sur le serveur ; colle ensuite les liens de tes playlists YouTube."
        )
        Button(session.signingIn ? "Connexion…" : "Continuer avec Google") {
          Task { await session.connectGoogle() }
        }.buttonStyle(.borderedProminent).disabled(session.signingIn || session.loadingCredentials)
        Text("Recall demande uniquement ton identité Google et ton adresse e-mail.").font(.caption)
      } else {
        Label(session.accountEmail, systemImage: "person.crop.circle.fill")
        SecureField("Ta clé API Gemini", text: $key).textFieldStyle(.roundedBorder)
        Text(
          "Ta clé est chiffrée sur le serveur et réservée à ton compte. Ton chat et les titres proposés sont envoyés à Google avec ton quota Gemini."
        ).font(.caption).foregroundStyle(.secondary)
        Link(
          "Obtenir ma clé Gemini", destination: URL(string: "https://aistudio.google.com/api-keys")!
        )
        Button(busy ? "Enregistrement…" : "Activer mon DJ") {
          busy = true
          Task {
            defer { busy = false }
            do {
              try await session.saveGeminiKey(key)
              key = ""
            } catch { self.error = error.localizedDescription }
          }
        }.buttonStyle(.borderedProminent).disabled(busy || key.isEmpty)
        if session.canClaimLibrary {
          Button("Récupérer mes playlists existantes sur ce compte") {
            Task { await session.claimLibrary() }
          }
        }
      }
      if !error.isEmpty { Text(error).foregroundStyle(.red).font(.caption) }
      if !session.error.isEmpty { Text(session.error).foregroundStyle(.red).font(.caption) }
      Button(session.hasServer ? "Ouvrir ma bibliothèque" : "Plus tard") {
        session.showOnboarding = false
      }
      .buttonStyle(.plain).font(.caption)
    }.padding(32).frame(width: 540).interactiveDismissDisabled()
  }
}
