import Foundation

/// Account-scoped server counters. A processed track may remain ambiguous or unmatched.
public struct EnrichmentProgress: Decodable, Sendable {
  public let total: Int
  public let processed: Int
  public let matched: Int
  public let ambiguous: Int
  public let notFound: Int
  public let unavailable: Int
  public let awaitingYoutube: Int
  public let queued: Int
  public let running: Int
  public let retrying: Int
  public let failed: Int
  public let enabled: Bool
  public let batchSize: Int
  public let checkedAt: String
  public var remaining: Int { max(0, total - processed - unavailable) }
  public var fraction: Double {
    total > 0 ? min(1, Double(processed + unavailable) / Double(total)) : 0
  }
  public var title: String {
    if !enabled { return "Enrichissement musical · pilote" }
    return remaining == 0
      ? "Enrichissement musical · terminé" : "Enrichissement musical · progressif"
  }
  public static func decode(_ object: [String: Any]) throws -> Self {
    let decoder = JSONDecoder()
    decoder.keyDecodingStrategy = .convertFromSnakeCase
    let result = try decoder.decode(Self.self, from: JSONSerialization.data(withJSONObject: object))
    guard
      [
        result.total, result.processed, result.matched, result.ambiguous, result.notFound,
        result.unavailable, result.awaitingYoutube, result.queued, result.running,
        result.retrying, result.failed,
      ].allSatisfy({ $0 >= 0 }),
      result.processed == result.matched + result.ambiguous + result.notFound,
      result.processed + result.unavailable <= result.total
    else {
      throw RecallError.message("Le suivi de l’enrichissement est illisible.")
    }
    return result
  }
}
