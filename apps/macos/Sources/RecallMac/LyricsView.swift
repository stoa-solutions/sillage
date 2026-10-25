import RecallKit
import SwiftUI

/// One sidebar presentation for timed and plain lyrics. LRCLIB supplies line timing,
/// so highlight complete lines rather than inventing word-level precision.
struct LyricsPanel: View {
  @ObservedObject var model: LyricsModel
  @ObservedObject var player: Player
  let connection: Connection?

  var body: some View {
    VStack(spacing: 0) {
      if let lyrics = model.lyrics, [.synced, .plain].contains(lyrics.status) {
        HStack {
          Text(lyrics.status == .synced ? "Synchronisées par ligne" : "Texte non synchronisé")
          Spacer(minLength: 4)
          if let source = lyrics.sourceName { Text(source) }
        }.font(.caption).foregroundStyle(.secondary).padding(12)
        Divider()
      }
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
      case .synced:
        SyncedLyrics(lyrics: lyrics, player: player).id(model.videoId)
      case .plain:
        ScrollView {
          Text(lyrics.text ?? "")
            .font(.system(size: 19, weight: .bold)).lineSpacing(14)
            .foregroundStyle(.secondary).textSelection(.enabled).padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
        }.id(model.videoId)
      case .instrumental: EmptyState(symbol: "pianokeys", message: "Morceau instrumental.")
      case .missing:
        EmptyState(
          symbol: "text.badge.xmark",
          message: "Pas de paroles disponibles pour cette version du morceau.")
      case .unavailable:
        EmptyState(
          symbol: "wifi.exclamationmark",
          message:
            "Paroles indisponibles pour le moment. Les titres doivent être dans ta bibliothèque.",
          action: ("Réessayer", { model.retry(connection: connection) }))
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
          Image(systemName: "backward")
        }
        .accessibilityLabel("Paroles plus tôt")
        .help("Afficher les paroles un dixième de seconde plus tôt")
        Text(offsetLabel(lyrics.offsetMs)).font(.caption.monospacedDigit())
          .foregroundStyle(.secondary).fixedSize()
        Button {
          model.nudge(by: 100, connection: connection)
        } label: {
          Image(systemName: "forward")
        }
        .accessibilityLabel("Paroles plus tard")
        .help("Afficher les paroles un dixième de seconde plus tard")
        Spacer(minLength: 0)
        if lyrics.offsetMs != 0 {
          Button {
            model.nudge(by: nil, connection: connection)
          } label: {
            Image(systemName: "arrow.counterclockwise")
          }
          .buttonStyle(.borderless).help("Revenir au calage d’origine")
          .accessibilityLabel("Réinitialiser le calage")
        }
      }.controlSize(.small).lineLimit(1)
      if model.correctionState == .saving {
        Text("Enregistrement du calage…").font(.caption2).foregroundStyle(.secondary)
      } else if model.correctionState == .failed {
        Text("Calage appliqué ici, mais non enregistré sur ton compte.")
          .font(.caption2).foregroundStyle(.orange)
        Button("Réessayer l’enregistrement") { model.nudge(by: 0, connection: connection) }
          .buttonStyle(.borderless).controlSize(.small)
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

/// The scroll view keeps its identity while the clock updates only the timed content.
/// Manual scrolling suspends follow until explicitly resumed, rather than fighting the reader.
private struct SyncedLyrics: View {
  let lyrics: Lyrics
  @ObservedObject var player: Player
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var following = true

  var body: some View {
    ScrollViewReader { proxy in
      TimelineView(.animation(minimumInterval: 0.1, paused: !player.playing)) { context in
        let position = lyrics.position(at: player.position(at: context.date))
        GeometryReader { geometry in
          ScrollView {
            LazyVStack(alignment: .leading, spacing: 14) {
              ForEach(lyrics.lines.indices, id: \.self) { index in
                Button {
                  player.seek(lyrics.start(of: index))
                  following = true
                  scroll(proxy, to: index)
                } label: {
                  Text(lyrics.lines[index].text).font(.system(size: 19, weight: .bold))
                    .foregroundStyle(index == position.index ? Color.recall : Color.secondary)
                    .opacity((position.index ?? -1) > index ? 0.55 : 1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
                }.buttonStyle(.plain).id(index)
                  .accessibilityLabel(lyrics.lines[index].text)
                  .accessibilityHint("Lire à partir de cette ligne")
              }
            }.padding(.horizontal, 16).padding(.vertical, max(24, geometry.size.height * 0.35))
          }
          .simultaneousGesture(DragGesture(minimumDistance: 8).onChanged { _ in following = false })
          .onLyricsScroll { following = false }
          .onChange(of: position.index, initial: true) { _, index in
            if following { scroll(proxy, to: index) }
          }
          .onChange(of: following) { _, enabled in
            if enabled { scroll(proxy, to: position.index) }
          }
          .overlay(alignment: .bottom) {
            if !following {
              Button("Reprendre le suivi") { following = true }
                .buttonStyle(GlassButtonStyle()).padding(8)
            }
          }
        }
      }
    }
  }

  private func scroll(_ proxy: ScrollViewProxy, to index: Int?) {
    guard let index else { return }
    withAnimation(reduceMotion ? nil : .easeOut(duration: 0.2)) {
      proxy.scrollTo(index, anchor: UnitPoint(x: 0, y: 0.35))
    }
  }
}

extension View {
  @ViewBuilder fileprivate func onLyricsScroll(_ action: @escaping () -> Void) -> some View {
    if #available(macOS 15, *) {
      onScrollPhaseChange { _, phase in
        if phase == .interacting { action() }
      }
    } else {
      self
    }
  }
}
