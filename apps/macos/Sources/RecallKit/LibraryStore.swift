import Foundation

public struct LibraryStore: Sendable {
  public enum Source: String { case local, server }
  public let directory: URL
  public init(directory: URL) { self.directory = directory }
  private func file(_ source: Source) -> URL {
    directory.appendingPathComponent(source == .local ? "local-library.json" : "server-cache.json")
  }
  public func prepare() throws {
    try FileManager.default.createDirectory(
      at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    let legacy = directory.appendingPathComponent("library.json")
    if FileManager.default.fileExists(atPath: legacy.path) {
      for source in [Source.local, .server]
      where !FileManager.default.fileExists(atPath: file(source).path) {
        try FileManager.default.copyItem(at: legacy, to: file(source))
      }
    }
  }
  public func read(_ source: Source) throws -> [Track] {
    guard FileManager.default.fileExists(atPath: file(source).path) else { return [] }
    return try JSONDecoder().decode([Track].self, from: Data(contentsOf: file(source)))
  }
  public func save(_ tracks: [Track], source: Source) throws {
    try prepare()
    try JSONEncoder().encode(tracks).write(to: file(source), options: .atomic)
    try FileManager.default.setAttributes(
      [.posixPermissions: 0o600], ofItemAtPath: file(source).path)
  }
}
