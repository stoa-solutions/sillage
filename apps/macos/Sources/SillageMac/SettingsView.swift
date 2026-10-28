import SillageKit
import SwiftUI

enum SettingsPage: String, CaseIterable, Identifiable {
  static let requestKey = "settingsRequestedPage"
  case dj = "DJ et voix"
  case agents = "Agents"
  case taste = "Goût"
  case playback = "Lecture"
  case appearance = "Apparence"
  case desk = "Bureau"
  case account = "Compte"
  var id: String { rawValue }
  var symbol: String {
    switch self {
    case .dj: "waveform"
    case .agents: "person.wave.2"
    case .taste: "hand.thumbsup"
    case .playback: "play.rectangle"
    case .appearance: "paintpalette"
    case .desk: "menubar.rectangle"
    case .account: "person.crop.circle"
    }
  }
  /// One sentence under the page title: what the page decides.
  var subtitle: String {
    switch self {
    case .dj: "Le modèle qui fait tourner ton DJ, sa clé et sa voix."
    case .agents: "Qui te répond, et sur quel ton."
    case .taste: "Comment tes avis et tes écoutes guident les propositions."
    case .playback: "La qualité du clip dans Compact et Studio."
    case .appearance: "Le fond de Sillage quand aucun morceau ne joue."
    case .desk: "Parler au DJ depuis n’importe quelle app."
    case .account: "Ton compte, tes playlists et ta session."
    }
  }
  /// Recette: the page named by SILLAGE_QA_SETTINGS (a case name such as taste).
  static let qaPage: SettingsPage? = ProcessInfo.processInfo.environment["SILLAGE_QA_SETTINGS"]
    .flatMap { name in allCases.first { "\($0)" == name } }
  /// Sidebar groups, in order.
  static let groups: [(title: String, pages: [SettingsPage])] = [
    ("Écoute", [.dj, .agents, .taste, .playback]),
    ("Sillage", [.appearance, .desk]),
    ("Compte", [.account]),
  ]
}

/// Réglages on the same glass as the main window: the Stoa light behind, a sidebar veil and
/// a reading veil, one page at a time. The system chooses light or dark, as everywhere else.
struct SettingsView: View {
  @EnvironmentObject var session: Session
  @EnvironmentObject var library: LibraryModel
  @EnvironmentObject var dj: DJModel
  @EnvironmentObject var desk: DeskIntegration
  @State private var page = SettingsPage.qaPage ?? .dj
  /// A page asked for from elsewhere (the composer's agent menu), consumed once.
  @AppStorage(SettingsPage.requestKey) private var requestedPage = ""
  @State private var key = ""
  @State private var busy = false
  @State private var message = ""
  var body: some View {
    ZStack {
      SillageBackdrop()
      HStack(spacing: 0) {
        sidebar.frame(width: 220).sillageSurface(.sidebar)
        SillageRule(vertical: true)
        content.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
          .sillageSurface(.reading)
      }
    }
    .frame(width: 860, height: 720)
    .onChange(of: key) { _, value in if !value.isEmpty { message = "" } }
    .onChange(of: session.provider) { _, _ in
      key = ""
      message = ""
    }
    .onChange(of: session.model) { _, _ in message = "" }
    .onChange(of: session.generation) { _, _ in
      key = ""
      message = ""
    }
    .task { await session.refreshCredentials() }
    .onAppear(perform: openRequestedPage)
    .onChange(of: requestedPage) { _, _ in openRequestedPage() }
  }

  private var sidebar: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(spacing: 8) {
        Image(nsImage: SillageGlyph.image(listening: false)).accessibilityHidden(true)
        Text("Réglages").font(.system(size: 15, weight: .semibold))
      }.padding(.horizontal, 16).padding(.top, 18).padding(.bottom, 6)
      ScrollView {
        VStack(alignment: .leading, spacing: 2) {
          ForEach(SettingsPage.groups, id: \.title) { group in
            SidebarTitle(group.title)
            ForEach(group.pages) { item in
              SidebarItem(title: item.rawValue, symbol: item.symbol, selected: page == item) {
                page = item
              }
            }
          }
        }.padding(.horizontal, 8)
      }
      Spacer(minLength: 0)
      Text(Self.versionLine).font(.system(size: 11)).foregroundStyle(.secondary)
        .padding(16)
    }
  }

  /// « Sillage 1.8.6 (77) · by Stoa », from the bundle.
  private static let versionLine: String = {
    let info = Bundle.main.infoDictionary
    let version = info?["CFBundleShortVersionString"] as? String
    let build = info?["CFBundleVersion"] as? String
    guard let version else { return "Sillage · by Stoa" }
    return "Sillage \(version)\(build.map { " (\($0))" } ?? "") · by Stoa"
  }()

  @ViewBuilder private var content: some View {
    VStack(alignment: .leading, spacing: 0) {
      PageHeader(
        title: page.rawValue, subtitle: page.subtitle,
        titleFont: .system(size: 24, weight: .semibold)
      )
      .padding(.horizontal, 28).padding(.top, 26).padding(.bottom, 4)
      switch page {
      case .appearance: AppearanceSettings()
      case .agents: DJAgentsSettings(agents: dj.agents).id(dj.agents.epoch)
      default:
        Form {
          switch page {
          case .account: accountSettings
          case .dj: djSettings
          case .taste: TasteSettingsSection(taste: dj.taste)
          case .playback:
            Section("Vidéo") { StudioQualitySettings(player: dj.player) }
            Section {
              Text("Studio change l’affichage du clip. Le fond d’accueil se règle dans Apparence.")
                .font(.callout).foregroundStyle(.secondary)
            }
          case .desk: DeskSettings(desk: desk)
          case .appearance, .agents: EmptyView()
          }
          if !session.error.isEmpty {
            Text(session.error).font(.caption).foregroundStyle(.orange)
          }
        }
        .formStyle(.grouped).scrollContentBackground(.hidden)
      }
    }
  }

  private func openRequestedPage() {
    guard let requested = SettingsPage(rawValue: requestedPage) else { return }
    page = requested
    requestedPage = ""
  }
  private var accountSettings: some View {
    Section("Compte") {
      if session.googleAccount {
        Label(session.accountEmail, systemImage: "person.crop.circle.fill")
          .help("Seules tes playlists et tes clés API sont accessibles depuis ce compte.")
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
      AIProviderFields().disabled(busy)
      if session.provider != session.activeProvider {
        Text(
          "Actuellement : \(session.activeProvider.name). Le changement prend effet après enregistrement."
        )
        .font(.caption).foregroundStyle(.secondary)
      }
      SecureField(
        session.selectedHasKey
          ? "Nouvelle clé (laisser vide pour conserver)" : "Ma clé API \(session.provider.name)",
        text: $key
      ).disabled(busy)
        .help(
          "Chiffrée sur le serveur, réservée à ton compte. Les demandes au DJ sont transmises au fournisseur sélectionné avec ton quota. Les échanges, propositions et outils sont conservés dans le journal privé de ton compte pour diagnostiquer le DJ."
        )
      Link(
        "Obtenir une clé \(session.provider.name)", destination: session.provider.keyURL
      ).tint(Color.sillageOrange)
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
                try await session.saveAIKey(key)
                key = ""
              }
              message = "Réglages enregistrés sur ton compte."
            } catch { message = error.localizedDescription }
          }
        }.buttonStyle(.borderedProminent).disabled(busy || !session.googleAccount)
        Button(session.provider == .google ? "Tester le DJ et la voix" : "Tester le DJ") {
          busy = true
          message = ""
          Task {
            defer { busy = false }
            do { message = try await session.testAIKey(key).message } catch {
              message = error.localizedDescription
            }
          }
        }.disabled(busy || !session.googleAccount || (!session.selectedHasKey && key.isEmpty))
          .help(
            "De courts appels réels au fournisseur sélectionné, sur le quota de la clé ; rien n’est enregistré."
          )
        if session.selectedHasKey && session.googleAccount {
          Button("Retirer ma clé") {
            busy = true
            message = ""
            Task {
              defer { busy = false }
              do {
                try await session.removeAIKey()
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
      if session.activeProvider == .anthropic {
        Label("Voix macOS", systemImage: "waveform")
        Text("La voix est produite sur ce Mac. Aucune clé Google supplémentaire n’est nécessaire.")
          .font(.caption).foregroundStyle(.secondary)
      } else {
        Toggle("Voix Gemini expressive", isOn: $session.cloudVoice)
          .disabled(!session.cloudVoiceAvailable)
          .help("Micro au clic, dictée Apple. Voix Gemini avec ta clé, voix macOS en secours.")
      }
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
