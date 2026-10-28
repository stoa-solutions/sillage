import SillageKit
import SwiftUI

/// Bibliothèque → Mon goût, as on the 2026-10-28 board: four figures, category chips, the
/// listener's artists on the left (the first one large) and a table of titles with their
/// affinity, plays and opinion. The score stays on the server; the page shows its category
/// and a 0–100 affinity.
struct TasteOverviewView: View {
  @ObservedObject var taste: TasteModel
  let current: Track?
  let play: (Track) -> Void
  let enqueue: (Track) -> Void
  /// The empty page's way back to the collection.
  let explore: () -> Void
  @Environment(\.openSettings) private var openSettings
  @AppStorage(SettingsPage.requestKey) private var requestedPage = ""
  @State private var filter: Filter = .all
  @State private var refresh: Task<Void, Never>?

  /// A category filter; the raw value is the server's category key ("" for all).
  private enum Filter: String, CaseIterable, Identifiable {
    case all = ""
    case favourite, frequent, heard, unconvinced, hidden
    var id: String { rawValue }
    var title: String {
      switch self {
      case .all: "Tout"
      case .favourite: "Coups de cœur"
      case .frequent: "Souvent écoutés"
      case .heard: "Déjà écoutés"
      case .unconvinced: "Peu accrochés"
      case .hidden: "Écartés"
      }
    }
  }

  private var isEmpty: Bool {
    taste.overview.map { $0.summary.tracks == 0 && $0.tracks.isEmpty } ?? false
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      LibraryPageHead(eyebrow: "Bibliothèque / Mon goût", title: "Mon goût") {
        Text(
          isEmpty
            ? "Tes écoutes et tes avis dessinent la suite."
            : "Tes artistes, tes retours, tes coups de cœur. Le DJ s’en inspire.")
      } trailing: {
        LibraryLinkButton(title: "Régler mes avis", symbol: "slider.horizontal.3") {
          requestedPage = SettingsPage.taste.rawValue
          NSApp.activate(ignoringOtherApps: true)
          openSettings()
        }.help("Réglages → Goût : combien de temps un titre reste écarté")
      }
      .padding(.bottom, 24)
      if let overview = taste.overview {
        if isEmpty {
          TasteEmptyView(dislikeDays: overview.dislikeDays, explore: explore)
        } else {
          figures(overview.summary).padding(.bottom, 18)
          chips(overview).padding(.bottom, 22)
          content(overview)
        }
      } else if taste.loadingOverview {
        ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
      } else if !taste.error.isEmpty {
        EmptyState(
          symbol: "exclamationmark.triangle", message: taste.error,
          action: ("Réessayer", { Task { await taste.loadOverview() } }))
      }
    }
    .padding(.top, 28).padding(.horizontal, 32).padding(.bottom, 18)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .task { await taste.loadOverview() }
    // An opinion changes the categories: refresh once the clicks settle.
    .onChange(of: taste.opinions) { _, _ in
      refresh?.cancel()
      refresh = Task {
        try? await Task.sleep(for: .milliseconds(800))
        guard !Task.isCancelled else { return }
        await taste.loadOverview()
      }
    }
  }

  // MARK: Figures and filters

  private func figures(_ summary: TasteOverview.Summary) -> some View {
    HStack(spacing: 0) {
      figure(summary.tracks, summary.tracks > 1 ? "titres écoutés" : "titre écouté", first: true)
      SillageRule(vertical: true).padding(.vertical, -2)
      figure(summary.listens, summary.listens > 1 ? "écoutes" : "écoute")
      SillageRule(vertical: true).padding(.vertical, -2)
      figure(summary.liked, summary.liked > 1 ? "titres aimés" : "titre aimé")
      SillageRule(vertical: true).padding(.vertical, -2)
      figure(summary.hidden, summary.hidden > 1 ? "écartés pour l’instant" : "écarté pour l’instant")
    }
    .fixedSize(horizontal: false, vertical: true)
    .padding(.vertical, 15)
    .overlay(alignment: .top) { SillageRule() }
    .overlay(alignment: .bottom) { SillageRule() }
  }

  private func figure(_ value: Int, _ caption: String, first: Bool = false) -> some View {
    HStack(alignment: .firstTextBaseline, spacing: 10) {
      Text(value.formatted()).font(.system(size: 25, weight: .medium).monospacedDigit())
        .tracking(-0.8)
      Text(caption).font(.system(size: 11)).foregroundStyle(.secondary).lineLimit(1)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(.leading, first ? 0 : 22)
    .accessibilityElement(children: .combine)
  }

  private func chips(_ overview: TasteOverview) -> some View {
    ScrollView(.horizontal, showsIndicators: false) {
      HStack(spacing: 8) {
        ForEach(Filter.allCases) { item in
          TasteFilterChip(
            title: item.title,
            count: item == .all
              ? overview.tracks.count
              : overview.tracks.filter { $0.category == item.rawValue }.count,
            selected: filter == item
          ) { filter = item }
        }
      }
    }
  }

  // MARK: Artists and titles

  private func content(_ overview: TasteOverview) -> some View {
    GeometryReader { geometry in
      HStack(alignment: .top, spacing: 28) {
        if geometry.size.width >= 760 && !overview.artists.isEmpty {
          artists(overview).frame(width: 232)
        }
        tracks(overview)
      }
    }
  }

  /// The listener's first artist large, with the thumbnail of one of their titles.
  private func artists(_ overview: TasteOverview) -> some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack {
        Text("Tes artistes").font(.system(size: 15, weight: .semibold))
          .accessibilityAddTraits(.isHeader)
        Spacer()
        MonoLabel("Affinité", uppercase: false)
      }.frame(height: 22).padding(.bottom, 14)
      ScrollView(showsIndicators: false) {
        VStack(alignment: .leading, spacing: 0) {
          if let first = overview.artists.first {
            TasteFeaturedArtist(artist: first, cover: cover(for: first, in: overview))
              .padding(.bottom, 18)
              .overlay(alignment: .bottom) { SillageRule() }
              .padding(.bottom, 14)
          }
          ForEach(overview.artists.dropFirst().prefix(12)) { artist in
            TasteArtistRow(artist: artist, cover: cover(for: artist, in: overview))
              .padding(.bottom, 13)
          }
          Text("L’affinité vient de tes écoutes et de tes avis, sur 100.")
            .font(.system(size: 10)).foregroundStyle(.secondary).padding(.top, 4)
        }
      }
    }
  }

  private func cover(for artist: TasteOverview.Artist, in overview: TasteOverview) -> Track? {
    overview.tracks.first { $0.artist?.localizedCaseInsensitiveCompare(artist.name) == .orderedSame }?
      .track
  }

  private func tracks(_ overview: TasteOverview) -> some View {
    let shown = overview.tracks.filter { filter == .all || $0.category == filter.rawValue }
    return VStack(alignment: .leading, spacing: 0) {
      HStack(alignment: .firstTextBaseline, spacing: 6) {
        Text("Tes titres").font(.system(size: 15, weight: .semibold))
          .accessibilityAddTraits(.isHeader)
        Text(String(format: "%02d", shown.count)).font(.system(size: 10, design: .monospaced))
          .foregroundStyle(.secondary)
        Spacer()
        Text("Selon tes écoutes et tes avis").font(.system(size: 10)).foregroundStyle(.secondary)
      }.frame(height: 22).padding(.bottom, 14)
      TableHeaderRow {
        MonoLabel("Titre", uppercase: false).frame(maxWidth: .infinity, alignment: .leading)
        MonoLabel("Affinité", uppercase: false).frame(width: TasteColumns.affinity, alignment: .leading)
        MonoLabel("Écoutes", uppercase: false).frame(width: TasteColumns.listens, alignment: .trailing)
        MonoLabel("Ton avis", uppercase: false).frame(width: TasteColumns.opinion, alignment: .trailing)
      }
      ScrollView {
        LazyVStack(spacing: 0) {
          ForEach(shown) { item in
            TasteTableRow(
              item: item, taste: taste, playing: current?.id == item.id,
              onPlay: { play(item.track) }, onEnqueue: { enqueue(item.track) })
          }
          if shown.isEmpty {
            Text("Aucun titre dans cette catégorie.").font(.callout).foregroundStyle(.secondary)
              .padding(.vertical, 20)
          }
        }
      }
      // A legacy scroller would narrow the rows and shift their columns off the header.
      .scrollIndicators(.never)
      (Text("Un avis, un effet. ").fontWeight(.semibold).foregroundStyle(.primary)
        + Text(
          "« J’aime » guide le DJ. « Je n’aime pas » écarte un titre des propositions pendant \(overview.dislikeDays) jours. Il reste dans tes playlists et jouable à ta demande."
        ))
        .font(.system(size: 10)).foregroundStyle(.secondary).lineLimit(2).padding(.top, 12)
    }
  }
}

enum TasteColumns {
  static let affinity: CGFloat = 130
  static let listens: CGFloat = 52
  static let opinion: CGFloat = 64
}

/// A category chip with its count; the selection is ink on chalk, inverted.
private struct TasteFilterChip: View {
  let title: String
  let count: Int
  let selected: Bool
  let action: () -> Void
  var body: some View {
    Button(action: action) {
      HStack(spacing: 8) {
        Text(title).font(.system(size: 11, weight: selected ? .semibold : .medium))
        Text("\(count)").font(.system(size: 10, design: .monospaced)).opacity(0.72)
      }
      .foregroundStyle(selected ? Color.sillage(.canvas) : Color.secondary)
      .padding(.horizontal, 12).frame(height: 30)
      .background(Capsule().fill(selected ? Color.primary : Color.sillageHover))
      .contentShape(Capsule())
    }.buttonStyle(.plain)
      .accessibilityLabel("\(title), \(count)")
      .accessibilityAddTraits(selected ? .isSelected : [])
  }
}

/// The first artist: a wide cover, the name large, counts, affinity.
private struct TasteFeaturedArtist: View {
  let artist: TasteOverview.Artist
  let cover: Track?
  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      ZStack(alignment: .topLeading) {
        RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Color.primary.opacity(0.07))
        if let cover {
          Artwork.image(for: cover, quality: "hqdefault")
            .frame(maxWidth: .infinity).frame(height: 108).clipped()
        }
        Text("01").font(.system(size: 10, design: .monospaced)).foregroundStyle(.white)
          .padding(.horizontal, 6).padding(.vertical, 3)
          .background(.black.opacity(0.55), in: RoundedRectangle(cornerRadius: 4))
          .padding(8)
      }
      .frame(height: 108)
      .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
      .accessibilityHidden(true)
      .padding(.bottom, 13)
      ArtistLink(
        text: artist.name, font: .system(size: 22, weight: .semibold), color: .primary
      ).tracking(-0.65).padding(.bottom, 5)
      Text(detail(artist)).font(.system(size: 11)).foregroundStyle(.secondary)
        .padding(.bottom, 12)
      AffinityMeter(value: artist.affinity)
    }
    .accessibilityElement(children: .contain)
  }
}

private struct TasteArtistRow: View {
  let artist: TasteOverview.Artist
  let cover: Track?
  var body: some View {
    HStack(spacing: 11) {
      Group {
        if let cover {
          Artwork.image(for: cover, quality: "mqdefault")
        } else {
          Color.primary.opacity(0.07)
        }
      }
      .frame(width: 45, height: 45).clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
      .accessibilityHidden(true)
      VStack(alignment: .leading, spacing: 3) {
        ArtistLink(text: artist.name, font: .system(size: 13, weight: .semibold), color: .primary)
        Text(detail(artist)).font(.system(size: 11)).foregroundStyle(.secondary).lineLimit(1)
        AffinityMeter(value: artist.affinity).padding(.top, 3)
      }
    }
    .accessibilityElement(children: .contain)
  }
}

private func detail(_ artist: TasteOverview.Artist) -> String {
  "\(artist.tracks) titre\(artist.tracks > 1 ? "s" : "") · \(artist.listens) écoute\(artist.listens > 1 ? "s" : "")"
}

/// A title of Mon goût: song, category over its affinity, plays, opinion buttons.
private struct TasteTableRow: View {
  let item: TasteOverview.Item
  @ObservedObject var taste: TasteModel
  let playing: Bool
  let onPlay: () -> Void
  let onEnqueue: () -> Void
  @State private var hovering = false
  var body: some View {
    let track = item.track
    let name = TrackTitle(track)
    HStack(spacing: 12) {
      TableSongCell(
        track: track, name: name, subtitle: subtitle(name), playing: playing, onPlay: onPlay)
      VStack(alignment: .leading, spacing: 5) {
        Text(caption).font(.system(size: 11, weight: .medium)).lineLimit(1)
          .foregroundStyle(
            item.category == "favourite" ? Color.primary : Color.secondary)
        AffinityMeter(value: item.affinity)
      }
      .frame(width: TasteColumns.affinity, alignment: .leading)
      .accessibilityElement(children: .ignore)
      .accessibilityLabel("\(caption), affinité \(item.affinity) sur 100")
      Text("\(item.listens)").font(.system(size: 12).monospacedDigit())
        .foregroundStyle(.secondary).frame(width: TasteColumns.listens, alignment: .trailing)
        .accessibilityLabel("\(item.listens) écoute\(item.listens > 1 ? "s" : "")")
      TasteButtons(taste: taste, track: track, size: 26)
        .frame(width: TasteColumns.opinion, alignment: .trailing)
    }
    .modifier(
      TableRowFrame(
        track: track, name: name, playing: playing, onPlay: onPlay, onEnqueue: onEnqueue,
        hovering: $hovering)
    )
    .help(item.label ?? "")
  }

  private func subtitle(_ name: TrackTitle) -> String? {
    let artist = item.artist ?? name.artist
    guard item.category == "unconvinced" else { return artist }
    return [artist, "souvent passé vite"].compactMap { $0 }.joined(separator: " · ")
  }

  private var caption: String {
    if let days = item.daysLeft { return "Écarté · encore \(days) j" }
    return item.categoryTitle
  }
}

/// No listen yet: what builds the page, and a way back to the collection.
private struct TasteEmptyView: View {
  let dislikeDays: Int
  let explore: () -> Void
  var body: some View {
    ScrollView {
      VStack(spacing: 0) {
        RoundedRectangle(cornerRadius: 14, style: .continuous)
          .fill(Color.sillage(.primaryFill).opacity(0.16))
          .frame(width: 72, height: 72)
          .overlay {
            Image(systemName: "waveform").font(.system(size: 30))
              .foregroundStyle(Color.sillage(.actionText))
          }
          .accessibilityHidden(true)
          .padding(.bottom, 24)
        Text("Ton goût commence\npar un morceau.").font(.system(size: 28, weight: .semibold))
          .tracking(-0.8).multilineTextAlignment(.center).padding(.bottom, 16)
        Text(
          "Écoute ce qui te plaît, reviens sur tes titres préférés.\nTu retrouveras ici les artistes et les morceaux qui comptent pour toi."
        )
        .font(.system(size: 12)).foregroundStyle(.secondary).multilineTextAlignment(.center)
        .lineSpacing(6).padding(.bottom, 24)
        Button(action: explore) { Label("Explorer ma bibliothèque", systemImage: "play.fill") }
          .buttonStyle(LibraryPrimaryButtonStyle()).padding(.bottom, 42)
        HStack(alignment: .top, spacing: 40) {
          step(
            "play.rectangle", "Écoute à ton rythme",
            "Tes écoutes font apparaître tes premiers repères.")
          step(
            "hand.thumbsup", "Dis ce que tu aimes",
            "« J’aime » aide le DJ à proposer ce qui te ressemble.")
          step(
            "hand.thumbsdown", "Fais une pause sur un titre",
            "« Je n’aime pas » l’écarte des propositions pendant \(dislikeDays) jours.")
        }
        .padding(.top, 30)
        .overlay(alignment: .top) { SillageRule() }
        .frame(maxWidth: 760)
        Text("Tes avis ne modifient aucune playlist.").font(.system(size: 10))
          .foregroundStyle(.secondary).padding(.top, 34)
      }
      .frame(maxWidth: .infinity).padding(.top, 8)
    }
  }

  private func step(_ symbol: String, _ title: String, _ text: String) -> some View {
    VStack(alignment: .leading, spacing: 0) {
      Image(systemName: symbol).font(.system(size: 18)).foregroundStyle(.secondary)
        .padding(.bottom, 16).accessibilityHidden(true)
      Text(title).font(.system(size: 12, weight: .semibold)).padding(.bottom, 10)
      Text(text).font(.system(size: 11)).foregroundStyle(.secondary).lineSpacing(5)
        .fixedSize(horizontal: false, vertical: true)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .accessibilityElement(children: .combine)
  }
}
