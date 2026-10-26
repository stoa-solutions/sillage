import RecallKit
import SwiftUI

/// The account's listening history read from the server, newest first, page by page.
@MainActor final class ListeningHistoryModel: ObservableObject {
  @Published private(set) var plays: [ListenedTrack] = []
  @Published private(set) var loading = false
  @Published private(set) var reachedEnd = false
  @Published private(set) var error = ""
  private var task: Task<Void, Never>?
  private var generation: UUID?
  static let pageSize = 50

  /// Plays under « Aujourd’hui », « Hier » or their date, keeping their order.
  static func days(_ plays: [ListenedTrack]) -> [(title: String, plays: [ListenedTrack])] {
    let calendar = Calendar.current
    var groups: [(title: String, plays: [ListenedTrack])] = []
    for listened in plays {
      let title =
        calendar.isDateInToday(listened.playedAt)
        ? "Aujourd’hui"
        : calendar.isDateInYesterday(listened.playedAt)
          ? "Hier"
          : listened.playedAt.formatted(.dateTime.weekday(.wide).day().month(.wide))
            .capitalized(with: Locale(identifier: "fr_FR"))
      if groups.last?.title == title {
        groups[groups.count - 1].plays.append(listened)
      } else {
        groups.append((title, [listened]))
      }
    }
    return groups
  }

  /// From the newest play, or the next page when `more` is set.
  func load(_ session: Session, more: Bool = false) {
    if more && (loading || reachedEnd) { return }
    guard let connection = session.connection else {
      plays = []
      return
    }
    // Another account's plays never stay on screen.
    if generation != session.generation {
      plays = []
      reachedEnd = false
    }
    let current = session.generation
    generation = current
    let last = more ? plays.last : nil
    task?.cancel()
    loading = true
    task = Task {
      defer { if !Task.isCancelled { loading = false } }
      do {
        let page = try await HTTPClient().history(
          connection, limit: Self.pageSize, after: last)
        try Task.checkCancellation()
        guard session.generation == current else { return }
        plays = more ? plays + page : page
        reachedEnd = page.count < Self.pageSize
        error = ""
      } catch {
        guard !Task.isCancelled, session.generation == current else { return }
        self.error = "Historique indisponible. " + error.localizedDescription
      }
    }
  }

  /// Forgets the shown plays at once, before another account's session starts.
  func reset() {
    task?.cancel()
    plays = []
    loading = false
    reachedEnd = false
    error = ""
    generation = nil
  }

  /// After an upload: the newest page is merged on top, pages already loaded stay.
  func refreshNewest(_ session: Session) {
    guard let connection = session.connection, !plays.isEmpty, !loading else {
      if plays.isEmpty { load(session) }
      return
    }
    let current = session.generation
    guard generation == current else { return load(session) }
    Task {
      guard let page = try? await HTTPClient().history(connection, limit: Self.pageSize),
        session.generation == current, generation == current
      else { return }
      let known = Set(plays.map(\.id))
      plays = page.filter { !known.contains($0.id) } + plays
    }
  }

  func clear(_ session: Session) {
    guard let connection = session.connection else { return }
    let current = session.generation
    Task {
      do {
        try await HTTPClient().clearHistory(connection)
        guard session.generation == current else { return }
        plays = []
        reachedEnd = true
        session.notice = "Historique d’écoute effacé."
      } catch {
        guard session.generation == current else { return }
        self.error = "Impossible d’effacer l’historique. " + error.localizedDescription
      }
    }
  }
}

/// Écoutes récentes: plays grouped by day, each one playable again.
struct ListeningHistoryView: View {
  @ObservedObject var model: ListeningHistoryModel
  let play: (Track) -> Void
  let enqueue: (Track) -> Void
  let clear: () -> Void
  let refresh: () -> Void
  let loadMore: () -> Void
  @EnvironmentObject var dj: DJModel
  @State private var confirming = false

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      header.padding(.horizontal, 16).padding(.top, 12).padding(.bottom, 8)
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 0, pinnedViews: []) {
          ForEach(days, id: \.title) { day in
            Text(day.title).font(.headline).padding(.horizontal, 10).padding(.top, 14)
              .padding(.bottom, 4)
            ForEach(day.plays) { listened in
              HistoryRow(
                listened: listened, playing: dj.current?.id == listened.track.id,
                onPlay: { play(listened.track) }, onEnqueue: { enqueue(listened.track) }
              )
              .onAppear { if listened.id == model.plays.last?.id { loadMore() } }
            }
          }
          if model.loading && !model.plays.isEmpty {
            ProgressView().controlSize(.small).padding(12).frame(maxWidth: .infinity)
          }
        }.padding(.horizontal, 10).padding(.bottom, 12)
      }
      .overlay {
        if model.plays.isEmpty {
          if model.loading {
            ProgressView()
          } else if !model.error.isEmpty {
            EmptyState(
              symbol: "exclamationmark.triangle", message: model.error,
              action: ("Réessayer", refresh))
          } else {
            EmptyState(
              symbol: "clock.arrow.circlepath",
              message:
                "Tes écoutes apparaîtront ici dès la fin d’un titre ou quand tu passes au suivant.")
          }
        }
      }
    }
    .confirmationDialog(
      "Effacer tout l’historique d’écoute ?", isPresented: $confirming, titleVisibility: .visible
    ) {
      Button("Effacer", role: .destructive, action: clear)
    } message: {
      Text(
        "Il est supprimé du serveur pour ton compte. Ta bibliothèque et tes playlists ne changent pas."
      )
    }
  }

  private var header: some View {
    HStack(alignment: .center, spacing: 12) {
      PlaylistTile(title: "Écoutes récentes", symbol: "clock.arrow.circlepath", size: 48)
      VStack(alignment: .leading, spacing: 2) {
        Text("Écoutes récentes").font(.system(size: 22, weight: .semibold)).lineLimit(1)
          .accessibilityAddTraits(.isHeader)
        Text("Enregistrées sur ton compte, de la plus récente à la plus ancienne.")
          .font(.system(size: 12)).foregroundStyle(.secondary)
      }
      Spacer()
      IconButton(symbol: "arrow.clockwise", help: "Actualiser", action: refresh)
        .disabled(model.loading)
      Menu {
        Button("Effacer l’historique…", systemImage: "trash", role: .destructive) {
          confirming = true
        }.disabled(model.plays.isEmpty)
      } label: {
        Image(systemName: "ellipsis").frame(width: 26, height: 26)
          .contentShape(Rectangle())
      }.menuStyle(.button).buttonStyle(.plain).menuIndicator(.hidden).fixedSize()
        .foregroundStyle(.secondary).help("Plus d’actions")
        .accessibilityLabel("Plus d’actions pour l’historique")
    }
  }

  private var days: [(title: String, plays: [ListenedTrack])] {
    ListeningHistoryModel.days(model.plays)
  }
}

/// A play: artwork, song and artist, how it ended, and the time. Compact puts the last two
/// under the artist, for the DJ panel.
struct HistoryRow: View {
  let listened: ListenedTrack
  let playing: Bool
  var compact = false
  let onPlay: () -> Void
  let onEnqueue: () -> Void
  @State private var hovering = false
  var body: some View {
    let name = TrackTitle(listened.track)
    HStack(spacing: 12) {
      Button(action: onPlay) {
        Artwork(track: listened.track, showsDuration: false).frame(width: compact ? 56 : 64)
          .overlay {
            if hovering {
              Image(systemName: "play.fill").foregroundStyle(.white)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(.black.opacity(0.35), in: RoundedRectangle(cornerRadius: 6))
            }
          }
      }.buttonStyle(.plain).accessibilityHidden(true)
      VStack(alignment: .leading, spacing: 2) {
        Text(name.title).fontWeight(.medium).lineLimit(1)
          .foregroundStyle(playing ? Color.sillage(.playingText) : Color.primary)
        Text(name.artist ?? listened.track.channel ?? "YouTube").font(.callout)
          .foregroundStyle(.secondary).lineLimit(1)
        if compact {
          Text(
            "\(outcome) à " + listened.playedAt.formatted(date: .omitted, time: .shortened)
          ).font(.caption).foregroundStyle(.tertiary)
        }
      }.frame(maxWidth: .infinity, alignment: .leading)
      HStack(spacing: 2) {
        if hovering {
          IconButton(symbol: "text.badge.plus", help: "Lire ensuite", action: onEnqueue)
        }
      }.frame(width: 28)
      if !compact {
        Text(outcome).font(.caption).foregroundStyle(.secondary).frame(
          width: 80, alignment: .trailing)
        Text(listened.playedAt.formatted(date: .omitted, time: .shortened))
          .font(.callout.monospacedDigit()).foregroundStyle(.secondary)
          .frame(width: 50, alignment: .trailing)
      }
    }
    .padding(.horizontal, 10).padding(.vertical, 6)
    .background(RoundedRectangle(cornerRadius: 8).fill(hovering ? Color.sillageHover : .clear))
    .contentShape(Rectangle())
    .onHover { hovering = $0 }
    .onTapGesture(count: 2, perform: onPlay)
    .accessibilityElement(children: .combine)
    .accessibilityLabel(
      "\(name.title), \(name.artist ?? ""), \(outcome), "
        + listened.playedAt.formatted(date: .abbreviated, time: .shortened)
    )
    .accessibilityAction(named: "Lire", onPlay)
    .accessibilityAction(named: "Lire ensuite", onEnqueue)
  }
  private var outcome: String {
    switch listened.outcome {
    case .finished: "Écouté"
    case .skipped: "Passé"
    case .unavailable: "Indisponible"
    case .replaced: "Interrompu"
    }
  }
}
