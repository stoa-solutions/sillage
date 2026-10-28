import Foundation
import SillageKit

@MainActor
func preparedSpeechChecks() async throws {
  let buffer = PreparedSpeech()
  var generated = 0
  buffer.prepare(key: "account-a:next") {
    generated += 1
    return Data("voice".utf8)
  }
  buffer.prepare(key: "account-a:next") { fatalError("Duplicate synthesis") }
  let foreign = try await buffer.take(key: "account-b:next")
  try expect(foreign == nil, "Speech crossed account boundary")
  let voice = try await buffer.take(key: "account-a:next")
  try expect(voice == Data("voice".utf8) && generated == 1, "Prepared speech was regenerated")
  let consumed = try await buffer.take(key: "account-a:next")
  try expect(consumed == nil, "Speech consumed twice")
  buffer.prepare(key: "old") {
    try await Task.sleep(nanoseconds: 1_000_000_000)
    return Data()
  }
  buffer.clear()
  let stale = try await buffer.take(key: "old")
  try expect(stale == nil, "Cancelled speech survived reset")
  print("Prepared speech checks passed: reuse, deduplication, session isolation, reset.")
}
