import Foundation
import SillageKit

/// One second of silence as a 16-bit mono WAV: a real file AVPlayer can open, no fixtures.
private func silentWAV() throws -> URL {
  let rate: UInt32 = 8000
  let samples = Data(count: Int(rate) * 2)
  var data = Data("RIFF".utf8)
  func le<T: FixedWidthInteger>(_ value: T) {
    withUnsafeBytes(of: value.littleEndian) { data.append(contentsOf: $0) }
  }
  le(UInt32(36 + samples.count))
  data.append(contentsOf: Array("WAVEfmt ".utf8))
  le(UInt32(16))
  le(UInt16(1))
  le(UInt16(1))
  le(rate)
  le(rate * 2)
  le(UInt16(2))
  le(UInt16(16))
  data.append(contentsOf: Array("data".utf8))
  le(UInt32(samples.count))
  data.append(samples)
  let url = FileManager.default.temporaryDirectory
    .appendingPathComponent("sillage-clip-\(UUID().uuidString).wav")
  try data.write(to: url)
  return url
}

@MainActor
func clipPlayerChecks() async throws {
  let file = try silentWAV()
  defer { try? FileManager.default.removeItem(at: file) }

  // Releasing a player must release its observation owner too, across repeated sessions.
  for _ in 0..<20 {
    var temporary: ClipPlayer? = ClipPlayer()
    weak var released = temporary
    temporary = nil
    try expect(released == nil, "Clip player retained after its owner released it")
  }
  let clip = ClipPlayer()
  try await clip.load(.file(file), at: 0.5, autoplay: false)
  try expect(abs(clip.position - 0.5) < 0.05, "A loaded clip did not start at the requested time")

  // Stop while loading: the load returns at once instead of staying suspended.
  let stopped = Task { try await clip.load(.file(file), at: 0, autoplay: true) }
  await Task.yield()
  clip.stop()
  let outcome = await stopped.result
  guard case .failure(let error) = outcome, error is CancellationError else {
    throw SillageError.message("A load interrupted by stop() did not end with a cancellation")
  }
  try expect(clip.player.currentItem == nil && clip.player.rate == 0, "A stopped load still played")

  // A newer load supersedes an older one; only the newer item is positioned and played.
  let first = Task { try await clip.load(.file(file), at: 0.2, autoplay: true) }
  await Task.yield()
  try await clip.load(.file(file), at: 0.7, autoplay: false)
  let superseded = await first.result
  guard case .failure(let reason) = superseded, reason is CancellationError else {
    throw SillageError.message("A superseded load was not cancelled")
  }
  try expect(
    abs(clip.position - 0.7) < 0.05 && clip.player.rate == 0,
    "A superseded load positioned or played the newer item")
  clip.stop()
  print("Clip player checks passed: load, stop during load, superseded load")
}
