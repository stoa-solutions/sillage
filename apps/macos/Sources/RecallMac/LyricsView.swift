import RecallKit
import SwiftUI

/// Lines with the sung one filled progressively; a click on a line plays from there.
struct LyricsPanel: View {
  @ObservedObject var model: LyricsModel
  @ObservedObject var player: Player
  let connection: Connection?
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    VStack(spacing: 0) {
      content.frame(maxWidth: .infinity, maxHeight: .infinity)
      if let lyrics = model.lyrics, lyrics.status == .synced {
        Divider()
        timingBar(lyrics).padding(12)
      }
    }
  }

  @ViewBuilder private var content: some View {
    if model.videoId == nil {
      EmptyState(
        symbol: "quote.bubble", message: "Les paroles du morceau en cours s’afficheront ici.")
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
      let position = lyrics.position(at: player.position(at: context.date))
      ScrollViewReader { proxy in
        ScrollView {
          LazyVStack(alignment: .leading, spacing: 14) {
            ForEach(lyrics.lines.indices, id: \.self) { index in
              let state: LineState =
                index == position.index
                ? .current(1)
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
          model.nudge(by: -100, connection: connection)
        } label: {
          Label("Plus tôt", systemImage: "backward")
        }.help("Afficher les paroles un dixième de seconde plus tôt")
        Text(offsetLabel(lyrics.offsetMs)).font(.caption.monospacedDigit())
          .foregroundStyle(.secondary).fixedSize()
        Button {
          model.nudge(by: 100, connection: connection)
        } label: {
          Label("Plus tard", systemImage: "forward")
        }.help("Afficher les paroles un dixième de seconde plus tard")
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
        Text("Paroles : \(source) · synchronisation par ligne").font(.caption2).foregroundStyle(
          .tertiary)
      }
    }
  }

  private func offsetLabel(_ offset: Int) -> String {
    offset == 0
      ? "Calage 0 s"
      : "Calage " + (offset > 0 ? "+" : "−")
        + String(format: "%.1f s", Double(abs(offset)) / 1000).replacingOccurrences(
          of: ".", with: ",")
  }
}

enum LineState: Equatable {
  case past
  case current(Double)
  case future
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
