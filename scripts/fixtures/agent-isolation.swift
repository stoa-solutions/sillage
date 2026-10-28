// Only the session and HTTP boundary are replaced. The model and contracts are compiled from source.
struct Connection { let token: String }
@MainActor final class Session { var connection: Connection? }
enum TestFailure: Error { case failed }
@MainActor enum Replies {
  static var lists: [CheckedContinuation<DJAgentList, Error>] = []
  static var agents: [CheckedContinuation<DJAgent, Error>] = []
  static var deletes: [CheckedContinuation<Void, Error>] = []
  static func wait(_ ready: () -> Bool) async {
    while !ready() { await Task.yield() }
  }
}
struct HTTPClient {
  @MainActor func djAgents(_ connection: Connection) async throws -> DJAgentList {
    try await withCheckedThrowingContinuation { Replies.lists.append($0) }
  }
  @MainActor func createDJAgent(_ connection: Connection, name: String, instructions: String)
    async throws -> DJAgent
  {
    try await withCheckedThrowingContinuation { Replies.agents.append($0) }
  }
  @MainActor func updateDJAgent(
    _ connection: Connection, id: String, name: String, instructions: String
  ) async throws -> DJAgent {
    try await withCheckedThrowingContinuation { Replies.agents.append($0) }
  }
  @MainActor func deleteDJAgent(_ connection: Connection, id: String) async throws {
    try await withCheckedThrowingContinuation { Replies.deletes.append($0) }
  }
}
@main struct AgentIsolation {
  static func agent(_ id: String) -> DJAgent {
    DJAgent(id: id, name: id, instructions: "Synthetic \(id)", base: false)
  }
  static func list(_ id: String) -> DJAgentList {
    DJAgentList(defaultID: DJAgent.defaultID, agents: [agent(id)])
  }
  @MainActor static func main() async {
    let session = Session()
    session.connection = Connection(token: "synthetic-A")
    let model = DJAgentsModel(session: session)
    let old = Task { await model.load() }
    await Replies.wait { Replies.lists.count == 1 }
    session.connection = Connection(token: "synthetic-B")
    let oldEpoch = model.epoch
    model.reset()
    precondition(model.epoch != oldEpoch, "Editors must be invalidated on account change")
    let current = Task { await model.load() }
    await Replies.wait { Replies.lists.count == 2 }
    Replies.lists.removeFirst().resume(returning: list("private-A"))
    await old.value
    precondition(
      model.agents.isEmpty && model.loading,
      "Old account must not populate or finish the current load")
    Replies.lists.removeFirst().resume(returning: list("private-B"))
    await current.value
    precondition(model.agents.map(\.id) == ["private-B"] && !model.loading)

    for operation in ["create", "update"] {
      let pending = Task {
        if operation == "create" { return await model.create(name: "old", instructions: "old") }
        return await model.update("private-B", name: "old", instructions: "old")
      }
      await Replies.wait { !Replies.agents.isEmpty }
      model.reset()
      Replies.agents.removeFirst().resume(returning: agent("private-old"))
      let result = await pending.value
      precondition(result == nil && model.agents.isEmpty, "Late \(operation) escaped its account")
    }
    let remove = Task { await model.delete("private-B") }
    await Replies.wait { !Replies.deletes.isEmpty }
    model.reset()
    Replies.deletes.removeFirst().resume(returning: ())
    let removed = await remove.value
    precondition(!removed, "Late delete must not report success to another account's editor")

    let failing = Task { await model.load() }
    await Replies.wait { !Replies.lists.isEmpty }
    model.reset()
    Replies.lists.removeFirst().resume(throwing: TestFailure.failed)
    await failing.value
    precondition(model.error.isEmpty, "Old failures must not leak into the new account")

    let earlier = Task { await model.load() }
    await Replies.wait { Replies.lists.count == 1 }
    let later = Task { await model.load() }
    await Replies.wait { Replies.lists.count == 2 }
    Replies.lists.removeLast().resume(returning: list("newest"))
    await later.value
    Replies.lists.removeFirst().resume(returning: list("stale"))
    await earlier.value
    precondition(
      model.agents.map(\.id) == ["newest"], "Overlapping loads must keep the latest result")

    let create = Task { await model.create(name: "mine", instructions: "mine") }
    await Replies.wait { !Replies.agents.isEmpty }
    Replies.agents.removeFirst().resume(returning: agent("mine"))
    let created = await create.value
    precondition(created?.id == "mine" && model.agents.last?.id == "mine")
    let update = Task { await model.update("mine", name: "edited", instructions: "edited") }
    await Replies.wait { !Replies.agents.isEmpty }
    var edited = agent("mine")
    edited.name = "edited"
    Replies.agents.removeFirst().resume(returning: edited)
    _ = await update.value
    precondition(model.agents.last?.name == "edited")
    let delete = Task { await model.delete("mine") }
    await Replies.wait { !Replies.deletes.isEmpty }
    Replies.deletes.removeFirst().resume(returning: ())
    let deleted = await delete.value
    precondition(deleted && !model.agents.contains { $0.id == "mine" })
    print(
      "Agent isolation passed: delayed load/create/update/delete, stale error, overlapping loads, active-account CRUD."
    )
  }
}
