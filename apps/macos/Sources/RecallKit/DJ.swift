import Foundation

/// One DJ turn: a request in, a verified reply and track choice out. The server runs it.
public protocol DJ: Sendable {
  func turn(_ request: DJRequest) async throws -> DJResponse
}

public struct DJRequest: Sendable {
  public var scope: DiscoveryScope = .library
  public var playbackContext: DJPlaybackContext?
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
        "Continue cette session avec de nouveaux vrais morceaux dans la même ambiance ou du même artiste. Consulte les sources autorisées avec des recherches courtes et plusieurs formulations si nécessaire. Ajoute cinq nouveaux morceaux sans répéter les titres déjà joués ou en file. Ne rejoue pas la liste précédente. Si aucun morceau ne convient, explique-le sans inventer. Exclue les type beats et hommages sauf demande explicite.",
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
    var body: [String: Any] = [
      "message": String(request.message.prefix(1500)), "scope": request.scope.rawValue,
      "history": request.history.suffix(12).map {
        ["role": $0.role, "content": String($0.contextContent.prefix(2000))]
      },
      "excludeIds": Array(request.queued.prefix(100)),
    ]
    if let context = request.playbackContext {
      body["playbackContext"] = try JSONSerialization.jsonObject(
        with: JSONEncoder().encode(context))
    }
    let object = try await HTTPClient().server(connection, path: "dj/chat", body: body)
    return try JSONDecoder().decode(
      DJResponse.self, from: JSONSerialization.data(withJSONObject: object))
  }
}

/// Only unambiguous transport commands bypass a provider; named songs still use search.
public enum DJTransportCommand: Sendable {
  case next, pause, resume
  public static func parse(_ text: String) -> Self? {
    let normalized = text.folding(
      options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "fr_FR")
    )
    .components(separatedBy: CharacterSet.alphanumerics.inverted).filter { !$0.isEmpty }.joined(
      separator: " ")
    let command = normalized.replacingOccurrences(of: " s il te plait", with: "")
      .replacingOccurrences(of: " stp", with: "")
    if [
      "next", "suivant", "suivante", "morceau suivant", "titre suivant", "passe au suivant",
      "passe au morceau suivant", "change de morceau", "skip",
      "passe a la suivante", "mets la suivante", "mets le suivant", "passe la musique",
      "passe au prochain", "chanson suivante",
    ].contains(command) {
      return .next
    }
    if [
      "pause", "mets en pause", "met en pause", "mets la musique en pause", "arrete", "stop",
      "stoppe la musique",
    ].contains(command) {
      return .pause
    }
    if [
      "reprends", "reprend", "reprends la musique", "reprends la lecture", "relance la lecture",
      "lecture", "play", "mets play", "met play", "tu peux mettre play", "resume",
      "continue la lecture",
    ].contains(command) {
      return .resume
    }
    return nil
  }
}
