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

    /// 1:1 with the web sub-resource create responses: created=201. idempotent=200
    /// and idConflict=409 are entry-only (client-id retry semantics). notFound=404
    /// is the patient-out-of-scope path; encryptionFailed is the fail-closed guard.
    public enum ClinicalCreateOutcome: Equatable {
        case created(id: String, version: Int)
        case idempotent(id: String, version: Int)
        case idConflict(error: String)
        case boundaryRejected(status: Int, error: String)
        case notFound
        case encryptionFailed

        public var wireResponse: (status: Int, error: String?) {
            switch self {
            case .created: return (201, nil)
            case .idempotent: return (200, nil)
            case .idConflict(let error): return (409, error)
            case .boundaryRejected(let status, let error): return (status, error)
            case .notFound: return (404, "Not found")
            case .encryptionFailed: return (500, "Failed to secure the record")
            }
        }
    }

    private let path: String

    public init(path: String) {
        self.path = path
    }

    // MARK: Per-entity list (read), 1:1 with lib/network-{e}-read.ts listNetworkScoped*.
    // NOT active-filtered (soft-deleted rows are listed too, same as the web); scoped
    // via the denormalized patients.ambulatory_id (same PARITY NOTE as the writes).
    // Decrypts the ENCRYPTED_FIELDS in-core via ClinicalFieldCrypto, mirroring
    // SQLitePatientStore.loadPatientDetail's decrypt-before-return shape.

    public func listEntries(
        patientId: String, scopeAmbulatoryId: String, masterKey: SymmetricKey, limit: Int? = nil
    ) throws -> [HomeBaseEntrySummary] {
        let sql = """
        SELECT e.id, e.patient_id, e.type, e.title, e.date, e.content, e.setting, e.metadata,
               e.attachments, e.deleted_at, e.deletion_reason, e.version, e.created_at, e.updated_at
        FROM entries e JOIN patients p ON e.patient_id = p.id
        WHERE e.patient_id = ? AND p.ambulatory_id = ? ORDER BY e.date DESC\(limitClause(limit))
        """
        let raw = try listQuery(sql, table: "entries", requiredColumns: Self.entryColumns,
                                patientId: patientId, scope: scopeAmbulatoryId, limit: limit) { row in
            HomeBaseEntrySummary(
                id: row.text(0) ?? "", patientId: row.text(1) ?? "", type: row.text(2) ?? "",
                title: row.text(3) ?? "", date: row.date(4) ?? Date(timeIntervalSince1970: 0),
                content: row.text(5) ?? "", setting: row.text(6), metadata: row.text(7),
                attachments: row.text(8), deletedAt: row.date(9), deletionReason: row.text(10),
                version: row.int(11) ?? 1, createdAt: row.date(12), updatedAt: row.date(13))
        }
        return raw.map { ClinicalFieldCrypto.decryptEntry($0, masterKey: masterKey) }
    }

    public func listTherapies(
        patientId: String, scopeAmbulatoryId: String, masterKey: SymmetricKey, limit: Int? = nil
    ) throws -> [HomeBaseTherapySummary] {
        let sql = """
        SELECT t.id, t.patient_id, t.drug_name, t.aic, t.atc, t.active_principle, t.dosage,
               t.motivation, t.diagnosis_code, t.diagnosis_name, t.status, t.start_date, t.end_date,
               t.version, t.created_at, t.updated_at, t.deleted_at, t.deletion_reason
        FROM therapies t JOIN patients p ON t.patient_id = p.id
        WHERE t.patient_id = ? AND p.ambulatory_id = ? ORDER BY t.start_date DESC\(limitClause(limit))
        """
        let raw = try listQuery(sql, table: "therapies", requiredColumns: Self.therapyColumns,
                                patientId: patientId, scope: scopeAmbulatoryId, limit: limit) { row in
            HomeBaseTherapySummary(
                id: row.text(0) ?? "", patientId: row.text(1) ?? "", drugName: row.text(2) ?? "",
                aic: row.text(3), atc: row.text(4), activePrinciple: row.text(5),
                dosage: row.text(6) ?? "", motivation: row.text(7), diagnosisCode: row.text(8),
                diagnosisName: row.text(9), status: ClinicalStatusNormalization.therapyStatus(row.text(10)),
                startDate: row.date(11) ?? Date(timeIntervalSince1970: 0), endDate: row.date(12),
                version: row.int(13) ?? 1, createdAt: row.date(14), updatedAt: row.date(15),
                deletedAt: row.date(16), deletionReason: row.text(17))
        }
        return raw.map { ClinicalFieldCrypto.decryptTherapy($0, masterKey: masterKey) }
    }

    public func listCheckups(
        patientId: String, scopeAmbulatoryId: String, masterKey: SymmetricKey, limit: Int? = nil
    ) throws -> [HomeBaseCheckupSummary] {
        let sql = """
        SELECT c.id, c.patient_id, c.date, c.title, c.notes, c.status, c.source,
               c.version, c.created_at, c.updated_at, c.deleted_at, c.deletion_reason
        FROM checkups c JOIN patients p ON c.patient_id = p.id
        WHERE c.patient_id = ? AND p.ambulatory_id = ? ORDER BY c.date DESC\(limitClause(limit))
        """
        let raw = try listQuery(sql, table: "checkups", requiredColumns: Self.checkupColumns,
                                patientId: patientId, scope: scopeAmbulatoryId, limit: limit) { row in
            HomeBaseCheckupSummary(
                id: row.text(0) ?? "", patientId: row.text(1) ?? "",
                date: row.date(2) ?? Date(timeIntervalSince1970: 0), title: row.text(3) ?? "",
                notes: row.text(4), status: ClinicalStatusNormalization.checkupStatus(row.text(5)), source: row.text(6),
                version: row.int(7) ?? 1, createdAt: row.date(8), updatedAt: row.date(9),
                deletedAt: row.date(10), deletionReason: row.text(11))
        }
        return raw.map { ClinicalFieldCrypto.decryptCheckup($0, masterKey: masterKey) }
    }

    public func listObservations(
        patientId: String, scopeAmbulatoryId: String, masterKey: SymmetricKey, limit: Int? = nil
    ) throws -> [HomeBaseObservationSummary] {
        let sql = """
        SELECT o.id, o.patient_id, o.code_system, o.code, o.display, o.unit_system, o.unit_code,
               o.value, o.notes, o.observed_at, o.source, o.version, o.created_at, o.updated_at,
               o.deleted_at, o.deletion_reason
        FROM observations o JOIN patients p ON o.patient_id = p.id
        WHERE o.patient_id = ? AND p.ambulatory_id = ? ORDER BY o.observed_at DESC\(limitClause(limit))
        """
        let raw = try listQuery(sql, table: "observations", requiredColumns: Self.observationColumns,
                                patientId: patientId, scope: scopeAmbulatoryId, limit: limit) { row in
            HomeBaseObservationSummary(
                id: row.text(0) ?? "", patientId: row.text(1) ?? "", codeSystem: row.text(2) ?? "",
                code: row.text(3) ?? "", display: row.text(4) ?? "", unitSystem: row.text(5) ?? "",
                unitCode: row.text(6) ?? "", value: row.text(7) ?? "", notes: row.text(8),
                observedAt: row.date(9) ?? Date(timeIntervalSince1970: 0), source: row.text(10),
                version: row.int(11) ?? 1, createdAt: row.date(12), updatedAt: row.date(13),
                deletedAt: row.date(14), deletionReason: row.text(15))
        }
        return raw.map { ClinicalFieldCrypto.decryptObservation($0, masterKey: masterKey) }
    }

    /// `LIMIT ?` clause text; the bind value is appended by listQuery. Empty when the
    /// web would treat `limit` as falsy (nil, 0, or negative -> unbounded), matching
    /// `filters.limit ? query.limit(filters.limit) : query` in lib/network-{e}-read.ts.
    private func limitClause(_ limit: Int?) -> String { (limit ?? 0) > 0 ? " LIMIT ?" : "" }

    /// Shared list-query runner: opens a connection, asserts the schema, binds
    /// patientId + scope (+ limit when positive, matching limitClause), and maps each row.
    private func listQuery<T>(
        _ sql: String, table: String, requiredColumns: [String],
        patientId: String, scope: String, limit: Int?, _ map: (SQLiteRow) -> T
    ) throws -> [T] {
        let db = try SQLiteConnection(readOnlyPath: path)
        try db.assertSchema(table: table, requiredColumns: requiredColumns)
        var binds: [SQLiteBind] = [.text(patientId), .text(scope)]
        if let limit, limit > 0 { binds.append(.int(limit)) }
        return try db.run(sql, bind: binds, map)
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
        b.plainText("setting", "setting", Self.normalizedSetting(payload.setting))   // entries: setting plaintext, '' -> nil
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
        b.plainText("status", "status", payload.status.map { ClinicalStatusNormalization.therapyStatus($0) })
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
        b.plainText("status", "status", payload.status.map { ClinicalStatusNormalization.checkupStatus($0) })
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
        // Mirror the web normalizers: canonical 'LOINC'/'UCUM' uppercased; trim
        // code/display/unitCode/value.
        b.plainText("codeSystem", "code_system", payload.codeSystem.map { Self.canonicalSystem($0) })
        b.plainText("code", "code", payload.code.map { Self.trimmed($0) })
        b.plainText("display", "display", payload.display.map { Self.trimmed($0) })
        b.plainText("unitSystem", "unit_system", payload.unitSystem.map { Self.canonicalSystem($0) })
        b.plainText("unitCode", "unit_code", payload.unitCode.map { Self.trimmed($0) })
        b.plainText("value", "value", payload.value.map { Self.trimmed($0) })
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

    // MARK: Per-entity create (patient-in-scope 404 -> INSERT 201; entry has idempotency)

    public func createEntry(
        _ payload: HomeBaseEntryCreatePayload, patientId: String, scopeAmbulatoryId: String,
        masterKey: SymmetricKey, now: Date = Date()
    ) throws -> ClinicalCreateOutcome {
        let clientId = payload.id.trimmingCharacters(in: .whitespacesAndNewlines)
        let id = clientId.isEmpty ? UUID().uuidString.lowercased() : payload.id
        var b = AssignmentBuilder(masterKey: masterKey)
        b.text("type", "type", payload.type)
        b.sealRequired("title", "title", payload.title ?? Self.entryDefaultTitle)  // entries: title ENCRYPTED
        b.requiredDate("date", "date", payload.date)
        b.sealRequired("content", "content", payload.content)  // entries: content ENCRYPTED
        b.plainText("setting", "setting", Self.normalizedSetting(payload.setting))
        b.sealStructuredOrPassthrough("metadata", "metadata", payload.metadata)  // ENC structured or verbatim
        b.serverNull("attachments")  // attachment writes are excluded by the boundary
        b.serverCreate(id: id, patientId: patientId, now: now)
        // Idempotency only when the client supplied the id (1:1 with the web).
        let idempotency: ((SQLiteConnection) throws -> ClinicalCreateOutcome?)? = clientId.isEmpty ? nil : { db in
            try self.entryCreateIdempotency(db, id: id, patientId: patientId, payload: payload, masterKey: masterKey)
        }
        return try runCreate(.entry, "entries", Self.entryColumns, id: id, patientId: patientId,
                             scope: scopeAmbulatoryId, builder: b, idempotency: idempotency)
    }

    public func createTherapy(
        _ payload: HomeBaseTherapyCreatePayload, patientId: String, scopeAmbulatoryId: String,
        masterKey: SymmetricKey, id: String = UUID().uuidString.lowercased(), now: Date = Date()
    ) throws -> ClinicalCreateOutcome {
        var b = AssignmentBuilder(masterKey: masterKey)
        b.text("drugName", "drug_name", payload.drugName)
        b.plainText("aic", "aic", payload.aic)
        b.plainText("atc", "atc", payload.atc)
        b.plainText("activePrinciple", "active_principle", payload.activePrinciple)
        b.plainText("diagnosisCode", "diagnosis_code", payload.diagnosisCode)
        b.plainText("diagnosisName", "diagnosis_name", payload.diagnosisName)
        b.text("dosage", "dosage", payload.dosage)
        b.text("status", "status", ClinicalStatusNormalization.therapyStatus(payload.status))
        b.requiredDate("startDate", "start_date", payload.startDate)
        b.date("endDate", "end_date", payload.endDate)
        b.sealString("motivation", "motivation", payload.motivation)  // therapies: motivation ENCRYPTED
        b.serverCreate(id: id, patientId: patientId, now: now)
        return try runCreate(.therapy, "therapies", Self.therapyColumns, id: id, patientId: patientId,
                             scope: scopeAmbulatoryId, builder: b)
    }

    public func createCheckup(
        _ payload: HomeBaseCheckupCreatePayload, patientId: String, scopeAmbulatoryId: String,
        masterKey: SymmetricKey, id: String = UUID().uuidString.lowercased(), now: Date = Date()
    ) throws -> ClinicalCreateOutcome {
        var b = AssignmentBuilder(masterKey: masterKey)
        b.requiredDate("date", "date", payload.date)
        b.text("title", "title", payload.title)   // checkups: title plaintext
        b.text("status", "status", ClinicalStatusNormalization.checkupStatus(payload.status))
        b.text("source", "source", payload.source)
        b.sealString("notes", "notes", payload.notes)  // checkups ENCRYPTED_FIELDS = [notes] ONLY
        b.serverCreate(id: id, patientId: patientId, now: now)
        return try runCreate(.checkup, "checkups", Self.checkupColumns, id: id, patientId: patientId,
                             scope: scopeAmbulatoryId, builder: b)
    }

    public func createObservation(
        _ payload: HomeBaseObservationCreatePayload, patientId: String, scopeAmbulatoryId: String,
        masterKey: SymmetricKey, id: String = UUID().uuidString.lowercased(), now: Date = Date()
    ) throws -> ClinicalCreateOutcome {
        var b = AssignmentBuilder(masterKey: masterKey)
        // The web stores the canonical 'LOINC'/'UCUM' literal (uppercased) and trims
        // code/display/unitCode/value (normalizeObservation*); mirror that here.
        b.text("codeSystem", "code_system", Self.canonicalSystem(payload.codeSystem))
        b.text("code", "code", Self.trimmed(payload.code))
        b.text("display", "display", Self.trimmed(payload.display))
        b.text("unitSystem", "unit_system", Self.canonicalSystem(payload.unitSystem))
        b.text("unitCode", "unit_code", Self.trimmed(payload.unitCode))
        b.text("value", "value", Self.trimmed(payload.value))
        b.requiredDate("observedAt", "observed_at", payload.observedAt)
        b.text("source", "source", payload.source)
        b.sealString("notes", "notes", payload.notes)  // observations ENCRYPTED_FIELDS = [notes] ONLY
        b.serverCreate(id: id, patientId: patientId, now: now)
        return try runCreate(.observation, "observations", Self.observationColumns, id: id, patientId: patientId,
                             scope: scopeAmbulatoryId, builder: b)
    }

    private static let entryDefaultTitle = "Voce clinica"

    // Value-normalization helpers matching the web normalizers (lib/api-v1-clinical-write-normalization.ts).
    private static func trimmed(_ value: String) -> String {
        value.trimmingCharacters(in: .whitespacesAndNewlines)
    }
    /// Observation code/unit system: the web stores the canonical uppercase literal ('LOINC'/'UCUM').
    private static func canonicalSystem(_ value: String) -> String { trimmed(value).uppercased() }
    /// Entry setting: '' -> nil (web normalizeEntrySetting maps the empty string to NULL).
    private static func normalizedSetting(_ value: String?) -> String? {
        (value?.isEmpty ?? true) ? nil : value
    }

    // MARK: Shared create skeleton

    private func runCreate(
        _ resource: NetworkWriteBoundary.SubResource, _ table: String, _ requiredColumns: [String],
        id: String, patientId: String, scope: String, builder: AssignmentBuilder,
        idempotency: ((SQLiteConnection) throws -> ClinicalCreateOutcome?)? = nil
    ) throws -> ClinicalCreateOutcome {
        let boundary = NetworkWriteBoundary.validateSubResource(
            resource, mode: .create, presentFields: builder.presentFields)
        if case .rejected(let status, let error) = boundary {
            return .boundaryRejected(status: status, error: error)
        }
        guard let assignments = builder.assignments else { return .encryptionFailed }

        let db = try SQLiteConnection(readWritePath: path)
        try db.assertSchema(table: table, requiredColumns: requiredColumns)
        try db.execute("BEGIN IMMEDIATE")
        do {
            guard try patientIsInScope(db, patientId: patientId, scope: scope) else {
                try db.execute("ROLLBACK"); return .notFound
            }
            if let idempotency, let early = try idempotency(db) {
                try db.execute("ROLLBACK"); return early  // 200 idempotent / 409 id-conflict, nothing written
            }
            let columns = assignments.map { $0.column }.joined(separator: ", ")
            let placeholders = assignments.map { _ in "?" }.joined(separator: ", ")
            let sql = "INSERT INTO \(table) (\(columns)) VALUES (\(placeholders))"
            _ = try db.run(sql, bind: assignments.map { $0.bind }) { _ in 0 }
            try db.execute("COMMIT")
            return .created(id: id, version: 1)
        } catch {
            try? db.execute("ROLLBACK")
            throw error
        }
    }

    /// The entity's patient must be in the ambulatory scope (web: patientsToAmbulatories
    /// membership; on-device: the denormalized patients.ambulatory_id, same deferral).
    private func patientIsInScope(_ db: SQLiteConnection, patientId: String, scope: String) throws -> Bool {
        try !db.run("SELECT 1 FROM patients WHERE id = ? AND ambulatory_id = ?",
                    bind: [.text(patientId), .text(scope)]) { _ in true }.isEmpty
    }

    /// 1:1 with isSameEntryCreatePayload: when the client id already exists, an
    /// identical create is idempotent (200), a different one conflicts (409). The
    /// comparison is on DECRYPTED plaintext (ciphertext differs per IV).
    private func entryCreateIdempotency(
        _ db: SQLiteConnection, id: String, patientId: String,
        payload: HomeBaseEntryCreatePayload, masterKey: SymmetricKey
    ) throws -> ClinicalCreateOutcome? {
        let sql = """
        SELECT type, title, date, content, setting, metadata, attachments, deleted_at, version
        FROM entries WHERE id = ? AND patient_id = ?
        """
        let rows = try db.run(sql, bind: [.text(id), .text(patientId)]) { row in
            (type: row.text(0), title: row.text(1), date: row.date(2), content: row.text(3),
             setting: row.text(4), metadata: row.text(5), attachments: row.text(6),
             deletedAt: row.date(7), version: row.int(8) ?? 1)
        }
        guard let existing = rows.first else { return nil }  // no clash -> proceed to INSERT
        // Decrypt BOTH sides before comparing: the production caller (the model)
        // pre-seals title/content before calling createEntry, so payload.title/content
        // is itself an ENC: ciphertext on every real retry, never plaintext. Comparing
        // a decrypted existing value against a still-sealed incoming one would always
        // mismatch (a fresh random IV per call), turning every retry into a false
        // .idConflict instead of the intended .idempotent. decryptStringField no-ops on
        // non-ENC input, so a plaintext payload (e.g. from a test) still compares correctly.
        let dec = { PatientFieldCrypto.decryptStringField($0, masterKey: masterKey) }
        let same = existing.type == payload.type
            && dec(existing.title) == (dec(payload.title) ?? Self.entryDefaultTitle)
            && dec(existing.content) == dec(payload.content)
            && PatientFieldCrypto.decryptStructuredField(existing.metadata, masterKey: masterKey)
                == PatientFieldCrypto.decryptStructuredField(payload.metadata, masterKey: masterKey)
            && existing.setting == Self.normalizedSetting(payload.setting)
            && existing.attachments == nil
            && existing.deletedAt == nil
            && existing.date.map { Int($0.timeIntervalSince1970) } == Int(payload.date.timeIntervalSince1970)
        return same
            ? .idempotent(id: id, version: existing.version)
            : .idConflict(error: "Network diary create id already exists with different content")
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
        /// sealOrPassthrough (Fase 3 slice 5): a value ALREADY sealed for HTTP (the
        /// model pre-seals clinical write payloads too) passes through verbatim when
        /// it is authenticated ciphertext under this key; plaintext (or a forged
        /// "ENC:") is sealed. Avoids double-encryption without touching the model.
        mutating func sealString(_ field: String, _ column: String, _ value: String?) {
            guard let value else { return }
            presentFields.insert(field)
            guard case .sealed(let enc?) = CryptoService.sealOrPassthrough(value, masterKey: masterKey) else {
                failed = true
                return
            }
            pairs.append((column, .text(enc)))
        }

        // --- Required client fields (create): always set, tracked as present. ---

        mutating func text(_ field: String, _ column: String, _ value: String) {
            presentFields.insert(field)
            pairs.append((column, .text(value)))
        }

        mutating func requiredDate(_ field: String, _ column: String, _ value: Date) {
            presentFields.insert(field)
            pairs.append((column, .int(Int(value.timeIntervalSince1970))))
        }

        /// Required ENCRYPTED string column (create): same strict sealOrPassthrough as
        /// `sealString`, but the field is always present (no nil/omit case).
        mutating func sealRequired(_ field: String, _ column: String, _ value: String) {
            presentFields.insert(field)
            guard case .sealed(let enc?) = CryptoService.sealOrPassthrough(value, masterKey: masterKey) else {
                failed = true
                return
            }
            pairs.append((column, .text(enc)))
        }

        /// A structured ENCRYPTED field that may arrive plaintext (sealed in-core) or
        /// already-authenticated ciphertext under this key (stored verbatim). nil = omit.
        /// Strict (Codex): a value that merely looks like "ENC:" but is not decryptable
        /// is sealed as plaintext, never passed through (fail-closed for PHI).
        mutating func sealStructuredOrPassthrough(_ field: String, _ column: String, _ value: String?) {
            guard let value else { return }
            presentFields.insert(field)
            guard case .sealed(let enc?) = CryptoService.encryptOrPassthrough(value, masterKey: masterKey) else {
                failed = true
                return
            }
            pairs.append((column, .text(enc)))
        }

        // --- Server-controlled columns (create): NOT tracked as present (the create
        //     boundary forbids client-set id/version/createdAt/etc.). ---

        mutating func serverNull(_ column: String) { pairs.append((column, .null)) }

        mutating func serverCreate(id: String, patientId: String, now: Date) {
            let seconds = Int(now.timeIntervalSince1970)
            pairs.append(("id", .text(id)))
            pairs.append(("patient_id", .text(patientId)))
            pairs.append(("version", .int(1)))
            pairs.append(("created_at", .int(seconds)))
            pairs.append(("updated_at", .int(seconds)))
            pairs.append(("deleted_at", .null))
            pairs.append(("deletion_reason", .null))
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
