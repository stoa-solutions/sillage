import Foundation

/// A profile added to the DJ's rules on the server: tone and selection preferences, never its
/// contract. Base agents have a stable key (`focus`) and are read-only; custom ones have a uuid.
public struct DJAgent: Codable, Identifiable, Hashable, Sendable {
  public let id: String
  public var name: String
  public var instructions: String
  public let base: Bool

  public init(id: String, name: String, instructions: String, base: Bool) {
    self.id = id
    self.name = name
    self.instructions = instructions
    self.base = base
  }

  /// The DJ as it behaves without a profile, used until the server's list is known.
  public static let defaultID = "dj"
  public static let nameLimit = 40
  public static let instructionsLimit = 1500
}

/// The account's agents, as `/v1/dj/agents` returns them: base ones first, then the custom ones.
public struct DJAgentList: Sendable {
  public let defaultID: String
  public let agents: [DJAgent]

  public static func decode(_ object: [String: Any]) throws -> DJAgentList {
    struct Body: Decodable {
      let defaultId: String
      let agents: [DJAgent]
    }
    let body = try JSONDecoder().decode(
      Body.self, from: JSONSerialization.data(withJSONObject: object))
    return DJAgentList(defaultID: body.defaultId, agents: body.agents)
  }

  /// The selection to use: the stored one if it still exists, else the server's default.
  public func resolve(_ selected: String?) -> String {
    guard let selected, agents.contains(where: { $0.id == selected }) else { return defaultID }
    return selected
  }
}

extension HTTPClient {
  public func djAgents(_ connection: Connection) async throws -> DJAgentList {
    try DJAgentList.decode(await server(connection, path: "dj/agents"))
  }
  public func createDJAgent(_ connection: Connection, name: String, instructions: String)
    async throws -> DJAgent
  {
    try decodeAgent(
      await server(
        connection, path: "dj/agents", body: ["name": name, "instructions": instructions]))
  }
  public func updateDJAgent(
    _ connection: Connection, id: String, name: String, instructions: String
  ) async throws -> DJAgent {
    try decodeAgent(
      await server(
        connection, path: "dj/agents/" + id, method: "PUT",
        body: ["name": name, "instructions": instructions]))
  }
  public func deleteDJAgent(_ connection: Connection, id: String) async throws {
    _ = try await server(connection, path: "dj/agents/" + id, method: "DELETE")
  }
  private func decodeAgent(_ object: [String: Any]) throws -> DJAgent {
    try JSONDecoder().decode(DJAgent.self, from: JSONSerialization.data(withJSONObject: object))
  }
}
