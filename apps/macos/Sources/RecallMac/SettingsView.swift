import RecallKit
import SwiftUI

private enum SettingsPage: String, CaseIterable, Identifiable {
  case appearance = "Apparence"
  case dj = "DJ et voix"
  case playback = "Lecture"
  case account = "Compte"
  var id: String { rawValue }
  var symbol: String {
    switch self {
    case .appearance: return "paintpalette"
    case .dj: return "waveform"
    case .playback: return "play.rectangle"
    case .account: return "person.crop.circle"
    }
  }
}

struct SettingsView: View {
  @EnvironmentObject var session: Session
  @EnvironmentObject var library: LibraryModel
  @EnvironmentObject var dj: DJModel
  @State private var page = SettingsPage.appearance
  @State private var key = ""
  @State private var busy = false
  @State private var message = ""
  var body: some View {
    HStack(spacing: 0) {
      VStack(alignment: .leading, spacing: 8) {
        Text("Réglages").font(.title2.weight(.semibold)).padding(.bottom, 16)
        ForEach(SettingsPage.allCases) { item in
          Button {
            page = item
          } label: {
            Label(item.rawValue, systemImage: item.symbol)
              .frame(maxWidth: .infinity, alignment: .leading).padding(10)
              .background(
                page == item ? Color.recall.opacity(0.16) : .clear,
                in: RoundedRectangle(cornerRadius: 10))
          }.buttonStyle(.plain)
            .accessibilityAddTraits(page == item ? .isSelected : [])
        }
        Spacer()
        Text("À ton rythme.").font(.caption).foregroundStyle(.secondary)
      }.padding(20).frame(width: 190).background(.background.secondary)
      Divider()
      VStack(alignment: .leading, spacing: 0) {
        Text(page.rawValue).font(.title2.weight(.semibold)).padding(.horizontal, 24).padding(
          .top, 24)
        if page == .appearance {
          AppearanceSettings()
        } else {
          Form {
            switch page {
            case .account: accountSettings
            case .dj: djSettings
            case .playback:
              Section("Vidéo") { StudioQualitySettings(player: dj.player) }
              Section {
                Text(
                  "Studio change l’affichage du clip. Le fond d’accueil se règle dans Apparence."
                )
                .font(.callout).foregroundStyle(.secondary)
              }
            case .appearance: EmptyView()
            }
            if !session.error.isEmpty {
              Text(session.error).font(.caption).foregroundStyle(.orange)
            }
          }.formStyle(.grouped)
        }
      }.frame(maxWidth: .infinity, maxHeight: .infinity)
    }.frame(width: 850, height: 750).preferredColorScheme(.dark)
      .onChange(of: key) { _, _ in message = "" }
      .onChange(of: session.model) { _, _ in message = "" }
      .onChange(of: session.generation) { _, _ in
        key = ""
        message = ""
      }
      .task { await session.refreshCredentials() }
  }
  private var accountSettings: some View {
    Section("Compte") {
      if session.googleAccount {
        Label(session.accountEmail, systemImage: "person.crop.circle.fill")
          .help("Seules tes playlists et ta clé Gemini sont accessibles depuis ce compte.")
        Button(session.signingIn ? "Connexion en cours…" : "Reconnecter Google") {
          Task { await session.connectGoogle() }
        }.disabled(busy || session.signingIn)
        if session.signingIn {
          Text("Termine la connexion dans ton navigateur.").font(.caption)
          Button("Annuler") { session.cancelGoogleSignIn() }
        }
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
  }
  @ViewBuilder private var djSettings: some View {
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
          "Chiffrée sur le serveur, réservée à ton compte. Les demandes au DJ sont transmises à Google avec ton quota Gemini. Les échanges, propositions et outils sont conservés dans le journal privé de ton compte pour diagnostiquer le DJ."
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
        : "Même qualité en Compact et en Studio. Le clip est téléchargé sur ce Mac ; la musique démarre aussitôt sur YouTube puis bascule. Cache : 2 Go. La 4K demande le décodage matériel AV1."
    )
    if player.preparingClip {
      Text("Préparation du clip en haute qualité…").font(.caption).foregroundStyle(.secondary)
    }
    if player.videoHeight > 0 { Text("Clip en cours : \(player.videoHeight)p").font(.caption) }
  }
}
