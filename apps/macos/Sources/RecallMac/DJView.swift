import RecallAudio
import RecallKit
import SwiftUI

/// Compact: one column beside your work. Studio: the clip fills the window, chat floats on glass.
struct DJView: View {
  @AppStorage("djPanelCollapsed") private var panelCollapsed = false
  /// Découvrir keeps its own state: folding it there must not fold Compact.
  @AppStorage("discoverDJPanelCollapsed") private var discoverCollapsed = true
  @Environment(\.studioControlsVisible) private var controlsVisible
  @State private var panelTab = SessionPanelTab.dj
  @StateObject private var lyrics = LyricsModel()
  @EnvironmentObject var listened: ListeningHistoryModel
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
      if panelOnly {
        sessionPanel
      } else if player.studio {
        studio
      } else {
        compact
      }
    }.sheet(isPresented: $model.showingRules) {
      VStack(alignment: .leading, spacing: 16) {
        HStack {
          Text("Les règles de ton DJ").font(.title2.weight(.semibold))
          Spacer()
          Button("Fermer") { model.showingRules = false }.keyboardShortcut(.cancelAction)
        }
        Text(
          "Prompt de base en lecture seule. Le morceau en cours, ta demande et les résultats de recherche sont ajoutés à chaque tour. Aucune clé API n’est affichée."
        )
        .font(.callout).foregroundStyle(.secondary)
        ScrollView {
          Text(model.rulesText).textSelection(.enabled).frame(
            maxWidth: .infinity, alignment: .leading)
        }
      }.padding(24).frame(width: 680, height: 560)
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
      .onChange(of: model.upcoming.first?.track.id) { _, _ in
        lyrics.show(
          model.current, next: model.upcoming.first?.track, connection: session.connection)
      }
  }

  /// Compact (Sillage spec): a pocket near 520 × 224, then the panel below it when opened.
  /// The window follows the pocket's height (CompactRestHeightKey), capped at 560 when open.
  private var compact: some View {
    VStack(spacing: 0) {
      VStack(spacing: 0) {
        pocket.padding(12)
        if hasStatus {
          playerStatus.frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 12).padding(.bottom, 10)
        }
        panelBar
      }
      .fixedSize(horizontal: false, vertical: true)
      .background {
        GeometryReader { proxy in
          Color.clear.preference(key: CompactRestHeightKey.self, value: proxy.size.height)
        }
      }
      if !panelCollapsed {
        SillageRule()
        sessionPanel.frame(maxHeight: .infinity)
      }
      Spacer(minLength: 0)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    .sillageSurface(.reading)
  }

  /// Thumbnail clip, song, transport, position and volume.
  private var pocket: some View {
    HStack(alignment: .center, spacing: 14) {
      VideoSurface(player: player, cornerRadius: 8).frame(width: 200, height: 112.5)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay {
          if model.current == nil {
            idleScreen
          } else if player.preparingClip && !player.playing, let current = model.current {
            Artwork(track: current, showsDuration: false)
          }
        }
      VStack(alignment: .leading, spacing: 8) {
        TrackHeadline(
          track: model.current, titleFont: .system(size: 17, weight: .semibold),
          detailFont: .system(size: 14)
        )
        .help(model.current.map { TrackTitle($0).spoken } ?? "")
        HStack(spacing: 12) {
          playButton(size: 38)
          Button {
            model.next()
          } label: {
            Image(systemName: "forward.fill").frame(width: 26, height: 26)
          }.buttonStyle(.plain).help("Morceau suivant").accessibilityLabel("Morceau suivant")
            .disabled(model.current == nil)
          Slider(
            value: Binding(get: { player.elapsed }, set: { model.seek($0) }),
            in: 0...max(1, player.duration)
          ).controlSize(.mini).tint(Color.sillage(.primaryFill))
            .disabled(player.duration <= 0).accessibilityLabel("Position du morceau")
            .accessibilityValue(clock(player.elapsed))
          Text(clock(player.duration > 0 ? player.elapsed : 0))
            .font(.system(size: 11).monospacedDigit()).foregroundStyle(.secondary)
            .frame(width: 34, alignment: .trailing)
          VolumeControl(player: player, compact: true)
            .fixedSize()
        }
      }
    }
  }

  /// « DJ et file »: opens or folds the panel; the session options stay in a menu here.
  private var panelBar: some View {
    HStack(spacing: 8) {
      Button {
        panelCollapsed.toggle()
      } label: {
        HStack(spacing: 8) {
          Image(systemName: "sidebar.right").foregroundStyle(.secondary)
          Text("DJ et file").font(.system(size: 13, weight: .medium))
          if !model.allUpcoming.isEmpty {
            Text("\(model.allUpcoming.count)").font(.system(size: 11).monospacedDigit())
              .foregroundStyle(.secondary)
          }
          Spacer(minLength: 0)
          Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold))
            .foregroundStyle(.secondary).rotationEffect(.degrees(panelCollapsed ? 0 : 90))
        }.contentShape(Rectangle())
      }.buttonStyle(.plain)
        .accessibilityLabel("DJ et file")
        .accessibilityValue(panelCollapsed ? "Replié" : "Ouvert")
      sessionMenu
    }.padding(.horizontal, 12).frame(height: 40)
      .background(Color.sillageHover, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
      .padding(.horizontal, 8).padding(.bottom, 8)
  }

  /// Voix du DJ, Enchaîner and the YouTube link in the pocket format; states stay visible
  /// as checkmarks and their names are unchanged for VoiceOver.
  private var sessionMenu: some View {
    Menu {
      Toggle(isOn: $model.spoken) { Label("Voix du DJ", systemImage: "person.wave.2") }
      Toggle(isOn: $model.continuous) { Label("Enchaîner", systemImage: "infinity") }
      if let current = model.current {
        Divider()
        Link(destination: current.url) {
          Label("Ouvrir sur YouTube", systemImage: "arrow.up.right.square")
        }
      }
    } label: {
      Image(systemName: "ellipsis.circle").frame(width: 26, height: 26).contentShape(Rectangle())
    }.menuStyle(.button).buttonStyle(.plain).menuIndicator(.hidden).fixedSize()
      .foregroundStyle(.secondary).help("Voix du DJ, Enchaîner")
      .accessibilityLabel("Options de la session")
      .accessibilityValue(
        "Voix du DJ \(model.spoken ? "activée" : "désactivée"), Enchaîner \(model.continuous ? "activé" : "désactivé")"
      )
  }

  /// Compact only: the Studio-only lines of playerStatus never show here.
  private var hasStatus: Bool {
    (model.waitingForNext && model.busy) || !model.continuationNotice.isEmpty
      || (!player.failure.isEmpty && !model.playbackBlocked)
  }

  private func playButton(size: CGFloat) -> some View {
    Button {
      model.togglePlayback()
    } label: {
      PlayDisc(size: size, symbol: player.playing ? "pause.fill" : "play.fill")
    }.buttonStyle(.plain).accessibilityLabel(player.playing ? "Pause" : "Lecture")
      .disabled(model.current == nil)
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
      }.padding(32).frame(maxWidth: .infinity, alignment: .leading).studioChrome(controlsVisible)
      if panelCollapsed {
        reopenPanel.padding(16).studioChrome(controlsVisible)
      } else {
        sessionPanel.frame(width: 360).glassPanel().padding(16)
      }
    }
  }

  private var idleScreen: some View {
    RoundedRectangle(cornerRadius: 6).fill(Color.sillage(.selection)).overlay {
      Image(systemName: "waveform").font(.system(size: 24, weight: .medium))
        .foregroundStyle(Color.sillage(.primaryFill))
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
    ViewThatFits(in: .horizontal) {
      HStack(spacing: 12) {
        playbackControls
        Spacer(minLength: 8)
        sessionControls
      }
      VStack(alignment: .leading, spacing: 12) {
        HStack(spacing: 12) {
          playbackControls
          Spacer(minLength: 0)
        }
        HStack(spacing: 12) {
          sessionControls
          Spacer(minLength: 0)
        }
      }
    }.toggleStyle(GlassToggleStyle())
  }

  @ViewBuilder private var playbackControls: some View {
    Button {
      model.togglePlayback()
    } label: {
      Image(systemName: player.playing ? "pause.fill" : "play.fill").font(.title3)
        .frame(width: 40, height: 40)
        .foregroundStyle(Color.sillage(.primaryIcon))
        .background(Circle().fill(Color.sillage(.primaryFill)))
    }.buttonStyle(.plain).accessibilityLabel(player.playing ? "Pause" : "Lecture")
      .disabled(model.current == nil)
    Button {
      model.next()
    } label: {
      Image(systemName: "forward.fill").font(.title3).frame(width: 32, height: 32)
    }.buttonStyle(.plain).help("Morceau suivant").accessibilityLabel("Morceau suivant")
      .disabled(model.current == nil)
    VolumeControl(player: player)
  }

  @ViewBuilder private var sessionControls: some View {
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
  }

  @ViewBuilder private var playerStatus: some View {
    if player.studio, let failure = player.clipFailure, !model.playbackBlocked {
      VStack(alignment: .leading, spacing: 4) {
        Text("Lecteur YouTube actif · " + failure.message)
          .font(.caption).foregroundStyle(.secondary)
        Button("Réessayer le clip natif") { player.retryClip() }
          .buttonStyle(.bordered).disabled(player.preparingClip)
      }
    }
    if player.preparingClip && !player.playing && player.studio {
      HStack(spacing: 8) {
        ProgressView().controlSize(.small)
        Text("Préparation du clip…").font(.caption).foregroundStyle(.secondary)
      }
    }
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
        Button(model.playbackBlocked ? "Réessayer ce titre" : "Réessayer la suite") {
          if model.playbackBlocked { model.retryPlayback() } else { model.retryContinuation() }
        }
        .buttonStyle(.bordered).disabled(model.busy)
        if model.playbackBlocked, let current = model.current {
          Link("Ouvrir YouTube", destination: current.url).font(.caption)
        }
      }
    }
    if !player.failure.isEmpty && !model.playbackBlocked {
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
        PanelTabBar(selection: $panelTab, queueCount: model.allUpcoming.count)
        Spacer(minLength: 0)
        if panelOnly || player.studio {
          Button {
            if panelOnly { discoverCollapsed = true } else { panelCollapsed = true }
          } label: {
            Image(systemName: "sidebar.right").frame(width: 26, height: 26)
          }.buttonStyle(.plain).foregroundStyle(.secondary).help("Replier le panneau")
            .accessibilityLabel("Replier le panneau")
        }
      }.padding(.horizontal, 12).padding(.top, 12).padding(.bottom, 4)
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

  /// The account's history from the server, refreshed when a play upload is confirmed.
  /// Without an account, this session's plays.
  @ViewBuilder private var historyPanel: some View {
    if session.connection == nil {
      sessionHistory
    } else {
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 0) {
          ForEach(listenedDays, id: \.title) { day in
            Text(day.title).font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
              .padding(.horizontal, 6).padding(.top, 12).padding(.bottom, 4)
            ForEach(day.plays) { play in
              HistoryRow(
                listened: play, playing: model.current?.id == play.track.id, compact: true,
                onPlay: { model.play(play.track, source: source ?? model.searchScope) },
                onEnqueue: { model.enqueue(play.track, source: source ?? model.searchScope) }
              )
              .onAppear {
                if play.id == listened.plays.last?.id { listened.load(session, more: true) }
              }
            }
          }
          if !listened.plays.isEmpty {
            if !listened.error.isEmpty {
              HStack {
                Text(listened.error).font(.caption).foregroundStyle(.orange).lineLimit(2)
                Spacer(minLength: 0)
                Button("Réessayer") { listened.load(session) }.buttonStyle(.link).font(.caption)
              }.padding(8)
            } else if listened.loading {
              ProgressView().controlSize(.small).padding(10).frame(maxWidth: .infinity)
            }
          }
        }.padding(.horizontal, 8).padding(.bottom, 12)
      }
      .overlay {
        if listened.plays.isEmpty {
          if listened.loading {
            ProgressView()
          } else if !listened.error.isEmpty {
            EmptyState(
              symbol: "exclamationmark.triangle", message: listened.error,
              action: ("Réessayer", { listened.load(session) }))
          } else {
            EmptyState(
              symbol: "clock.arrow.circlepath",
              message: "Tes écoutes apparaîtront ici, enregistrées sur ton compte.")
          }
        }
      }
      .task(id: session.generation) {
        if listened.plays.isEmpty { listened.load(session) }
      }
    }
  }

  private var sessionHistory: some View {
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

  private var listenedDays: [(title: String, plays: [ListenedTrack])] {
    ListeningHistoryModel.days(listened.plays)
  }

  private var conversation: some View {
    ScrollViewReader { proxy in
      ScrollView {
        // The session keeps at most 24 messages. Eager layout avoids lazy placement
        // feedback while variable-height discovery cards and replies are inserted.
        VStack(alignment: .leading, spacing: 16) {
          if model.messages.isEmpty { welcome }
          ForEach(model.messages) { message in
            VStack(alignment: .leading, spacing: 10) {
              ChatBubble(message: message)
              if let results = message.discoveries, !results.isEmpty {
                VStack(spacing: 6) {
                  ForEach(results) {
                    DiscoveryTrackRow(item: $0, compact: true, source: source ?? model.searchScope)
                  }
                }
                .padding(8)
                .background(
                  Color.sillageHover, in: RoundedRectangle(cornerRadius: 12, style: .continuous)
                )
                .padding(.leading, 36)
              }
            }.id(message.id)
          }
          if model.busy && !microphone.active {
            TypingIndicator(label: "Je cherche la bonne suite…") { model.cancel() }
          }
          Color.clear.frame(height: 1).id("conversation-bottom").accessibilityHidden(true)
        }.padding(.vertical, 16)
      }
      .task(id: conversationScrollKey) {
        guard !model.messages.isEmpty else { return }
        // One cancellable scroll after insertion; a new answer supersedes the typing
        // target. A fixed anchor never asks SwiftUI to estimate an offscreen lazy row.
        do { try await Task.sleep(for: .milliseconds(30)) } catch { return }
        guard !Task.isCancelled else { return }
        var transaction = Transaction(animation: nil)
        transaction.disablesAnimations = true
        withTransaction(transaction) { proxy.scrollTo("conversation-bottom", anchor: .bottom) }
      }
    }
  }

  private var conversationScrollKey: String {
    // Count stays at 24 once history is full; the last ID still changes on every reply.
    "\(model.messages.last?.id.uuidString ?? "empty"):\(model.busy):\(microphone.active)"
  }

  private var welcome: some View {
    VStack(alignment: .leading, spacing: 14) {
      DJAvatar(size: 40)
      VStack(alignment: .leading, spacing: 4) {
        Text("Qu’est-ce qui te ferait du bien ?").font(.title3.weight(.semibold))
        Text("Une ambiance, un artiste, une soirée. Tape / pour les commandes.")
          .font(.callout).foregroundStyle(.secondary)
      }
      VStack(alignment: .leading, spacing: 8) {
        ForEach(
          ["Du Mac Miller", "Une soirée jazz douce", "De l’énergie pour avancer"], id: \.self
        ) { text in
          Chip(title: text, symbol: "sparkles") { model.send(text, source: source) }
        }
      }
      if session.loadingCredentials {
        Text("Connexion à ton compte…").font(.caption).foregroundStyle(.secondary)
      } else if !session.hasServer {
        Text("Connecte ton compte dans Réglages pour accéder à tes playlists et au DJ.")
          .font(.caption).foregroundStyle(.secondary)
      }
    }.padding(.top, 8)
  }

  /// One rounded field: the message on top; where to search, the microphone and send below.
  private var composer: some View {
    VStack(alignment: .leading, spacing: 8) {
      if model.prompt.hasPrefix("/") {
        CommandSuggestions(prompt: model.prompt) { model.prompt = $0 }
      }
      if microphone.active {
        HStack(spacing: 8) {
          if microphone.starting || microphone.finishing { ProgressView().controlSize(.small) }
          Text(microphone.status).foregroundStyle(Color.recall)
          Button("Annuler l’écoute") { microphone.stop() }.buttonStyle(.link)
        }.font(.caption).padding(.horizontal, 4)
      } else if !model.busy && !voice.status.isEmpty {
        Text(voice.status).font(.caption).foregroundStyle(.secondary).padding(.horizontal, 4)
      }
      VStack(alignment: .leading, spacing: 6) {
        TextField("Demande au DJ…", text: $model.prompt, axis: .vertical)
          .lineLimit(1...5).textFieldStyle(.plain)
          .onSubmit { model.send(source: source) }
        HStack(spacing: 8) {
          if !panelOnly { ScopeMenu(scope: $model.searchScope) }
          Spacer(minLength: 0)
          Button {
            model.toggleMicrophone(source: source)
          } label: {
            Image(systemName: microphone.active ? "mic.fill" : "mic")
              .foregroundStyle(microphone.active ? Color.recall : .secondary)
              .frame(width: 28, height: 28).contentShape(Circle())
          }.buttonStyle(.plain).help("Parler au DJ")
            .accessibilityLabel(microphone.active ? "Terminer la dictée" : "Parler au DJ")
            .disabled(microphone.finishing)
          Button {
            model.send(source: source)
          } label: {
            Image(systemName: "arrow.up").fontWeight(.bold).frame(width: 28, height: 28)
              .foregroundStyle(canSend ? Color.sillage(.primaryIcon) : Color.secondary)
              .background(
                Circle().fill(canSend ? Color.sillage(.primaryFill) : Color.sillageHover))
          }.buttonStyle(.plain).accessibilityLabel("Envoyer").disabled(!canSend)
            .keyboardShortcut(.return, modifiers: [.command])
        }
      }
      .padding(.horizontal, 12).padding(.top, 10).padding(.bottom, 8)
      .background(
        RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.sillageHover)
          .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(
              Color.sillage(.separator)))
      )
    }
  }

  private var canSend: Bool {
    !model.prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
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
