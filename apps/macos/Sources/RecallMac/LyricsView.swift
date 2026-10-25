import RecallKit
import SwiftUI

/// Lyrics of the current track, the next one prepared ahead, and this account's timing correction.
@MainActor
final class LyricsModel: ObservableObject {
  @Published private(set) var lyrics: Lyrics?
  @Published private(set) var loading = false
  private(set) var videoId: String?
  private var cache: [String: Lyrics] = [:]
  private var saving: Task<Void, Never>?

  func show(_ track: Track?, next: Track?, connection: Connection?) {
    guard let connection, let track else {
      videoId = nil
      lyrics = nil
      return
    }
    if track.id != videoId {
      videoId = track.id
      lyrics = cache[track.id]
      if lyrics == nil || lyrics?.status == .unavailable { load(track.id, connection) }
    }
    if let next, cache[next.id] == nil {
      Task { [weak self] in
        if let found = try? await HTTPClient().lyrics(connection, videoId: next.id) {
          self?.cache[next.id] = found
        }
      }
    }
  }

  func retry(connection: Connection?) {
    guard let connection, let videoId else { return }
    load(videoId, connection)
  }

  /// Moves the lyrics by `deltaMs`, at once on screen and shortly after on the server.
  func nudge(by deltaMs: Int?, connection: Connection?) {
    guard var current = lyrics, let videoId, let connection else { return }
    current.offsetMs = deltaMs.map { min(30000, max(-30000, current.offsetMs + $0)) } ?? 0
    lyrics = current
    cache[videoId] = current
    saving?.cancel()
    let offset = current.offsetMs
    saving = Task {
      try? await Task.sleep(nanoseconds: 800_000_000)
      guard !Task.isCancelled else { return }
      try? await HTTPClient().setLyricsOffset(connection, videoId: videoId, offsetMs: offset)
    }
  }

  private func load(_ id: String, _ connection: Connection) {
    loading = true
    Task { [weak self] in
      let found = try? await HTTPClient().lyrics(connection, videoId: id)
      guard let self, self.videoId == id else { return }
      self.loading = false
      self.lyrics = found ?? Lyrics(status: .unavailable, lines: [])
      if let found, found.status != .unavailable { self.cache[id] = found }
    }
  }
}

/// The player reports its position about twice a second; between reports, time keeps flowing.
private struct PlaybackClock {
  var elapsed: Double = 0
  var at = Date()
  func now(_ date: Date, playing: Bool) -> Double {
    playing ? elapsed + min(date.timeIntervalSince(at), 2) : elapsed
  }
}

/// Lines with the sung one filled progressively; a click on a line plays from there.
struct LyricsPanel: View {
  @ObservedObject var model: LyricsModel
  @ObservedObject var player: Player
  let connection: Connection?
  @State private var clock = PlaybackClock()
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    VStack(spacing: 0) {
      content.frame(maxWidth: .infinity, maxHeight: .infinity)
      if let lyrics = model.lyrics, lyrics.status == .synced {
        Divider()
        timingBar(lyrics).padding(12)
      }
    }.onChange(of: player.elapsed) { _, value in clock = PlaybackClock(elapsed: value, at: Date()) }
  }

  @ViewBuilder private var content: some View {
    if model.videoId == nil {
      EmptyState(symbol: "quote.bubble", message: "Les paroles du morceau en cours s’afficheront ici.")
    } else if model.loading && model.lyrics == nil {
      ProgressView("Recherche des paroles…").controlSize(.small)
    } else if let lyrics = model.lyrics {
      switch lyrics.status {
      case .synced: synced(lyrics)
      case .plain:
        ScrollView {
          Text(lyrics.text ?? "").textSelection(.enabled).padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
      case .instrumental: EmptyState(symbol: "pianokeys", message: "Morceau instrumental.")
      case .missing:
        EmptyState(symbol: "text.badge.xmark", message: "Pas de paroles trouvées pour ce titre.")
      case .unavailable:
        EmptyState(
          symbol: "wifi.exclamationmark",
          message: "Le service de paroles ne répond pas pour le moment.",
          action: ("Réessayer", { model.retry(connection: connection) }))
      }
    }
  }

  private func synced(_ lyrics: Lyrics) -> some View {
    TimelineView(.animation(minimumInterval: 1 / 30, paused: !player.playing)) { context in
      let position = lyrics.position(at: clock.now(context.date, playing: player.playing))
      ScrollViewReader { proxy in
        ScrollView {
          LazyVStack(alignment: .leading, spacing: 14) {
            ForEach(lyrics.lines.indices, id: \.self) { index in
              let state: LineState =
                index == position.index
                ? .current(reduceMotion ? 1 : position.progress)
                : (position.index ?? -1) > index ? .past : .future
              Button {
                player.seek(lyrics.start(of: index))
              } label: {
                LyricsLineView(text: lyrics.lines[index].text, state: state, size: 19)
              }.buttonStyle(.plain).id(index)
                .accessibilityLabel(lyrics.lines[index].text)
                .accessibilityHint("Lire à partir de cette ligne")
            }
          }.padding(.horizontal, 16).padding(.vertical, 120)
        }.onChange(of: position.index) { _, index in
          guard let index else { return }
          withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.35)) {
            proxy.scrollTo(index, anchor: UnitPoint(x: 0, y: 0.4))
          }
        }
      }
    }
  }

  private func timingBar(_ lyrics: Lyrics) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      if lyrics.offsetMs == 0, let delta = lyrics.durationDeltaMs, abs(delta) > 2000 {
        Text("Ce clip diffère de la version album : cale les paroles si besoin.")
          .font(.caption).foregroundStyle(.secondary)
      }
      HStack(spacing: 8) {
        Button {
          model.nudge(by: -500, connection: connection)
        } label: {
          Label("Plus tôt", systemImage: "backward")
        }.help("Afficher les paroles une demi-seconde plus tôt")
        Text(offsetLabel(lyrics.offsetMs)).font(.caption.monospacedDigit())
          .foregroundStyle(.secondary).fixedSize()
        Button {
          model.nudge(by: 500, connection: connection)
        } label: {
          Label("Plus tard", systemImage: "forward")
        }.help("Afficher les paroles une demi-seconde plus tard")
        Spacer(minLength: 0)
        if lyrics.offsetMs != 0 {
          Button {
            model.nudge(by: nil, connection: connection)
          } label: {
            Image(systemName: "arrow.counterclockwise")
          }.buttonStyle(.borderless).help("Revenir au calage d’origine")
            .accessibilityLabel("Réinitialiser le calage")
        }
      }.controlSize(.small).lineLimit(1)
      if let source = lyrics.sourceName {
        Text("Paroles : \(source)").font(.caption2).foregroundStyle(.tertiary)
      }
    }
  }

  private func offsetLabel(_ offset: Int) -> String {
    offset == 0
      ? "Calage 0 s"
      : "Calage " + (offset > 0 ? "+" : "−")
        + String(format: "%.1f s", Double(abs(offset)) / 1000).replacingOccurrences(of: ".", with: ",")
  }
}

/// Studio: the line being sung and the next one, large over the clip.
struct KaraokeOverlay: View {
  @ObservedObject var model: LyricsModel
  @ObservedObject var player: Player
  @State private var clock = PlaybackClock()
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    Group {
      if let lyrics = model.lyrics, lyrics.status == .synced {
        TimelineView(.animation(minimumInterval: 1 / 30, paused: !player.playing)) { context in
          let position = lyrics.position(at: clock.now(context.date, playing: player.playing))
          let index = position.index ?? -1
          VStack(spacing: 14) {
            if index >= 0 {
              LyricsLineView(
                text: lyrics.lines[index].text,
                state: .current(reduceMotion ? 1 : position.progress), size: 44)
            }
            if lyrics.lines.indices.contains(index + 1) {
              LyricsLineView(text: lyrics.lines[index + 1].text, state: .future, size: 30)
            }
          }.multilineTextAlignment(.center).shadow(color: .black.opacity(0.6), radius: 12)
            .frame(maxWidth: 900).animation(reduceMotion ? nil : .easeOut(duration: 0.25), value: index)
        }
      } else {
        Color.clear
      }
    }.frame(maxWidth: .infinity, maxHeight: .infinity)
      .onChange(of: player.elapsed) { _, value in clock = PlaybackClock(elapsed: value, at: Date()) }
      .accessibilityHidden(true)
  }
}

enum LineState: Equatable {
  case past, current(Double), future
}

/// One line; the sung one fills from left to right in Recall green.
struct LyricsLineView: View {
  let text: String
  let state: LineState
  let size: CGFloat
  var body: some View {
    let base = Text(text).font(.system(size: size, weight: .bold))
    switch state {
    case .past: base.foregroundStyle(.secondary).opacity(0.55)
    case .future: base.foregroundStyle(.secondary)
    case .current(let progress):
      base.foregroundStyle(.primary).overlay(alignment: .leading) {
        base.foregroundStyle(Color.recall).mask(alignment: .leading) {
          GeometryReader { geometry in
            Rectangle().frame(width: geometry.size.width * progress)
          }
        }
      }
    }
  }
}
