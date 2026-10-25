import RecallAudio
import RecallKit
import SwiftUI

/// Compact: one column beside your work. Studio: the clip fills the window, chat floats on glass.
struct DJView: View {
  @AppStorage("djPanelCollapsed") private var panelCollapsed = false
  @State private var panelTab = SessionPanelTab.dj
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
      .onChange(of: model.continuous) { _, _ in model.continuousChanged() }
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
      if panelCollapsed {
        reopenPanel.padding(12)
        Spacer(minLength: 0)
      } else {
        sessionPanel
      }
    }.frame(maxWidth: 560).frame(maxWidth: .infinity)
  }

  private var studio: some View {
    HStack(alignment: .bottom, spacing: 0) {
      VStack(alignment: .leading, spacing: 14) {
        if player.studioReady {
          Spacer(minLength: 0)
        } else if player.preparingStudio {
          HStack(spacing: 10) {
            ProgressView().controlSize(.small)
            Text("Préparation du clip").foregroundStyle(.secondary)
          }.frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
          PlayerView(player: player).aspectRatio(16 / 9, contentMode: .fit)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .overlay { if model.current == nil { idleScreen } }
        }
        nowPlaying(title: .system(size: 40, weight: .bold), subtitle: .title3)
        progress
        transport
        upNext
        playerStatus
      }.padding(32).frame(maxWidth: .infinity, alignment: .leading)
      if panelCollapsed {
        reopenPanel.padding(16)
      } else {
        sessionPanel.frame(width: 360).background {
          // Translucent so the clip stays visible behind the conversation.
          let shape = RoundedRectangle(cornerRadius: 20, style: .continuous)
          shape.fill(.black.opacity(0.35)).background(.ultraThinMaterial.opacity(0.5), in: shape)
            .overlay(shape.strokeBorder(.white.opacity(0.1)))
        }.padding(16)
      }
    }
    .background {
      ZStack {
        Color.black
        if player.studioReady {
          StudioPlayerView(player: player.nativePlayer)
        } else if player.preparingStudio, let current = model.current {
          // While the clip downloads, its cover sets the mood instead of an empty player.
          AsyncImage(url: URL(string: "https://i.ytimg.com/vi/\(current.id)/hqdefault.jpg")) {
            image in
            image.resizable().scaledToFill()
          } placeholder: {
            Color.black
          }.blur(radius: 40).overlay(Color.black.opacity(0.35)).clipped()
            .transition(.opacity)
        }
        LinearGradient(
          colors: [.clear, .black.opacity(0.8)], startPoint: .center, endPoint: .bottom)
      }.ignoresSafeArea().allowsHitTesting(false)
        .animation(.easeInOut(duration: 0.6), value: player.studioReady)
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
        .disabled(model.current == nil)
      VolumeControl(player: player)
      Spacer(minLength: 8)
      Toggle(isOn: $model.spoken) { Label("Voix du DJ", systemImage: "person.wave.2") }
        .help("Le DJ te répond et annonce les morceaux à voix haute")
      Toggle(isOn: $model.continuous) { Label("Enchaîner", systemImage: "infinity") }
        .help("À la fin de la file, le DJ ajoute de nouveaux morceaux dans la même ambiance")
      if let current = model.current {
        Link(destination: current.url) { Image(systemName: "arrow.up.right.square") }
          .foregroundStyle(.secondary)
          .help("Ouvrir sur YouTube").accessibilityLabel("Ouvrir sur YouTube")
      }
    }.toggleStyle(PillToggleStyle())
  }

  @ViewBuilder private var upNext: some View {
    if !model.upcoming.isEmpty {
      Text("Ensuite : " + model.upcoming.map(\.track.title).joined(separator: ", "))
        .font(.caption).foregroundStyle(.secondary).lineLimit(1)
    }
  }

  @ViewBuilder private var playerStatus: some View {
    if model.waitingForNext && model.busy {
      HStack {
        ProgressView().controlSize(.small)
        Text("Recherche du prochain morceau…")
        Button("Annuler") { model.cancel() }.buttonStyle(.link)
      }.font(.caption)
    }
    if !model.continuationNotice.isEmpty {
      VStack(alignment: .leading, spacing: 4) {
        Text(model.continuationNotice).font(.caption).foregroundStyle(.secondary)
        Button("Réessayer la suite") { model.retryContinuation() }
          .buttonStyle(.bordered).disabled(model.busy)
      }
    }
    if !player.failure.isEmpty {
      Label(player.failure, systemImage: "exclamationmark.triangle").font(.caption)
        .foregroundStyle(.orange)
    }
  }

  private var reopenPanel: some View {
    Button {
      panelCollapsed = false
    } label: {
      Label("DJ et file", systemImage: "sidebar.right")
        .padding(.horizontal, 12).padding(.vertical, 8)
        .background(.ultraThinMaterial, in: Capsule())
    }.buttonStyle(.plain).accessibilityLabel("Afficher le panneau DJ et la file")
  }

  private var sessionPanel: some View {
    VStack(spacing: 0) {
      HStack(spacing: 8) {
        Picker("Vue de la session", selection: $panelTab) {
          ForEach(SessionPanelTab.allCases) { tab in Text(tab.rawValue).tag(tab) }
        }.pickerStyle(.segmented).labelsHidden()
        Button {
          panelCollapsed = true
        } label: {
          Image(systemName: "sidebar.right").frame(width: 24, height: 24)
        }.buttonStyle(.plain).help("Replier le panneau")
          .accessibilityLabel("Replier le panneau")
      }.padding(12)
      switch panelTab {
      case .dj:
        conversation.padding(.horizontal, 16)
        composer.padding(12)
      case .queue:
        queuePanel
      case .history:
        historyPanel
      }
    }
  }

  private var queuePanel: some View {
    ScrollView {
      LazyVStack(alignment: .leading, spacing: 14) {
        if let current = model.current {
          Text("EN COURS").font(.caption).foregroundStyle(.secondary)
          trackLabel(current)
          Divider().padding(.vertical, 4)
        }
        Text("À SUIVRE · \(model.allUpcoming.count)").font(.caption).foregroundStyle(.secondary)
        if model.allUpcoming.isEmpty {
          Text(
            model.busy ? "Le DJ prépare la suite…" : "La file est vide. Demande une suite au DJ."
          )
          .foregroundStyle(.secondary)
          Button("Préparer la suite") { model.retryContinuation() }
            .disabled(model.busy || model.current == nil)
        }
        ForEach(model.allUpcoming) { entry in
          VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top, spacing: 8) {
              Text("\(entry.id - model.position)").font(.caption.monospacedDigit())
                .foregroundStyle(.secondary).frame(width: 18)
              trackLabel(entry.track)
            }
            HStack(spacing: 14) {
              Button {
                model.playUpcoming(at: entry.id)
              } label: {
                Label("Lire", systemImage: "play.fill")
              }.accessibilityLabel("Lire maintenant : \(entry.track.title)")
              Spacer()
              Button {
                model.moveUpcoming(from: entry.id, to: entry.id - 1)
              } label: {
                Image(systemName: "arrow.up")
              }.disabled(entry.id == model.position + 1)
                .accessibilityLabel("Monter : \(entry.track.title)")
              Button {
                model.moveUpcoming(from: entry.id, to: entry.id + 1)
              } label: {
                Image(systemName: "arrow.down")
              }.disabled(entry.id == model.queue.count - 1)
                .accessibilityLabel("Descendre : \(entry.track.title)")
            }.font(.caption).buttonStyle(.borderless)
          }
          Divider()
        }
        Text(
          "L’ordre affiché est l’ordre de lecture. Les flèches déplacent les titres sans interrompre le clip."
        )
        .font(.caption).foregroundStyle(.secondary)
      }.padding(16)
    }
  }

  private var historyPanel: some View {
    ScrollView {
      LazyVStack(alignment: .leading, spacing: 14) {
        Text("CETTE SESSION").font(.caption).foregroundStyle(.secondary)
        if model.history.isEmpty {
          Text("Les morceaux terminés, passés ou indisponibles apparaîtront ici.")
            .foregroundStyle(.secondary)
        }
        ForEach(model.history.reversed()) { entry in
          VStack(alignment: .leading, spacing: 4) {
            trackLabel(entry.track)
            Text(entry.outcome.rawValue).font(.caption).foregroundStyle(.secondary)
          }
          Divider()
        }
      }.padding(16)
    }
  }

  private func trackLabel(_ track: Track) -> some View {
    VStack(alignment: .leading, spacing: 3) {
      Text(track.title).fontWeight(.medium).fixedSize(horizontal: false, vertical: true)
      if let channel = track.channel, !channel.isEmpty {
        Text(channel).font(.caption).foregroundStyle(.secondary)
      }
    }.frame(maxWidth: .infinity, alignment: .leading)
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

private enum SessionPanelTab: String, CaseIterable, Identifiable {
  case dj = "DJ"
  case queue = "À suivre"
  case history = "Historique"
  var id: Self { self }
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

/// On: filled in Recall green. Off: outlined and muted. The state reads at a glance.
private struct PillToggleStyle: ToggleStyle {
  func makeBody(configuration: Configuration) -> some View {
    Button {
      configuration.isOn.toggle()
    } label: {
      configuration.label.labelStyle(.titleAndIcon).font(.caption.weight(.medium))
        .padding(.horizontal, 10).padding(.vertical, 6)
        .foregroundStyle(
          configuration.isOn ? Color(nsColor: .windowBackgroundColor) : Color.secondary
        )
        .background {
          if configuration.isOn {
            Capsule().fill(Color.recall)
          } else {
            Capsule().strokeBorder(Color.secondary.opacity(0.5))
          }
        }.contentShape(Capsule())
    }.buttonStyle(.plain).accessibilityValue(configuration.isOn ? "Activé" : "Désactivé")
  }
}

/// Music volume; the speaker mutes and restores the previous level.
private struct VolumeControl: View {
  @ObservedObject var player: Player
  @State private var beforeMute = 1.0
  var body: some View {
    HStack(spacing: 6) {
      Button {
        if player.volume > 0 {
          beforeMute = player.volume
          player.volume = 0
        } else {
          player.volume = max(beforeMute, 0.1)
        }
      } label: {
        Image(systemName: player.volume == 0 ? "speaker.slash.fill" : "speaker.wave.2.fill")
          .frame(width: 20)
      }.buttonStyle(.plain).foregroundStyle(.secondary)
        .accessibilityLabel(player.volume == 0 ? "Remettre le son" : "Couper le son")
      Slider(value: $player.volume, in: 0...1).frame(width: 90).controlSize(.small)
        .accessibilityLabel("Volume de la musique")
    }.help("Volume de la musique")
  }
}
