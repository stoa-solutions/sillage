import Foundation

public enum StudioQuality: String, CaseIterable, Sendable {
  case hd = "1080"
  case ultra = "2160"
  public var label: String { self == .hd ? "1080p" : "Jusqu’à 4K" }
  public var maximumBytes: Int { (self == .hd ? 400 : 1200) * 1024 * 1024 }
  public var cacheBytes: Int { (self == .hd ? 2048 : 6144) * 1024 * 1024 }
  public var timeout: UInt64 { self == .hd ? 150 : 300 }
  public var format: String {
    let hd =
      "bv*[height<=1080][vcodec^=avc1]+ba[acodec^=mp4a]/b[height<=1080][ext=mp4][vcodec^=avc1]"
    return self == .hd ? hd : "bv*[height<=2160][vcodec^=av01]+ba[acodec^=mp4a]/" + hd
  }
}

/// Opt-in home Studio cache. No browser cookies, account credentials, or shell interpolation.
@MainActor
public final class StudioVideoCache {
  private var jobs: [String: Task<URL, Error>] = [:]
  private var generations: [String: UUID] = [:]
  private var processes: [String: Process] = [:]
  private let directory: URL
  private let executableOverride: String?
  public init(directory override: URL? = nil, executable: String? = nil) {
    executableOverride = executable
    let root =
      ProcessInfo.processInfo.environment["SILLAGE_DATA_DIR"].map { URL(fileURLWithPath: $0) }
      ?? FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
    directory = override ?? root.appendingPathComponent("Sillage/Studio", isDirectory: true)
  }
  public func cancel(except keep: Set<String> = []) {
    for (id, job) in jobs where !keep.contains(String(id.prefix(11))) {
      job.cancel()
      if let process = processes[id], process.isRunning { process.terminate() }
      jobs[id] = nil
      processes[id] = nil
      generations[id] = nil
    }
  }
  public func file(for id: String, quality: StudioQuality = .hd) async throws -> URL {
    guard id.range(of: #"^[A-Za-z0-9_-]{11}$"#, options: .regularExpression) != nil else {
      throw SillageError.message("Identifiant vidéo invalide.")
    }
    try FileManager.default.createDirectory(
      at: directory, withIntermediateDirectories: true,
      attributes: [.posixPermissions: 0o700])
    let key = id + "-" + quality.rawValue
    let destination = directory.appendingPathComponent(key + ".mp4")
    if FileManager.default.fileExists(atPath: destination.path) {
      try? FileManager.default.setAttributes(
        [.modificationDate: Date()], ofItemAtPath: destination.path)
      return destination
    }
    if let job = jobs[key] { return try await job.value }
    let generation = UUID()
    generations[key] = generation
    let job = Task { try await download(id, key: key, quality: quality, to: destination) }
    jobs[key] = job
    defer {
      if generations[key] == generation {
        jobs[key] = nil
        processes[key] = nil
        generations[key] = nil
      }
    }
    return try await job.value
  }
  private func download(_ id: String, key: String, quality: StudioQuality, to destination: URL)
    async throws -> URL
  {
    let staging = directory.appendingPathComponent(UUID().uuidString, isDirectory: true)
    try FileManager.default.createDirectory(
      at: staging, withIntermediateDirectories: true,
      attributes: [.posixPermissions: 0o700])
    defer { try? FileManager.default.removeItem(at: staging) }
    let output = staging.appendingPathComponent("video.mp4")
    guard
      let executable =
        (executableOverride.map { [$0] } ?? ["/opt/homebrew/bin/yt-dlp", "/usr/local/bin/yt-dlp"])
        .first(where: {
          FileManager.default.isExecutableFile(atPath: $0)
        })
    else { throw SillageError.message("Le téléchargement Studio n’est pas installé sur ce Mac.") }
    let process = Process()
    process.executableURL = URL(fileURLWithPath: executable)
    process.arguments =
      StudioJavaScriptRuntime.arguments() + [
        "--ignore-config", "--no-playlist", "--no-cache-dir", "--no-progress",
        "--quiet", "--no-warnings", "--concurrent-fragments", "4", "--retries", "1",
        "--fragment-retries", "1", "--socket-timeout",
        "15",
        "--max-filesize", String(quality.maximumBytes), "--match-filters",
        "duration <= 1200 & !is_live",
        "--format", quality.format,
        "--merge-output-format", "mp4", "--output", output.path,
        "--", "https://www.youtube.com/watch?v=" + id,
      ]
    var environment = ProcessInfo.processInfo.environment
    environment["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
    process.environment = environment
    process.standardOutput = FileHandle.nullDevice
    // Keep stderr private and short-lived; expose only its classified cause, never raw text.
    let diagnostic = staging.appendingPathComponent("diagnostic.txt")
    FileManager.default.createFile(
      atPath: diagnostic.path, contents: nil, attributes: [.posixPermissions: 0o600])
    let diagnosticOutput = try FileHandle(forWritingTo: diagnostic)
    defer { try? diagnosticOutput.close() }
    process.standardError = diagnosticOutput
    var timedOut = false
    processes[key] = process
    let deadline = Task {
      try? await Task.sleep(nanoseconds: quality.timeout * 1_000_000_000)
      if !Task.isCancelled, process.isRunning {
        timedOut = true
        process.terminate()
      }
    }
    defer { deadline.cancel() }
    try Task.checkCancellation()
    let status: Int32 = try await withCheckedThrowingContinuation { continuation in
      process.terminationHandler = { process in
        continuation.resume(returning: process.terminationStatus)
      }
      do { try process.run() } catch { continuation.resume(throwing: error) }
    }
    try Task.checkCancellation()
    guard status == 0, FileManager.default.fileExists(atPath: output.path) else {
      let input = try? FileHandle(forReadingFrom: diagnostic)
      defer { try? input?.close() }
      let data = (try? input?.read(upToCount: 32 * 1024)) ?? Data()
      throw PlaybackFailure.downloadDiagnostic(
        String(decoding: data, as: UTF8.self), timedOut: timedOut)
    }
    let size = (try output.resourceValues(forKeys: [.fileSizeKey])).fileSize ?? 0
    guard size > 0, size <= quality.maximumBytes else {
      throw SillageError.message("Ce clip dépasse la limite du cache Studio.")
    }
    try FileManager.default.moveItem(at: output, to: destination)
    // Keep a small recoverable cache, preserving any files currently in use by the player.
    return destination
  }
  public func trim(keeping ids: Set<String>, quality: StudioQuality = .hd) {
    guard
      let files = try? FileManager.default.contentsOfDirectory(
        at: directory,
        includingPropertiesForKeys: [.fileSizeKey, .contentModificationDateKey])
    else { return }
    let videos = files.filter { $0.pathExtension == "mp4" }.sorted {
      ((try? $0.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate)
        ?? .distantPast)
        < ((try? $1.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate)
          ?? .distantPast)
    }
    var bytes = videos.reduce(0) {
      $0 + ((try? $1.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0)
    }
    for file in videos
    where bytes > quality.cacheBytes && !ids.contains(String(file.lastPathComponent.prefix(11))) {
      let size = (try? file.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
      if (try? FileManager.default.removeItem(at: file)) != nil { bytes -= size }
    }
  }
}
