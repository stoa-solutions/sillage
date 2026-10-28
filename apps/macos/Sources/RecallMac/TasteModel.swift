import Foundation
import RecallKit

/// 👍 / 👎 on the tracks of this account, and how long a 👎 keeps a track out of proposals.
/// Opinions are shown at once and sent in the background; a failure restores the previous one.
@MainActor
final class TasteModel: ObservableObject {
  @Published private(set) var opinions: [String: TrackOpinion] = [:]
  @Published private(set) var dislikeDays = TasteLimits.defaultDislikeDays
  @Published var error = ""
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
    error = ""
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
        guard started == epoch, opinions[videoId] == next else { return }
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
      guard started == epoch else { return }
      dislikeDays = previous
      self.error = error.localizedDescription
    }
  }
}
