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
      Section("Compte") {
        if session.googleAccount {
          Label(session.accountEmail, systemImage: "person.crop.circle.fill")
            .help("Seules tes playlists et ta clé Gemini sont accessibles depuis ce compte.")
          Button("Me déconnecter") {
            key = ""
            message = ""
            Task { await session.forgetServer() }
          }.disabled(busy)
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
      Section("DJ") {
        Picker("Modèle", selection: $session.model) {
          Text("Gemini 3.8 Flash · équilibré").tag("gemini-3.8-flash")
          Text("Gemini 3.5 Flash-Lite · très rapide").tag("gemini-3.5-flash-lite")
          Text("Gemini 4 Argon · raisonnement avancé").tag("gemini-4-argon")
        }
        .disabled(busy)
        SecureField(
          session.hasKey ? "Nouvelle clé (laisser vide pour conserver)" : "Ma clé API Gemini",
          text: $key
        ).disabled(busy)
          .help(
            "Chiffrée sur le serveur, réservée à ton compte. Les demandes au DJ sont transmises à Google avec ton quota Gemini."
          )
        Link(
          "Obtenir une clé Gemini", destination: URL(string: "https://aistudio.google.com/api-keys")!
        )
        HStack {
          Button(busy ? "Vérification…" : "Vérifier et enregistrer") {
            busy = true
            message = ""
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
          Button("Tester le DJ et la voix") {
            busy = true
            message = ""
            Task {
              defer { busy = false }
              do { message = try await session.testGeminiKey(key).message } catch {
                message = error.localizedDescription
              }
            }
          }.disabled(busy || !session.googleAccount || (!session.hasKey && key.isEmpty))
            .help("De courts appels réels à Google, sur le quota de la clé ; rien n’est enregistré.")
          if session.hasKey && session.googleAccount {
            Button("Retirer ma clé") {
              busy = true
              message = ""
              Task {
                defer { busy = false }
                do {
                  try await session.removeGeminiKey()
                  key = ""
                  message = "Clé retirée de ton compte."
                } catch {
                  message = error.localizedDescription
                }
              }
            }.disabled(busy)
          }
        }
        if !message.isEmpty { Text(message).font(.callout).textSelection(.enabled) }
      }
      Section("Voix") {
        Toggle("Voix Gemini expressive", isOn: $session.cloudVoice)
          .help("Micro au clic, dictée Apple. Voix Gemini avec ta clé, voix macOS en secours.")
      }
      Section("Vidéo") {
        StudioQualitySettings(player: dj.player)
      }
      if !session.error.isEmpty { Text(session.error).font(.caption).foregroundStyle(.red) }
    }.onChange(of: key) { _, _ in message = "" }.onChange(of: session.model) { _, _ in message = ""
    }.formStyle(.grouped).frame(width: 650, height: 700)
      .task { await session.refreshCredentials() }
  }
}

private struct StudioQualitySettings: View {
  @ObservedObject var player: Player
  var body: some View {
    Picker(
      "Qualité vidéo",
      selection: Binding(
        get: { player.youtubeOnly ? "youtube" : player.quality.rawValue },
        set: { value in
          if value == "youtube" {
            player.setYouTubeOnly(true)
          } else {
            player.setYouTubeOnly(false)
            player.setQuality(StudioQuality(rawValue: value) ?? .hd)
          }
        })
    ) {
      Text("1080p").tag(StudioQuality.hd.rawValue)
      if Player.supports4K { Text("Jusqu’à 4K").tag(StudioQuality.ultra.rawValue) }
      Text("Lecteur YouTube seulement").tag("youtube")
    }.help(
      Player.supports4K
        ? "Même qualité en Compact et en Studio. Le clip est téléchargé sur ce Mac ; la musique démarre aussitôt sur YouTube puis bascule. Cache : 2 Go en 1080p, 6 Go en 4K."
        : "Même qualité en Compact et en Studio. Le clip est téléchargé sur ce Mac ; la musique démarre aussitôt sur YouTube puis bascule. Cache : 2 Go. La 4K demande le décodage matériel AV1.")
    if player.preparingClip {
      Text("Préparation du clip en haute qualité…").font(.caption).foregroundStyle(.secondary)
    }
    if player.videoHeight > 0 { Text("Clip en cours : \(player.videoHeight)p").font(.caption) }
  }
}
