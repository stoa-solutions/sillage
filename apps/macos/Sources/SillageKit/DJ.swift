import Foundation

/// One DJ turn: a request in, a verified reply and track choice out. The server runs it.
public protocol DJ: Sendable {
  func turn(_ request: DJRequest) async throws -> DJResponse
}

/// The last visible choices are clues for follow-ups, not the song currently playing.
public struct DJDiscoveryContext: Codable, Sendable {
  public let id: String
  public let title: String
  public let channel: String
  public init(_ track: Track) {
    id = track.id
    title = String(track.title.prefix(300))
    channel = String((track.channel ?? "").prefix(200))
  }
}

public enum DJTrigger: String, Sendable { case user, continuation }

/// A refill the server plans from its count, whatever the accompanying text says.
public struct DJContinuation: Sendable, Equatable {
  public var count: Int
  /// Search further than the playing artist after an empty first attempt.
  public var broaden: Bool
  public init(count: Int = 5, broaden: Bool = false) {
    self.count = min(8, max(1, count))
    self.broaden = broaden
  }
}

/// Same bound as the server's DJ_SELECTION_LIMIT: tracks or cards in one answer, `/suite` counts.
public enum DJLimits {
  public static let selection = 20
}

public struct DJRequest: Sendable {
  public var conversationId: UUID?
  public var requestId: UUID?
  public var trigger: DJTrigger = .user
  public var continuation: DJContinuation?
  public var scope: DiscoveryScope = .library
  /// The agent chosen on this Mac; the server falls back to its default for an unknown one.
  public var agentId: String?
  public var playbackContext: DJPlaybackContext?
  /// Explicitly rejected suggestions, unlike songs merely queued or previously played.
  public var rejectedIds: [String] = []
  public var discoveryContext: [DJDiscoveryContext] = []
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
    let object = try await HTTPClient().server(
      connection, path: "dj/chat", body: Self.body(for: request))
    return try JSONDecoder().decode(
      DJResponse.self, from: JSONSerialization.data(withJSONObject: object))
  }
  /// The JSON sent to `/v1/dj/chat`, apart so the contract can be checked without a server.
  public static func body(for request: DJRequest) throws -> [String: Any] {
    var body: [String: Any] = [
      "message": String(request.message.prefix(1500)), "scope": request.scope.rawValue,
      "history": request.history.suffix(12).map {
        ["role": $0.role, "content": String($0.contextContent.prefix(2000))]
      },
      "excludeIds": Array(request.queued.prefix(100)),
    ]
    body["rejectedIds"] = Array(request.rejectedIds.suffix(100))
    body["conversationId"] = request.conversationId?.uuidString.lowercased()
    body["requestId"] = request.requestId?.uuidString.lowercased()
    body["trigger"] = request.trigger.rawValue
    if let agentId = request.agentId { body["agentId"] = agentId }
    if let continuation = request.continuation {
      body["continuation"] = ["count": continuation.count, "broaden": continuation.broaden]
    }
    if !request.discoveryContext.isEmpty {
      body["discoveryContext"] = try JSONSerialization.jsonObject(
        with: JSONEncoder().encode(Array(request.discoveryContext.prefix(DJLimits.selection))))
    }
    if let context = request.playbackContext {
      body["playbackContext"] = try JSONSerialization.jsonObject(
        with: JSONEncoder().encode(context))
    }
    return body
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
    // Match the whole utterance after removing only conversational framing. Never infer
    // transport from a keyword in a song title, a negation, or a compound request.
    let words = Set(normalized.split(separator: " "))
    guard words.isDisjoint(with: ["pas", "jamais", "non", "sans", "ne", "n", "not", "don", "dont"])
    else { return nil }
    var command = normalized
    for suffix in [" s il te plait", " s il vous plait", " stp", " svp"] {
      if command.hasSuffix(suffix) { command.removeLast(suffix.count) }
    }
    for prefix in [
      "est ce que tu peux ", "tu peux ", "peux tu ", "pourrais tu ", "je veux que tu ",
    ] {
      if command.hasPrefix(prefix) {
        command.removeFirst(prefix.count)
        break
      }
    }
    if [
      "next", "suivant", "suivante", "morceau suivant", "titre suivant", "passe au suivant",
      "passe au morceau suivant", "change de morceau", "skip",
      "passe a la suivante", "mets la suivante", "mets le suivant", "passe la musique",
      "passe au prochain", "chanson suivante", "passer au suivant", "passer a la suivante",
      "passer au morceau suivant", "mettre le suivant", "mettre la suivante", "changer de morceau",
      "change de musique", "changer de musique", "passe a la prochaine", "mets le prochain",
      "passer au prochain",
    ].contains(command) {
      return .next
    }
    if [
      "pause", "mets en pause", "met en pause", "mets la musique en pause", "arrete", "stop",
      "stoppe la musique", "stop la musique", "mets moi en pause", "met moi en pause",
      "arrete la musique", "arrete la lecture", "stoppe", "mets pause",
      "met pause", "mettre en pause", "mettre la musique en pause", "mettre pause",
      "arreter la musique", "arreter la lecture", "stopper la musique", "arrete de jouer",
      "arreter de jouer", "coupe la musique",
    ].contains(command) {
      return .pause
    }
    if [
      "reprends", "reprend", "reprends la musique", "reprends la lecture", "relance la lecture",
      "lecture", "play", "mets play", "met play", "tu peux mettre play", "resume",
      "continue la lecture", "reprendre", "reprendre la lecture", "reprendre la musique",
      "relancer la lecture", "mettre play", "relance la musique", "relancer la musique",
    ].contains(command) {
      return .resume
    }
    return nil
  }
}

/// Only explicit references to alternatives reject cards; naming a new artist does not.
public enum DJDiscoveryFollowUp {
  public static func rejectsSuggestions(_ text: String, cardCount: Int? = nil) -> Bool {
    let words = text.folding(
      options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "fr_FR")
    ).components(separatedBy: CharacterSet.alphanumerics.inverted)
      .filter { !$0.isEmpty }.joined(separator: " ")
    // A numbered refusal refers to the whole displayed group only when its size agrees.
    // With three visible cards, "except these two" does not identify which two to reject.
    if let range = words.range(
      of: #"\bsauf (?:ces|les) (deux|trois|[1-8])\b"#,
      options: .regularExpression)
    {
      let number = String(words[range].split(separator: " ").last ?? "")
      let expected = ["deux": 2, "trois": 3][number] ?? Int(number)
      guard expected == cardCount else { return false }
    }
    if words.range(
      of: #"\b(?:pas|plus|jamais) (?:d autres?|de nouveaux?|d autre)\b"#,
      options: .regularExpression) != nil
    {
      return false
    }
    return words.range(
      of:
        #"\b(?:d autres?|autres (?:morceaux|titres|sons|chansons)|sauf (?:ces|les) (?:deux|trois|[1-8])(?: la)?|pas (?:ceux|celles) la)\b"#,
      options: .regularExpression) != nil
  }
}
