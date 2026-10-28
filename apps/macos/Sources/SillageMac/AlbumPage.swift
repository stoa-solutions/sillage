import SillageKit
import SwiftUI

/// An album in the app: cover, artist (a link), what it is, and its tracks, playable at once;
/// the ones already in the library are marked.
struct AlbumPage: View {
  let browseId: String
  let backTitle: String
  let back: () -> Void
  let openDJ: () -> Void
  @EnvironmentObject var session: Session
  @EnvironmentObject var dj: DJModel
  @State private var album: Album?
  @State private var failure = ""
  @State private var expanded = false

  var body: some View {
    VStack(spacing: 0) {
      ScrollView {
        VStack(alignment: .leading, spacing: 26) {
          HStack {
            LibraryLinkButton(title: backTitle, symbol: "chevron.left", action: back)
              .keyboardShortcut("[", modifiers: .command).help("Retour (⌘[)")
            Spacer(minLength: 0)
          }
          if let album {
            header(album)
            tracks(album)
          } else if !failure.isEmpty {
            EmptyState(symbol: "exclamationmark.triangle", message: failure)
          } else {
            ProgressView().controlSize(.small).frame(maxWidth: .infinity).padding(.top, 60)
          }
        }
        .padding(.top, 20).padding(.horizontal, 32).padding(.bottom, 24)
        .frame(maxWidth: .infinity, alignment: .leading)
      }
      .scrollIndicators(.never)
      NowPlayingBar(model: dj, player: dj.player, openDJ: openDJ)
    }
    .sillageSurface(.reading)
    .task(id: browseId) { await load() }
  }

  private func load() async {
    guard let connection = session.connection else { return }
    do {
      album = try await HTTPClient().album(connection, browseId: browseId)
    } catch {
      failure = "Album indisponible pour l’instant. " + error.localizedDescription
    }
  }

  private func header(_ album: Album) -> some View {
    HStack(alignment: .bottom, spacing: 22) {
      RemotePicture(url: album.artwork, placeholder: "square.stack")
        .frame(width: 184, height: 184)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
          RoundedRectangle(cornerRadius: 12, style: .continuous)
            .strokeBorder(Color.sillage(.separator)))
      VStack(alignment: .leading, spacing: 8) {
        MonoLabel([album.kind, album.year].compactMap { $0 }.joined(separator: " · "))
        Text(album.title).font(.system(size: 30, weight: .bold)).tracking(-0.8).lineLimit(2)
          .accessibilityAddTraits(.isHeader)
        if let artist = album.artist {
          ArtistLink(text: artist, font: .system(size: 15, weight: .medium), color: .primary)
        }
        if let summary = album.summary {
          Text(summary).font(.system(size: 11, design: .monospaced)).foregroundStyle(.secondary)
        }
        if let description = album.description {
          Text(description).font(.system(size: 12)).foregroundStyle(.secondary)
            .lineLimit(expanded ? nil : 2).fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: 560, alignment: .leading)
            .onTapGesture { expanded.toggle() }
            .help(expanded ? "" : "Lire la suite")
        }
        HStack(spacing: 10) {
          Button {
            playAll(album)
          } label: {
            Label("Tout lire", systemImage: "play.fill")
          }.buttonStyle(LibraryPrimaryButtonStyle()).disabled(album.tracks.isEmpty)
          if let url = album.url {
            Link(destination: url) {
              Label("YouTube Music", systemImage: "arrow.up.right.square")
            }.font(.system(size: 12)).foregroundStyle(.secondary)
          }
        }.padding(.top, 6)
      }
      Spacer(minLength: 0)
    }
  }

  private func tracks(_ album: Album) -> some View {
    VStack(alignment: .leading, spacing: 0) {
      SillageRule()
      ForEach(album.tracks) { entry in
        AlbumTrackRow(entry: entry, track: album.track(entry))
      }
    }
  }

  /// The first track now, the others queued in album order.
  private func playAll(_ album: Album) {
    guard let first = album.tracks.first else { return }
    dj.play(album.track(first), source: .all)
    for entry in album.tracks.dropFirst() { dj.enqueue(album.track(entry), source: .all) }
  }
}

private struct AlbumTrackRow: View {
  let entry: Album.Entry
  let track: Track
  @EnvironmentObject var dj: DJModel
  @State private var hovering = false
  var body: some View {
    let playing = dj.current?.id == track.id
    HStack(spacing: 12) {
      Group {
        if playing {
          Image(systemName: "speaker.wave.2").font(.system(size: 13))
            .foregroundStyle(Color.sillage(.actionText))
        } else if hovering {
          Button(action: play) { Image(systemName: "play.fill").font(.system(size: 10)) }
            .buttonStyle(.plain).accessibilityHidden(true)
        } else {
          Text(String(format: "%02d", entry.position)).font(.system(size: 10, design: .monospaced))
            .foregroundStyle(.secondary)
        }
      }.frame(width: 26)
      Button(action: play) {
        Text(entry.title).font(.system(size: 13, weight: .medium)).lineLimit(1)
          .foregroundStyle(playing ? Color.sillage(.playingText) : Color.primary)
          .frame(maxWidth: .infinity, alignment: .leading)
      }.buttonStyle(.plain)
      if entry.inLibrary {
        Image(systemName: "checkmark.circle.fill").font(.system(size: 12))
          .foregroundStyle(.secondary).help("Dans ta bibliothèque")
          .accessibilityLabel("Dans ta bibliothèque")
      }
      if let plays = entry.plays {
        Text(plays).font(.system(size: 11)).foregroundStyle(.secondary).lineLimit(1)
          .frame(width: 110, alignment: .trailing)
      }
      Text(entry.durationSeconds.map { clock(Double($0)) } ?? "")
        .font(.system(size: 11, design: .monospaced)).foregroundStyle(.secondary)
        .frame(width: LibraryColumns.duration, alignment: .trailing)
      HStack(spacing: 2) {
        if hovering {
          IconButton(symbol: "text.badge.plus", help: "Lire ensuite") {
            dj.enqueue(track, source: .all)
          }
        }
      }.frame(width: LibraryColumns.actions, alignment: .trailing)
    }
    .padding(.horizontal, 10).frame(height: 44)
    .background(
      RoundedRectangle(cornerRadius: 4).fill(hovering ? Color.sillageHover : .clear))
    .overlay(alignment: .bottom) { SillageRule().opacity(0.5) }
    .contentShape(Rectangle())
    .onHover { hovering = $0 }
    .onTapGesture(count: 2, perform: play)
    .accessibilityElement(children: .combine)
    .accessibilityLabel("\(entry.position). \(entry.title)")
    .accessibilityAction(named: "Lire", play)
    .accessibilityAction(named: "Lire ensuite") { dj.enqueue(track, source: .all) }
  }
  private func play() { dj.play(track, source: .all) }
}
