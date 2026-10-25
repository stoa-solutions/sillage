import Foundation

// Each operation owns its connection. No SQLite handle crosses tasks or sources.
public struct LibraryStore: Sendable {
  public enum Source: String, Sendable { case local, server }
  public let directory: URL
  public init(directory: URL) { self.directory = directory }
  private var databaseURL: URL { directory.appendingPathComponent("library.sqlite") }
  public func prepare() throws {
    try FileManager.default.createDirectory(
      at: directory, withIntermediateDirectories: true,
      attributes: [.posixPermissions: 0o700])
    try database { db in
      try db.exec(
        """
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS videos(source TEXT NOT NULL,id TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(source,id));
        CREATE TABLE IF NOT EXISTS playlists(source TEXT NOT NULL,id TEXT NOT NULL,title TEXT NOT NULL,url TEXT,PRIMARY KEY(source,id));
        CREATE TABLE IF NOT EXISTS members(source TEXT NOT NULL,playlist TEXT NOT NULL,position INTEGER NOT NULL,video TEXT NOT NULL,PRIMARY KEY(source,playlist,position));
        CREATE INDEX IF NOT EXISTS member_video ON members(source,video);
        CREATE VIRTUAL TABLE IF NOT EXISTS video_search USING fts5(source UNINDEXED,id UNINDEXED,title,channel,description,tokenize='unicode61 remove_diacritics 2');
        CREATE TABLE IF NOT EXISTS migrations(name TEXT PRIMARY KEY);
        """)
      for source in [Source.local, .server] {
        let marker = "json-v1-" + source.rawValue
        if try !db.rows("SELECT name FROM migrations WHERE name=?", [marker]).isEmpty { continue }
        let specific = directory.appendingPathComponent(
          source == .local ? "local-library.json" : "server-cache.json")
        let legacy = directory.appendingPathComponent("library.json")
        let file = FileManager.default.fileExists(atPath: specific.path) ? specific : legacy
        let imported: [Track] =
          FileManager.default.fileExists(atPath: file.path)
          ? try JSONDecoder().decode([Track].self, from: Data(contentsOf: file)) : []
        try db.transaction {
          // Migration and its marker commit together; originals remain untouched.
          if !imported.isEmpty,
            try db.rows("SELECT id FROM videos WHERE source=? LIMIT 1", [source.rawValue]).isEmpty
          {
            try write(
              LibraryDocument(
                tracks: imported,
                playlists: [
                  LibraryPlaylist(
                    id: "legacy", title: "Bibliothèque importée", videoIDs: imported.map(\.id))
                ]), source: source, replace: false, db: db)
          }
          try db.exec("INSERT OR IGNORE INTO migrations VALUES(?)", [marker])
        }
      }
    }
    try FileManager.default.setAttributes(
      [.posixPermissions: 0o600], ofItemAtPath: databaseURL.path)
  }
  public func count(_ source: Source) throws -> Int {
    try database { db in
      Int(try db.rows("SELECT count(*) FROM videos WHERE source=?", [source.rawValue])[0][0]) ?? 0
    }
  }
  public func read(_ source: Source) throws -> [Track] {
    try database { db in
      try decode(
        db.rows("SELECT payload FROM videos WHERE source=? ORDER BY rowid", [source.rawValue]))
    }
  }
  public func save(_ tracks: [Track], source: Source) throws {
    try commit(
      LibraryDocument(
        tracks: tracks,
        playlists: [
          LibraryPlaylist(id: "snapshot", title: "Bibliothèque", videoIDs: tracks.map(\.id))
        ]), source: source, replace: true)
  }
  public func commit(_ document: LibraryDocument, source: Source, replace: Bool = false) throws {
    try prepare()
    try database { db in
      try db.transaction { try write(document, source: source, replace: replace, db: db) }
    }
  }
  public func playlists(_ source: Source) throws -> [LibraryPlaylist] {
    try database { db in
      try db.rows(
        "SELECT id,title,coalesce(url,'') FROM playlists WHERE source=? ORDER BY rowid",
        [source.rawValue]
      ).map { row in
        let ids = try db.rows(
          "SELECT video FROM members WHERE source=? AND playlist=? ORDER BY position",
          [source.rawValue, row[0]]
        ).map { $0[0] }
        return LibraryPlaylist(
          id: row[0], title: row[1], url: row[2].isEmpty ? nil : row[2], videoIDs: ids)
      }
    }
  }
  // Every word must match first. When nothing does, any word matches and FTS5 rank orders
  // results, so a mood query such as "jazz doux soirée" still finds candidates.
  public func search(
    _ query: String, source: Source, playlist: String? = nil, offset: Int = 0,
    limit: Int = 100, excluded: Set<String> = []
  ) throws -> [Track] {
    try searchPage(query, source: source, playlist: playlist, offset: offset,
                   limit: limit, excluded: excluded).tracks
  }
  public func searchPage(
    _ query: String, source: Source, playlist: String? = nil, offset: Int = 0,
    limit: Int = 100, excluded: Set<String> = []
  ) throws -> LibrarySearchPage {
    let words = query.components(separatedBy: CharacterSet.alphanumerics.inverted).filter {
      !$0.isEmpty
    }.prefix(20).map { "\"" + $0 + "\"*" }
    return try database { db in
      func filtered(_ match: String) -> (sql: String, args: [String]) {
        var sql = "FROM videos v "
        var args: [String] = []
        if !match.isEmpty { sql += "JOIN video_search f ON f.source=v.source AND f.id=v.id " }
        if playlist != nil { sql += "JOIN members m ON m.source=v.source AND m.video=v.id " }
        sql += "WHERE v.source=? "
        args.append(source.rawValue)
        if !match.isEmpty {
          sql += "AND video_search MATCH ? "
          args.append(match)
        }
        if let playlist {
          sql += "AND m.playlist=? "
          args.append(playlist)
        }
        if !excluded.isEmpty {
          let ids = Array(excluded.prefix(100))
          sql +=
            "AND v.id NOT IN (" + Array(repeating: "?", count: ids.count).joined(separator: ",")
            + ") "
          args += ids
        }
        return (sql, args)
      }
      var match = words.joined(separator: " AND ")
      if words.count > 1 {
        let strict = filtered(match)
        if try db.rows("SELECT 1 " + strict.sql + "LIMIT 1", strict.args).isEmpty {
          match = words.joined(separator: " OR ")
        }
      }
      let (from, args) = filtered(match)
      // Playlist rows keep repeated positions; callers identify rows by position.
      // Title and channel outweigh descriptions, where tags and links mention everything.
      let order =
        playlist != nil
        ? "m.position" : match.isEmpty ? "v.rowid" : "bm25(video_search, 0, 0, 10, 5, 1)"
      let total = Int(try db.rows("SELECT count(*) " + from, args)[0][0]) ?? 0
      let tracks = try decode(
        db.rows(
          "SELECT v.payload " + from + "ORDER BY " + order + " LIMIT ? OFFSET ?",
          args + [String(min(max(limit, 1), 200)), String(max(offset, 0))]))
      return LibrarySearchPage(tracks: tracks, total: total)
    }
  }
  public func export(_ source: Source) throws -> Data {
    try database { db in
      var output = Data()
      try db.transaction {
        let tracks = try decode(
          db.rows("SELECT payload FROM videos WHERE source=? ORDER BY rowid", [source.rawValue]))
        let indexed = Dictionary(uniqueKeysWithValues: tracks.map { ($0.id, $0) })
        var collections: [[String: Any]] = try db.rows(
          "SELECT id,title,coalesce(url,'') FROM playlists WHERE source=? ORDER BY rowid",
          [source.rawValue]
        ).map { list in
          let ids = try db.rows(
            "SELECT video FROM members WHERE source=? AND playlist=? ORDER BY position",
            [source.rawValue, list[0]]
          ).map { $0[0] }
          return [
            "playlist": ["id": list[0], "title": list[1], "url": list[2]],
            "videos": ids.compactMap { indexed[$0] }.map(exportRow),
          ]
        }
        let assigned = Set(
          try db.rows("SELECT DISTINCT video FROM members WHERE source=?", [source.rawValue]).map {
            $0[0]
          })
        let unassigned = tracks.filter { !assigned.contains($0.id) }
        if !unassigned.isEmpty {
          collections.append([
            "playlist": ["id": LibraryDocument.unassignedID, "title": "Autres vidéos"],
            "videos": unassigned.map(exportRow),
          ])
        }
        output = try JSONSerialization.data(
          withJSONObject: ["format": "playlist-recall", "version": 1, "collections": collections],
          options: .prettyPrinted)
      }
      return output
    }
  }
  private func exportRow(_ track: Track) -> [String: Any] {
    var row: [String: Any] = [
      "id": track.id, "title": track.title, "description": track.description ?? "",
    ]
    row["metadataUnavailable"] = track.metadataUnavailable
    row["channel"] = track.channel
    row["duration_seconds"] = track.durationSeconds
    return row
  }
  private func decode(_ rows: [[String]]) throws -> [Track] {
    try rows.map { try JSONDecoder().decode(Track.self, from: Data($0[0].utf8)) }
  }
  private func write(
    _ document: LibraryDocument, source: Source, replace: Bool, db: SQLiteConnection
  ) throws {
    guard document.tracks.count <= 50_000 else {
      throw RecallError.message("Maximum 50 000 vidéos par import.")
    }
    let s = source.rawValue
    if replace {
      for table in ["videos", "video_search", "members", "playlists"] {
        try db.exec("DELETE FROM \(table) WHERE source=?", [s])
      }
    }
    for incoming in document.tracks {
      var track = incoming
      if let previous = try decode(
        db.rows("SELECT payload FROM videos WHERE source=? AND id=?", [s, incoming.id])
      ).first {
        track = Track(
          id: incoming.id, title: incoming.title, channel: incoming.channel ?? previous.channel,
          durationSeconds: incoming.durationSeconds ?? previous.durationSeconds,
          description: (incoming.description?.isEmpty == false
            ? incoming.description : previous.description),
          metadataUnavailable: incoming.metadataUnavailable)
      }
      guard track.id.range(of: "^[A-Za-z0-9_-]{11}$", options: .regularExpression) != nil else {
        throw RecallError.message("Vidéo invalide.")
      }
      let payload = String(decoding: try JSONEncoder().encode(track), as: UTF8.self)
      try db.exec(
        "INSERT INTO videos VALUES(?,?,?) ON CONFLICT(source,id) DO UPDATE SET payload=excluded.payload",
        [s, track.id, payload])
      try db.exec(
        "DELETE FROM video_search WHERE rowid=(SELECT rowid FROM videos WHERE source=? AND id=?)",
        [s, track.id])
      try db.exec(
        "INSERT INTO video_search(rowid,source,id,title,channel,description) SELECT rowid,?,?,?,?,? FROM videos WHERE source=? AND id=?",
        [s, track.id, track.title, track.channel ?? "", track.description ?? "", s, track.id])
    }
    for list in document.playlists {
      try db.exec(
        "INSERT INTO playlists VALUES(?,?,?,?) ON CONFLICT(source,id) DO UPDATE SET title=excluded.title,url=excluded.url",
        [s, list.id, list.title, list.url ?? ""])
      try db.exec("DELETE FROM members WHERE source=? AND playlist=?", [s, list.id])
      for (position, id) in list.videoIDs.enumerated() {
        guard try !db.rows("SELECT id FROM videos WHERE source=? AND id=?", [s, id]).isEmpty else {
          throw RecallError.message("Playlist contenant une vidéo inconnue.")
        }
        try db.exec("INSERT INTO members VALUES(?,?,?,?)", [s, list.id, String(position), id])
      }
    }
  }
  private func database<T>(_ operation: (SQLiteConnection) throws -> T) throws -> T {
    let db = try SQLiteConnection(url: databaseURL)
    return try operation(db)
  }
}

public struct LibrarySearchPage: Sendable {
  public let tracks: [Track]
  public let total: Int
  public init(tracks: [Track], total: Int) {
    self.tracks = tracks
    self.total = total
  }
}
