import Foundation
import SillageKit

func djAgentChecks() throws {
  // The chosen agent travels with a typed request and with a refill alike.
  var composition = DJComposition()
  composition.direct("Du jazz doux", source: .youtube)
  var queue = PlaybackQueue()
  queue.replace([Track(id: "first123456", title: "Navajo", channel: "Masego")])
  var typed = composition.userRequest("Plus calme", history: [], queue: queue)
  typed.agentId = "focus"
  var refill = composition.request(history: [], queue: queue)
  refill.agentId = "11111111-2222-4333-8444-555555555555"
  try expect(
    try ServerDJ.body(for: typed)["agentId"] as? String == "focus",
    "A typed request lost its agent")
  let refillBody = try ServerDJ.body(for: refill)
  try expect(
    refillBody["agentId"] as? String == "11111111-2222-4333-8444-555555555555"
      && refillBody["continuation"] != nil && refillBody["scope"] as? String == "youtube",
    "A refill lost its agent or its source")
  try expect(
    try ServerDJ.body(for: composition.userRequest("x", history: [], queue: queue))["agentId"]
      == nil,
    "A request without agent invented one")

  // The server's list decides the selection: a deleted or foreign agent goes back to default.
  let list = try DJAgentList.decode([
    "defaultId": "dj",
    "agents": [
      [
        "id": "dj", "name": "Le DJ", "instructions": "", "base": true,
        "updatedAt": "2026-10-28T00:00:00Z",
      ],
      [
        "id": "11111111-2222-4333-8444-555555555555", "name": "Soirée", "instructions": "Doux.",
        "base": false, "updatedAt": "2026-10-28T00:00:00Z",
      ],
    ],
  ])
  try expect(list.agents.map(\.base) == [true, false], "Agent list decoded out of order")
  try expect(list.resolve("11111111-2222-4333-8444-555555555555") != "dj", "Own agent dropped")
  try expect(list.resolve("focus-removed") == "dj", "Missing agent kept")
  try expect(list.resolve(nil) == "dj", "No selection did not use the default")
  // The answering agent stays on the reply, even when a refill drops repeated tracks.
  let answered = try JSONDecoder().decode(
    DJResponse.self,
    from: Data(
      #"{"reply":"C’est parti","action":"append","tracks":[{"id":"first123456","title":"Navajo"},{"id":"fresh123456","title":"Fresh"}],"agent":{"id":"disquaire","name":"Le Disquaire"}}"#
        .utf8))
  try expect(
    queue.freshContinuation(answered).agent?.name == "Le Disquaire",
    "A refill lost the answering agent")
  let plain = try JSONDecoder().decode(
    DJResponse.self, from: Data(#"{"reply":"Ok","action":"keep","tracks":[]}"#.utf8))
  try expect(plain.agent == nil, "An answer without agent invented one")
  print("DJ agent checks passed: typed and refill requests, default fallback, answering agent")
}
