import SillageKit
import SwiftUI

/// The same account-scoped choices in onboarding and Settings.
struct AIProviderFields: View {
  @EnvironmentObject var session: Session
  var body: some View {
    Picker("Fournisseur", selection: $session.provider) {
      ForEach(AIProvider.allCases) { provider in Text(provider.name).tag(provider) }
    }
    Picker("Modèle", selection: $session.model) {
      ForEach(session.availableModels, id: \.self) { model in Text(model).tag(model) }
    }
  }
}
