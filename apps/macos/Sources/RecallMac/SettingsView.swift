import RecallKit
import SwiftUI

struct SettingsView: View {
  @EnvironmentObject var session: Session
  @EnvironmentObject var library: LibraryModel
  @State private var key = ""
  @State private var youtubeKey = ""
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
        Toggle("DJ Apple sur ce Mac · sans clé Gemini", isOn: $session.localDJ)
        Text(
          AppleDJ.availability
            ?? "Modèle Apple prêt. Tes demandes et les titres restent sur ce Mac."
        ).font(.caption).foregroundStyle(.secondary)
        Text(
          "Désactive ce mode pour utiliser Gemini ou ton serveur. Aucun basculement vers le cloud sans ton choix."
        ).font(.caption)
        if !session.localDJ {
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
      }
      Section("Import YouTube sur ce Mac") {
        SecureField(
          session.hasYouTubeKey
            ? "Nouvelle clé YouTube (vide pour conserver)" : "Clé YouTube Data API",
          text: $youtubeKey)
        Text(
          "Une seule saisie, conservée dans le Trousseau. Importe les playlists publiques ou non répertoriées. La clé Gemini ne remplace pas une clé autorisée pour YouTube."
        ).font(.caption).foregroundStyle(.secondary)
        Link(
          "Créer une clé YouTube",
          destination: URL(string: "https://console.cloud.google.com/apis/credentials")!)
      }
      Section("Bibliothèque") {
        Toggle("Utiliser mon serveur vectoriel", isOn: $session.useServer)
        TextField("Adresse HTTPS du serveur (facultatif)", text: $serverURL)
        SecureField("Jeton personnel (laisser vide pour conserver)", text: $token)
        if session.hasServer {
          Button("Oublier ce serveur") {
            Task {
              await session.forgetServer()
              serverURL = ""
              message = "Serveur retiré de ce Mac. Ta bibliothèque locale est conservée."
            }
          }
        }
        Text(
          "Sur ce Mac, ajoute un lien YouTube dans Bibliothèque ou importe un export JSON. Le serveur vectoriel reste facultatif. Les jetons d’un même serveur partagent sa bibliothèque."
        ).font(.caption).foregroundStyle(.secondary)
      }
      Section("Micro et voix") {
        Text(
          "Le micro fonctionne uniquement au clic. La dictée française utilise la reconnaissance Apple, sur l’appareil lorsque disponible, sinon via le service Apple. Le DJ Apple utilise la voix macOS. En mode Gemini, la voix macOS sert de secours."
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
      } else if session.useServer {
        throw RecallError.message("Renseigne l’adresse du serveur ou désactive le mode serveur.")
      }
      let newKey = key.trimmingCharacters(in: .whitespacesAndNewlines)
      guard newKey.isEmpty || (20...256).contains(newKey.count) else {
        throw RecallError.message("La clé Gemini est invalide.")
      }
      let newYouTubeKey = youtubeKey.trimmingCharacters(in: .whitespacesAndNewlines)
      guard newYouTubeKey.isEmpty || (20...256).contains(newYouTubeKey.count) else {
        throw RecallError.message("Clé YouTube invalide.")
      }
      let savedConnection = connection
      try await Task.detached {
        if let savedConnection {
          try KeychainStore.save(JSONEncoder().encode(savedConnection), account: "server")
        }
        if !newKey.isEmpty { try KeychainStore.save(newKey, account: "gemini") }
        if !newYouTubeKey.isEmpty { try KeychainStore.save(newYouTubeKey, account: "youtube") }
      }.value
      key = ""
      youtubeKey = ""
      token = ""
      await session.refreshCredentials()
      library.search()
      message = "Réglages enregistrés. Tu n’auras pas à ressaisir ta clé au prochain lancement."
    } catch { message = error.localizedDescription }
  }
}
