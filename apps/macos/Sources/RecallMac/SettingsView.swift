import AppKit
import RecallKit
import SwiftUI
import UniformTypeIdentifiers

struct SettingsView: View {
  @EnvironmentObject var session: Session
  @EnvironmentObject var library: LibraryModel
  @State private var key = ""
  @State private var serverURL = ""
  @State private var token = ""
  @State private var message = ""
  var body: some View {
    Form {
      if session.loadingCredentials {
        Text(
          "Accès au Trousseau en attente de validation macOS. Tes clés existantes seront conservées."
        ).font(.caption)
      }
      Section("Ton IA musicale") {
        Picker("Modèle", selection: $session.model) {
          Text("Gemini 3.8 Flash · rapide et équilibré").tag("gemini-3.8-flash")
          Text("Gemini 3.5 Flash-Lite · très rapide").tag("gemini-3.5-flash-lite")
          Text("Gemini 4 Argon · raisonnement avancé").tag("gemini-4-argon")
        }
        SecureField(
          session.hasKey
            ? "Nouvelle clé Gemini (laisser vide pour conserver)" : "Ta clé API Gemini",
          text: $key)
        Text(
          session.hasKey
            ? "Clé enregistrée dans le Trousseau de ce Mac."
            : "Ajoute ta clé pour utiliser ton projet Google. Sans clé personnelle, le DJ du serveur connecté peut être utilisé."
        ).font(.caption).foregroundStyle(.secondary)
        Text(
          "Le chat et les métadonnées sélectionnées sont transmis à Google. Les appels directs utilisent ton quota Google ; la limite du serveur ne s’applique pas à eux."
        ).font(.caption)
      }
      Section("Import YouTube") {
        Text(
          "Colle un lien dans Bibliothèque : ton serveur importe et conserve les playlists. La clé YouTube reste sur le serveur."
        ).font(.caption)
      }
      Section("Bibliothèque") {
        Button("Importer ma connexion serveur…") {
          let panel = NSOpenPanel()
          panel.allowedContentTypes = [.json]
          if panel.runModal() == .OK, let url = panel.url {
            Task {
              do {
                try await session.importConnection(url)
                serverURL = session.connectedURL
              } catch { message = error.localizedDescription }
            }
          }
        }
        TextField("Adresse HTTPS du serveur", text: $serverURL)
        SecureField("Jeton personnel (laisser vide pour conserver)", text: $token)
        if session.hasServer {
          Button("Oublier ce serveur") {
            Task {
              await session.forgetServer()
              serverURL = ""
              message = "Connexion retirée. Tes playlists restent sur le serveur."
            }
          }
        }
        Text(
          "La bibliothèque reste sur le serveur. Les clés de connexion restent dans le Trousseau. Les jetons de ce serveur partagent actuellement la même bibliothèque ; les comptes individuels viendront ensuite."
        ).font(.caption).foregroundStyle(.secondary)
      }
      Section("Micro et voix") {
        Toggle("Voix Gemini expressive", isOn: $session.cloudVoice)
        Text(
          "La voix est indépendante du modèle du DJ. Gemini utilise ta clé enregistrée ; la voix macOS reste disponible en secours."
        ).font(.caption)
        Text(
          "Le micro fonctionne uniquement au clic. La dictée française utilise la reconnaissance Apple, sur l’appareil lorsque disponible, sinon via le service Apple. La voix Gemini expressive est indépendante du modèle ; macOS sert de secours."
        ).font(.caption)
      }
      Section("Mises à jour") {
        Text(
          "Les mises à jour sont vérifiées automatiquement et les archives doivent être signées. Cette première version est locale, sans notarisation Apple : la distribution publique sans avertissement attend un compte Developer ID."
        ).font(.caption)
      }
      HStack {
        Button("Enregistrer") { Task { await save() } }.buttonStyle(.borderedProminent)
        if session.hasKey {
          Button("Retirer ma clé Gemini") {
            Task {
              do {
                try await Task.detached { try KeychainStore.remove("gemini") }.value
                await session.refreshCredentials()
                message = "Clé retirée du Trousseau."
              } catch { message = error.localizedDescription }
            }
          }
        }
      }
      if !message.isEmpty { Text(message).font(.caption).textSelection(.enabled) }
    }.formStyle(.grouped).frame(width: 650, height: 670)
      .task {
        await session.refreshCredentials()
        serverURL = session.connectedURL
      }
  }
  private func save() async {
    do {
      let previous = try await Task.detached { try KeychainStore.connection() }.value
      let address = serverURL.trimmingCharacters(in: .whitespacesAndNewlines)
      var connection: Connection?
      if !address.isEmpty {
        let oldURL = previous?.url
        guard
          !token.isEmpty
            || address.trimmingCharacters(in: CharacterSet(charactersIn: "/")) == oldURL
        else {
          throw RecallError.message(
            "Pour changer de serveur, renseigne son jeton. L’ancien jeton ne sera pas envoyé à une autre adresse."
          )
        }
        connection = try Connection(
          url: address, token: token.isEmpty ? previous?.token ?? "" : token)
      } else {
        throw RecallError.message("Renseigne l’adresse de ton serveur.")
      }
      let newKey = key.trimmingCharacters(in: .whitespacesAndNewlines)
      guard newKey.isEmpty || (20...256).contains(newKey.count) else {
        throw RecallError.message("La clé Gemini est invalide.")
      }
      let savedConnection = connection
      try await Task.detached {
        if let savedConnection {
          try KeychainStore.save(JSONEncoder().encode(savedConnection), account: "server")
        }
        if !newKey.isEmpty { try KeychainStore.save(newKey, account: "gemini") }
      }.value
      key = ""
      token = ""
      await session.refreshCredentials()
      library.sync()
      message = "Réglages enregistrés. Tu n’auras pas à ressaisir ta clé au prochain lancement."
    } catch { message = error.localizedDescription }
  }
}
