import Foundation

/// One DJ turn: a request in, a verified reply and track choice out. The server runs it.
public protocol DJ: Sendable {
  func turn(_ request: DJRequest) async throws -> DJResponse
}

public struct DJRequest: Sendable {
  public var scope: DiscoveryScope = .library
  public let message: String
  public let history: [ChatMessage]
  /// Tracks already in the play queue. They are excluded unless the person asks for them again.
  public let queued: Set<String>
  /// Keep prior title lists in conversational context, never in the new command.
  /// The catalog's exact-title resolver must not interpret a refill as another ordered request.
  public static func continuation(
    context: String, history: [ChatMessage], queued: Set<String>
  ) -> DJRequest {
    let contextMessage = ChatMessage(
      role: "user", content: "Mon envie musicale de référence : " + context)
    return DJRequest(
      message:
        "Continue cette session avec de nouveaux vrais morceaux dans la même ambiance ou du même artiste. Consulte les sources autorisées avec des recherches courtes et plusieurs formulations si nécessaire. Ajoute une petite suite sans répéter les titres déjà joués ou en file. Ne rejoue pas la liste précédente. Si aucun morceau ne convient, explique-le sans inventer. Exclue les type beats et hommages sauf demande explicite.",
      history: Array(history.suffix(10)) + [contextMessage], queued: queued)
  }
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
        "message": String(request.message.prefix(1500)), "scope": request.scope.rawValue,
        "history": request.history.suffix(12).map { ["role": $0.role, "content": $0.content] },
        "excludeIds": Array(request.queued.prefix(100)),
      ])
    return try JSONDecoder().decode(
      DJResponse.self, from: JSONSerialization.data(withJSONObject: object))
  }
}

/// Only unambiguous transport commands bypass a provider; named songs still use search.
public enum DJTransportCommand: Sendable {
  case next
  public static func parse(_ text: String) -> Self? {
    let normalized = text.folding(
      options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "fr_FR")
    )
    .components(separatedBy: CharacterSet.alphanumerics.inverted).filter { !$0.isEmpty }.joined(
      separator: " ")
    let command = normalized.replacingOccurrences(of: " s il te plait", with: "")
      .replacingOccurrences(of: " stp", with: "")
    return [
      "next", "suivant", "suivante", "morceau suivant", "titre suivant", "passe au suivant",
      "passe au morceau suivant", "change de morceau", "skip",
    ].contains(command) ? .next : nil
  }
}
