import RecallAudio
import RecallKit
import SwiftUI

/// Compact: one column beside your work. Studio: the clip fills the window, chat floats on glass.
struct DJView: View {
  @ObservedObject var model: DJModel
  @EnvironmentObject var session: Session
  @ObservedObject var player: Player
  @ObservedObject var microphone: Microphone
  @ObservedObject var voice: VoiceOutput
  init(model: DJModel) {
    self.model = model
    player = model.player
    microphone = model.microphone
    voice = model.voice
  }
  var body: some View {
    Group {
      if player.studio { studio } else { compact }
    }.onChange(of: model.spoken) { _, value in if !value { model.stopVoice() } }
  }

  private var compact: some View {
    VStack(spacing: 0) {
      VStack(alignment: .leading, spacing: 12) {
        PlayerView(player: player).aspectRatio(16 / 9, contentMode: .fit)
          .frame(maxWidth: .infinity).overlay { if model.current == nil { idleScreen } }
        nowPlaying(title: .title3.weight(.semibold), subtitle: .body)
        transport
        upNext
        playerStatus
      }.padding(16).layoutPriority(1)
      Divider()
      conversation.padding(.horizontal, 16)
      composer.padding([.horizontal, .bottom], 12)
    }.frame(maxWidth: 560).frame(maxWidth: .infinity)
  }

  private var studio: some View {
    HStack(alignment: .bottom, spacing: 0) {
      VStack(alignment: .leading, spacing: 14) {
        if player.studioReady {
          Spacer(minLength: 0)
        } else {
          PlayerView(player: player).aspectRatio(16 / 9, contentMode: .fit)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .overlay {
              if model.current == nil {
                idleScreen
              } else if player.preparingStudio {
                ProgressView("Préparation du clip…").padding(16)
                  .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
              }
            }
        }
        nowPlaying(title: .system(size: 40, weight: .bold), subtitle: .title3)
        progress
        transport
        upNext
        playerStatus
      }.padding(32).frame(maxWidth: .infinity, alignment: .leading)
      VStack(spacing: 0) {
        conversation.padding(.horizontal, 16)
        composer.padding(12)
      }.frame(width: 360).background {
        // Translucent so the clip stays visible behind the conversation.
        let shape = RoundedRectangle(cornerRadius: 20, style: .continuous)
        shape.fill(.black.opacity(0.35)).background(.ultraThinMaterial.opacity(0.5), in: shape)
          .overlay(shape.strokeBorder(.white.opacity(0.1)))
      }.padding(16)
    }
    .background {
      ZStack {
        Color.black
        if player.studioReady { StudioPlayerView(player: player.nativePlayer) }
        LinearGradient(
          colors: [.clear, .black.opacity(0.8)], startPoint: .center, endPoint: .bottom)
      }.ignoresSafeArea().allowsHitTesting(false)
    }
    .environment(\.colorScheme, .dark)
    .toolbarBackground(.hidden, for: .windowToolbar)
  }

  private var idleScreen: some View {
    RoundedRectangle(cornerRadius: 10).fill(.black).overlay {
      Image(systemName: "dot.radiowaves.left.and.right").font(.system(size: 34))
        .foregroundStyle(Color.recall)
    }.accessibilityHidden(true)
  }

  private func nowPlaying(title: Font, subtitle: Font) -> some View {
    VStack(alignment: .leading, spacing: 4) {
      Text(model.current?.title ?? "Prêt quand tu l’es").font(title).lineLimit(2)
        .minimumScaleFactor(0.7)
      Text(model.current?.channel ?? "Dis au DJ ce que tu veux écouter.")
        .font(subtitle).foregroundStyle(.secondary).lineLimit(1)
    }
  }

  @ViewBuilder private var progress: some View {
    if player.studioReady {
      HStack(spacing: 10) {
        Text(clock(player.elapsed))
        Slider(
          value: Binding(get: { player.elapsed }, set: { player.seek($0) }),
          in: 0...max(1, player.duration)
        ).accessibilityLabel("Position du morceau")
        Text(clock(player.duration))
      }.font(.caption.monospacedDigit()).foregroundStyle(.secondary)
    }
  }

  private var transport: some View {
    HStack(spacing: 12) {
      Button {
        player.command(player.playing ? "pause" : "play")
      } label: {
        Image(systemName: player.playing ? "pause.fill" : "play.fill").font(.title3)
          .frame(width: 40, height: 40)
          .foregroundStyle(Color(nsColor: .windowBackgroundColor))
          .background(Circle().fill(Color.recall))
      }.buttonStyle(.plain).accessibilityLabel(player.playing ? "Pause" : "Lecture")
        .disabled(model.current == nil || player.preparingStudio)
      Button {
        model.next()
      } label: {
        Image(systemName: "forward.fill").font(.title3).frame(width: 32, height: 32)
      }.buttonStyle(.plain).help("Morceau suivant").accessibilityLabel("Morceau suivant")
        .disabled(model.current == nil || model.busy)
      Spacer()
      Toggle(isOn: $model.spoken) {
        Image(systemName: model.spoken ? "speaker.wave.2.fill" : "speaker.slash")
      }.help("Le DJ répond à voix haute").accessibilityLabel("Réponses à voix haute")
      Toggle(isOn: $model.continuous) { Image(systemName: "infinity") }
        .help("Enchaîner la musique automatiquement").accessibilityLabel("Enchaîner")
      if let current = model.current {
        Link(destination: current.url) { Image(systemName: "arrow.up.right.square") }
          .foregroundStyle(.secondary)
          .help("Ouvrir sur YouTube").accessibilityLabel("Ouvrir sur YouTube")
      }
    }.toggleStyle(.button)
  }

  @ViewBuilder private var upNext: some View {
    if !model.upcoming.isEmpty {
      Text("Ensuite : " + model.upcoming.map(\.track.title).joined(separator: ", "))
        .font(.caption).foregroundStyle(.secondary).lineLimit(1)
    }
  }

  @ViewBuilder private var playerStatus: some View {
    if !player.failure.isEmpty {
      Label(player.failure, systemImage: "exclamationmark.triangle").font(.caption)
        .foregroundStyle(.orange)
    }
  }

  private var conversation: some View {
    ScrollViewReader { proxy in
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 12) {
          if model.messages.isEmpty { welcome }
          ForEach(model.messages) { message in
            MessageRow(message: message).id(message.id)
          }
        }.padding(.vertical, 16)
      }.onChange(of: model.messages.count) { _, _ in
        if let id = model.messages.last?.id {
          withAnimation { proxy.scrollTo(id, anchor: .bottom) }
        }
      }
    }
  }

  private var welcome: some View {
    VStack(alignment: .leading, spacing: 10) {
      Text("Qu’est-ce qui te ferait du bien ?").font(.title3.weight(.semibold))
      Text("Une ambiance, un artiste, une soirée… Le DJ cherche dans tes playlists.")
        .foregroundStyle(.secondary)
      ForEach(["Du Mac Miller", "Une soirée jazz douce", "De l’énergie pour avancer"], id: \.self) {
        text in
        Button(text) { model.send(text) }.buttonStyle(.bordered).buttonBorderShape(.capsule)
          .disabled(model.busy)
      }
      if session.loadingCredentials {
        Text("Connexion à ton compte…").font(.caption).foregroundStyle(.secondary)
      } else if !session.hasServer {
        Text("Connecte ton serveur dans Réglages pour accéder à tes playlists et au DJ.")
          .font(.caption).foregroundStyle(.secondary)
      }
    }
  }

  private var composer: some View {
    VStack(alignment: .leading, spacing: 8) {
      if microphone.active {
        HStack(spacing: 8) {
          if microphone.starting || microphone.finishing { ProgressView().controlSize(.small) }
          Text(microphone.status).foregroundStyle(Color.recall)
          Button("Annuler l’écoute") { microphone.stop() }.buttonStyle(.link)
        }.font(.caption)
      } else if model.busy {
        HStack(spacing: 8) {
          ProgressView().controlSize(.small)
          Text("Je cherche la bonne suite…")
          Button("Annuler") { model.cancel() }.buttonStyle(.link)
        }.font(.caption)
      } else if !voice.status.isEmpty {
        Text(voice.status).font(.caption).foregroundStyle(.secondary)
      }
      HStack(alignment: .bottom, spacing: 8) {
        TextField("Ton envie, un artiste, un titre…", text: $model.prompt, axis: .vertical)
          .lineLimit(1...4).textFieldStyle(.plain).padding(.vertical, 6)
          .onSubmit { model.send() }
        Button {
          model.toggleMicrophone()
        } label: {
          Image(systemName: microphone.active ? "mic.fill" : "mic").font(.body)
            .foregroundStyle(microphone.active ? Color.recall : .secondary)
            .frame(width: 28, height: 28)
        }.buttonStyle(.plain).help("Parler au DJ")
          .accessibilityLabel(microphone.active ? "Terminer la dictée" : "Parler au DJ")
          .disabled(model.busy || microphone.finishing)
        Button {
          model.send()
        } label: {
          Image(systemName: "arrow.up").fontWeight(.semibold).frame(width: 28, height: 28)
            .foregroundStyle(Color(nsColor: .windowBackgroundColor))
            .background(Circle().fill(canSend ? Color.recall : Color.secondary.opacity(0.4)))
        }.buttonStyle(.plain).accessibilityLabel("Envoyer").disabled(!canSend)
          .keyboardShortcut(.return, modifiers: [.command])
      }.padding(.leading, 14).padding(.trailing, 6).padding(.vertical, 4)
        .background(.quaternary.opacity(0.6), in: RoundedRectangle(cornerRadius: 18))
    }
  }

  private var canSend: Bool {
    !model.busy && !model.prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
  }
}

/// 3:07, or 1:02:45 past an hour: the same clock in the player and the library.
func clock(_ seconds: Double) -> String {
  let value = Int(seconds.isFinite ? max(seconds, 0) : 0)
  let (hours, minutes, rest) = (value / 3600, value / 60 % 60, value % 60)
  return hours > 0
    ? String(format: "%d:%02d:%02d", hours, minutes, rest)
    : String(format: "%d:%02d", minutes, rest)
}

/// Your messages sit right in a tinted bubble; the DJ answers as plain text.
private struct MessageRow: View {
  let message: ChatMessage
  var body: some View {
    if message.role == "user" {
      HStack {
        Spacer(minLength: 48)
        Text(message.content).textSelection(.enabled).padding(.horizontal, 12)
          .padding(.vertical, 8)
          .background(
            Color.recall.opacity(0.18), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
      }
    } else {
      Text(message.content).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
    }
  }
}
