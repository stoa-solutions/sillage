import Foundation

#if canImport(FoundationModels)
  import FoundationModels

  @available(macOS 26.0, *)
  private enum LocalSchemas {
    static func plan() throws -> GenerationSchema {
      try GenerationSchema(
        root: DynamicGenerationSchema(
          name: "LibraryPlan",
          properties: [
            .init(
              name: "queries", description: "1 to 3 short searches: artist, title or mood words",
              schema: .init(
                arrayOf: .init(type: String.self), minimumElements: 1,
                maximumElements: LocalDJ.maxQueries)),
            .init(
              name: "named",
              description:
                "True when a specific artist or song name is requested; false for a mood or genre",
              schema: .init(type: Bool.self)),
            .init(
              name: "includeQueued",
              description: "True only when the person asks again for a song already queued",
              schema: .init(type: Bool.self)),
          ]), dependencies: [])
    }
    static func selection(ids: [String]) throws -> GenerationSchema {
      try GenerationSchema(
        root: DynamicGenerationSchema(
          name: "LocalSelection",
          properties: [
            .init(
              name: "reply", description: "Short honest French reply",
              schema: .init(type: String.self)),
            .init(
              name: "trackIds", description: "Exact candidate IDs only",
              schema: .init(
                arrayOf: .init(name: "TrackID", anyOf: ids), maximumElements: LocalDJ.maxTracks)),
            .init(
              name: "append", description: "True to continue or add to queue",
              schema: .init(type: Bool.self)),
          ]), dependencies: [])
    }
  }
#endif

/// Apple's on-device model. Nothing leaves the Mac; the small context gets a short history.
public struct AppleDJ: DJLanguageModel {
  public init() {}
  public static var availability: String? {
    #if canImport(FoundationModels)
      if #available(macOS 26.0, *) {
        switch SystemLanguageModel.default.availability {
        case .available: return nil
        case .unavailable(.deviceNotEligible):
          return "Ce Mac ne prend pas en charge Apple Intelligence."
        case .unavailable(.appleIntelligenceNotEnabled):
          return "Active Apple Intelligence dans les Réglages Système."
        case .unavailable(.modelNotReady):
          return "Le modèle Apple est en cours de préparation. Réessaie après son téléchargement."
        default: return "Le modèle Apple est momentanément indisponible."
        }
      }
    #endif
    return "Le DJ Apple nécessite macOS 26 et un Mac compatible Apple Intelligence."
  }
  public var historyWindow: (messages: Int, characters: Int) { (4, 250) }

  public func plan(instructions: String, input: String) async throws -> DJPlan {
    try Self.ensureAvailable()
    #if canImport(FoundationModels)
      if #available(macOS 26.0, *) {
        let content = try await LanguageModelSession(instructions: instructions).respond(
          to: input, schema: LocalSchemas.plan()
        ).content
        return DJPlan(
          queries: try content.value([String].self, forProperty: "queries"),
          named: try content.value(Bool.self, forProperty: "named"),
          includeQueued: try content.value(Bool.self, forProperty: "includeQueued"))
      }
    #endif
    throw RecallError.message("Le DJ Apple est indisponible sur ce Mac.")
  }

  public func select(instructions: String, input: String, candidateIDs: [String]) async throws
    -> DJSelection
  {
    try Self.ensureAvailable()
    #if canImport(FoundationModels)
      if #available(macOS 26.0, *) {
        let content = try await LanguageModelSession(instructions: instructions).respond(
          to: input, schema: LocalSchemas.selection(ids: candidateIDs)
        ).content
        return DJSelection(
          reply: try content.value(String.self, forProperty: "reply"),
          trackIds: try content.value([String].self, forProperty: "trackIds"),
          append: try content.value(Bool.self, forProperty: "append"))
      }
    #endif
    throw RecallError.message("Le DJ Apple est indisponible sur ce Mac.")
  }

  private static func ensureAvailable() throws {
    if let reason = availability {
      throw RecallError.message(reason + " Tu peux aussi choisir Gemini dans Réglages.")
    }
  }
}
