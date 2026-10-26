import RecallKit
import SwiftUI

/// Three short steps — account, DJ, first playlist — each with one main action.
/// The step follows what is already done, so a returning account lands where it left off.
/// Laid out like Studio: the Stoa backdrop under a dark veil, text on the left, chalk buttons.
struct OnboardingView: View {
  @EnvironmentObject var session: Session
  @EnvironmentObject var library: LibraryModel
  @State private var key = ""
  @State private var busy = false
  @State private var error = ""
  @FocusState private var fieldFocused: Bool
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  private var step: Int { !session.googleAccount ? 0 : !session.hasKey ? 1 : 2 }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      progress
      Group {
        switch step {
        case 0: account
        case 1: gemini
        default: playlists
        }
      }
      .id(step)
      .transition(reduceMotion ? .opacity : .opacity.combined(with: .offset(x: 12)))
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
      Button(session.hasServer ? "Plus tard" : "Fermer") { session.showOnboarding = false }
        .buttonStyle(.plain).font(.callout).foregroundStyle(Stoa.stone)
        .disabled(busy || session.claimingLibrary).padding(.top, 28)
    }
    .padding(40)
    .frame(width: 640, height: 460)
    .background(OnboardingBackdrop())
    .environment(\.colorScheme, .dark)
    .animation(.easeInOut(duration: 0.3), value: step)
    .interactiveDismissDisabled().tint(Stoa.orange)
  }

  /// Three short strokes; the current one in Stoa orange.
  private var progress: some View {
    HStack(spacing: 4) {
      ForEach(0..<3) { index in
        Capsule().fill(index == step ? Stoa.orange : Stoa.chalk.opacity(index < step ? 0.6 : 0.18))
          .frame(width: 20, height: 2)
      }
    }
    .accessibilityElement().accessibilityLabel("Étape \(step + 1) sur 3")
  }

  private var account: some View {
    StepPage(
      title: "Bienvenue dans Sillage",
      message: "Ton DJ personnel, nourri par tes playlists YouTube."
    ) {
      if session.signingIn {
        HStack(spacing: 12) {
          ProgressView().controlSize(.small)
          Text("Termine la connexion dans ton navigateur.").foregroundStyle(Stoa.chalk)
          Button("Annuler") { session.cancelGoogleSignIn() }.buttonStyle(.plain)
            .foregroundStyle(Stoa.stone)
        }.frame(height: 40)
      } else {
        Button {
          Task { await session.connectGoogle() }
        } label: {
          HStack(spacing: 10) {
            GoogleMark().frame(width: 16, height: 16)
            Text("Continuer avec Google")
          }
        }
        .buttonStyle(ChalkButtonStyle())
        .keyboardShortcut(.defaultAction)
        .disabled(session.loadingCredentials)
      }
      errorLine
      Text("Sillage reçoit ton nom et ton adresse e-mail, rien d’autre.")
        .font(.caption).foregroundStyle(Stoa.stone)
    }
  }

  private var gemini: some View {
    StepPage(
      title: "Active ton DJ",
      message: "Colle ta clé Gemini. Elle reste chiffrée sur ton compte."
    ) {
      HStack(spacing: 8) {
        SecureField("Clé API Gemini", text: $key)
          .textFieldStyle(.plain).focused($fieldFocused).onSubmit(saveKey).disabled(busy)
        if busy { ProgressView().controlSize(.small) }
      }
      .padding(.horizontal, 12).frame(width: 340, height: 40)
      .background(Stoa.ink.opacity(0.7), in: RoundedRectangle(cornerRadius: 8))
      .overlay(
        RoundedRectangle(cornerRadius: 8).strokeBorder(
          fieldFocused ? Stoa.orange : Stoa.chalk.opacity(0.16)))
      errorLine
      HStack(spacing: 20) {
        Button(busy ? "Vérification…" : "Activer mon DJ", action: saveKey)
          .buttonStyle(ChalkButtonStyle())
          .disabled(busy || key.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        Link("Obtenir une clé", destination: URL(string: "https://aistudio.google.com/api-keys")!)
          .font(.callout).foregroundStyle(Stoa.chalk.opacity(0.8))
          .help("Ouvre Google AI Studio, où la clé est gratuite.")
      }
      if !session.accountEmail.isEmpty {
        Text("Connecté : \(session.accountEmail)").font(.caption).foregroundStyle(Stoa.stone)
      }
    }
    .onAppear { fieldFocused = true }
  }

  private var playlists: some View {
    StepPage(
      title: session.canClaimLibrary ? "Retrouve tes playlists" : "Ajoute une playlist",
      message: session.canClaimLibrary
        ? "Des playlists existent déjà sur ce serveur. Rattache-les à ton compte."
        : library.libraryCount > 0
          ? "Ta bibliothèque compte \(library.libraryCount) vidéos. Tu peux en ajouter d’autres."
          : "Colle le lien d’une playlist YouTube publique ou non répertoriée."
    ) {
      if session.canClaimLibrary {
        Button(session.claimingLibrary ? "Récupération…" : "Récupérer mes playlists") {
          Task { await session.claimLibrary() }
        }
        .buttonStyle(ChalkButtonStyle())
        .keyboardShortcut(.defaultAction).disabled(session.claimingLibrary)
        errorLine
      } else {
        TextField("youtube.com/playlist?list=…", text: $library.playlistLink)
          .textFieldStyle(.plain).focused($fieldFocused).onSubmit(importAndFinish)
          .padding(.horizontal, 12).frame(width: 340, height: 40)
          .background(Stoa.ink.opacity(0.7), in: RoundedRectangle(cornerRadius: 8))
          .overlay(
            RoundedRectangle(cornerRadius: 8).strokeBorder(
              fieldFocused ? Stoa.orange : Stoa.chalk.opacity(0.16)))
        errorLine
        HStack(spacing: 20) {
          Button("Importer", action: importAndFinish).buttonStyle(ChalkButtonStyle())
            .disabled(library.playlistLink.trimmingCharacters(in: .whitespaces).isEmpty)
          if library.libraryCount > 0 {
            Button("C’est parti") { session.showOnboarding = false }.buttonStyle(.plain)
              .font(.callout).foregroundStyle(Stoa.chalk.opacity(0.8))
          }
        }
      }
    }
  }

  @ViewBuilder private var errorLine: some View {
    if !error.isEmpty || !session.error.isEmpty {
      Text(error.isEmpty ? session.error : error)
        .font(.callout).foregroundStyle(Stoa.orange).frame(maxWidth: 380, alignment: .leading)
        .fixedSize(horizontal: false, vertical: true)
    }
  }

  private func saveKey() {
    guard !busy, !key.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
    error = ""
    busy = true
    Task {
      defer { busy = false }
      do {
        try await session.saveGeminiKey(key, finishOnboarding: false)
        key = ""
      } catch { self.error = error.localizedDescription }
    }
  }

  /// The import runs in Bibliothèque, where its progress shows.
  private func importAndFinish() {
    guard !library.playlistLink.trimmingCharacters(in: .whitespaces).isEmpty else { return }
    library.importPlaylist()
    session.showOnboarding = false
  }
}

/// Stoa's brand colours, as in the Stoa site.
private enum Stoa {
  static let ink = Color(red: 0x20 / 255, green: 0x20 / 255, blue: 0x1e / 255)
  static let chalk = Color(red: 0xf5 / 255, green: 0xf3 / 255, blue: 0xee / 255)
  static let orange = Color(red: 0xf1 / 255, green: 0x5a / 255, blue: 0x24 / 255)
  /// Secondary text on ink.
  static let stone = Color(red: 0x8f / 255, green: 0x8e / 255, blue: 0x86 / 255)
}

private struct StepPage<Actions: View>: View {
  let title: String
  let message: String
  @ViewBuilder var actions: Actions
  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      Text(title).font(.system(size: 32, weight: .semibold)).tracking(-0.4)
        .foregroundStyle(Stoa.chalk)
      Text(message).font(.title3).foregroundStyle(Stoa.chalk.opacity(0.62))
        .frame(maxWidth: 380, alignment: .leading).fixedSize(horizontal: false, vertical: true)
        .padding(.top, 8)
      VStack(alignment: .leading, spacing: 14) { actions }.padding(.top, 28)
    }
  }
}

/// The idle backdrop chosen in Apparence, veiled in ink and darkest behind the text.
private struct OnboardingBackdrop: View {
  @ObservedObject private var appearance = AppearanceModel.shared
  var body: some View {
    ZStack {
      Stoa.ink
      if let image = appearance.image {
        Image(nsImage: image).resizable().aspectRatio(contentMode: .fill)
          .frame(maxWidth: .infinity, maxHeight: .infinity).clipped().opacity(0.85)
      }
      LinearGradient(
        stops: [
          .init(color: Stoa.ink, location: 0.25), .init(color: Stoa.ink.opacity(0.3), location: 1),
        ], startPoint: .leading, endPoint: .trailing)
      LinearGradient(
        colors: [.clear, Stoa.ink.opacity(0.8)], startPoint: .center, endPoint: .bottom)
    }
    .ignoresSafeArea().accessibilityHidden(true)
  }
}

/// Chalk fill and ink text: the one main action on each step.
private struct ChalkButtonStyle: ButtonStyle {
  @Environment(\.isEnabled) private var isEnabled
  func makeBody(configuration: Configuration) -> some View {
    configuration.label.font(.body.weight(.semibold)).foregroundStyle(Stoa.ink)
      .padding(.horizontal, 20).frame(height: 40)
      .background(
        Stoa.chalk.opacity(isEnabled ? (configuration.isPressed ? 0.8 : 1) : 0.3),
        in: RoundedRectangle(cornerRadius: 8)
      )
      .contentShape(RoundedRectangle(cornerRadius: 8))
  }
}
