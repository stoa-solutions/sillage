import AppKit
import RecallKit
import SwiftUI

// Pieces shared by Bibliothèque and Découvrir: the song row, buttons, tiles and chips. docs/design.md explains the rules.

/// One song in a list (Sillage Atelier): number or play on hover, 16:9 thumbnail, song and
/// artist, hover actions, duration. Regular columns; rows separated by a faint rule only.
/// The playing song shows a speaker marker; its title uses the action text role.
struct SongRow: View {
  let index: Int?
  let track: Track
  let playing: Bool
  let onPlay: () -> Void
  let onEnqueue: () -> Void
  /// Découvrir: one click selects the row for the preview; it is outlined in orange.
  var selected = false
  var onSelect: (() -> Void)? = nil
  /// Extra control kept visible at the end (Découvrir's « add to Mes découvertes »).
  var accessory: AnyView? = nil
  /// Why the row is shown (a recommendation's reason), one hover away.
  var note: String? = nil
  @State private var hovering = false
  var body: some View {
    let name = TrackTitle(track)
    HStack(spacing: 12) {
      if let index {
        ZStack {
          if hovering {
            Image(systemName: "play.fill").font(.system(size: 11))
          } else if playing {
            Image(systemName: "speaker.wave.2.fill").font(.system(size: 11))
              .foregroundStyle(Color.sillage(.primaryFill))
          } else {
            Text("\(index)").font(.system(size: 12).monospacedDigit()).foregroundStyle(.secondary)
          }
        }.frame(width: 26).accessibilityHidden(true)
      }
      Artwork(track: track, showsDuration: false).frame(width: 56)
      VStack(alignment: .leading, spacing: 2) {
        Text(name.title).font(.system(size: 13, weight: .medium)).lineLimit(1)
          .foregroundStyle(playing ? Color.sillage(.playingText) : Color.primary)
        Text(name.artist ?? track.channel ?? "YouTube").font(.system(size: 12))
          .foregroundStyle(.secondary).lineLimit(1)
      }.frame(maxWidth: .infinity, alignment: .leading)
      // Hover actions leave the view when hidden, so keyboard focus never lands on them;
      // the row's accessibility actions offer the same choices.
      HStack(spacing: 2) {
        if hovering {
          IconButton(symbol: "text.badge.plus", help: "Lire ensuite", action: onEnqueue)
          Menu {
            Button("Lire maintenant", systemImage: "play.fill", action: onPlay)
            Button("Lire ensuite", systemImage: "text.badge.plus", action: onEnqueue)
            Divider()
            Button("Ouvrir sur YouTube", systemImage: "arrow.up.right.square") {
              NSWorkspace.shared.open(track.url)
            }
          } label: {
            Image(systemName: "ellipsis").frame(width: 26, height: 26).contentShape(Rectangle())
          }.menuStyle(.button).buttonStyle(.plain).menuIndicator(.hidden).fixedSize()
            .help("Plus d’actions").accessibilityLabel("Plus d’actions pour \(name.title)")
        }
      }.frame(width: 54, alignment: .trailing)
      if let accessory { accessory }
      Text(track.durationSeconds.map(clock) ?? "").font(.system(size: 12).monospacedDigit())
        .foregroundStyle(.secondary).frame(width: 44, alignment: .trailing)
    }
    .padding(.horizontal, 8).padding(.vertical, 5)
    .background {
      RoundedRectangle(cornerRadius: 8)
        .fill(selected ? Color.sillage(.selection) : hovering ? Color.sillageHover : .clear)
        .overlay {
          if selected {
            RoundedRectangle(cornerRadius: 8).strokeBorder(
              Color.sillage(.primaryFill), lineWidth: 1.5)
          }
        }
    }
    .overlay(alignment: .bottom) {
      if !selected { SillageRule().opacity(0.5).padding(.leading, index == nil ? 76 : 114) }
    }
    .contentShape(Rectangle())
    .onHover { hovering = $0 }
    .onTapGesture(count: 2, perform: onPlay)
    .onTapGesture { onSelect?() }
    .overlay(alignment: .leading) {
      // The number column doubles as a play button, as in Spotify.
      if index != nil {
        // A clear colour takes no clicks by itself: the shape makes the column clickable.
        Button(action: onPlay) { Color.clear.frame(width: 40).contentShape(Rectangle()) }
          .buttonStyle(.plain)
          .accessibilityHidden(true)
      }
    }
    .help(help(name))
    .accessibilityElement(children: .contain)
    .accessibilityLabel(name.artist.map { "\(name.title), \($0)" } ?? name.title)
    .accessibilityValue(
      [playing ? "En lecture" : nil, track.durationSeconds.map(spokenDuration)]
        .compactMap { $0 }.joined(separator: ", ")
    )
    .accessibilityAddTraits(playing || selected ? .isSelected : [])
    .accessibilityAction(named: "Lire", onPlay)
    .accessibilityAction(named: "Lire ensuite", onEnqueue)
  }

  /// Full title, credits and genres stay one hover away instead of crowding the row.
  private func help(_ name: TrackTitle) -> String {
    var lines = [name.artist.map { "\(name.title) — \($0)" } ?? name.title]
    if let note { lines.append(note) }
    if let metadata = track.musicMetadata, metadata.matched, !metadata.genres.isEmpty {
      lines.append(metadata.genres.prefix(3).joined(separator: ", "))
    }
    if let summary = track.description.flatMap(shortDescription) { lines.append(summary) }
    return lines.joined(separator: "\n")
  }
}

/// The round accent play button: the one strong action of a header or a card.
struct PlayDisc: View {
  var size: CGFloat = 48
  var symbol = "play.fill"
  var body: some View {
    Image(systemName: symbol).font(.system(size: size * 0.38, weight: .bold))
      .foregroundStyle(Color.sillage(.primaryIcon)).frame(width: size, height: size)
      .background(Circle().fill(Color.sillage(.primaryFill)))
      .shadow(color: .black.opacity(0.18), radius: 4, y: 2)
  }
}

/// Small borderless icon button with a hover tint.
struct IconButton: View {
  let symbol: String
  let help: String
  let action: () -> Void
  var body: some View {
    Button(action: action) {
      Image(systemName: symbol).frame(width: 26, height: 26).contentShape(Rectangle())
    }.buttonStyle(.plain).foregroundStyle(.secondary).help(help).accessibilityLabel(help)
  }
}

/// A playlist cover without artwork: its initial on a muted colour of its own.
struct PlaylistTile: View {
  let title: String
  var symbol: String? = nil
  var size: CGFloat = 40
  var body: some View {
    let seed = title.unicodeScalars.reduce(0) { ($0 &* 31 &+ Int($1.value)) & 0xFFFF }
    RoundedRectangle(cornerRadius: size * 0.18, style: .continuous)
      .fill(
        LinearGradient(
          colors: [
            Color(hue: Double(seed % 360) / 360, saturation: 0.35, brightness: 0.42),
            Color(hue: Double(seed % 360) / 360, saturation: 0.4, brightness: 0.22),
          ], startPoint: .topLeading, endPoint: .bottomTrailing)
      )
      .overlay {
        if let symbol {
          Image(systemName: symbol).font(.system(size: size * 0.4, weight: .semibold))
        } else {
          Text(title.first.map { String($0).uppercased() } ?? "?")
            .font(.system(size: size * 0.45, weight: .bold))
        }
      }
      .foregroundStyle(.white.opacity(0.9))
      .frame(width: size, height: size).accessibilityHidden(true)
  }
}

/// Neutral chip, white (chalk) with ink text when selected; recents, ideas, scopes.
struct Chip: View {
  let title: String
  var symbol: String? = nil
  var selected = false
  let action: () -> Void
  var body: some View {
    Button(action: action) {
      HStack(spacing: 5) {
        if let symbol { Image(systemName: symbol).imageScale(.small) }
        Text(title).lineLimit(1)
      }
    }.buttonStyle(SillageChipStyle(selected: selected))
      .accessibilityAddTraits(selected ? .isSelected : [])
  }
}

/// Start of a YouTube description without the "Provided to YouTube by" line and links.
func shortDescription(_ description: String) -> String? {
  let lines = description.split(whereSeparator: \.isNewline)
    .filter { !$0.hasPrefix("Provided to YouTube by") }
    .map { line in
      line.split(separator: " ").filter { !$0.contains("http") && !$0.hasPrefix("www.") }
        .joined(separator: " ")
    }.filter { !$0.isEmpty }
  let text = lines.prefix(3).joined(separator: " ")
  return text.isEmpty ? nil : String(text.prefix(280))
}

/// « 3 minutes 15 » rather than « 3:15 », which speech reads as a time of day.
func spokenDuration(_ seconds: Double) -> String {
  let total = Int(seconds.isFinite ? max(seconds, 0) : 0)
  let (hours, minutes, rest) = (total / 3600, total / 60 % 60, total % 60)
  var parts: [String] = []
  if hours > 0 { parts.append("\(hours) h") }
  if minutes > 0 { parts.append("\(minutes) minute\(minutes > 1 ? "s" : "")") }
  if rest > 0 || parts.isEmpty { parts.append("\(rest)") }
  return parts.joined(separator: " ")
}
