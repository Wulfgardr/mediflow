import Foundation
import Crypto
import MediFlowSQLiteC

// ADR 0071 Fase 2 (Codex review): the read-only first slice of the local-authority
// persistence. Opens a medical.db read-only, fails fast on schema drift (the native
// consumes the web schema and never migrates it), reads the active patients, and
// reuses PatientFieldCrypto to decrypt the ENCRYPTED_FIELDS in-process. The write
// path / transaction + the pure conflict policy (NetworkWriteBoundary,
// PatientConcurrency) come next.

public struct SQLitePatientStore {
    public enum StoreError: Error, Equatable {
        case cannotOpen(String)
        case query(String)
        case incompatibleSchema(String)
    }

    private let path: String

    public init(path: String) {
        self.path = path
    }

    /// Active (non-soft-deleted) patient summaries. No decryption needed: summary
    /// columns are plaintext.
    public func listPatients() throws -> [HomeBasePatientSummary] {
        let db = try Connection(readOnlyPath: path)
        try db.assertPatientsSchema()
        let sql = """
        SELECT id, first_name, last_name, tax_code, birth_date, is_adi, is_archived, version, updated_at
        FROM patients WHERE deleted_at IS NULL ORDER BY updated_at DESC
        """
        return try db.run(sql) { row in
            HomeBasePatientSummary(
                id: row.text(0) ?? "",
                firstName: row.text(1) ?? "",
                lastName: row.text(2) ?? "",
                birthDate: row.date(4),
                taxCode: row.text(3) ?? "",
                isAdi: row.bool(5),
                isArchived: row.bool(6),
                version: row.int(7) ?? 1,
                updatedAt: row.date(8))
        }
    }

    /// One patient's full detail with the ENCRYPTED_FIELDS decrypted by the operator
    /// master key. nil when the id is absent (or soft-deleted). Reuses
    /// PatientFieldCrypto so decryption stays byte-identical with the web.
    public func loadPatientDetail(id: String, masterKey: SymmetricKey) throws -> HomeBasePatientDetail? {
        let db = try Connection(readOnlyPath: path)
        try db.assertPatientsSchema()
        let sql = """
        SELECT id, first_name, last_name, tax_code, birth_date, address, phone, caregiver, notes,
               ai_summary, is_adi, is_archived, ambulatory_id, created_at, updated_at, document_insights,
               exemptions, diagnoses, monitoring_profile, status_reason, version
        FROM patients WHERE id = ? AND deleted_at IS NULL
        """
        let rows = try db.run(sql, bind: [id]) { row -> HomeBasePatientDetail in
            // The encrypted columns are read RAW (ENC:iv:data); PatientFieldCrypto
            // decrypts them below, exactly as it does for a fetched network detail.
            HomeBasePatientDetail(
                id: row.text(0) ?? "", firstName: row.text(1) ?? "", lastName: row.text(2) ?? "",
                birthDate: row.date(4), taxCode: row.text(3) ?? "",
                address: row.text(5), phone: row.text(6), caregiver: row.text(7),
                exemptions: row.text(16), diagnoses: row.text(17), monitoringProfile: row.text(18),
                statusReason: row.text(19), notes: row.text(8), aiSummary: row.text(9),
                documentInsights: row.text(15), isAdi: row.bool(10), isArchived: row.bool(11),
                version: row.int(20) ?? 1, ambulatoryId: row.text(12),
                createdAt: row.date(13), updatedAt: row.date(14))
        }
        guard let raw = rows.first else { return nil }
        return PatientFieldCrypto.decryptDetail(raw, masterKey: masterKey)
    }

    // MARK: Minimal read-only SQLite wrapper (confined here)

    private final class Connection {
        private let handle: OpaquePointer
        private static let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

        init(readOnlyPath: String) throws {
            var db: OpaquePointer?
            let rc = sqlite3_open_v2(readOnlyPath, &db, SQLITE_OPEN_READONLY, nil)
            guard rc == SQLITE_OK, let db else {
                if let db { sqlite3_close(db) }
                throw StoreError.cannotOpen("sqlite3_open_v2 rc=\(rc) for \(readOnlyPath)")
            }
            handle = db
        }

        deinit { sqlite3_close(handle) }

        /// Fail-fast schema guard: the patients table must carry the columns the
        /// store reads. The native never migrates the web's schema.
        func assertPatientsSchema() throws {
            let required = ["id", "first_name", "last_name", "tax_code", "version", "deleted_at",
                            "address", "phone", "caregiver", "exemptions", "diagnoses", "updated_at"]
            var present = Set<String>()
            _ = try run("PRAGMA table_info(patients)") { row -> Int in
                if let name = row.text(1) { present.insert(name) }
                return 0
            }
            let missing = required.filter { !present.contains($0) }
            guard missing.isEmpty else {
                throw StoreError.incompatibleSchema("patients table missing columns: \(missing.joined(separator: ", "))")
            }
        }

        func run<T>(_ sql: String, bind params: [String] = [], _ map: (Row) -> T) throws -> [T] {
            var stmt: OpaquePointer?
            guard sqlite3_prepare_v2(handle, sql, -1, &stmt, nil) == SQLITE_OK, let stmt else {
                throw StoreError.query(String(cString: sqlite3_errmsg(handle)))
            }
            defer { sqlite3_finalize(stmt) }
            for (index, value) in params.enumerated() {
                sqlite3_bind_text(stmt, Int32(index + 1), value, -1, Self.transient)
            }
            var out: [T] = []
            while true {
                let rc = sqlite3_step(stmt)
                if rc == SQLITE_ROW {
                    out.append(map(Row(stmt: stmt)))
                } else if rc == SQLITE_DONE {
                    break
                } else {
                    throw StoreError.query(String(cString: sqlite3_errmsg(handle)))
                }
            }
            return out
        }
    }

    /// Column accessors for one result row.
    private struct Row {
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
}
