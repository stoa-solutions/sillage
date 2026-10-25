import Combine
import Foundation
import RecallKit

/// Sends each finished play to the account's server history (`/v1/history`), a few seconds
/// after it happens and in batches. Failed uploads wait and retry; the outbox is in memory, so
/// plays still unsent when the app quits are lost. Reset before the account changes.
@MainActor final class HistorySync: ObservableObject {
  private var outbox = ListeningHistoryOutbox()
  private var watch: AnyCancellable?
  private var upload: Task<Void, Never>?
  private let session: Session

  init(session: Session, dj: DJModel) {
    self.session = session
    // Only history changes matter, not every chat or status update of the session.
    watch = dj.$listening.map(\.queue.history)
      .removeDuplicates { $0.map(\.id) == $1.map(\.id) }
      .sink { [weak self] history in
        self?.outbox.observe(history)
        self?.schedule(after: .seconds(5))
      }
  }

  func reset() {
    upload?.cancel()
    upload = nil
    outbox.reset()
  }

  private func schedule(after delay: Duration) {
    guard upload == nil, !outbox.pending.isEmpty else { return }
    upload = Task { [weak self] in
      try? await Task.sleep(for: delay)
      guard !Task.isCancelled, let self else { return }
      let sent = await self.flush()
      guard !Task.isCancelled else { return }
      self.upload = nil
      self.schedule(after: sent ? .seconds(5) : .seconds(60))
    }
  }

  /// One batch; true when the server accepted it.
  private func flush() async -> Bool {
    guard let connection = session.connection else { return false }
    let batch = outbox.nextBatch()
    guard !batch.isEmpty else { return true }
    do {
      try await HTTPClient().recordHistory(connection, batch)
      guard !Task.isCancelled else { return false }
      outbox.acknowledge(batch)
      return true
    } catch let error as HTTPServiceError
      where (400..<500).contains(error.status) && ![401, 408, 429].contains(error.status)
    {
      // The server will never accept this batch; keeping it would block every later play.
      outbox.acknowledge(batch)
      return true
    } catch {
      return false
    }
  }
}
