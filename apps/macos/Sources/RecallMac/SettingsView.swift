import RecallKit
import SwiftUI

struct SettingsView: View {
  @EnvironmentObject var session: Session
  @EnvironmentObject var library: LibraryModel
  @EnvironmentObject var dj: DJModel
  @State private var key = ""
  @State private var busy = false
  @State private var message = ""
  var body: some View {
    Form {
      Section("Mon compte") {
        if session.googleAccount {
          Label(session.accountEmail, systemImage: "person.crop.circle.fill")
          Text("Seules tes playlists et ta clé Gemini sont accessibles depuis ce compte.").font(
            .caption)
          Button("Me déconnecter") { Task { await session.forgetServer() } }
        } else {
          Text(
            session.hasServer
              ? "Ta bibliothèque historique est connectée. Connecte Google pour la rattacher à ton compte."
              : "Connecte-toi pour créer ta bibliothèque personnelle.")
          Button(session.signingIn ? "Connexion…" : "Continuer avec Google") {
            Task { await session.connectGoogle() }
          }
          .disabled(session.signingIn || session.loadingCredentials)
          if session.signingIn {
            Text("Termine la connexion dans ton navigateur.").font(.caption)
            Button("Annuler la connexion") { session.cancelGoogleSignIn() }
          }
        }
        if session.canClaimLibrary {
          Button("Rattacher mes playlists existantes à \(session.accountEmail)") {
            Task { await session.claimLibrary() }
          }
        }
      }
      Section("Mon DJ Gemini") {
        Picker("Modèle", selection: $session.model) {
          Text("Gemini 3.8 Flash · équilibré").tag("gemini-3.8-flash")
          Text("Gemini 3.5 Flash-Lite · très rapide").tag("gemini-3.5-flash-lite")
          Text("Gemini 4 Argon · raisonnement avancé").tag("gemini-4-argon")
        }
        SecureField(
          session.hasKey ? "Nouvelle clé (laisser vide pour conserver)" : "Ma clé API Gemini",
          text: $key)
        Text(
          "Chiffrée sur le serveur, réservée à ton compte. Les demandes au DJ et les titres proposés sont transmis à Google et utilisent ton quota Gemini."
        ).font(.caption)
        Link(
          "Obtenir ma clé Gemini", destination: URL(string: "https://aistudio.google.com/api-keys")!
        )
        HStack {
          Button(busy ? "Enregistrement…" : "Enregistrer") {
            busy = true
            Task {
              defer { busy = false }
              do {
                if key.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                  try await session.saveModel()
                } else {
                  try await session.saveGeminiKey(key)
                  key = ""
                }
                message = "Réglages enregistrés sur ton compte."
              } catch { message = error.localizedDescription }
            }
          }.buttonStyle(.borderedProminent).disabled(busy || !session.googleAccount)
          if session.hasKey && session.googleAccount {
            Button("Retirer ma clé") {
              Task {
                do { try await session.removeGeminiKey() } catch {
                  message = error.localizedDescription
                }
              }
            }
          }
        }
      }
      Section("YouTube") {
        Text(
          "Colle le lien d’une playlist publique ou non répertoriée dans Bibliothèque. Aucune clé YouTube à saisir. Les imports et la recherche restent sur le serveur."
        ).font(.caption)
      }
      Section("Micro et voix") {
        Toggle("Voix Gemini expressive", isOn: $session.cloudVoice)
        Text("Micro au clic. Dictée Apple ; voix Gemini avec ta clé, voix macOS en secours.").font(
          .caption)
      }
      Section("Vidéo Studio") {
        StudioQualitySettings(player: dj.player)
      }
      Section("Mises à jour") {
        Text(
          "Les archives de mise à jour doivent être signées. Cette version utilise une signature locale ; la distribution sans avertissement macOS attend la notarisation Apple."
        ).font(.caption)
      }
      if !message.isEmpty { Text(message).font(.caption) }
      if !session.error.isEmpty { Text(session.error).font(.caption).foregroundStyle(.red) }
    }.formStyle(.grouped).frame(width: 650, height: 700)
      .task { await session.refreshCredentials() }
  }
}

private struct StudioQualitySettings: View {
  @ObservedObject var player: Player
  var body: some View {
    Picker("Qualité", selection: Binding(get: { player.quality }, set: { player.setQuality($0) })) {
      Text("1080p").tag(StudioQuality.hd)
      if Player.supports4K { Text("Jusqu’à 4K").tag(StudioQuality.ultra) }
    }
    Text(
      Player.supports4K
        ? "La résolution dépend du clip disponible. Cache Studio : 2 Go en 1080p, 6 Go en 4K."
        : "1080p sur ce Mac. La 4K nécessite le décodage matériel AV1. Cache Studio : 2 Go."
    ).font(.caption)
    if player.downloadingStudio {
      Text("Le clip Studio se prépare en plein écran.").font(.caption)
    }
    if player.videoHeight > 0 { Text("Clip en cours : \(player.videoHeight)p").font(.caption) }
  }
}
