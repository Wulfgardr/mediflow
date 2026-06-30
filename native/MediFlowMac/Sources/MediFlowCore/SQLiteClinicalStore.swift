import Foundation
import Crypto

// ADR 0071 Fase 2: the reversed-flow WRITE authority for the clinical sub-resources
// (entry / therapy / checkup / observation), ported 1:1 from lib/network-{e}-write.ts
// updateNetworkScoped*. Each update runs: version-first 400 -> sub-resource write
// boundary -> "No valid fields" 400 -> a transaction that checks the row is in scope
// (404), then a version-guarded UPDATE (409 on mismatch via the pure
// ClinicalConcurrency). SOFT-DELETE is just an update that carries deletedAt +
// deletionReason (the web has no separate delete path; the audit event flips, which
// the store does not model). The ENCRYPTED_FIELDS are sealed in-core.
//
// PARITY NOTE (scope): the web checks the row's patient is in the ambulatory via the
// patients_to_ambulatories membership join; on-device we use the denormalized
// patients.ambulatory_id (the same deferral as SQLitePatientStore). The clinical
// UPDATE itself is NOT active-filtered (a soft-deleted row can still be updated),
// matching the web. CREATE is a separate follow-up slice (per-entity defaults +
// entry idempotency).
//
// PAYLOAD NOTE: the typed *UpdatePayload types use plain optionals (nil = omit) for
// the clinical fields, so the store can SET a field but cannot CLEAR it to null
// (and cannot clear endDate/restore a tombstone). That is a pre-existing limit of
// the shared payloads (the HTTP client uses the same types), not introduced here.

public struct SQLiteClinicalStore {
    /// 1:1 with the web sub-resource responses: updated=200,
    /// versionRequired/noValidFields=400, boundaryRejected=403/400, notFound=404,
    /// conflict=409. encryptionFailed is the local fail-closed guard (no web peer).
    public enum ClinicalWriteOutcome: Equatable {
        case updated(version: Int)
        case versionRequired
        case noValidFields
        case boundaryRejected(status: Int, error: String)
        case notFound
        case conflict(VersionConflictPayload)
        case encryptionFailed

        /// HTTP-equivalent (status, error-copy), locking the web wire strings.
        public var wireResponse: (status: Int, error: String?) {
            switch self {
            case .updated: return (200, nil)
            case .versionRequired: return (400, "Version is required")
            case .noValidFields: return (400, "No valid fields to update")
            case .boundaryRejected(let status, let error): return (status, error)
            case .notFound: return (404, "Not found")
            case .conflict: return (409, nil)
            case .encryptionFailed: return (500, "Failed to secure the record")
            }
        }
    }

    private let path: String

    public init(path: String) {
        self.path = path
    }

    // MARK: Per-entity update (soft-delete = update carrying deletedAt + deletionReason)

    public func updateEntry(
        id: String, patientId: String, scopeAmbulatoryId: String,
        payload: HomeBaseEntryUpdatePayload, masterKey: SymmetricKey, now: Date = Date()
    ) throws -> ClinicalWriteOutcome {
        var b = AssignmentBuilder(masterKey: masterKey)
        b.plainText("type", "type", payload.type)
        b.sealString("title", "title", payload.title)       // entries: title ENCRYPTED
        b.sealString("content", "content", payload.content)  // entries: content ENCRYPTED
        b.date("date", "date", payload.date)
        b.plainText("setting", "setting", payload.setting)   // entries: setting plaintext
        b.date("deletedAt", "deleted_at", payload.deletedAt)
        b.sealString("deletionReason", "deletion_reason", payload.deletionReason)
        return try runUpdate(.entry, "entry", "entries", Self.entryColumns,
                             id: id, patientId: patientId, scope: scopeAmbulatoryId,
                             rawVersion: payload.version, builder: b, now: now)
    }

    public func updateTherapy(
        id: String, patientId: String, scopeAmbulatoryId: String,
        payload: HomeBaseTherapyUpdatePayload, masterKey: SymmetricKey, now: Date = Date()
    ) throws -> ClinicalWriteOutcome {
        var b = AssignmentBuilder(masterKey: masterKey)
        b.plainText("drugName", "drug_name", payload.drugName)
        b.plainText("aic", "aic", payload.aic)
        b.plainText("atc", "atc", payload.atc)
        b.plainText("activePrinciple", "active_principle", payload.activePrinciple)
        b.plainText("diagnosisCode", "diagnosis_code", payload.diagnosisCode)
        b.plainText("diagnosisName", "diagnosis_name", payload.diagnosisName)
        b.plainText("dosage", "dosage", payload.dosage)
        b.plainText("status", "status", payload.status)
        b.date("startDate", "start_date", payload.startDate)
        b.date("endDate", "end_date", payload.endDate)
        b.sealString("motivation", "motivation", payload.motivation)  // therapies: motivation ENCRYPTED
        b.date("deletedAt", "deleted_at", payload.deletedAt)
        b.sealString("deletionReason", "deletion_reason", payload.deletionReason)
        return try runUpdate(.therapy, "therapy", "therapies", Self.therapyColumns,
                             id: id, patientId: patientId, scope: scopeAmbulatoryId,
                             rawVersion: payload.version, builder: b, now: now)
    }

    public func updateCheckup(
        id: String, patientId: String, scopeAmbulatoryId: String,
        payload: HomeBaseCheckupUpdatePayload, masterKey: SymmetricKey, now: Date = Date()
    ) throws -> ClinicalWriteOutcome {
        var b = AssignmentBuilder(masterKey: masterKey)
        b.date("date", "date", payload.date)
        b.plainText("title", "title", payload.title)   // checkups: title is plaintext
        b.plainText("status", "status", payload.status)
        b.plainText("source", "source", payload.source)
        b.sealString("notes", "notes", payload.notes)  // checkups ENCRYPTED_FIELDS = [notes] ONLY
        b.date("deletedAt", "deleted_at", payload.deletedAt)
        // checkups: deletion_reason is NOT in ENCRYPTED_FIELDS (lib/db.ts) -> plaintext.
        b.plainText("deletionReason", "deletion_reason", payload.deletionReason)
        return try runUpdate(.checkup, "checkup", "checkups", Self.checkupColumns,
                             id: id, patientId: patientId, scope: scopeAmbulatoryId,
                             rawVersion: payload.version, builder: b, now: now)
    }

    public func updateObservation(
        id: String, patientId: String, scopeAmbulatoryId: String,
        payload: HomeBaseObservationUpdatePayload, masterKey: SymmetricKey, now: Date = Date()
    ) throws -> ClinicalWriteOutcome {
        var b = AssignmentBuilder(masterKey: masterKey)
        b.plainText("codeSystem", "code_system", payload.codeSystem)
        b.plainText("code", "code", payload.code)
        b.plainText("display", "display", payload.display)
        b.plainText("unitSystem", "unit_system", payload.unitSystem)
        b.plainText("unitCode", "unit_code", payload.unitCode)
        // value is a plaintext string column; the web trims it (normalizeObservationValue).
        b.plainText("value", "value", payload.value.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) })
        b.date("observedAt", "observed_at", payload.observedAt)
        b.plainText("source", "source", payload.source)
        b.sealString("notes", "notes", payload.notes)     // observations ENCRYPTED_FIELDS = [notes] ONLY
        b.date("deletedAt", "deleted_at", payload.deletedAt)
        // observations: deletion_reason is NOT in ENCRYPTED_FIELDS (lib/db.ts) -> plaintext.
        b.plainText("deletionReason", "deletion_reason", payload.deletionReason)
        return try runUpdate(.observation, "observation", "observations", Self.observationColumns,
                             id: id, patientId: patientId, scope: scopeAmbulatoryId,
                             rawVersion: payload.version, builder: b, now: now)
    }

    // MARK: Shared version-guarded update skeleton

    private func runUpdate(
        _ resource: NetworkWriteBoundary.SubResource, _ entity: String, _ table: String,
        _ requiredColumns: [String], id: String, patientId: String, scope: String,
        rawVersion: Int, builder: AssignmentBuilder, now: Date
    ) throws -> ClinicalWriteOutcome {
        // 1. Version first (1:1 parse{Entity}ExpectedVersion).
        guard let expected = ClinicalConcurrency.parseExpectedVersion(rawVersion) else {
            return .versionRequired
        }
        // 2. Sub-resource write boundary. The typed payload structurally cannot carry
        //    the forbidden AI / client-controlled fields, so this is .allowed today;
        //    kept wired as the authority seam for future untyped / peer-sourced writes.
        let boundary = NetworkWriteBoundary.validateSubResource(
            resource, mode: .update, presentFields: builder.presentFields)
        if case .rejected(let status, let error) = boundary {
            return .boundaryRejected(status: status, error: error)
        }
        // 3. Seal outcome + "No valid fields".
        guard let fieldAssignments = builder.assignments else { return .encryptionFailed }
        guard !fieldAssignments.isEmpty else { return .noValidFields }

        // 4. Transaction: scoped existence -> concurrency -> version-guarded UPDATE.
        let db = try SQLiteConnection(readWritePath: path)
        try db.assertSchema(table: table, requiredColumns: requiredColumns)
        try db.execute("BEGIN IMMEDIATE")
        do {
            let snapshot = try selectScopedSnapshot(db, table: table, id: id, patientId: patientId, scope: scope)
            switch ClinicalConcurrency.evaluate(rawVersion: rawVersion, entity: entity, recordId: id, current: snapshot) {
            case .versionRequired:
                try db.execute("ROLLBACK"); return .versionRequired
            case .notFound:
                try db.execute("ROLLBACK"); return .notFound
            case .conflict(let conflict):
                try db.execute("ROLLBACK"); return .conflict(conflict)
            case .ok(let nextVersion):
                var columns = fieldAssignments
                columns.append(("version", .int(nextVersion)))
                columns.append(("updated_at", .int(Int(now.timeIntervalSince1970))))
                let setClause = columns.map { "\($0.column) = ?" }.joined(separator: ", ")
                // Version-guarded, NOT active-filtered (matches the web sub-resource update).
                let sql = "UPDATE \(table) SET \(setClause) WHERE id = ? AND patient_id = ? AND version = ?"
                let binds = columns.map { $0.bind } + [.text(id), .text(patientId), .int(expected)]
                _ = try db.run(sql, bind: binds) { _ in 0 }
                if db.changes == 0 {
                    // Raced between the scoped read and the version-guarded UPDATE: re-read
                    // the unscoped snapshot (id + patientId), 1:1 with select*ConflictSnapshot.
                    let raced = try selectConflictSnapshot(db, table: table, id: id, patientId: patientId)
                    try db.execute("ROLLBACK")
                    return .conflict(ClinicalConcurrency.buildVersionConflictPayload(
                        entity: entity, expectedVersion: expected, recordId: id, current: raced))
                }
                try db.execute("COMMIT")
                return .updated(version: nextVersion)
            }
        } catch {
            try? db.execute("ROLLBACK")
            throw error
        }
    }

    /// Existence-in-scope read: the row joined to its patient's denormalized
    /// ambulatory (the web joins patients_to_ambulatories). nil -> 404.
    private func selectScopedSnapshot(
        _ db: SQLiteConnection, table: String, id: String, patientId: String, scope: String
    ) throws -> ClinicalConcurrency.ConflictSource? {
        let sql = """
        SELECT t.id, t.patient_id, t.version, t.updated_at, t.deleted_at
        FROM \(table) t JOIN patients p ON t.patient_id = p.id
        WHERE t.id = ? AND t.patient_id = ? AND p.ambulatory_id = ?
        """
        return try db.run(sql, bind: [.text(id), .text(patientId), .text(scope)]) { row in
            ClinicalConcurrency.ConflictSource(
                id: row.text(0) ?? "", patientId: row.text(1) ?? "", version: row.int(2) ?? 1,
                updatedAt: row.date(3), deletedAt: row.date(4))
        }.first
    }

    /// Unscoped conflict snapshot (id + patientId), 1:1 with select*ConflictSnapshot.
    private func selectConflictSnapshot(
        _ db: SQLiteConnection, table: String, id: String, patientId: String
    ) throws -> ClinicalConcurrency.ConflictSource? {
        let sql = """
        SELECT id, patient_id, version, updated_at, deleted_at FROM \(table)
        WHERE id = ? AND patient_id = ?
        """
        return try db.run(sql, bind: [.text(id), .text(patientId)]) { row in
            ClinicalConcurrency.ConflictSource(
                id: row.text(0) ?? "", patientId: row.text(1) ?? "", version: row.int(2) ?? 1,
                updatedAt: row.date(3), deletedAt: row.date(4))
        }.first
    }

    // MARK: Assignment builder (per-field omit / seal, fail-closed)

    /// Collects the SET assignments + present-field names from a typed update payload.
    /// `assignments` becomes nil if any ENCRYPTED field fails to seal (-> the store
    /// aborts rather than persist plaintext into an encrypted column).
    private struct AssignmentBuilder {
        let masterKey: SymmetricKey
        private(set) var pairs: [(column: String, bind: SQLiteBind)] = []
        private(set) var presentFields: Set<String> = []
        private var failed = false

        init(masterKey: SymmetricKey) { self.masterKey = masterKey }

        var assignments: [(column: String, bind: SQLiteBind)]? { failed ? nil : pairs }

        /// A plaintext string column (nil = omit).
        mutating func plainText(_ field: String, _ column: String, _ value: String?) {
            guard let value else { return }
            presentFields.insert(field)
            pairs.append((column, .text(value)))
        }

        /// A timestamp column stored as unixepoch seconds (nil = omit).
        mutating func date(_ field: String, _ column: String, _ value: Date?) {
            guard let value else { return }
            presentFields.insert(field)
            pairs.append((column, .int(Int(value.timeIntervalSince1970))))
        }

        /// An ENCRYPTED string column: JSON.stringify(value) then AES-GCM (nil = omit).
        mutating func sealString(_ field: String, _ column: String, _ value: String?) {
            guard let value else { return }
            presentFields.insert(field)
            guard case .sealed(let enc?) = CryptoService.seal(value, masterKey: masterKey) else {
                failed = true
                return
            }
            pairs.append((column, .text(enc)))
        }
    }

    // MARK: Required columns per table (read + write) for the fail-fast schema guard

    private static let entryColumns = [
        "id", "patient_id", "version", "updated_at", "deleted_at", "deletion_reason",
        "type", "title", "content", "date", "setting",
    ]
    private static let therapyColumns = [
        "id", "patient_id", "version", "updated_at", "deleted_at", "deletion_reason",
        "drug_name", "aic", "atc", "active_principle", "diagnosis_code", "diagnosis_name",
        "dosage", "status", "start_date", "end_date", "motivation",
    ]
    private static let checkupColumns = [
        "id", "patient_id", "version", "updated_at", "deleted_at", "deletion_reason",
        "date", "title", "status", "source", "notes",
    ]
    private static let observationColumns = [
        "id", "patient_id", "version", "updated_at", "deleted_at", "deletion_reason",
        "code_system", "code", "display", "unit_system", "unit_code", "value", "observed_at",
        "source", "notes",
    ]
}
