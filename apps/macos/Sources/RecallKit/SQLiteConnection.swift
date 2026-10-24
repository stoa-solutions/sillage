import CSQLite
import Foundation

// One connection per operation; callers never share a handle across tasks.
final class SQLiteConnection {
  private var handle: OpaquePointer?
  init(url: URL) throws {
    guard
      sqlite3_open_v2(
        url.path, &handle, SQLITE_OPEN_CREATE | SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX, nil)
        == SQLITE_OK
    else {
      defer { sqlite3_close(handle) }
      throw RecallError.message("Impossible d’ouvrir la bibliothèque locale." + detail)
    }
    sqlite3_busy_timeout(handle, 5000)
  }
  deinit { sqlite3_close(handle) }
  // SQLite messages describe the failing operation, never bound values.
  private var detail: String {
    guard let handle, let message = sqlite3_errmsg(handle) else { return "" }
    return " (SQLite : \(String(cString: message)))"
  }
  func transaction(_ body: () throws -> Void) throws {
    try exec("BEGIN IMMEDIATE")
    do {
      try body()
      try exec("COMMIT")
    } catch {
      try? exec("ROLLBACK")
      throw error
    }
  }
  func exec(_ sql: String, _ args: [String] = []) throws { _ = try rows(sql, args) }
  func rows(_ sql: String, _ args: [String] = []) throws -> [[String]] {
    if args.isEmpty, sql.contains(";") {
      guard sqlite3_exec(handle, sql, nil, nil, nil) == SQLITE_OK else {
        throw RecallError.message("La bibliothèque locale n’a pas pu être préparée." + detail)
      }
      return []
    }
    var statement: OpaquePointer?
    guard sqlite3_prepare_v2(handle, sql, -1, &statement, nil) == SQLITE_OK else {
      throw RecallError.message("Requête de bibliothèque invalide." + detail)
    }
    defer { sqlite3_finalize(statement) }
    let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
    for (index, value) in args.enumerated() {
      sqlite3_bind_text(statement, Int32(index + 1), value, -1, transient)
    }
    var result: [[String]] = []
    while true {
      let status = sqlite3_step(statement)
      if status == SQLITE_DONE { return result }
      guard status == SQLITE_ROW else {
        throw RecallError.message("La bibliothèque locale n’a pas pu être enregistrée." + detail)
      }
      result.append(
        (0..<sqlite3_column_count(statement)).map { index in
          sqlite3_column_text(statement, index).map { String(cString: $0) } ?? ""
        })
    }
  }
}
