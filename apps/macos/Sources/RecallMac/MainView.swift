import RecallKit
import SwiftUI

private let forest = Color(red: 0.09, green: 0.18, blue: 0.14)
private let cream = Color(red: 0.97, green: 0.96, blue: 0.92)
struct MainView: View {
  @EnvironmentObject var model: AppModel
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
        Text("\(model.tracks.count) vidéos").font(.headline)
        Text(
          model.useServer ? "Recherche vectorielle · ton serveur" : "Bibliothèque locale · ce Mac"
        ).font(.caption).foregroundStyle(.secondary)
        SettingsLink { Label("Réglages", systemImage: "slider.horizontal.3") }
      }.padding(24).buttonStyle(.plain).navigationSplitViewColumnWidth(220)
    } detail: {
      VStack(spacing: 0) {
        if !model.error.isEmpty {
          HStack {
            Image(systemName: "exclamationmark.circle")
            Text(model.error)
            Spacer()
            Button("Fermer") { model.error = "" }
          }.padding(12).background(Color.orange.opacity(0.15))
        }
        if !model.notice.isEmpty {
          HStack {
            Text(model.notice).font(.caption)
            Spacer()
            Button {
              model.notice = ""
            } label: {
              Image(systemName: "xmark")
            }.buttonStyle(.plain)
          }.padding(10).background(Color.green.opacity(0.08))
        }
        if tab == "dj" { DJView(model: model) } else { LibraryView().environmentObject(model) }
      }.background(cream)
    }.tint(forest)
  }
}
struct DJView: View {
  @ObservedObject var model: AppModel
  @ObservedObject var player: Player
  @ObservedObject var microphone: Microphone
  init(model: AppModel) {
    self.model = model
    player = model.player
    microphone = model.microphone
  }
  var body: some View {
    HSplitView {
      VStack(alignment: .leading, spacing: 18) {
        Text("À TON RYTHME").font(.system(size: 10, design: .monospaced)).tracking(2)
        Text("Un mood.\nLa bonne musique.").font(.system(size: 40, weight: .medium, design: .serif))
        Text("Parle-moi de ta soirée. On trouve la suite ensemble.").foregroundStyle(.secondary)
        PlayerView(player: player).frame(minHeight: 250, maxHeight: 310).clipShape(
          RoundedRectangle(cornerRadius: 16))
        Text(model.current?.title ?? "Prêt quand tu l’es").font(.title3).bold().lineLimit(2)
        Text(model.current?.channel ?? "Une ambiance, un artiste, une sensation…").foregroundStyle(
          .secondary)
        HStack(spacing: 18) {
          Button {
            player.command(player.playing ? "pause" : "play")
          } label: {
            Image(systemName: player.playing ? "pause.fill" : "play.fill")
          }.disabled(model.current == nil)
          Button {
            model.next()
          } label: {
            Image(systemName: "forward.end.fill")
          }.disabled(model.current == nil || model.busy)
          if let current = model.current {
            Link("YouTube ↗", destination: current.url).font(.caption)
          }
        }.buttonStyle(.bordered)
        if !player.failure.isEmpty { Text(player.failure).font(.caption).foregroundStyle(.orange) }
        Toggle("Continuer la musique automatiquement", isOn: $model.continuous).font(.caption)
        if model.queue.count > 1 {
          Text("À SUIVRE").font(.system(size: 10, design: .monospaced)).foregroundStyle(.secondary)
          ForEach(Array(model.queue.dropFirst(model.position + 1).prefix(3))) { track in
            Text(track.title).font(.caption).lineLimit(1)
          }
        }
        Spacer(minLength: 0)
      }.padding(28).frame(minWidth: 380, idealWidth: 440)
      VStack(spacing: 16) {
        HStack {
          Text("Ton DJ personnel").font(.title2)
          Spacer()
        }
        Toggle("Me répondre à voix haute", isOn: $model.spoken).onChange(of: model.spoken) {
          _, value in if !value { model.stopVoice() }
        }
        ScrollViewReader { proxy in
          ScrollView {
            LazyVStack(alignment: .leading, spacing: 14) {
              if model.messages.isEmpty {
                Text("Qu’est-ce qui te ferait du bien ?").font(.title3).padding(.top, 35)
                Text("Une soirée calme, de l’énergie, un artiste que tu aimes…").foregroundStyle(
                  .secondary)
                ForEach(
                  ["Du Mac Miller", "Une soirée jazz douce", "De l’énergie pour avancer"],
                  id: \.self
                ) { text in
                  Button(text) { model.send(text) }.buttonStyle(.bordered).disabled(model.busy)
                }
                if model.loadingCredentials {
                  Text(
                    "Autorise l’accès au Trousseau dans la fenêtre macOS pour retrouver tes clés déjà enregistrées."
                  ).font(.caption)
                } else if !model.hasKey && !model.hasServer {
                  Text(
                    "Commence dans Réglages : ajoute ta clé Gemini, puis importe ta bibliothèque."
                  ).font(.caption)
                }
              }
              ForEach(model.messages) { message in
                VStack(alignment: .leading, spacing: 5) {
                  Text(message.role == "user" ? "TOI" : "RECALL").font(
                    .system(size: 9, design: .monospaced)
                  ).foregroundStyle(.secondary)
                  Text(message.content).textSelection(.enabled)
                }.padding(14).frame(maxWidth: .infinity, alignment: .leading)
                  .background(message.role == "user" ? Color.white : Color.green.opacity(0.08))
                  .clipShape(RoundedRectangle(cornerRadius: 14)).id(message.id)
              }
              if model.busy {
                HStack {
                  ProgressView().controlSize(.small)
                  Text("Je cherche la bonne suite…").font(.caption)
                  Button("Annuler") { model.cancel() }
                }
              }
            }
          }.onChange(of: model.messages.count) { _, _ in
            if let id = model.messages.last?.id { proxy.scrollTo(id, anchor: .bottom) }
          }
        }
        if microphone.listening {
          Text(
            microphone.transcript.isEmpty
              ? "Je t’écoute… Clique à nouveau pour terminer." : microphone.transcript
          ).font(.caption).foregroundStyle(.green)
        }
        HStack(alignment: .bottom) {
          TextField("Ton mood, un titre, une envie…", text: $model.prompt, axis: .vertical)
            .lineLimit(1...4).textFieldStyle(.plain).onSubmit { model.send() }
          Button {
            model.toggleMicrophone()
          } label: {
            Image(systemName: microphone.listening ? "mic.slash.fill" : "mic.fill")
          }.help("Parler au DJ").disabled(model.busy)
          Button {
            model.send()
          } label: {
            Image(systemName: "arrow.up")
          }.disabled(
            model.busy || model.prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
          ).keyboardShortcut(.return, modifiers: [.command])
        }.padding(14).background(.white).clipShape(RoundedRectangle(cornerRadius: 20))
        Text("Micro au clic. Les réponses du DJ sont des suggestions issues de ta bibliothèque.")
          .font(.system(size: 10)).foregroundStyle(.secondary)
      }.padding(28).frame(minWidth: 340)
    }
  }
}
struct LibraryView: View {
  @EnvironmentObject var model: AppModel
  var body: some View {
    VStack(alignment: .leading, spacing: 20) {
      HStack {
        Text("Ta bibliothèque.").font(.largeTitle)
        Spacer()
        Button("Importer JSON…") { model.importLibrary() }
        if model.hasServer {
          Button(model.syncing ? "Synchronisation…" : "Synchroniser") { model.sync() }.disabled(
            model.syncing)
        }
      }
      TextField("Un artiste, un titre, un souvenir…", text: $model.query).textFieldStyle(
        .roundedBorder
      ).onChange(of: model.query) { _, _ in model.search() }
      Text(
        model.useServer
          ? "Recherche hybride sur ton serveur privé."
          : "Recherche locale dans les titres et métadonnées."
      ).font(.caption).foregroundStyle(.secondary)
      List(model.results) { track in
        HStack {
          VStack(alignment: .leading) {
            Text(track.title)
            Text(track.channel ?? "").font(.caption).foregroundStyle(.secondary)
          }
          Spacer()
          Button {
            model.play(track)
          } label: {
            Image(systemName: "play.fill")
          }
        }
      }.scrollContentBackground(.hidden)
      if model.tracks.isEmpty {
        Text(
          "Importe un export Recall ou yt-dlp. Aucune bibliothèque personnelle n’est embarquée dans l’app redistribuée."
        ).foregroundStyle(.secondary)
      }
    }.padding(28)
  }
}
