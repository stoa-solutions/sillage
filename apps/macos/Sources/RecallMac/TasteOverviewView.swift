import RecallKit
import SwiftUI

/// Bibliothèque → Mon goût: what the listener's plays and opinions say, in the Library's own
/// layout. The score stays on the server; the page shows its category and a 0–100 affinity.
struct TasteOverviewView: View {
  @ObservedObject var taste: TasteModel
  let current: Track?
  let play: (Track) -> Void
  let enqueue: (Track) -> Void
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

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 22) {
        header
        if let overview = taste.overview {
          if overview.summary.tracks == 0 && overview.tracks.isEmpty {
            EmptyState(
              symbol: "waveform",
              message:
                "Ton goût se dessinera dès tes premières écoutes. Les boutons J’aime et Je n’aime pas l’affinent."
            )
          } else {
            figures(overview.summary)
            if !overview.artists.isEmpty { artists(overview.artists) }
            tracks(overview)
          }
        } else if taste.loadingOverview {
          ProgressView().frame(maxWidth: .infinity).padding(40)
        } else if !taste.error.isEmpty {
          EmptyState(
            symbol: "exclamationmark.triangle", message: taste.error,
            action: ("Réessayer", { Task { await taste.loadOverview() } }))
        }
      }
      .padding(.horizontal, 16).padding(.vertical, 14)
    }
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

  private var header: some View {
    HStack(alignment: .center, spacing: 12) {
      PlaylistTile(title: "Mon goût", symbol: "waveform", size: 56)
      VStack(alignment: .leading, spacing: 2) {
        Text("Mon goût").font(.system(size: 22, weight: .medium)).accessibilityAddTraits(.isHeader)
        Text("Ce que tes écoutes et tes avis disent de toi. Le DJ s’en sert pour ses propositions.")
          .font(.system(size: 12)).foregroundStyle(.secondary)
      }
      Spacer(minLength: 0)
    }
  }

  private func figures(_ summary: TasteOverview.Summary) -> some View {
    HStack(spacing: 0) {
      figure(summary.tracks, "titres écoutés")
      figure(summary.listens, "écoutes complètes")
      figure(summary.liked, "titres aimés")
      figure(summary.hidden, "écartés pour l’instant")
    }
    .padding(.vertical, 12)
    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.sillageHover))
  }

  private func figure(_ value: Int, _ caption: String) -> some View {
    VStack(spacing: 2) {
      Text(value.formatted()).font(.system(size: 22, weight: .semibold).monospacedDigit())
      Text(caption).font(.system(size: 12)).foregroundStyle(.secondary)
    }
    .frame(maxWidth: .infinity)
    .accessibilityElement(children: .combine)
  }

  private func artists(_ artists: [TasteOverview.Artist]) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      SectionHeader("Tes artistes")
      LazyVGrid(
        columns: [GridItem(.flexible(), spacing: 24), GridItem(.flexible(), spacing: 24)],
        alignment: .leading, spacing: 10
      ) {
        ForEach(artists) { artist in
          VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
              Text(artist.name).font(.system(size: 13, weight: .medium)).lineLimit(1)
              Spacer(minLength: 8)
              Text(
                "\(artist.tracks) titre\(artist.tracks > 1 ? "s" : "") · \(artist.listens) écoute\(artist.listens > 1 ? "s" : "")"
              )
              .font(.system(size: 11).monospacedDigit()).foregroundStyle(.secondary)
            }
            AffinityBar(value: artist.affinity)
          }
          .accessibilityElement(children: .ignore)
          .accessibilityLabel("\(artist.name), affinité \(artist.affinity) sur 100")
        }
      }
    }
  }

  private func tracks(_ overview: TasteOverview) -> some View {
    let shown = overview.tracks.filter { filter == .all || $0.category == filter.rawValue }
    return VStack(alignment: .leading, spacing: 8) {
      SectionHeader("Tes titres", count: shown.count)
      ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: 6) {
          ForEach(Filter.allCases) { item in
            Button(item.title) { filter = item }
              .buttonStyle(SillageChipStyle(selected: filter == item))
              .accessibilityAddTraits(filter == item ? .isSelected : [])
          }
        }
      }
      LazyVStack(spacing: 0) {
        ForEach(Array(shown.enumerated()), id: \.element.id) { index, item in
          SongRow(
            index: index + 1, track: item.track, playing: current?.id == item.id,
            onPlay: { play(item.track) }, onEnqueue: { enqueue(item.track) },
            accessory: AnyView(TasteAccessory(item: item, taste: taste)),
            note: item.label, accessoryWidth: 250)
        }
        if shown.isEmpty {
          Text("Aucun titre dans cette catégorie.").font(.callout).foregroundStyle(.secondary)
            .padding(.vertical, 20)
        }
      }
      .padding(.horizontal, -8)
    }
  }
}

/// Category, affinity and the two opinion buttons at the end of a row.
private struct TasteAccessory: View {
  let item: TasteOverview.Item
  @ObservedObject var taste: TasteModel
  var body: some View {
    HStack(spacing: 10) {
      VStack(alignment: .leading, spacing: 4) {
        Text(caption).font(.system(size: 11, weight: .medium))
          .foregroundStyle(item.category == "favourite" ? Color.recall : .secondary)
          .lineLimit(1)
        AffinityBar(value: item.affinity).frame(width: 110)
      }
      .frame(width: 150, alignment: .leading)
      .accessibilityElement(children: .ignore)
      .accessibilityLabel("\(caption), affinité \(item.affinity) sur 100")
      TasteButtons(taste: taste, track: item.track, size: 26)
    }
  }
  private var caption: String {
    if let days = item.daysLeft { return "Écarté encore \(days) j" }
    return item.categoryTitle
  }
}

/// A thin 0–100 bar: neutral track, orange fill. The number is read by VoiceOver.
struct AffinityBar: View {
  let value: Int
  var body: some View {
    GeometryReader { geometry in
      ZStack(alignment: .leading) {
        Capsule().fill(Color.primary.opacity(0.1))
        Capsule().fill(Color.sillage(.primaryFill))
          .frame(width: geometry.size.width * CGFloat(min(max(value, 0), 100)) / 100)
      }
    }
    .frame(height: 4)
    .accessibilityHidden(true)
  }
}
