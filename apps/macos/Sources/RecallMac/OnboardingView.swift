import AppKit
import RecallKit
import SwiftUI
import UniformTypeIdentifiers

struct OnboardingView: View {
  @EnvironmentObject var session: Session
  @State private var key = ""
  @State private var busy = false
  @State private var error = ""
  var body: some View {
    VStack(alignment: .leading, spacing: 20) {
      Text("Bienvenue dans Recall.").font(.largeTitle)
      Text("Connecte ton serveur pour retrouver toutes tes playlists. Ajoute ta clé Gemini pour personnaliser ton DJ et sa voix.")
      SecureField("Ta clé API Gemini", text: $key).textFieldStyle(.roundedBorder)
      Text(
        "Conservée dans le Trousseau de ce Mac. Seuls tes demandes et les titres sélectionnés sont transmis à Google. Les appels utilisent ton quota Gemini."
      ).font(.caption).foregroundStyle(.secondary)
      Link(
        "Obtenir ma clé Gemini", destination: URL(string: "https://aistudio.google.com/api-keys")!)
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
      Divider()
      Text("YouTube, sans clé à saisir.").font(.headline)
      Text(
        session.hasServer
          ? "Ton serveur est déjà connecté. Colle simplement un lien de playlist dans Bibliothèque."
          : "Importe le fichier de connexion privé de ton serveur pour ajouter tes playlists par lien. Il contient ton accès personnel et ne doit pas être redistribué avec l’app."
      ).font(.callout)
      Button("Importer ma connexion serveur…") { importConnection() }
      if !error.isEmpty { Text(error).font(.caption).foregroundStyle(.red) }
      Button(session.hasServer ? "Ouvrir ma bibliothèque" : "Configurer plus tard") { session.showOnboarding = false }.buttonStyle(
        .plain
      ).font(.caption)
    }.padding(32).frame(width: 540).interactiveDismissDisabled()
  }
  private func importConnection() {
    let panel = NSOpenPanel()
    panel.allowedContentTypes = [.json]
    guard panel.runModal() == .OK, let url = panel.url else { return }
    Task {
      do { try await session.importConnection(url) } catch {
        self.error = error.localizedDescription
      }
    }
  }
}
