import Foundation
import RecallKit

/// The DJ agents of the signed-in account and the one chosen on this Mac. The choice is sent
/// with every DJ request, refills included; the server owns the profiles and their rules.
@MainActor
final class DJAgentsModel: ObservableObject {
  @Published private(set) var agents: [DJAgent] = []
  @Published private(set) var loading = false
  @Published var error = ""
  @Published private(set) var selectedID: String
  private let session: Session
  private static let selectionKey = "djAgent"

  init(session: Session) {
    self.session = session
    selectedID = UserDefaults.standard.string(forKey: Self.selectionKey) ?? DJAgent.defaultID
  }

  var selected: DJAgent? { agents.first { $0.id == selectedID } }
  /// The name shown in the composer, even before the list has loaded.
  var selectedName: String { selected?.name ?? "Le DJ" }
  var baseAgents: [DJAgent] { agents.filter(\.base) }
  var customAgents: [DJAgent] { agents.filter { !$0.base } }

  func select(_ id: String) {
    selectedID = id
    UserDefaults.standard.set(id, forKey: Self.selectionKey)
  }

  func reset() {
    agents = []
    error = ""
  }

  func load() async {
    guard let connection = session.connection else { return }
    loading = true
    defer { loading = false }
    do {
      let list = try await HTTPClient().djAgents(connection)
      agents = list.agents
      // A deleted or foreign agent goes back to the default instead of failing silently.
      let resolved = list.resolve(selectedID)
      if resolved != selectedID { select(resolved) }
      error = ""
    } catch {
      self.error = error.localizedDescription
    }
  }

  /// Creates the agent and returns it, so the editor can keep it selected.
  func create(name: String, instructions: String) async -> DJAgent? {
    await perform {
      let agent = try await HTTPClient().createDJAgent($0, name: name, instructions: instructions)
      agents.append(agent)
      return agent
    }
  }

  func update(_ id: String, name: String, instructions: String) async -> DJAgent? {
    await perform {
      let agent = try await HTTPClient().updateDJAgent(
        $0, id: id, name: name, instructions: instructions)
      if let index = agents.firstIndex(where: { $0.id == id }) { agents[index] = agent }
      return agent
    }
  }

  func delete(_ id: String) async -> Bool {
    await perform {
      try await HTTPClient().deleteDJAgent($0, id: id)
      agents.removeAll { $0.id == id }
      if selectedID == id { select(DJAgent.defaultID) }
      return true
    } ?? false
  }

  private func perform<T>(_ body: (Connection) async throws -> T) async -> T? {
    guard let connection = session.connection else {
      error = "Connecte ton compte pour gérer tes agents."
      return nil
    }
    do {
      let value = try await body(connection)
      error = ""
      return value
    } catch {
      self.error = error.localizedDescription
      return nil
    }
  }
}
