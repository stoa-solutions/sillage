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
      Text(
        !session.googleAccount
          ? "1 · Connecte ton compte Google"
          : (session.hasKey ? "Ton compte est prêt" : "2 · Active ton DJ")
      )
      .font(.headline)
      if !session.googleAccount {
        Text(
          "Connecte-toi avec Google. Ta bibliothèque reste privée sur le serveur ; colle ensuite les liens de tes playlists YouTube."
        )
        Button(session.signingIn ? "Connexion…" : "Continuer avec Google") {
          Task { await session.connectGoogle() }
        }.buttonStyle(.borderedProminent).disabled(session.signingIn || session.loadingCredentials)
        if session.signingIn {
          Text("Termine la connexion dans ton navigateur.").font(.caption)
          Button("Annuler la connexion") { session.cancelGoogleSignIn() }
        }
        Text("Recall demande uniquement ton identité Google et ton adresse e-mail.").font(.caption)
      } else {
        Label(session.accountEmail, systemImage: "person.crop.circle.fill")
        if session.hasKey {
          Label("Ton DJ est activé. Ta clé est enregistrée.", systemImage: "checkmark.circle.fill")
            .foregroundStyle(.green)
          Text("Tu peux modifier ta clé dans Réglages.").font(.caption).foregroundStyle(.secondary)
        } else {
          SecureField("Ta clé API Gemini", text: $key).textFieldStyle(.roundedBorder)
          Text(
            "Ta clé est chiffrée sur le serveur et réservée à ton compte. Ton chat et les titres proposés sont envoyés à Google avec ton quota Gemini."
          ).font(.caption).foregroundStyle(.secondary)
          Link(
            "Obtenir ma clé Gemini",
            destination: URL(string: "https://aistudio.google.com/api-keys")!
          )
          Text(
            "Crée une clé dans Google AI Studio, puis colle-la ici. Tu n’auras pas à la ressaisir à chaque lancement."
          )
          .font(.caption).foregroundStyle(.secondary)
          Button(busy ? "Enregistrement…" : "Activer mon DJ") {
            error = ""
            busy = true
            Task {
              defer { busy = false }
              do {
                try await session.saveGeminiKey(key)
                key = ""
              } catch { self.error = error.localizedDescription }
            }
          }.buttonStyle(.borderedProminent).disabled(
            busy || key.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
        if session.canClaimLibrary {
          Text("Dernière étape : récupère tes playlists existantes dans ton compte Google.")
            .font(.callout)
          Button(
            session.claimingLibrary
              ? "Récupération…" : "Récupérer mes playlists existantes sur ce compte"
          ) {
            Task { await session.claimLibrary() }
          }.disabled(busy || session.claimingLibrary)
        }
      }
      if !error.isEmpty { Text(error).foregroundStyle(.red).font(.caption) }
      if !session.error.isEmpty { Text(session.error).foregroundStyle(.red).font(.caption) }
      Button(session.hasServer ? "Aller à mes playlists" : "Plus tard") {
        session.showOnboarding = false
      }
      .buttonStyle(.plain).font(.caption).disabled(busy || session.claimingLibrary)
    }.padding(32).frame(width: 540).interactiveDismissDisabled().preferredColorScheme(.light)
  }
}
