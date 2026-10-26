import Foundation

public struct JournalTrack: Codable, Sendable {
  public let id: String
  public let title: String
  public let channel: String?
  public init(_ track: Track) {
    id = track.id
    title = String(track.title.prefix(300))
    channel = track.channel.map { String($0.prefix(200)) }
  }
}
public struct JournalDiscovery: Codable, Sendable {
  public let id: String
  public let title: String
  public let channel: String?
  public let inLibrary: Bool
  init(_ item: DiscoveryItem) {
    id = item.id
    title = String(item.video.title.prefix(300))
    channel = item.video.channel.map { String($0.prefix(200)) }
    inLibrary = item.inLibrary
  }
}
public struct DJJournalEvent: Codable, Identifiable, Sendable {
  public let id: UUID
  public let sequence: Int
  public let occurredAt: String
  public let scope: DiscoveryScope
  public let visibleScope: DiscoveryScope
  public let kind: String
  public let role: String?
  public let content: String?
  public let action: String?
  public let requestId: UUID?
  public let current: JournalTrack?
  public let queueIds: [String]
  public let discoveries: [JournalDiscovery]?
  public let sources: [InformationSource]?
}

/// The visible chat can trim old messages; this bounded outbox keeps unsent events apart.
public struct DJJournalBuffer: Sendable {
  public private(set) var conversationId = UUID()
  public private(set) var pending: [DJJournalEvent] = []
  public private(set) var dropped = 0
  private var sequence = 0
  public init() {}
  public mutating func reset() { self = DJJournalBuffer() }
  public mutating func acknowledge(_ ids: Set<UUID>) { pending.removeAll { ids.contains($0.id) } }

  public mutating func capture(
    before: [ChatMessage], after: [ChatMessage], action: String?, scope: DiscoveryScope,
    visibleScope: DiscoveryScope, requestId: UUID?, current: Track?, upcoming: [Track],
    now: Date = Date()
  ) {
    let existing = Set(before.map(\.id))
    let fresh = after.filter { !existing.contains($0.id) }
    guard !fresh.isEmpty || action != nil else { return }
    let date = ISO8601DateFormatter().string(from: now)
    let track = current.map(JournalTrack.init)
    let queue = Array(upcoming.prefix(100).map(\.id))
    for message in fresh {
      sequence += 1
      pending.append(
        DJJournalEvent(
          id: message.id, sequence: sequence, occurredAt: date, scope: scope,
          visibleScope: visibleScope,
          kind: "message", role: message.role, content: String(message.content.prefix(8192)),
          action: nil,
          requestId: requestId, current: track, queueIds: queue,
          discoveries: message.discoveries.map { Array($0.prefix(8).map(JournalDiscovery.init)) },
          sources: message.sources.map { Array($0.prefix(5)) }))
    }
    if let action {
      sequence += 1
      pending.append(
        DJJournalEvent(
          id: UUID(), sequence: sequence, occurredAt: date, scope: scope,
          visibleScope: visibleScope,
          kind: "action", role: nil, content: nil, action: action, requestId: requestId,
          current: track, queueIds: queue, discoveries: nil, sources: nil))
    }
    if pending.count > 1000 {
      dropped += pending.count - 1000
      pending = Array(pending.suffix(1000))
    }
  }
}

extension HTTPClient {
  public func recordConversation(
    _ connection: Connection, conversationId: UUID, events: [DJJournalEvent]
  ) async throws {
    let data = try JSONEncoder().encode(events)
    let payload = try JSONSerialization.jsonObject(with: data)
    _ = try await server(
      connection, path: "dj/conversations/\(conversationId.uuidString.lowercased())/events",
      body: ["events": payload])
  }
}
