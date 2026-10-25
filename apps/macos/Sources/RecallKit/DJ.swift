import Foundation

/// One DJ turn: a request in, a verified reply and track choice out. The server runs it.
public protocol DJ: Sendable {
  func turn(_ request: DJRequest) async throws -> DJResponse
}

public struct DJRequest: Sendable {
  public let message: String
  public let history: [ChatMessage]
  /// Tracks already in the play queue. They are excluded unless the person asks for them again.
  public let queued: Set<String>
  public init(message: String, history: [ChatMessage], queued: Set<String>) {
    self.message = message
    self.history = history
    self.queued = queued
  }
}

/// The connected server runs the whole turn with its own key and rules.
public struct ServerDJ: DJ {
  let connection: Connection
  public init(connection: Connection) { self.connection = connection }
  public func turn(_ request: DJRequest) async throws -> DJResponse {
    let object = try await HTTPClient().server(
      connection, path: "dj/chat",
      body: [
        "message": String(request.message.prefix(1500)),
        "history": request.history.suffix(12).map { ["role": $0.role, "content": $0.content] },
        "excludeIds": Array(request.queued.prefix(100)),
      ])
    return try JSONDecoder().decode(
      DJResponse.self, from: JSONSerialization.data(withJSONObject: object))
  }
}
