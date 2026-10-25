import RecallAudio
import RecallKit
import SwiftUI

private let forest = Color(red: 0.09, green: 0.18, blue: 0.14)
private let cream = Color(red: 0.97, green: 0.96, blue: 0.92)
struct MainView: View {
  @EnvironmentObject var session: Session
  @EnvironmentObject var library: LibraryModel
  @EnvironmentObject var dj: DJModel
  @State private var tab = "dj"
  var body: some View {
    NavigationSplitView {
      VStack(alignment: .leading, spacing: 24) {
        Label("recall", systemImage: "dot.radiowaves.left.and.right").font(
          .system(size: 30, weight: .semibold, design: .rounded))
        Text("TA MÉMOIRE MUSICALE").font(.system(size: 10, design: .monospaced)).tracking(2)
          .foregroundStyle(.secondary)
        Button {
          tab = "dj"
        } label: {
          Label("Ton DJ", systemImage: "headphones").frame(maxWidth: .infinity, alignment: .leading)
        }
        Button {
          tab = "library"
        } label: {
          Label("Bibliothèque", systemImage: "square.stack").frame(
            maxWidth: .infinity, alignment: .leading)
        }
        Spacer()
        Text("\(library.libraryCount) vidéos").font(.headline)
        Text(
          session.useServer ? "Recherche vectorielle · ton serveur" : "Bibliothèque locale · ce Mac"
        ).font(.caption).foregroundStyle(.secondary)
        SettingsLink { Label("Réglages", systemImage: "slider.horizontal.3") }
      }.padding(24).buttonStyle(.plain).navigationSplitViewColumnWidth(220)
    } detail: {
      VStack(spacing: 0) {
        if !session.error.isEmpty {
          HStack {
            Image(systemName: "exclamationmark.circle")
            Text(session.error)
            Spacer()
            Button("Fermer") { session.error = "" }
          }.padding(12).background(Color.orange.opacity(0.15))
        }
        if !session.notice.isEmpty {
          HStack {
            Text(session.notice).font(.caption)
            Spacer()
            Button {
              session.notice = ""
            } label: {
              Image(systemName: "xmark")
            }.buttonStyle(.plain)
          }.padding(10).background(Color.green.opacity(0.08))
        }
        if tab == "dj" {
          DJView(model: dj)
        } else {
          LibraryView(onPlay: { tab = "dj" })
        }
      }.background(cream)
    }.tint(forest)
      .sheet(isPresented: $session.showOnboarding) { OnboardingView().environmentObject(session) }
  }
}
