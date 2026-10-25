import RecallAudio
import RecallKit
import SwiftUI

struct DJView: View {
  @ObservedObject var model: DJModel
  @EnvironmentObject var session: Session
  @ObservedObject var player: Player
  @ObservedObject var microphone: Microphone
  init(model: DJModel) {
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
        PlayerView(player: player).frame(minHeight: 250, maxHeight: .infinity).clipShape(
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
          ForEach(model.upcoming) { entry in
            Text(entry.track.title).font(.caption).lineLimit(1)
          }
        }
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
                if session.loadingCredentials {
                  Text(
                    "Autorise l’accès au Trousseau dans la fenêtre macOS pour retrouver tes clés déjà enregistrées."
                  ).font(.caption)
                } else if !session.hasServer {
                  Text(
                    "Connecte ton serveur dans Réglages pour accéder à tes playlists et au DJ."
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
        if microphone.active {
          HStack {
            if microphone.starting || microphone.finishing { ProgressView().controlSize(.small) }
            Text(microphone.status).font(.caption).foregroundStyle(.green)
            Button("Annuler l’écoute") { microphone.stop() }
          }
        }
        HStack(alignment: .bottom) {
          TextField("Ton mood, un titre, une envie…", text: $model.prompt, axis: .vertical)
            .lineLimit(1...4).textFieldStyle(.plain).onSubmit { model.send() }
          Button {
            model.toggleMicrophone()
          } label: {
            Image(systemName: microphone.active ? "mic.slash.fill" : "mic.fill")
          }.help("Parler au DJ").accessibilityLabel(
            microphone.active ? "Terminer la dictée" : "Parler au DJ"
          ).disabled(model.busy || microphone.finishing)
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
