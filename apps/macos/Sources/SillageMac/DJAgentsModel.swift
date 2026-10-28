import Foundation
import SillageKit

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

  /// Bumped when the account changes: an answer for the previous account must not land here.
  @Published private(set) var epoch = 0
  private var loadID = UUID()

  func reset() {
    epoch += 1
    loadID = UUID()
    agents = []
    error = ""
    loading = false
  }

  func load() async {
    guard let connection = session.connection else { return }
    let started = epoch
    let request = UUID()
    loadID = request
    loading = true
    let result = await outcome { try await HTTPClient().djAgents(connection) }
    guard started == epoch, request == loadID else { return }
    loading = false
    switch result {
    case .success(let list):
      agents = list.agents
      // A deleted or foreign agent goes back to the default instead of failing silently.
      let resolved = list.resolve(selectedID)
      if resolved != selectedID { select(resolved) }
      error = ""
    case .failure(let failure):
      error = failure.localizedDescription
    }
  }

  /// Creates the agent and returns it, so the editor can keep it selected.
  func create(name: String, instructions: String) async -> DJAgent? {
    guard
      let agent = await perform({
        try await HTTPClient().createDJAgent($0, name: name, instructions: instructions)
      })
    else { return nil }
    agents.append(agent)
    return agent
  }

  func update(_ id: String, name: String, instructions: String) async -> DJAgent? {
    guard
      let agent = await perform({
        try await HTTPClient().updateDJAgent($0, id: id, name: name, instructions: instructions)
      })
    else { return nil }
    if let index = agents.firstIndex(where: { $0.id == id }) { agents[index] = agent }
    return agent
  }

  func delete(_ id: String) async -> Bool {
    guard await perform({ try await HTTPClient().deleteDJAgent($0, id: id) }) != nil else {
      return false
    }
    agents.removeAll { $0.id == id }
    if selectedID == id { select(DJAgent.defaultID) }
    return true
  }

  /// Runs one server call; nil when it failed or when the account changed while it ran, so the
  /// caller only updates the list for the account that asked.
  private func perform<T>(_ body: (Connection) async throws -> T) async -> T? {
    guard let connection = session.connection else {
      error = "Connecte ton compte pour gérer tes agents."
      return nil
    }
    let started = epoch
    let result = await outcome { try await body(connection) }
    guard started == epoch else { return nil }
    switch result {
    case .success(let value):
      error = ""
      return value
    case .failure(let failure):
      error = failure.localizedDescription
      return nil
    }
  }
}

private func outcome<T>(_ body: () async throws -> T) async -> Result<T, Error> {
  do { return .success(try await body()) } catch { return .failure(error) }
}
