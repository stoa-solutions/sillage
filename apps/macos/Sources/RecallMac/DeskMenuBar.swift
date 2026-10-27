import AppKit
import RecallAudio
import RecallKit
import SwiftUI

/// The sign in the menu bar. It is the one view alive for the whole session, so it also hands
/// SwiftUI's window opener to the desk integration.
struct DeskMenuBarLabel: View {
  @ObservedObject var desk: DeskIntegration
  @ObservedObject var microphone: Microphone
  @Environment(\.openWindow) private var openWindow
  var body: some View {
    Image(nsImage: SillageGlyph.image(listening: microphone.active))
      .onAppear {
        desk.openWindowAction = { openWindow(id: RecallApp.mainWindowID) }
      }
  }
}

/// The menu bar window: what is playing, the DJ's last words, the microphone and a quick
/// request, without opening Sillage.
struct DeskMenu: View {
  @ObservedObject var desk: DeskIntegration
  @ObservedObject var dj: DJModel
  @ObservedObject var player: Player
  @ObservedObject var microphone: Microphone
  @Environment(\.openSettings) private var openSettings
  @State private var request = ""
  @FocusState private var requestFocused: Bool

  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      header
      nowPlaying
      if let reply = lastReply {
        Text(reply).font(.system(size: 12)).foregroundStyle(.secondary).lineLimit(3)
          .fixedSize(horizontal: false, vertical: true)
          .padding(.leading, 10)
          .overlay(alignment: .leading) {
            Capsule().fill(Color.recall.opacity(0.6)).frame(width: 2)
          }
      }
      requestField
      Divider()
      footer
    }
    .padding(16)
    .frame(width: 330)
  }

  private var header: some View {
    HStack(spacing: 8) {
      Text("SILLAGE").font(.system(size: 10, weight: .semibold, design: .monospaced))
        .tracking(1.4).foregroundStyle(Color.recall)
      Text(status).font(.system(size: 10, design: .monospaced)).foregroundStyle(.secondary)
      Spacer()
    }
  }

  private var status: String {
    if microphone.active { return "· À L’ÉCOUTE" }
    if dj.busy { return "· LE DJ CHERCHE" }
    guard dj.current != nil else { return "" }
    return player.playing ? "· EN LECTURE" : "· EN PAUSE"
  }

  @ViewBuilder private var nowPlaying: some View {
    if let track = dj.current {
      let title = TrackTitle(track)
      VStack(alignment: .leading, spacing: 10) {
        HStack(spacing: 12) {
          Artwork(track: track, showsDuration: false).frame(width: 104)
          VStack(alignment: .leading, spacing: 3) {
            Text(title.title).font(.system(size: 13, weight: .semibold)).lineLimit(2)
            if let artist = title.artist ?? track.channel {
              Text(artist).font(.system(size: 12)).foregroundStyle(.secondary).lineLimit(1)
            }
          }
        }
        SillageSlider(
          value: Binding(get: { player.elapsed }, set: { player.seek($0) }),
          range: 0...max(1, player.duration), step: 5
        )
        .disabled(player.duration <= 0).accessibilityLabel("Position du morceau")
        .accessibilityValue(clock(player.elapsed))
        HStack(spacing: 14) {
          Text("\(clock(player.elapsed)) / \(clock(player.duration))")
            .font(.system(size: 11, design: .monospaced)).foregroundStyle(.secondary)
          Spacer()
          Button {
            dj.togglePlayback()
          } label: {
            Image(systemName: player.playing ? "pause.fill" : "play.fill")
              .font(.system(size: 13, weight: .bold)).frame(width: 30, height: 30)
              .foregroundStyle(Color.sillage(.primaryIcon))
              .background(Circle().fill(Color.sillage(.primaryFill)))
          }.buttonStyle(.plain).accessibilityLabel(player.playing ? "Pause" : "Lecture")
          Button {
            dj.next()
          } label: {
            Image(systemName: "forward.fill").frame(width: 26, height: 26)
              .contentShape(Rectangle())
          }.buttonStyle(.plain).accessibilityLabel("Morceau suivant")
          VolumeControl(player: player, compact: true)
        }
      }
    } else {
      HStack(spacing: 10) {
        Image(nsImage: SillageGlyph.image(listening: false)).opacity(0.5)
        Text("Rien en lecture. Demande une ambiance au DJ.")
          .font(.system(size: 12)).foregroundStyle(.secondary)
      }
    }
  }

  private var lastReply: String? {
    guard let message = dj.messages.last(where: { $0.role != "user" }) else { return nil }
    let text = message.content.replacingOccurrences(of: "**", with: "")
    return text.isEmpty ? nil : text
  }

  /// One composer, like the main window's: the request on top, then where to search, the
  /// shortcut as a quiet hint, the microphone and send.
  private var requestField: some View {
    VStack(alignment: .leading, spacing: 8) {
      if microphone.active {
        HStack(spacing: 8) {
          if microphone.listening { LiveWaveform(meter: microphone.meter) }
          Text(microphoneTitle).font(.system(size: 13)).foregroundStyle(.secondary)
            .lineLimit(2).truncationMode(.head)
        }
      } else {
        TextField("Demande au DJ…", text: $request)
          .textFieldStyle(.plain).font(.system(size: 13)).focused($requestFocused)
          .onSubmit(send)
      }
      HStack(spacing: 8) {
        // Shared with the main window, so typed and spoken requests search the same place.
        ScopeMenu(scope: $dj.searchScope)
        Spacer(minLength: 0)
        if !microphone.active, request.isEmpty, let shortcut = desk.shortcut {
          Text(shortcut.keycaps.joined(separator: " "))
            .font(.system(size: 10.5, design: .rounded)).foregroundStyle(.tertiary)
            .help("Raccourci global pour parler au DJ depuis n’importe quelle app")
        }
        Button(action: toggleMicrophone) {
          Image(systemName: microphone.active ? "mic.fill" : "mic")
            .font(.system(size: 12, weight: .medium))
            .foregroundStyle(microphone.active ? Color.recall : .secondary)
            .frame(width: 24, height: 24).contentShape(Circle())
        }.buttonStyle(.plain)
          .accessibilityLabel(microphone.active ? "Envoyer la demande vocale" : "Parler au DJ")
        if !request.isEmpty {
          Button(action: send) {
            Image(systemName: "arrow.up").font(.system(size: 11, weight: .bold))
              .foregroundStyle(.white).frame(width: 22, height: 22)
              .background(Circle().fill(Color.recall))
          }.buttonStyle(.plain).accessibilityLabel("Envoyer")
        }
      }
    }
    .padding(.horizontal, 12).padding(.vertical, 10)
    .background(
      RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.primary.opacity(0.06)))
  }

  private func toggleMicrophone() {
    if microphone.listening {
      microphone.stop(submit: true)
    } else if microphone.active {
      microphone.stop()
    } else {
      desk.startDictation(showingPill: false)
    }
  }

  private var microphoneTitle: String {
    if microphone.listening {
      return microphone.transcript.isEmpty
        ? "Je t’écoute… clique le micro pour envoyer" : microphone.transcript
    }
    return microphone.status
  }

  private func send() {
    let text = request.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else { return }
    if !desk.mainWindowOpen { desk.openMainWindow(activating: false) }
    dj.send(text)
    request = ""
  }

  private var footer: some View {
    HStack(spacing: 14) {
      Button("Ouvrir Sillage") { desk.openMainWindow() }
      Spacer()
      Button("Réglages…") {
        NSApp.activate(ignoringOtherApps: true)
        openSettings()
      }
      Button("Quitter") { NSApp.terminate(nil) }
    }
    .buttonStyle(.plain).font(.system(size: 12)).foregroundStyle(.secondary)
  }
}

/// Five bars following the microphone, small enough for a button.
struct LiveWaveform: View {
  @ObservedObject var meter: InputMeter
  @State private var history = Array(repeating: Float(0), count: 5)
  var body: some View {
    HStack(spacing: 2) {
      ForEach(Array(history.enumerated()), id: \.offset) { _, level in
        Capsule().fill(Color.recall).frame(width: 2, height: 3 + CGFloat(level) * 10)
      }
    }
    .animation(.easeOut(duration: 0.1), value: history)
    .onReceive(meter.$level) { level in
      history.removeFirst()
      history.append(level)
    }
    .accessibilityHidden(true)
  }
}
