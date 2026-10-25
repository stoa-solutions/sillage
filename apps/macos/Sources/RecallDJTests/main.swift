import Foundation
import RecallKit

func check(_ condition: Bool, _ message: String) throws {
  if !condition { throw RecallError.message(message) }
}

/// Scripted model: returns the given plan and selection, records every prompt.
final class FakeModel: DJLanguageModel, @unchecked Sendable {
  let historyWindow: (messages: Int, characters: Int)
  let planned: DJPlan
  let selected: DJSelection
  private let lock = NSLock()
  private(set) var planInputs: [String] = []
  private(set) var selectInputs: [String] = []
  init(
    plan: DJPlan, select: DJSelection, window: (messages: Int, characters: Int) = (12, 2000)
  ) {
    planned = plan
    selected = select
    historyWindow = window
  }
  func plan(instructions: String, input: String) async throws -> DJPlan {
    lock.withLock { planInputs.append(input) }
    return planned
  }
  func select(instructions: String, input: String, candidateIDs: [String]) async throws
    -> DJSelection
  {
    lock.withLock { selectInputs.append(input) }
    return selected
  }
}

/// In-memory library: a track matches when its title or channel contains any query word.
final class FakeLibrary: LibrarySearch, @unchecked Sendable {
  let tracks: [Track]
  private let lock = NSLock()
  var calls: [(query: String, excluding: Set<String>, limit: Int)] = []
  init(_ tracks: [Track]) { self.tracks = tracks }
  func search(_ query: String, excluding: Set<String>, limit: Int) async throws -> [Track] {
    lock.withLock { calls.append((query, excluding, limit)) }
    let words = query.lowercased().split(separator: " ").map(String.init)
    return Array(
      tracks.filter { track in
        !excluding.contains(track.id)
          && words.contains {
            (track.title + " " + (track.channel ?? "")).lowercased().contains($0)
          }
      }.prefix(limit))
  }
}

func id(_ n: Int) -> String { String(format: "%011d", n) }

@main struct DJTests {
  static func main() async {
    do {
      let baker = Track(id: id(1), title: "My Funny Valentine", channel: "Chet Baker")
      let faker = Track(id: id(2), title: "Gold", channel: "Chet Faker")
      let jazz = (10..<40).map { Track(id: id($0), title: "Jazz doux \($0)", channel: "Trio") }
      let library = FakeLibrary([baker, faker] + jazz)
      let named = DJPlan(queries: ["Chet Baker"], named: true, includeQueued: false)

      // A named request keeps only tracks matching every word of the name.
      let pick = FakeModel(
        plan: named, select: DJSelection(reply: "Voilà Chet.", trackIds: [baker.id], append: false))
      var response = try await LocalDJ(model: pick, library: library).turn(
        DJRequest(message: "Mets du Chet Baker", history: [], queued: []))
      try check(response.action == "replace" && response.tracks == [baker], "Named pick failed")
      try check(
        pick.selectInputs.first?.contains(faker.id) == false, "Lookalike artist reached the model")

      // Imitations and entries without metadata never reach the model, unless imitations are asked.
      let beat = Track(id: id(3), title: "Chet Baker Type Beat - Blue", channel: "Prod")
      let hidden = Track(
        id: id(4), title: "Chet Baker", channel: "Chet Baker", metadataUnavailable: true)
      let mixed = FakeLibrary([baker, beat, hidden])
      let watch = FakeModel(
        plan: DJPlan(queries: ["Chet Baker"], named: false, includeQueued: false),
        select: DJSelection(reply: "ok", trackIds: [], append: false))
      _ = try await LocalDJ(model: watch, library: mixed).turn(
        DJRequest(message: "Du Chet Baker", history: [], queued: []))
      try check(
        watch.selectInputs[0].contains(baker.id) && !watch.selectInputs[0].contains(beat.id)
          && !watch.selectInputs[0].contains(hidden.id),
        "Imitation or unavailable entry offered to the model")
      _ = try await LocalDJ(model: watch, library: mixed).turn(
        DJRequest(message: "Un type beat façon Chet Baker", history: [], queued: []))
      try check(watch.selectInputs[1].contains(beat.id), "Requested type beat filtered out")

      // Merged libraries keep priority order, drop duplicates and honour the limit.
      let first = FakeLibrary([baker, faker])
      let second = FakeLibrary([faker] + jazz)
      let merged = try await MergedLibrarySearch([first, second]).search(
        "chet jazz", excluding: [baker.id], limit: 4)
      try check(
        merged.map(\.id) == [faker.id] + jazz.prefix(3).map(\.id),
        "Merged search lost order, repeated a track or ignored the exclusion")

      // Queued tracks are excluded by the library itself, and a pick outside candidates is dropped.
      library.calls.removeAll()
      response = try await LocalDJ(model: pick, library: library).turn(
        DJRequest(message: "Encore Chet Baker", history: [], queued: [baker.id]))
      try check(library.calls.first?.excluding == [baker.id], "Queue exclusion not sent to search")
      try check(response.action == "keep" && response.tracks.isEmpty, "Queued track replayed")

      // Asking again for a queued song includes it.
      let again = FakeModel(
        plan: DJPlan(queries: ["Chet Baker"], named: true, includeQueued: true),
        select: DJSelection(reply: "La revoilà.", trackIds: [baker.id], append: false))
      response = try await LocalDJ(model: again, library: library).turn(
        DJRequest(message: "Remets My Funny Valentine", history: [], queued: [baker.id]))
      try check(response.tracks == [baker], "Explicit request for a queued track refused")

      // Invented IDs are dropped, duplicates removed, the count capped, append honoured.
      let ids = [id(99), id(10), id(10)] + (11..<17).map(id)
      let many = FakeModel(
        plan: DJPlan(queries: ["jazz"], named: false, includeQueued: false),
        select: DJSelection(reply: "Du jazz.", trackIds: ids, append: true))
      response = try await LocalDJ(model: many, library: library).turn(
        DJRequest(message: "Du jazz doux", history: [], queued: []))
      try check(
        response.action == "append" && response.tracks.map(\.id) == (10..<15).map(id),
        "Selection not verified, deduplicated and capped at \(LocalDJ.maxTracks)")

      // An empty choice keeps the queue; no candidate skips the second model call.
      let none = FakeModel(
        plan: DJPlan(queries: ["jazz"], named: false, includeQueued: false),
        select: DJSelection(reply: "Rien ne colle.", trackIds: [], append: false))
      response = try await LocalDJ(model: none, library: library).turn(
        DJRequest(message: "Du jazz", history: [], queued: []))
      try check(response.action == "keep" && response.reply == "Rien ne colle.", "Empty pick")
      let missing = FakeModel(
        plan: DJPlan(queries: ["opéra"], named: false, includeQueued: false),
        select: DJSelection(reply: "", trackIds: [], append: false))
      response = try await LocalDJ(model: missing, library: library).turn(
        DJRequest(message: "De l’opéra", history: [], queued: []))
      try check(
        response.action == "keep" && missing.selectInputs.isEmpty,
        "Model asked to choose without candidates")

      // Several queries are deduplicated and capped; an empty plan searches the request.
      library.calls.removeAll()
      let wide = FakeModel(
        plan: DJPlan(
          queries: ["jazz", "doux", "trio", "quatrième"], named: false, includeQueued: false),
        select: DJSelection(reply: "ok", trackIds: [], append: false))
      _ = try await LocalDJ(model: wide, library: library).turn(
        DJRequest(message: "jazz", history: [], queued: []))
      try check(library.calls.count == LocalDJ.maxQueries, "Query count not capped")
      try check(
        wide.selectInputs[0].components(separatedBy: "\"id\"").count - 1 == LocalDJ.maxCandidates,
        "Candidates not deduplicated and capped at \(LocalDJ.maxCandidates)")
      library.calls.removeAll()
      let blank = FakeModel(
        plan: DJPlan(queries: [" "], named: false, includeQueued: false),
        select: DJSelection(reply: "ok", trackIds: [], append: false))
      _ = try await LocalDJ(model: blank, library: library).turn(
        DJRequest(message: "jazz du soir", history: [], queued: []))
      try check(library.calls.map(\.query) == ["jazz du soir"], "Empty plan did not search request")

      // Each model receives the conversation window it declares.
      let history = (0..<10).map {
        ChatMessage(
          role: $0 % 2 == 0 ? "user" : "assistant",
          content: "message \($0) " + String(repeating: "x", count: 400))
      }
      let small = FakeModel(
        plan: named, select: DJSelection(reply: "ok", trackIds: [], append: false), window: (4, 250)
      )
      _ = try await LocalDJ(model: small, library: library).turn(
        DJRequest(message: "Chet Baker", history: history, queued: []))
      let input = small.planInputs[0]
      try check(
        input.contains("message 6 ") && !input.contains("message 5 ")
          && !input.contains(String(repeating: "x", count: 300)),
        "History window not applied")

      print(
        "DJ turn checks passed: named, queue exclusion, explicit replay, verification, caps, empty choices, queries, history window, imitations, merged search."
      )
    } catch {
      fputs("DJ tests failed: \(error.localizedDescription)\n", stderr)
      exit(1)
    }
  }
}
