import RecallKit
import SwiftUI

// Pieces of the DJ panel: tab bar, conversation and composer chrome. Sober glass, white for
// what is selected, the accent only for sending and listening (docs/design.md).

enum SessionPanelTab: String, CaseIterable, Identifiable {
  case dj = "DJ"
  case queue = "À suivre"
  case history = "Historique"
  case lyrics = "Paroles"
  var id: Self { self }
  var symbol: String {
    switch self {
    case .dj: "bubble.left.and.text.bubble.right"
    case .queue: "list.bullet"
    case .history: "clock.arrow.circlepath"
    case .lyrics: "quote.bubble"
    }
  }
}

/// Icon tabs in a quiet capsule; the selected one turns white with its label.
struct PanelTabBar: View {
  @Binding var selection: SessionPanelTab
  var queueCount = 0
  @Namespace private var pill
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  var body: some View {
    HStack(spacing: 2) {
      ForEach(SessionPanelTab.allCases) { tab in
        let selected = selection == tab
        Button {
          selection = tab
        } label: {
          HStack(spacing: 5) {
            Image(systemName: tab.symbol).imageScale(.small)
            if selected { Text(tab.rawValue).lineLimit(1) }
            if tab == .queue && queueCount > 0 && !selected {
              Text("\(queueCount)").font(.caption2.monospacedDigit().weight(.semibold))
                .padding(.horizontal, 5).padding(.vertical, 1)
                .background(Capsule().fill(Color.primary.opacity(0.12)))
            }
          }
          .font(.callout.weight(.medium))
          .foregroundStyle(selected ? Color.sillage(.primaryIcon) : Color.secondary)
          .padding(.horizontal, selected ? 12 : 9).frame(height: 28)
          .background {
            if selected {
              Capsule().fill(Color.sillageSelectedFill).matchedGeometryEffect(id: "tab", in: pill)
            }
          }
          .contentShape(Capsule())
        }
        .buttonStyle(.plain).help(tab.rawValue).accessibilityLabel(tab.rawValue)
        .accessibilityAddTraits(selected ? .isSelected : [])
      }
    }
    .padding(3)
    .background(Capsule().fill(Color.sillageHover))
    .animation(reduceMotion ? nil : .snappy(duration: 0.25), value: selection)
  }
}

/// The DJ's mark beside its replies.
struct DJAvatar: View {
  var size: CGFloat = 26
  var body: some View {
    Circle().fill(Color.recall.opacity(0.18))
      .overlay {
        Image(systemName: "waveform").font(.system(size: size * 0.45, weight: .semibold))
          .foregroundStyle(Color.recall)
      }
      .frame(width: size, height: size).accessibilityHidden(true)
  }
}

/// Your messages on the right in a neutral bubble; the DJ's on the left with its mark.
struct ChatBubble: View {
  let message: ChatMessage
  var body: some View {
    if message.role == "user" {
      HStack {
        Spacer(minLength: 40)
        Text(message.content).textSelection(.enabled)
          .padding(.horizontal, 13).padding(.vertical, 8)
          .background(
            Color.primary.opacity(0.08), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
      }
    } else {
      HStack(alignment: .top, spacing: 10) {
        DJAvatar()
        VStack(alignment: .leading, spacing: 8) {
          MarkdownMessage(message.content, sources: message.sources ?? [])
          if let sources = message.sources, !sources.isEmpty {
            ForEach(sources) { source in
              if let url = source.safeURL {
                Link(destination: url) {
                  Label("[\(source.id)] \(source.title)", systemImage: "arrow.up.right.square")
                    .font(.caption).lineLimit(2)
                }.tint(Color.recall)
              }
            }
          }
        }.frame(maxWidth: .infinity, alignment: .leading).padding(.top, 3)
      }
    }
  }
}

/// Three dots while the DJ searches, in the conversation where the answer will appear.
struct TypingIndicator: View {
  var label = "Le DJ cherche…"
  let cancel: () -> Void
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  var body: some View {
    HStack(alignment: .center, spacing: 10) {
      DJAvatar()
      TimelineView(.animation(minimumInterval: 1 / 20, paused: reduceMotion)) { context in
        let phase = context.date.timeIntervalSinceReferenceDate * 2.5
        HStack(spacing: 4) {
          ForEach(0..<3) { index in
            Circle().fill(.secondary).frame(width: 6, height: 6)
              .opacity(reduceMotion ? 0.6 : 0.35 + 0.65 * max(0, sin(phase - Double(index) * 0.8)))
          }
        }
      }
      .padding(.horizontal, 12).padding(.vertical, 10)
      .background(Color.sillageHover, in: Capsule())
      .accessibilityHidden(true)
      Text(label).font(.caption).foregroundStyle(.secondary)
      Spacer(minLength: 0)
      Button("Annuler", action: cancel).buttonStyle(.plain).font(.caption)
        .foregroundStyle(.secondary)
    }
  }
}

/// Where the DJ searches, as a small menu inside the composer.
struct ScopeMenu: View {
  @Binding var scope: DiscoveryScope
  var body: some View {
    Menu {
      Picker("Chercher dans", selection: $scope) {
        Label("Mes playlists", systemImage: "music.note.list").tag(DiscoveryScope.library)
        Label("YouTube", systemImage: "play.rectangle").tag(DiscoveryScope.youtube)
        Label("Partout", systemImage: "globe").tag(DiscoveryScope.all)
      }.pickerStyle(.inline)
    } label: {
      HStack(spacing: 4) {
        Image(systemName: symbol).imageScale(.small)
        Text(scope.title)
        Image(systemName: "chevron.down").imageScale(.small)
      }
      .font(.caption.weight(.medium)).foregroundStyle(.secondary)
      .padding(.horizontal, 8).padding(.vertical, 4)
      .background(Capsule().fill(Color.sillageHover))
    }
    .menuStyle(.button).buttonStyle(.plain).menuIndicator(.hidden).fixedSize()
    .help("Choisis où le DJ cherche. « Joue » lance maintenant ; « ajoute » garde la lecture.")
  }
  private var symbol: String {
    switch scope {
    case .library: "music.note.list"
    case .youtube: "play.rectangle"
    case .all: "globe"
    }
  }
}

/// Slash commands as a Raycast-like list above the composer.
struct CommandSuggestions: View {
  let prompt: String
  let choose: (String) -> Void
  var body: some View {
    // Hidden once arguments differ from every command, so a typed count is never replaced.
    let items = DJCommand.suggestions.filter {
      prompt == "/" || $0.command.hasPrefix(prompt.lowercased())
    }
    if !items.isEmpty {
      VStack(alignment: .leading, spacing: 0) {
        Text("Commandes").font(.caption.weight(.medium)).foregroundStyle(.secondary)
          .padding(.horizontal, 10).padding(.top, 8).padding(.bottom, 4)
        ForEach(items, id: \.command) { item in
          CommandRow(command: item.command, label: item.label) { choose(item.command) }
        }
      }
      .padding(.bottom, 4)
      .background(
        RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.sillage(.reading))
          .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(
              Color.sillage(.separator)))
      )
    }
  }
}

private struct CommandRow: View {
  let command: String
  let label: String
  let action: () -> Void
  @State private var hovering = false
  var body: some View {
    Button(action: action) {
      HStack(spacing: 10) {
        Text(command).font(.callout.monospaced().weight(.medium))
          .frame(width: 96, alignment: .leading)
        Text(label).font(.callout).foregroundStyle(.secondary).lineLimit(1)
        Spacer(minLength: 0)
      }
      .padding(.horizontal, 10).padding(.vertical, 6)
      .background(
        RoundedRectangle(cornerRadius: 8).fill(hovering ? Color.sillageHover : .clear)
      )
      .contentShape(Rectangle())
    }.buttonStyle(.plain).onHover { hovering = $0 }.padding(.horizontal, 4)
  }
}
