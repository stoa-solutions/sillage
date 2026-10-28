import Foundation
import SillageKit

/// Sends private diagnostics independently of music, voice and agent requests.
@MainActor
final class DJJournal {
  private(set) var buffer = DJJournalBuffer()
  private var connection: Connection?
  private var task: Task<Void, Never>?
  private var generation = UUID()
  var onSyncIssue: ((Bool) -> Void)?
  var conversationId: UUID { buffer.conversationId }

  func reset() {
    generation = UUID()
    task?.cancel()
    task = nil
    connection = nil
    buffer.reset()
  }
  func use(_ value: Connection?) {
    if value?.token != connection?.token || value?.url != connection?.url {
      reset()
      connection = value
    }
  }
  func capture(
    before: [ChatMessage], after: [ChatMessage], action: String?, scope: DiscoveryScope,
    visibleScope: DiscoveryScope, requestId: UUID?, current: Track?, upcoming: [Track]
  ) {
    guard connection != nil else { return }
    let dropped = buffer.dropped
    buffer.capture(
      before: before, after: after, action: action, scope: scope, visibleScope: visibleScope,
      requestId: requestId, current: current, upcoming: upcoming)
    if buffer.dropped > dropped { onSyncIssue?(true) }
    flush()
  }
  private func flush() {
    guard task == nil, !buffer.pending.isEmpty, let connection else { return }
    let generation = generation
    task = Task { [weak self] in
      var failures = 0
      do { try await Task.sleep(for: .milliseconds(250)) } catch { return }
      while !Task.isCancelled {
        guard let batch = self?.batch(for: generation) else { break }
        do {
          try await HTTPClient().recordConversation(
            connection, conversationId: batch.0, events: batch.1)
          guard self?.generation == generation, !Task.isCancelled else { return }
          self?.buffer.acknowledge(Set(batch.1.map(\.id)))
          if failures > 0 { self?.onSyncIssue?(false) }
          failures = 0
        } catch {
          guard self?.generation == generation, !Task.isCancelled else { return }
          failures += 1
          if failures == 3 { self?.onSyncIssue?(true) }
          do { try await Task.sleep(for: .seconds(min(30, 1 << min(failures, 5)))) } catch {
            return
          }
        }
      }
      if self?.generation == generation { self?.task = nil }
    }
  }
  private func batch(for generation: UUID) -> (UUID, [DJJournalEvent])? {
    guard self.generation == generation, !buffer.pending.isEmpty else { return nil }
    return (buffer.conversationId, Array(buffer.pending.prefix(50)))
  }
  deinit { task?.cancel() }
}
