import RecallKit
import SwiftUI

/// Three short steps — account, DJ, first playlist — each with one main action.
/// The step follows what is already done, so a returning account lands where it left off.
struct OnboardingView: View {
  @EnvironmentObject var session: Session
  @EnvironmentObject var library: LibraryModel
  @State private var key = ""
  @State private var busy = false
  @State private var error = ""
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  private var step: Int { !session.googleAccount ? 0 : !session.hasKey ? 1 : 2 }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(spacing: 6) {
        ForEach(0..<3) { index in
          Capsule().fill(index <= step ? Color.recall : Color.secondary.opacity(0.25))
            .frame(width: index == step ? 22 : 8, height: 8)
        }
      }.animation(.easeInOut(duration: 0.25), value: step)
        .accessibilityElement().accessibilityLabel("Étape \(step + 1) sur 3")
      Group {
        switch step {
        case 0: account
        case 1: gemini
        default: playlists
        }
      }
      .id(step)
      .transition(
        reduceMotion
          ? .opacity
          : .asymmetric(insertion: .push(from: .trailing), removal: .push(from: .trailing))
      )
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
      .padding(.top, 28)
      if !error.isEmpty || !session.error.isEmpty {
        Label(error.isEmpty ? session.error : error, systemImage: "exclamationmark.triangle")
          .font(.callout).foregroundStyle(.orange).padding(.bottom, 12)
      }
      HStack {
        Button(session.hasServer ? "Plus tard" : "Fermer") { session.showOnboarding = false }
          .buttonStyle(.link).disabled(busy || session.claimingLibrary)
        Spacer()
      }
    }
    .padding(32).frame(width: 520, height: 440)
    .animation(.easeInOut(duration: 0.3), value: step)
    .interactiveDismissDisabled().tint(.recall)
  }

  private var account: some View {
    StepPage(
      title: "Bienvenue dans Recall",
      message: "Ton DJ personnel, nourri par tes playlists YouTube. Ta bibliothèque reste privée sur ton compte."
    ) {
      Button(session.signingIn ? "Connexion…" : "Continuer avec Google") {
        Task { await session.connectGoogle() }
      }.buttonStyle(.borderedProminent).controlSize(.large)
        .disabled(session.signingIn || session.loadingCredentials)
      if session.signingIn {
        HStack {
          Text("Termine la connexion dans ton navigateur.").foregroundStyle(.secondary)
          Button("Annuler") { session.cancelGoogleSignIn() }.buttonStyle(.link)
        }.font(.callout)
      }
      Text("Recall reçoit seulement ton nom et ton adresse e-mail.").font(.caption)
        .foregroundStyle(.secondary)
    }
  }

  private var gemini: some View {
    StepPage(
      title: "Active ton DJ",
      message: "Le DJ utilise ta clé Gemini, chiffrée sur ton compte. Tu ne la saisis qu’une fois."
    ) {
      Label(session.accountEmail, systemImage: "person.crop.circle.fill").foregroundStyle(.secondary)
      SecureField("Ta clé API Gemini", text: $key).textFieldStyle(.roundedBorder)
        .onSubmit(saveKey)
      HStack {
        Button(busy ? "Vérification…" : "Activer mon DJ", action: saveKey)
          .buttonStyle(.borderedProminent).controlSize(.large)
          .disabled(busy || key.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        Link("Obtenir une clé", destination: URL(string: "https://aistudio.google.com/api-keys")!)
          .padding(.leading, 8)
      }
    }
  }

  private var playlists: some View {
    StepPage(
      title: session.canClaimLibrary ? "Retrouve tes playlists" : "Ajoute une playlist",
      message: session.canClaimLibrary
        ? "Des playlists existent déjà sur ce serveur. Rattache-les à ton compte."
        : library.libraryCount > 0
          ? "Ta bibliothèque compte \(library.libraryCount) vidéos. Tu peux en ajouter d’autres."
          : "Colle le lien d’une playlist YouTube, publique ou non répertoriée."
    ) {
      if session.canClaimLibrary {
        Button(session.claimingLibrary ? "Récupération…" : "Récupérer mes playlists") {
          Task { await session.claimLibrary() }
        }.buttonStyle(.borderedProminent).controlSize(.large).disabled(session.claimingLibrary)
      } else {
        TextField("https://www.youtube.com/playlist?list=…", text: $library.playlistLink)
          .textFieldStyle(.roundedBorder).onSubmit(importAndFinish)
        HStack {
          Button("Importer", action: importAndFinish).buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(library.playlistLink.trimmingCharacters(in: .whitespaces).isEmpty)
          if library.libraryCount > 0 {
            Button("C’est parti") { session.showOnboarding = false }.controlSize(.large)
          }
        }
      }
    }
  }

  private func saveKey() {
    guard !busy, !key.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
    error = ""
    busy = true
    Task {
      defer { busy = false }
      do {
        try await session.saveGeminiKey(key)
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

private struct StepPage<Actions: View>: View {
  let title: String
  let message: String
  @ViewBuilder var actions: Actions
  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      Text(title).font(.largeTitle.bold())
      Text(message).font(.title3).foregroundStyle(.secondary)
        .fixedSize(horizontal: false, vertical: true)
      VStack(alignment: .leading, spacing: 12) { actions }.padding(.top, 8)
    }
  }
}
