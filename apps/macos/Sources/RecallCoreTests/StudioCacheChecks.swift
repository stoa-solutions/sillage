import Foundation
import RecallKit

@MainActor
func studioCacheChecks() async throws {
  let root = FileManager.default.temporaryDirectory.appendingPathComponent(
    "studio test " + UUID().uuidString)
  try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: root) }
  let helper = root.appendingPathComponent("fake-downloader")
  try Data(
    """
    #!/bin/sh
    while [ "$#" -gt 0 ]; do
      if [ "$1" = "--output" ]; then shift; target="$1"; fi
      shift
    done
    printf 'test-video' > "$target"
    """.utf8
  ).write(to: helper)
  try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: helper.path)
  let cache = StudioVideoCache(
    directory: root.appendingPathComponent("cache"), executable: helper.path)
  var rejected = false
  do { _ = try await cache.file(for: "../../evil") } catch { rejected = true }
  try expect(rejected, "Unsafe Studio ID accepted")
  let first = try await cache.file(for: "abcdefghijk")
  try expect(
    try Data(contentsOf: first) == Data("test-video".utf8), "Studio output not promoted atomically")
  let ultra = try await cache.file(for: "abcdefghijk", quality: .ultra)
  try expect(
    ultra != first && first.lastPathComponent == "abcdefghijk-1080.mp4",
    "Quality reused another resolution")
  try expect(
    StudioQuality.ultra.format.contains("av01") && !StudioQuality.hd.format.contains("720"),
    "Unsupported video selector")
  try FileManager.default.removeItem(at: helper)
  let reused = try await cache.file(for: "abcdefghijk")
  try expect(first == reused, "Studio redownloaded a cached clip")
  try Data("#!/bin/sh\nexec /bin/sleep 30\n".utf8).write(to: helper)
  try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: helper.path)
  let waiting = Task { try await cache.file(for: "12345678901") }
  try await Task.sleep(nanoseconds: 100_000_000)
  cache.cancel()
  var cancelled = false
  do { _ = try await waiting.value } catch is CancellationError { cancelled = true }
  try expect(cancelled, "Studio cancellation did not stop the downloader")
  try expect(
    !FileManager.default.fileExists(
      atPath: root.appendingPathComponent("cache/12345678901-1080.mp4").path),
    "Cancelled download became a playable cache entry")
  // Real subprocess stderr is classified without leaking URLs or credentials to the UI.
  try Data(
    "#!/bin/sh\nprintf '%s' 'ERROR: Sign in to confirm you are not a bot https://signed.invalid/?token=private' >&2\nexit 1\n"
      .utf8
  ).write(to: helper)
  try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: helper.path)
  do {
    _ = try await cache.file(for: "zzzzzzzzzzz")
    throw RecallError.message("A failed download was accepted")
  } catch let failure as PlaybackFailure {
    try expect(
      failure.kind == .authentication && !failure.message.contains("private")
        && !failure.message.contains("signed.invalid"), "Raw extractor diagnostics leaked")
  }
  try expect(
    PlaybackFailure.youtube(code: 153).kind == .configuration
      && PlaybackFailure.youtube(code: 150).kind == .embeddingDenied
      && PlaybackFailure.youtube(code: 100).kind == .videoUnavailable,
    "YouTube error codes were flattened")
  try expect(
    PlaybackFailure.downloadDiagnostic("HTTP Error 429").kind == .rateLimited
      && PlaybackFailure.downloadDiagnostic("request timed out").kind == .network,
    "Download service failures were classified as unavailable videos")
  print("Studio cache checks passed: invalid ID, atomic download, reuse, cancellation.")
}
