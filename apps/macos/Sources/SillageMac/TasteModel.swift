import Foundation
import SillageKit

/// « J’aime » and « Je n’aime pas » on the tracks of this account, how long a dislike keeps a
/// track out of proposals, and the taste overview shown in the Library.
/// Opinions are shown at once and sent in the background; a failure restores the previous one.
@MainActor
final class TasteModel: ObservableObject {
  @Published private(set) var opinions: [String: TrackOpinion] = [:]
  @Published private(set) var dislikeDays = TasteLimits.defaultDislikeDays
  @Published var error = ""
  @Published private(set) var overview: TasteOverview?
  @Published private(set) var loadingOverview = false
  private var loaded: Set<String> = []
  private let session: Session
  /// Bumped when the account changes: an answer for the previous account must not land here.
  private var epoch = 0

  init(session: Session) { self.session = session }

  func opinion(_ videoId: String) -> TrackOpinion? { opinions[videoId] }

  func reset() {
    epoch += 1
    opinions = [:]
    loaded = []
    dislikeDays = TasteLimits.defaultDislikeDays
    overview = nil
    error = ""
  }

  func loadOverview() async {
    guard let connection = session.connection else { return }
    let started = epoch
    loadingOverview = true
    defer { if started == epoch { loadingOverview = false } }
    do {
      let value = try await HTTPClient().tasteOverview(connection)
      guard started == epoch else { return }
      overview = value
      dislikeDays = value.dislikeDays
      for item in value.tracks {
        opinions[item.id] = item.opinion.flatMap(TrackOpinion.init(rawValue:))
        loaded.insert(item.id)
      }
      error = ""
    } catch {
      // A page left while loading cancels its request: that is not an error to show.
      if started == epoch && !Self.cancelled(error) { self.error = error.localizedDescription }
    }
  }

  private static func cancelled(_ error: Error) -> Bool {
    error is CancellationError || (error as? URLError)?.code == .cancelled
  }

  /// The opinion of a track as the server has it, once per track and account.
  func load(_ videoId: String) async {
    guard let connection = session.connection, !loaded.contains(videoId) else { return }
    let started = epoch
    let opinion = try? await HTTPClient().trackOpinion(connection, videoId: videoId)
    guard started == epoch else { return }
    loaded.insert(videoId)
    opinions[videoId] = opinion
  }

  /// Pressing the active opinion again withdraws it.
  func toggle(_ opinion: TrackOpinion, for videoId: String) {
    guard let connection = session.connection else {
      error = "Connecte ton compte pour donner ton avis."
      return
    }
    let previous = opinions[videoId]
    let next = previous == opinion ? nil : opinion
    opinions[videoId] = next
    loaded.insert(videoId)
    let started = epoch
    Task {
      do {
        try await HTTPClient().setTrackOpinion(connection, videoId: videoId, next)
        if started == epoch { error = "" }
      } catch {
        guard started == epoch, opinions[videoId] == next, !Self.cancelled(error) else { return }
        opinions[videoId] = previous
        self.error = error.localizedDescription
      }
    }
  }

  func loadSettings() async {
    guard let connection = session.connection else { return }
    let started = epoch
    guard let days = try? await HTTPClient().dislikeDays(connection), started == epoch else {
      return
    }
    dislikeDays = days
  }

  func saveDislikeDays(_ days: Int) async {
    guard let connection = session.connection else { return }
    let started = epoch
    let previous = dislikeDays
    dislikeDays = days
    do {
      let saved = try await HTTPClient().saveDislikeDays(connection, days)
      if started == epoch { dislikeDays = saved }
    } catch {
      guard started == epoch, !Self.cancelled(error) else { return }
      dislikeDays = previous
      self.error = error.localizedDescription
    }
  }
}
