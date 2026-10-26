import Foundation
import RecallKit

func djJournalChecks() throws {
  var journal = DJJournalBuffer()
  let conversation = journal.conversationId
  let request = UUID()
  let first = ChatMessage(role: "user", content: "Prépare la suite avec HEDGES")
  let reply = ChatMessage(role: "assistant", content: "J’ajoute Incapable")
  let track = Track(id: "C7vVkdPEun8", title: "Incapable", channel: "Jewel Usain")
  journal.capture(
    before: [], after: [first], action: "ask", scope: .all, visibleScope: .youtube,
    requestId: request, current: track, upcoming: [track])
  let sent = Set(journal.pending.map(\.id))
  journal.capture(
    before: [first], after: [first, reply], action: "answer_received", scope: .all,
    visibleScope: .library, requestId: request, current: track, upcoming: [track])
  try expect(journal.pending.count == 4, "Journal missed visible messages or actions")
  try expect(
    journal.pending[0].id == first.id && journal.pending[0].scope == .all
      && journal.pending[0].visibleScope == .youtube && journal.pending[0].requestId == request,
    "Journal lost source or correlation after dropdown change")
  try expect(journal.pending[2].queueIds == [track.id], "Journal lost actual queue")
  journal.acknowledge(sent)
  try expect(
    journal.pending.map(\.id).contains(reply.id), "Retry acknowledgment removed unsent reply")
  let payload =
    try JSONSerialization.jsonObject(with: JSONEncoder().encode(journal.pending))
    as! [[String: Any]]
  try expect(payload[0]["scope"] as? String == "all", "Journal source is not server-compatible")
  try expect(
    payload[0]["content"] as? String == reply.content, "Journal changed conversational content")
  for i in 0..<1010 {
    let next = ChatMessage(role: "user", content: "pause \(i)")
    journal.capture(
      before: [], after: [next], action: nil, scope: .library, visibleScope: .library,
      requestId: nil, current: nil, upcoming: [])
  }
  try expect(journal.pending.count == 1000 && journal.dropped > 0, "Offline journal is unbounded")
  journal.reset()
  try expect(
    journal.conversationId != conversation && journal.pending.isEmpty,
    "Journal leaked into another account")
  var session = ListeningSession()
  let effects = session.handle(.ask("Du jazz", source: .youtube))
  var automatic = false
  for effect in effects {
    if case .send(_, let request) = effect { automatic = request.trigger == .user }
  }
  try expect(automatic, "User request mislabeled as automatic continuation")
  print(
    "DJ journal checks passed: source, correlation, verbatim messages, retry acknowledgments, bounded outbox, account reset"
  )
}
