import Darwin
import Foundation

/// A private, non-synced session file. No Keychain access, including during migration.
/// Same-user applications can read it; only revocable Sillage session tokens belong here.
public final class CredentialFile: @unchecked Sendable {
  private let directory: URL
  private let lock = NSLock()
  private let allowed: Set<String> = ["server", "legacy-server"]

  public init(directory: URL) { self.directory = directory }

  public func read(_ account: String) throws -> Data? {
    try transaction { values in values[account] }
  }

  public func save(_ data: Data?, account: String) throws {
    guard allowed.contains(account) else { throw failure() }
    try transaction(write: true) { values in values[account] = data }
  }

  public func install(_ incoming: [String: Data]) throws {
    guard incoming.keys.allSatisfy({ allowed.contains($0) }) else { throw failure() }
    try transaction(write: true) { values in values.merge(incoming) { _, new in new } }
  }

  private func failure() -> SillageError {
    .message("La connexion privée de Sillage ne peut pas être lue ou enregistrée.")
  }

  private func transaction<T>(write: Bool = false, _ body: (inout [String: Data]) throws -> T)
    throws -> T
  {
    lock.lock()
    defer { lock.unlock() }
    let fm = FileManager.default
    try fm.createDirectory(
      at: directory, withIntermediateDirectories: true,
      attributes: [.posixPermissions: 0o700])
    let dir = open(directory.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
    guard dir >= 0 else { throw failure() }
    defer { close(dir) }
    var info = stat()
    guard fstat(dir, &info) == 0, info.st_uid == getuid(), fchmod(dir, 0o700) == 0 else {
      throw failure()
    }
    // A directory lock serializes separate app instances as well as in-process tasks.
    guard flock(dir, LOCK_EX) == 0 else { throw failure() }
    defer { flock(dir, LOCK_UN) }
    var values: [String: Data] = [:]
    let fd = openat(dir, "session.json", O_RDONLY | O_NOFOLLOW | O_NONBLOCK)
    if fd >= 0 {
      defer { close(fd) }
      guard fstat(fd, &info) == 0, info.st_uid == getuid(),
        (info.st_mode & S_IFMT) == S_IFREG, info.st_nlink == 1,
        info.st_size <= 65536, fchmod(fd, 0o600) == 0
      else { throw failure() }
      let data = FileHandle(fileDescriptor: fd, closeOnDealloc: false).readDataToEndOfFile()
      values = try JSONDecoder().decode([String: Data].self, from: data)
      guard values.keys.allSatisfy({ allowed.contains($0) }) else { throw failure() }
    } else if errno != ENOENT {
      throw failure()
    }
    let result = try body(&values)
    if write {
      let data = try JSONEncoder().encode(values)
      guard data.count <= 65536 else { throw failure() }
      let temporary = ".session-" + UUID().uuidString
      let output = openat(dir, temporary, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600)
      guard output >= 0 else { throw failure() }
      defer {
        close(output)
        unlinkat(dir, temporary, 0)
      }
      try FileHandle(fileDescriptor: output, closeOnDealloc: false).write(contentsOf: data)
      guard fsync(output) == 0, renameat(dir, temporary, dir, "session.json") == 0 else {
        throw failure()
      }
      var privateDirectory = directory
      var resourceValues = URLResourceValues()
      resourceValues.isExcludedFromBackup = true
      try? privateDirectory.setResourceValues(resourceValues)
    }
    return result
  }
}
