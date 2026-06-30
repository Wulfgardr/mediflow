import Foundation
import MediFlowSQLiteC

// ADR 0071 Fase 2: the minimal SQLite wrapper shared by the local-authority stores
// (SQLitePatientStore + SQLiteClinicalStore). Extracted from SQLitePatientStore so
// the patient and clinical write paths reuse one connection/bind/row implementation
// over the vendored SQLite. Internal to MediFlowCore; the native consumes the web
// schema and never migrates it (assertSchema fails fast on drift).

enum SQLiteStoreError: Error, Equatable {
    case cannotOpen(String)
    case query(String)
    case incompatibleSchema(String)
}

/// A typed bind value: text / integer / NULL (the only column kinds the stores write).
enum SQLiteBind {
    case text(String)
    case int(Int)
    case null
}

final class SQLiteConnection {
    private let handle: OpaquePointer
    private static let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

    private init(path: String, flags: Int32) throws {
        var db: OpaquePointer?
        let rc = sqlite3_open_v2(path, &db, flags, nil)
        guard rc == SQLITE_OK, let db else {
            if let db { sqlite3_close(db) }
            throw SQLiteStoreError.cannotOpen("sqlite3_open_v2 rc=\(rc) for \(path)")
        }
        handle = db
    }

    convenience init(readOnlyPath: String) throws {
        try self.init(path: readOnlyPath, flags: SQLITE_OPEN_READONLY)
    }

    convenience init(readWritePath: String) throws {
        try self.init(path: readWritePath, flags: SQLITE_OPEN_READWRITE)
    }

    deinit { sqlite3_close(handle) }

    /// Rows changed by the most recent statement on this connection.
    var changes: Int { Int(sqlite3_changes(handle)) }

    /// Run a non-query statement (BEGIN/COMMIT/ROLLBACK, DDL in tests).
    func execute(_ sql: String) throws {
        var errorMessage: UnsafeMutablePointer<CChar>?
        let rc = sqlite3_exec(handle, sql, nil, nil, &errorMessage)
        guard rc == SQLITE_OK else {
            let message = errorMessage.map { String(cString: $0) } ?? String(cString: sqlite3_errmsg(handle))
            sqlite3_free(errorMessage)
            throw SQLiteStoreError.query(message)
        }
    }

    /// Fail-fast schema guard: `table` must carry every column the store reads OR
    /// writes. The native never migrates the web's schema.
    func assertSchema(table: String, requiredColumns: [String]) throws {
        var present = Set<String>()
        _ = try run("PRAGMA table_info(\(table))") { row -> Int in
            if let name = row.text(1) { present.insert(name) }
            return 0
        }
        let missing = requiredColumns.filter { !present.contains($0) }
        guard missing.isEmpty else {
            throw SQLiteStoreError.incompatibleSchema("\(table) table missing columns: \(missing.joined(separator: ", "))")
        }
    }

    func run<T>(_ sql: String, bind params: [SQLiteBind] = [], _ map: (SQLiteRow) -> T) throws -> [T] {
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(handle, sql, -1, &stmt, nil) == SQLITE_OK, let stmt else {
            throw SQLiteStoreError.query(String(cString: sqlite3_errmsg(handle)))
        }
        defer { sqlite3_finalize(stmt) }
        for (index, value) in params.enumerated() {
            let position = Int32(index + 1)
            switch value {
            case .text(let string): sqlite3_bind_text(stmt, position, string, -1, Self.transient)
            case .int(let number): sqlite3_bind_int64(stmt, position, Int64(number))
            case .null: sqlite3_bind_null(stmt, position)
            }
        }
        var out: [T] = []
        while true {
            let rc = sqlite3_step(stmt)
            if rc == SQLITE_ROW {
                out.append(map(SQLiteRow(stmt: stmt)))
            } else if rc == SQLITE_DONE {
                break
            } else {
                throw SQLiteStoreError.query(String(cString: sqlite3_errmsg(handle)))
            }
        }
        return out
    }
}

/// Column accessors for one result row.
struct SQLiteRow {
    let stmt: OpaquePointer

    func text(_ col: Int32) -> String? {
        guard sqlite3_column_type(stmt, col) != SQLITE_NULL,
              let c = sqlite3_column_text(stmt, col) else { return nil }
        return String(cString: c)
    }

    func int(_ col: Int32) -> Int? {
        guard sqlite3_column_type(stmt, col) != SQLITE_NULL else { return nil }
        return Int(sqlite3_column_int64(stmt, col))
    }

    /// SQLite stores booleans as 0/1 integers.
    func bool(_ col: Int32) -> Bool? {
        guard let value = int(col) else { return nil }
        return value != 0
    }

    /// unixepoch seconds -> Date.
    func date(_ col: Int32) -> Date? {
        guard let value = int(col) else { return nil }
        return Date(timeIntervalSince1970: TimeInterval(value))
    }
}
