import AppKit
import SillageKit
import SwiftUI

// Bibliothèque and Mon goût as on the 2026-10-28 boards (assets/creative/sillage/etudes in the
// Stoa repo): a page head with a mono eyebrow, then a real table with a mono header row,
// 16:9 thumbnails and a faint rule between rows. Shared by the two pages only.

/// Small uppercase annotation in the mono face: eyebrows, column titles, counts.
struct MonoLabel: View {
  let text: String
  var uppercase = true
  init(_ text: String, uppercase: Bool = true) {
    self.text = text
    self.uppercase = uppercase
  }
  var body: some View {
    Text(uppercase ? text.uppercased(with: Locale(identifier: "fr_FR")) : text)
      .font(.system(size: 10, design: .monospaced)).tracking(uppercase ? 1.35 : 0)
      .foregroundStyle(.secondary).lineLimit(1)
  }
}

/// Eyebrow, large title, one line under it, and a quiet action on the right.
struct LibraryPageHead<Detail: View, Trailing: View>: View {
  let eyebrow: String
  let title: String
  @ViewBuilder var detail: Detail
  @ViewBuilder var trailing: Trailing
  var body: some View {
    HStack(alignment: .center, spacing: 24) {
      VStack(alignment: .leading, spacing: 0) {
        MonoLabel(eyebrow).padding(.bottom, 9)
        Text(title).font(.system(size: 32, weight: .semibold)).tracking(-1)
          .lineLimit(1).truncationMode(.tail).help(title).accessibilityAddTraits(.isHeader)
        detail.font(.system(size: 12)).foregroundStyle(.secondary).padding(.top, 8)
      }
      Spacer(minLength: 0)
      trailing
    }
  }
}

/// A plain secondary link: grey text and a symbol, ink on hover.
struct LibraryLinkButton: View {
  let title: String
  var symbol: String? = nil
  var trailingSymbol: String? = nil
  let action: () -> Void
  @State private var hovering = false
  var body: some View {
    Button(action: action) {
      HStack(spacing: 6) {
        if let symbol { Image(systemName: symbol).font(.system(size: 14)) }
        Text(title).font(.system(size: 12))
        if let trailingSymbol { Image(systemName: trailingSymbol).font(.system(size: 13)) }
      }
      .foregroundStyle(hovering ? Color.primary : Color.secondary)
      .padding(.vertical, 7).contentShape(Rectangle())
    }.buttonStyle(.plain).onHover { hovering = $0 }
  }
}

/// The page's one strong action: orange, ink label.
struct LibraryPrimaryButtonStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label.font(.system(size: 12, weight: .semibold))
      .foregroundStyle(Color.sillage(.primaryIcon))
      .padding(.horizontal, 15).frame(height: 36)
      .background(
        RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Color.sillage(.primaryFill))
          .opacity(configuration.isPressed ? 0.85 : 1))
      .contentShape(Rectangle())
  }
}

/// A quiet companion to the primary action.
struct LibrarySecondaryButtonStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label.font(.system(size: 12, weight: .medium))
      .padding(.horizontal, 13).frame(height: 36)
      .background(
        RoundedRectangle(cornerRadius: 8, style: .continuous).fill(
          configuration.isPressed ? Color.sillagePressed : Color.sillageHover))
      .contentShape(Rectangle())
  }
}

/// A 16:9 thumbnail at the table's size.
struct TableThumbnail: View {
  let track: Track
  var width: CGFloat = 52
  var height: CGFloat = 30
  var radius: CGFloat = 4
  var body: some View {
    Artwork.image(for: track, quality: "mqdefault")
      .frame(width: width, height: height).clipped()
      .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
      .accessibilityHidden(true)
  }
}

/// A column title row, sticky above the rows.
struct TableHeaderRow<Content: View>: View {
  @ViewBuilder var content: Content
  var body: some View {
    HStack(spacing: 12) { content }
      .padding(.horizontal, 10).frame(height: 31)
      .background(Color.sillageHover.opacity(0.6))
      .overlay(alignment: .bottom) { SillageRule() }
  }
}

/// Thin orange bar on a neutral track, with « 60/100 » after it.
struct AffinityMeter: View {
  let value: Int
  var showsValue = true
  var body: some View {
    HStack(spacing: 10) {
      AffinityBar(value: value, height: 3)
      if showsValue {
        HStack(alignment: .firstTextBaseline, spacing: 1) {
          Text("\(value)").font(.system(size: 10, design: .monospaced))
          Text("/100").font(.system(size: 9, design: .monospaced)).foregroundStyle(.secondary)
        }.fixedSize()
      }
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("Affinité \(value) sur 100")
  }
}

/// A 0–100 bar: neutral track, orange fill. The number is read by VoiceOver elsewhere.
struct AffinityBar: View {
  let value: Int
  var height: CGFloat = 4
  var body: some View {
    GeometryReader { geometry in
      ZStack(alignment: .leading) {
        Capsule().fill(Color.primary.opacity(0.1))
        Capsule().fill(Color.sillage(.primaryFill))
          .frame(width: geometry.size.width * CGFloat(min(max(value, 0), 100)) / 100)
      }
    }
    .frame(height: height)
    .accessibilityHidden(true)
  }
}

/// Shared row behaviour: hover tint, faint rule, playing tint with an orange edge, double
/// click to play, the same context menu and accessibility actions everywhere.
struct TableRowFrame: ViewModifier {
  let track: Track
  let name: TrackTitle
  let playing: Bool
  let onPlay: () -> Void
  let onEnqueue: () -> Void
  @Binding var hovering: Bool
  func body(content: Content) -> some View {
    content
      .padding(.horizontal, 10).frame(height: 53)
      .background {
        RoundedRectangle(cornerRadius: 4)
          .fill(
            playing
              ? Color.sillage(.primaryFill).opacity(0.1)
              : hovering ? Color.sillageHover : .clear)
      }
      .overlay(alignment: .leading) {
        if playing {
          Capsule().fill(Color.sillage(.primaryFill)).frame(width: 2).padding(.vertical, 10)
        }
      }
      .overlay(alignment: .bottom) { SillageRule().opacity(0.5) }
      .contentShape(Rectangle())
      .onHover { hovering = $0 }
      .onTapGesture(count: 2, perform: onPlay)
      .accessibilityElement(children: .contain)
      .accessibilityLabel(name.artist.map { "\(name.title), \($0)" } ?? name.title)
      .accessibilityValue(
        [playing ? "En lecture" : nil, track.durationSeconds.map(spokenDuration)]
          .compactMap { $0 }.joined(separator: ", ")
      )
      .accessibilityAddTraits(playing ? .isSelected : [])
      .accessibilityAction(named: "Lire", onPlay)
      .accessibilityAction(named: "Lire ensuite", onEnqueue)
      .accessibilityAction(named: "Ouvrir sur YouTube") { NSWorkspace.shared.open(track.url) }
      .artistAction(name.artist)
      .contextMenu {
        Button("Lire maintenant", systemImage: "play.fill", action: onPlay)
        Button("Lire ensuite", systemImage: "text.badge.plus", action: onEnqueue)
        Divider()
        Button("Ouvrir sur YouTube", systemImage: "arrow.up.right.square") {
          NSWorkspace.shared.open(track.url)
        }
      }
  }
}

/// The song cell: thumbnail, title (click to play), artist under it.
struct TableSongCell: View {
  let track: Track
  let name: TrackTitle
  var subtitle: String? = nil
  let playing: Bool
  let onPlay: () -> Void
  @State private var hovering = false
  var body: some View {
    HStack(spacing: 12) {
      TableThumbnail(track: track)
      VStack(alignment: .leading, spacing: 3) {
        Button(action: onPlay) {
          Text(name.title).font(.system(size: 12, weight: .semibold)).lineLimit(1)
            .underline(hovering).foregroundStyle(
              playing ? Color.sillage(.playingText) : Color.primary)
        }.buttonStyle(.plain).onHover { hovering = $0 }.help("Lire \(name.title)")
        if let subtitle { ArtistLink(text: subtitle, font: .system(size: 11)) }
      }
    }.frame(maxWidth: .infinity, alignment: .leading)
  }
}

/// Bibliothèque: number (speaker while playing), song, artist, duration, hover actions.
struct LibraryTableRow: View {
  let index: Int
  let track: Track
  let playing: Bool
  let compact: Bool
  let onPlay: () -> Void
  let onEnqueue: () -> Void
  @State private var hovering = false
  var body: some View {
    let name = TrackTitle(track)
    HStack(spacing: 12) {
      Group {
        if playing {
          Image(systemName: "speaker.wave.2").font(.system(size: 13))
            .foregroundStyle(Color.sillage(.actionText))
        } else if hovering {
          Button(action: onPlay) { Image(systemName: "play.fill").font(.system(size: 10)) }
            .buttonStyle(.plain).accessibilityHidden(true)
        } else {
          Text(String(format: "%02d", index)).font(.system(size: 10, design: .monospaced))
            .foregroundStyle(.secondary)
        }
      }.frame(width: 26).accessibilityHidden(true)
      TableSongCell(
        track: track, name: name, subtitle: compact ? name.artist : nil, playing: playing,
        onPlay: onPlay)
      if !compact {
        Group {
          if let artist = name.artist {
            ArtistLink(text: artist)
          } else {
            Text(track.channel ?? "").font(.system(size: 12)).foregroundStyle(.secondary)
              .lineLimit(1)
          }
        }.frame(width: LibraryColumns.artist, alignment: .leading)
      }
      Text(track.durationSeconds.map(clock) ?? "").font(.system(size: 11, design: .monospaced))
        .foregroundStyle(.secondary).frame(width: LibraryColumns.duration, alignment: .trailing)
      HStack(spacing: 2) {
        if hovering {
          IconButton(symbol: "text.badge.plus", help: "Lire ensuite", action: onEnqueue)
        }
      }.frame(width: LibraryColumns.actions, alignment: .trailing)
    }
    .modifier(
      TableRowFrame(
        track: track, name: name, playing: playing, onPlay: onPlay, onEnqueue: onEnqueue,
        hovering: $hovering))
  }
}

enum LibraryColumns {
  static let artist: CGFloat = 225
  static let duration: CGFloat = 52
  static let actions: CGFloat = 30
  /// Below this width the artist column folds under the title.
  static let compactBelow: CGFloat = 720
}
