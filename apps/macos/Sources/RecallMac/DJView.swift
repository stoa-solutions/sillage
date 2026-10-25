import RecallAudio
import RecallKit
import SwiftUI

/// Compact: one column beside your work. Studio: the clip fills the window, chat floats on glass.
struct DJView: View {
  @AppStorage("djPanelCollapsed") private var panelCollapsed = false
  @State private var panelTab = SessionPanelTab.dj
  @StateObject private var lyrics = LyricsModel()
  let panelOnly: Bool
  let source: DiscoveryScope?
  @ObservedObject var model: DJModel
  @EnvironmentObject var session: Session
  @ObservedObject var player: Player
  @ObservedObject var microphone: Microphone
  @ObservedObject var voice: VoiceOutput
  init(model: DJModel, panelOnly: Bool = false, source: DiscoveryScope? = nil) {
    self.source = source
    self.panelOnly = panelOnly
    self.model = model
    player = model.player
    microphone = model.microphone
    voice = model.voice
  }
  var body: some View {
    Group {
      if panelOnly { sessionPanel } else if player.studio { studio } else { compact }
    }.onChange(of: model.spoken) { _, value in if !value { model.stopVoice() } }
      .onChange(of: model.current?.id, initial: true) { _, _ in
        lyrics.show(
          model.current, next: model.upcoming.first?.track, connection: session.connection)
      }
      .onChange(of: session.generation) { _, _ in
        lyrics.reset()
        lyrics.show(
          model.current, next: model.upcoming.first?.track, connection: session.connection)
      }
  }

  /// Same glass as Studio: the player on one panel, the session on another.
  private var compact: some View {
    VStack(spacing: 12) {
      VStack(alignment: .leading, spacing: 12) {
        VideoSurface(player: player).aspectRatio(16 / 9, contentMode: .fit)
          .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
          .frame(maxWidth: .infinity).overlay { if model.current == nil { idleScreen } }
        TrackHeadline(track: model.current, titleFont: .title3.weight(.semibold), detailFont: .body)
        transport
        playerStatus
      }.padding(14).glassPanel().layoutPriority(1)
      if panelCollapsed {
        HStack {
          reopenPanel
          Spacer()
        }
        Spacer(minLength: 0)
      } else {
        sessionPanel.glassPanel()
      }
    }.padding(12).frame(maxWidth: 600).frame(maxWidth: .infinity)
  }

  private var studio: some View {
    HStack(alignment: .bottom, spacing: 0) {
      VStack(alignment: .leading, spacing: 14) {
        // The video itself fills the stage behind this page (StageBackground).
        Spacer(minLength: 0)
        TrackHeadline(
          track: model.current, titleFont: .system(size: 40, weight: .bold), detailFont: .title3,
          lines: 2)
        progress
        transport
        playerStatus
      }.padding(32).frame(maxWidth: .infinity, alignment: .leading)
      if panelCollapsed {
        reopenPanel.padding(16)
      } else {
        sessionPanel.frame(width: 360).glassPanel().padding(16)
      }
    }
  }

  private var idleScreen: some View {
    RoundedRectangle(cornerRadius: 10).fill(.black).overlay {
      Image(systemName: "dot.radiowaves.left.and.right").font(.system(size: 34))
        .foregroundStyle(Color.recall)
    }.accessibilityHidden(true)
  }

  @ViewBuilder private var progress: some View {
    if player.duration > 0 {
      HStack(spacing: 10) {
        Text(clock(player.elapsed))
        Slider(
          value: Binding(get: { player.elapsed }, set: { model.seek($0) }),
          in: 0...max(1, player.duration)
        ).accessibilityLabel("Position du morceau")
        Text(clock(player.duration))
      }.font(.caption.monospacedDigit()).foregroundStyle(.secondary)
    }
  }

  private var transport: some View {
    HStack(spacing: 12) {
      Button {
        model.togglePlayback()
      } label: {
        Image(systemName: player.playing ? "pause.fill" : "play.fill").font(.title3)
          .frame(width: 40, height: 40)
          .foregroundStyle(Color(nsColor: .windowBackgroundColor))
          .background(Circle().fill(Color.recall))
      }.buttonStyle(.plain).accessibilityLabel(player.playing ? "Pause" : "Lecture")
        .disabled(model.current == nil)
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
      if player.studio {
        Toggle(
          isOn: Binding(
            get: { !panelCollapsed && panelTab == .lyrics },
            set: { visible in
              if visible {
                panelCollapsed = false
                panelTab = .lyrics
              } else {
                panelTab = .dj
              }
            }
          )
        ) { Label("Paroles", systemImage: "music.note.list") }
        .help("Afficher les paroles synchronisées dans le panneau latéral")
      }
      if let current = model.current {
        Link(destination: current.url) { Image(systemName: "arrow.up.right.square") }
          .foregroundStyle(.secondary)
          .help("Ouvrir sur YouTube").accessibilityLabel("Ouvrir sur YouTube")
      }
    }.toggleStyle(GlassToggleStyle())
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
        }.pickerStyle(.segmented).labelsHidden().neutralSelection()
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
      case .lyrics:
        LyricsPanel(model: lyrics, player: player, connection: session.connection)
      }
    }
  }

  private var queuePanel: some View {
    List {
      if let current = model.current {
        Section {
          TrackRow(track: current, artworkWidth: 72, onPlay: nil)
        } header: {
          SectionHeader("En cours")
        }
      }
      Section {
        if model.allUpcoming.isEmpty {
          EmptyState(
            symbol: "music.note.list",
            message: model.busy ? "Le DJ prépare la suite…" : "La file est vide.",
            action: model.busy || model.current == nil
              ? nil : ("Préparer la suite", { model.retryContinuation() }))
        }
        ForEach(model.allUpcoming) { entry in
          TrackRow(
            track: entry.track, artworkWidth: 72, persistentActions: true,
            onPlay: { model.playUpcoming(at: entry.id) }
          ) {
            Menu {
              Button("Lire maintenant") { model.playUpcoming(at: entry.id) }
              Button("Monter") { model.moveUpcoming(from: entry.id, to: entry.id - 1) }
                .disabled(entry.id == model.position + 1)
              Button("Descendre") { model.moveUpcoming(from: entry.id, to: entry.id + 1) }
                .disabled(entry.id == model.queue.count - 1)
              Divider()
              Link("Ouvrir sur YouTube", destination: entry.track.url)
            } label: {
              Image(systemName: "ellipsis.circle")
            }.menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
              .accessibilityLabel("Actions pour \(TrackTitle(entry.track).title)")
          }
        }.onMove { offsets, destination in
          // List offsets count from the first upcoming track; the queue counts from the start.
          guard let source = offsets.first else { return }
          let target = destination > source ? destination - 1 : destination
          model.moveUpcoming(from: model.position + 1 + source, to: model.position + 1 + target)
        }
      } header: {
        SectionHeader("À suivre", count: model.allUpcoming.count)
      } footer: {
        if model.allUpcoming.count > 1 {
          Text("Glisse un morceau pour changer l’ordre ; le clip en cours continue.")
            .font(.caption).foregroundStyle(.secondary)
        }
      }
    }.listStyle(.plain).scrollContentBackground(.hidden)
  }

  private var historyPanel: some View {
    List {
      Section {
        if model.history.isEmpty {
          EmptyState(
            symbol: "clock.arrow.circlepath",
            message: "Les morceaux écoutés, passés ou indisponibles apparaîtront ici.")
        }
        ForEach(model.history.reversed()) { entry in
          TrackRow(
            track: entry.track, detail: entry.outcome.rawValue, artworkWidth: 72,
            onPlay: { model.play(entry.track, source: source ?? model.searchScope) })
        }
      } header: {
        SectionHeader("Cette session")
      }
    }.listStyle(.plain).scrollContentBackground(.hidden)
  }

  private var conversation: some View {
    ScrollViewReader { proxy in
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 12) {
          if model.messages.isEmpty { welcome }
          ForEach(model.messages) { message in
            VStack(alignment: .leading, spacing: 10) {
              MessageRow(message: message)
              if let results = message.discoveries {
                ForEach(results) {
                  DiscoveryTrackRow(item: $0, compact: true, source: source ?? model.searchScope)
                }
              }
            }.id(message.id)
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
        Button(text) { model.send(text, source: source) }.buttonStyle(
          GlassButtonStyle(emphasized: true))
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
      if !panelOnly {
        Picker("Chercher dans", selection: $model.searchScope) {
          Text("Mes playlists").tag(DiscoveryScope.library)
          Text("YouTube").tag(DiscoveryScope.youtube)
          Text("Partout").tag(DiscoveryScope.all)
        }.pickerStyle(.segmented).labelsHidden().neutralSelection().help(
          "Choisis où chercher. « Joue » lance maintenant ; « ajoute à la suite » conserve la lecture."
        )
      }
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
          .onSubmit { model.send(source: source) }
        Button {
          model.toggleMicrophone(source: source)
        } label: {
          Image(systemName: microphone.active ? "mic.fill" : "mic").font(.body)
            .foregroundStyle(microphone.active ? Color.recall : .secondary)
            .frame(width: 28, height: 28)
        }.buttonStyle(.plain).help("Parler au DJ")
          .accessibilityLabel(microphone.active ? "Terminer la dictée" : "Parler au DJ")
          .disabled(microphone.finishing)
        Button {
          model.send(source: source)
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
    !model.prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
  }
}

private enum SessionPanelTab: String, CaseIterable, Identifiable {
  case dj = "DJ"
  case queue = "À suivre"
  case history = "Historique"
  case lyrics = "Paroles"
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
