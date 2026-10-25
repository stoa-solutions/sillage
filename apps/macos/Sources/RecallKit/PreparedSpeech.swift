import Foundation

/// One speculative utterance, held only in memory and scoped by the caller's session.
@MainActor
public final class PreparedSpeech {
  private var key: String?
  private var pending: Task<Data, Error>?
  public init() {}
  public func prepare(key: String, generate: @escaping () async throws -> Data) {
    guard self.key != key else { return }
    clear()
    self.key = key
    pending = Task { try await generate() }
  }
  public func take(key: String) async throws -> Data? {
    guard self.key == key, let pending else { return nil }
    self.key = nil
    self.pending = nil
    return try await pending.value
  }
  public func clear() {
    pending?.cancel()
    pending = nil
    key = nil
  }
}
