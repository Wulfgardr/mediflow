import Foundation
import Crypto

// ADR 0071 Fase 2 (Codex review): the local-authority persistence over the web's
// medical.db. Fails fast on schema drift (the native consumes the web schema and
// never migrates it), reads the active patients, and reuses PatientFieldCrypto to
// decrypt the ENCRYPTED_FIELDS in-process. The reversed-flow WRITE path lives here
// too: updatePatient() runs the pure authority logic (NetworkWriteBoundary +
// PatientConcurrency) inside a transaction, seals the ENCRYPTED_FIELDS in-core, and
// applies a version-guarded UPDATE. The conflict policy stays in the pure functions
// (never buried in SQL); status codes + copy match lib/network-patient-write.ts so a
// write rejected here is rejected identically on the web.

public struct SQLitePatientStore {
    /// Outcome of a patient write, 1:1 with updateNetworkScopedPatient's responses:
    /// updated=200, versionRequired/noValidFields=400, boundaryRejected=403/400,
    /// notFound=404, conflict=409. encryptionFailed is a local-authority guard (the
    /// core refuses to persist plaintext into an encrypted column) with no web peer.
    public enum PatientWriteOutcome: Equatable {
        case updated(version: Int)
        case versionRequired
        case noValidFields
        case boundaryRejected(status: Int, error: String)
        case notFound
        case conflict(VersionConflictPayload)
        case encryptionFailed

        /// The HTTP-equivalent (status, error-copy) for the future sync/route layer,
        /// locking the web's EXACT wire strings in executable code (not just comments)
        /// so they can't drift. `conflict` carries the VersionConflictPayload as its
        /// body (no error string); `encryptionFailed` is a native fail-closed guard
        /// with no web peer. Matches lib/network-patient-write.ts.
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

    /// Outcome of a patient create, 1:1 with POST /api/v1/patients: created=201.
    /// encryptionFailed is the local-authority fail-closed guard. (There is no
    /// invalidBirthDate case: the typed payload pre-parses birthDate to a Date.)
    public enum PatientCreateOutcome: Equatable {
        case created(id: String, version: Int)
        case encryptionFailed
    }

    /// Every column the patient store reads OR writes; the shared schema guard
    /// fails fast if the web's medical.db drifts from it.
    private static let patientRequiredColumns = [
        "id", "first_name", "last_name", "tax_code", "version", "deleted_at",
        "address", "phone", "caregiver", "exemptions", "diagnoses", "updated_at",
        "notes", "monitoring_profile", "status_reason", "is_adi", "is_archived",
        "ambulatory_id", "created_at", "birth_date", "ai_summary",
        "document_insights", "deletion_reason",
    ]

    private let path: String

    public init(path: String) {
        self.path = path
    }

    /// Active (non-soft-deleted) patient summaries. No decryption needed: summary
    /// columns are plaintext. `scopeAmbulatoryId` (when provided) filters via the
    /// patients_to_ambulatories membership join (1:1 with the web's listNetworkScopedPatients,
    /// the same scope model every store read/write uses); unscoped lists every active patient.
    public func listPatients(scopeAmbulatoryId: String? = nil, includeDeleted: Bool = false) throws -> [HomeBasePatientSummary] {
        let db = try SQLiteConnection(readOnlyPath: path)
        try db.assertSchema(table: "patients", requiredColumns: Self.patientRequiredColumns)
        // Scope via the patients_to_ambulatories membership join (1:1 with the web,
        // lib/network-patient-read.ts) - a patient can belong to more than one
        // ambulatory, and the denormalized patients.ambulatory_id only holds the
        // primary; unscoped lists every active patient.
        let scopeJoin = scopeAmbulatoryId == nil ? "" :
            "JOIN patients_to_ambulatories pa ON p.id = pa.patient_id AND pa.ambulatory_id = ? "
        let deletedFilter = includeDeleted ? "" : "WHERE p.deleted_at IS NULL "
        let sql = """
        SELECT p.id, p.first_name, p.last_name, p.tax_code, p.birth_date, p.is_adi, p.is_archived, p.version, p.updated_at, p.deleted_at, p.deletion_reason
        FROM patients p \(scopeJoin)\(deletedFilter)ORDER BY p.updated_at DESC
        """
        let binds: [SQLiteBind] = scopeAmbulatoryId.map { [.text($0)] } ?? []
        return try db.run(sql, bind: binds) { row in
            HomeBasePatientSummary(
                id: row.text(0) ?? "",
                firstName: row.text(1) ?? "",
                lastName: row.text(2) ?? "",
                birthDate: row.date(4),
                taxCode: row.text(3) ?? "",
                isAdi: row.bool(5),
                isArchived: row.bool(6),
                version: row.int(7) ?? 1,
                updatedAt: row.date(8),
                deletedAt: row.date(9),
                deletionReason: row.text(10))
        }
    }

    /// Raw patient detail with ENC fields untouched, matching the HomeBase HTTP wire.
    /* @Codex */
    public func loadRawPatientDetail(
        id: String, scopeAmbulatoryId: String? = nil
    ) throws -> HomeBasePatientDetail? {
        try loadPatientDetailRow(id: id, scopeAmbulatoryId: scopeAmbulatoryId)
    }

    /// Decrypted convenience retained for direct core consumers and tests.
    /* @Codex */
    public func loadPatientDetail(
        id: String, scopeAmbulatoryId: String? = nil, masterKey: SymmetricKey
    ) throws -> HomeBasePatientDetail? {
        guard let raw = try loadPatientDetailRow(id: id, scopeAmbulatoryId: scopeAmbulatoryId) else { return nil }
        return PatientFieldCrypto.decryptDetail(raw, masterKey: masterKey)
    }

    /* @Codex */
    private func loadPatientDetailRow(
        id: String, scopeAmbulatoryId: String?
    ) throws -> HomeBasePatientDetail? {
        let db = try SQLiteConnection(readOnlyPath: path)
        try db.assertSchema(table: "patients", requiredColumns: Self.patientRequiredColumns)
        let scopeClause = scopeAmbulatoryId == nil ? "" :
            "AND id IN (SELECT patient_id FROM patients_to_ambulatories WHERE ambulatory_id = ?) "
        let sql = """
        SELECT id, first_name, last_name, tax_code, birth_date, address, phone, caregiver, notes,
               ai_summary, is_adi, is_archived, ambulatory_id, created_at, updated_at, document_insights,
               exemptions, diagnoses, monitoring_profile, status_reason, version, deleted_at, deletion_reason
        FROM patients WHERE id = ? AND deleted_at IS NULL \(scopeClause)
        """
        var binds: [SQLiteBind] = [.text(id)]
        if let scope = scopeAmbulatoryId { binds.append(.text(scope)) }
        let rows = try db.run(sql, bind: binds) { row -> HomeBasePatientDetail in
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
                createdAt: row.date(13), updatedAt: row.date(14),
                deletedAt: row.date(21), deletionReason: row.text(22))
        }
        return rows.first
    }

    // MARK: Write path (reversed flow: the core is the on-device write authority)

    /// Apply a scoped patient update under optimistic concurrency, sealing the
    /// ENCRYPTED_FIELDS in-core. Ported 1:1 from updateNetworkScopedPatient
    /// (lib/network-patient-write.ts): version is checked first, then the write
    /// boundary, then the transaction reads a snapshot, the pure PatientConcurrency
    /// policy decides, and a version-guarded UPDATE is applied. The input is the
    /// app's plaintext patch payload; this method does the zero-knowledge sealing
    /// (the home-base only ever stores ciphertext).
    ///
    /// Scope 404 is via the patients_to_ambulatories membership join, 1:1 with the web
    /// (a patient can be in more than one ambulatory). PARITY NOTE: SETTING the primary
    /// ambulatoryId on update (WUL-309 set-primary) is still deferred - the update
    /// payload carries no ambulatoryId, so the boundary is passed .omit; createPatient
    /// does upsert the membership. So the on-device update cannot change the primary
    /// ambulatory yet (a follow-up: add ambulatoryId to the payload + upsert here too).
    public func updatePatient(
        id: String,
        scopeAmbulatoryId: String,
        payload: HomeBasePatientUpdatePayload,
        masterKey: SymmetricKey,
        now: Date = Date()
    ) throws -> PatientWriteOutcome {
        // 1. Version first (1:1 parseExpectedVersion): a 400 before any I/O.
        guard let expected = PatientConcurrency.parseExpectedVersion(payload.version) else {
            return .versionRequired
        }

        // 2. Write-boundary authority. The typed payload structurally cannot carry
        //    the forbidden AI fields or an ambulatoryId, so this is .allowed today;
        //    it stays wired as the authority seam for future untyped / peer-sourced
        //    writes (fan-out), where the field set is dynamic.
        let boundary = NetworkWriteBoundary.validatePatient(
            presentFields: presentPatientFields(payload),
            ambulatoryIdInBody: .omit,
            scopeAmbulatoryId: scopeAmbulatoryId)
        if case .rejected(let status, let error) = boundary {
            return .boundaryRejected(status: status, error: error)
        }

        // 3. Normalize -> sealed column assignments. nil means a field failed to
        //    encrypt: abort rather than ever persist plaintext into an encrypted
        //    column (CryptoService.seal's fail-closed contract).
        guard let assignments = buildPatientUpdateAssignments(payload, masterKey: masterKey) else {
            return .encryptionFailed
        }
        guard !assignments.isEmpty else { return .noValidFields }

        // 4. Transaction: read scoped snapshot -> concurrency policy -> UPDATE.
        let db = try SQLiteConnection(readWritePath: path)
        try db.assertSchema(table: "patients", requiredColumns: Self.patientRequiredColumns)
        try db.execute("BEGIN IMMEDIATE")
        do {
            let snapshot = try selectScopedSnapshot(db, id: id, scope: scopeAmbulatoryId)
            switch PatientConcurrency.evaluate(rawVersion: payload.version, recordId: id, current: snapshot) {
            case .versionRequired:
                try db.execute("ROLLBACK"); return .versionRequired
            case .notFound:
                try db.execute("ROLLBACK"); return .notFound
            case .conflict(let conflict):
                try db.execute("ROLLBACK"); return .conflict(conflict)
            case .ok(let nextVersion):
                try applyPatientUpdate(db, id: id, expected: expected,
                                       nextVersion: nextVersion, assignments: assignments, now: now)
                if db.changes == 0 {
                    // Raced between the snapshot read and the version-guarded UPDATE
                    // (1:1 with the web's updateResult.changes === 0 path): re-read
                    // the active snapshot (unscoped, like selectPatientConflictSnapshot)
                    // and emit the conflict.
                    let raced = try selectConflictSnapshot(db, id: id)
                    try db.execute("ROLLBACK")
                    return .conflict(PatientConcurrency.buildVersionConflictPayload(
                        expectedVersion: expected, recordId: id, current: raced))
                }
                try db.execute("COMMIT")
                return .updated(version: nextVersion)
            }
        } catch {
            try? db.execute("ROLLBACK")
            throw error
        }
    }

    /// Insert a new patient locally (reversed flow), sealing the ENCRYPTED_FIELDS
    /// in-core. Ported from normalizePatientCreateInput + the web INSERT: version=1,
    /// createdAt=updatedAt=now, deletedAt/deletionReason/aiSummary/documentInsights
    /// null. `id` defaults to a fresh lowercased UUID (uuidv4 format).
    ///
    /// Sets BOTH the denormalized patients.ambulatory_id AND the patients_to_ambulatories
    /// membership row (upsertPrimaryAmbulatoryMembership, 1:1 with the web), so a locally
    /// created patient is visible to the membership-join scope checks. Both writes run in
    /// one transaction. notes "" collapses to null (web length>0 rule); the other string
    /// fields store their value as-is when present.
    public func createPatient(
        _ payload: HomeBasePatientCreatePayload,
        id: String = UUID().uuidString.lowercased(),
        scopeAmbulatoryId: String?,
        masterKey: SymmetricKey,
        now: Date = Date()
    ) throws -> PatientCreateOutcome {
        guard let assignments = buildPatientInsertAssignments(
            payload, id: id, scopeAmbulatoryId: scopeAmbulatoryId, masterKey: masterKey, now: now)
        else { return .encryptionFailed }

        let db = try SQLiteConnection(readWritePath: path)
        try db.assertSchema(table: "patients", requiredColumns: Self.patientRequiredColumns)
        let columns = assignments.map { $0.column }.joined(separator: ", ")
        let placeholders = assignments.map { _ in "?" }.joined(separator: ", ")
        try db.execute("BEGIN IMMEDIATE")
        do {
            _ = try db.run("INSERT INTO patients (\(columns)) VALUES (\(placeholders))",
                           bind: assignments.map { $0.bind }) { _ in 0 }
            // WUL-309 set-primary: upsert the targeted (patient, ambulatory) membership
            // only, never touching other memberships. resolvePrimaryAmbulatoryId: a
            // non-empty string sets it; blank/nil is a no-op.
            if let scope = scopeAmbulatoryId, !scope.trimmingCharacters(in: .whitespaces).isEmpty {
                _ = try db.run("""
                INSERT INTO patients_to_ambulatories (patient_id, ambulatory_id, assigned_at)
                VALUES (?, ?, ?) ON CONFLICT DO NOTHING
                """, bind: [.text(id), .text(scope), .int(Int(now.timeIntervalSince1970))]) { _ in 0 }
            }
            try db.execute("COMMIT")
        } catch {
            try? db.execute("ROLLBACK")
            throw error
        }
        return .created(id: id, version: 1)
    }

    /// Soft-delete a patient (ADR 0066 tombstone), 1:1 with the operator route
    /// DELETE /api/v1/patients/[id]: version-guarded, sets deleted_at + deletion_reason
    /// + version+1 + updated_at. UNSCOPED on purpose: that operator route reads
    /// existence by id + active only (no ambulatory join, and there is no network
    /// delete peer), so a version-mismatched active patient yields 409 regardless of
    /// ambulatory, exactly like the web. deletion_reason defaults to "api-v1-delete"
    /// (web hardcode) and IS sealed: it is an ENCRYPTED_FIELD and the core holds the
    /// key, so the at-rest encryption invariant is kept (the web DELETE route writes
    /// it plaintext only because the server is keyless). Success is reported as
    /// `.updated(version:)` (the wire contract is the same version-bumping 200).
    public func softDeletePatient(
        id: String,
        version: Int,
        deletionReason: String = "api-v1-delete",
        masterKey: SymmetricKey,
        scopeAmbulatoryId: String? = nil,
        now: Date = Date()
    ) throws -> PatientWriteOutcome {
        guard let expected = PatientConcurrency.parseExpectedVersion(version) else {
            return .versionRequired
        }
        guard case .sealed(let sealedReason?) = CryptoService.sealOrPassthrough(deletionReason, masterKey: masterKey) else {
            return .encryptionFailed
        }

        let db = try SQLiteConnection(readWritePath: path)
        try db.assertSchema(table: "patients", requiredColumns: Self.patientRequiredColumns)
        try db.execute("BEGIN IMMEDIATE")
        do {
            // Scoped like the network boundary: out-of-scope patients read as 404.
            guard try isMemberOfScope(db, patientId: id, scopeAmbulatoryId: scopeAmbulatoryId) else {
                try db.execute("ROLLBACK"); return .notFound
            }
            let snapshot = try selectConflictSnapshot(db, id: id)
            switch PatientConcurrency.evaluate(rawVersion: version, recordId: id, current: snapshot) {
            case .versionRequired:
                try db.execute("ROLLBACK"); return .versionRequired
            case .notFound:
                try db.execute("ROLLBACK"); return .notFound
            case .conflict(let conflict):
                try db.execute("ROLLBACK"); return .conflict(conflict)
            case .ok(let nextVersion):
                let sql = """
                UPDATE patients SET deleted_at = ?, deletion_reason = ?, version = ?, updated_at = ?
                WHERE id = ? AND version = ? AND deleted_at IS NULL
                """
                let stamp = Int(now.timeIntervalSince1970)
                _ = try db.run(sql, bind: [.int(stamp), .text(sealedReason), .int(nextVersion),
                                           .int(stamp), .text(id), .int(expected)]) { _ in 0 }
                if db.changes == 0 {
                    let raced = try selectConflictSnapshot(db, id: id)
                    try db.execute("ROLLBACK")
                    return .conflict(PatientConcurrency.buildVersionConflictPayload(
                        expectedVersion: expected, recordId: id, current: raced))
                }
                try db.execute("COMMIT")
                return .updated(version: nextVersion)
            }
        } catch {
            try? db.execute("ROLLBACK")
            throw error
        }
    }

    /// Restore a tombstoned patient, mirroring POST /api/v1/network/patients/[id]/restore.
    /// The restore is version-guarded, clears deleted_at/deletion_reason, bumps version
    /// and leaves archive state untouched.
    public func restorePatient(
        id: String,
        version: Int,
        scopeAmbulatoryId: String? = nil,
        now: Date = Date()
    ) throws -> PatientWriteOutcome {
        guard let expected = PatientConcurrency.parseExpectedVersion(version) else {
            return .versionRequired
        }

        let db = try SQLiteConnection(readWritePath: path)
        try db.assertSchema(table: "patients", requiredColumns: Self.patientRequiredColumns)
        try db.execute("BEGIN IMMEDIATE")
        do {
            // Scoped like the network boundary: out-of-scope patients read as 404.
            guard try isMemberOfScope(db, patientId: id, scopeAmbulatoryId: scopeAmbulatoryId) else {
                try db.execute("ROLLBACK"); return .notFound
            }
            let tombstone = try selectTombstonedSnapshot(db, id: id)
            switch PatientConcurrency.evaluate(rawVersion: version, recordId: id, current: tombstone) {
            case .versionRequired:
                try db.execute("ROLLBACK"); return .versionRequired
            case .notFound:
                try db.execute("ROLLBACK"); return .notFound
            case .conflict(let conflict):
                try db.execute("ROLLBACK"); return .conflict(conflict)
            case .ok(let nextVersion):
                let stamp = Int(now.timeIntervalSince1970)
                let sql = """
                UPDATE patients SET deleted_at = NULL, deletion_reason = NULL, version = ?, updated_at = ?
                WHERE id = ? AND version = ? AND deleted_at IS NOT NULL
                """
                _ = try db.run(sql, bind: [.int(nextVersion), .int(stamp), .text(id), .int(expected)]) { _ in 0 }
                if db.changes == 0 {
                    let raced = try selectTombstonedSnapshot(db, id: id)
                    try db.execute("ROLLBACK")
                    return .conflict(PatientConcurrency.buildVersionConflictPayload(
                        expectedVersion: expected, recordId: id, current: raced))
                }
                try db.execute("COMMIT")
                return .updated(version: nextVersion)
            }
        } catch {
            try? db.execute("ROLLBACK")
            throw error
        }
    }

    /// Build the (column, bind) INSERT assignments for a new patient, sealing the
    /// ENCRYPTED_FIELDS. Returns nil if any field fails to seal.
    private func buildPatientInsertAssignments(
        _ p: HomeBasePatientCreatePayload, id: String, scopeAmbulatoryId: String?,
        masterKey: SymmetricKey, now: Date
    ) -> [(column: String, bind: SQLiteBind)]? {
        let stamp = Int(now.timeIntervalSince1970)
        var out: [(column: String, bind: SQLiteBind)] = []
        out.append(("id", .text(id)))
        out.append(("first_name", .text(p.firstName)))
        out.append(("last_name", .text(p.lastName)))
        out.append(("tax_code", .text(p.taxCode)))
        out.append(("birth_date", p.birthDate.map { .int(Int($0.timeIntervalSince1970)) } ?? .null))
        // ENCRYPTED string fields (nil -> NULL column).
        guard sealInto(&out, "address", p.address, masterKey),
              sealInto(&out, "phone", p.phone, masterKey),
              sealInto(&out, "caregiver", p.caregiver, masterKey),
              sealInto(&out, "status_reason", p.statusReason, masterKey)
        else { return nil }
        // notes: the web stores null for empty strings (length>0 rule).
        let notes = (p.notes?.isEmpty ?? true) ? nil : p.notes
        guard sealInto(&out, "notes", notes, masterKey) else { return nil }
        // STRUCTURED ENCRYPTED fields: encrypt the array-JSON string directly.
        guard sealStructuredInto(&out, "exemptions", p.exemptions, masterKey),
              sealStructuredInto(&out, "diagnoses", p.diagnoses, masterKey)
        else { return nil }
        // monitoring_profile is plaintext (not an ENCRYPTED_FIELD).
        out.append(("monitoring_profile", p.monitoringProfile.map { .text($0) } ?? .null))
        out.append(("ai_summary", .null))
        out.append(("document_insights", .null))
        out.append(("is_adi", .int(p.isAdi ? 1 : 0)))
        out.append(("is_archived", .int(p.isArchived ? 1 : 0)))
        out.append(("deleted_at", .null))
        out.append(("deletion_reason", .null))
        out.append(("version", .int(1)))
        out.append(("ambulatory_id", scopeAmbulatoryId.map { .text($0) } ?? .null))
        out.append(("created_at", .int(stamp)))
        out.append(("updated_at", .int(stamp)))
        return out
    }

    /// Seal an optional string field into the assignments (nil -> NULL).
    /// sealOrPassthrough, like the update path: the model pre-seals the wire
    /// payload, so a value can arrive here already ENC: and must not be
    /// encrypted twice. Returns false if a present value fails to encrypt.
    private func sealInto(
        _ out: inout [(column: String, bind: SQLiteBind)], _ column: String,
        _ value: String?, _ key: SymmetricKey
    ) -> Bool {
        guard let value else { out.append((column, .null)); return true }
        guard case .sealed(let enc?) = CryptoService.sealOrPassthrough(value, masterKey: key) else { return false }
        out.append((column, .text(enc)))
        return true
    }

    /// Seal an optional STRUCTURED field (array/object JSON string) into the
    /// assignments by encrypting the JSON directly (no JSON.stringify wrap).
    /// encryptOrPassthrough for the same no-double-encryption reason above.
    private func sealStructuredInto(
        _ out: inout [(column: String, bind: SQLiteBind)], _ column: String,
        _ value: String?, _ key: SymmetricKey
    ) -> Bool {
        guard let value else { out.append((column, .null)); return true }
        guard case .sealed(let enc?) = CryptoService.encryptOrPassthrough(value, masterKey: key) else { return false }
        out.append((column, .text(enc)))
        return true
    }

    /// The set of logical field names present in the patch (for the write boundary).
    private func presentPatientFields(_ p: HomeBasePatientUpdatePayload) -> Set<String> {
        var fields = Set<String>()
        if p.firstName != nil { fields.insert("firstName") }
        if p.lastName != nil { fields.insert("lastName") }
        if p.taxCode != nil { fields.insert("taxCode") }
        if p.isAdi != nil { fields.insert("isAdi") }
        if p.isArchived != nil { fields.insert("isArchived") }
        let patches: [(String, PatchValue<String>)] = [
            ("address", p.address), ("phone", p.phone), ("caregiver", p.caregiver),
            ("notes", p.notes), ("monitoringProfile", p.monitoringProfile),
            ("statusReason", p.statusReason), ("diagnoses", p.diagnoses),
            ("exemptions", p.exemptions),
        ]
        for (name, value) in patches {
            if case .omit = value { continue }
            fields.insert(name)
        }
        if case .omit = p.birthDate {} else { fields.insert("birthDate") }
        return fields
    }

    /// Build the (column, sealed-bind) assignments for the SET clause, excluding the
    /// always-set version/updated_at. Returns nil if any ENCRYPTED_FIELD fails to
    /// seal; an empty array means "No valid fields to update".
    private func buildPatientUpdateAssignments(
        _ p: HomeBasePatientUpdatePayload, masterKey: SymmetricKey
    ) -> [(column: String, bind: SQLiteBind)]? {
        var out: [(column: String, bind: SQLiteBind)] = []
        // Plaintext scalar columns (web: typeof === 'string'/'boolean' -> set, else skip).
        if let v = p.firstName { out.append(("first_name", .text(v))) }
        if let v = p.lastName { out.append(("last_name", .text(v))) }
        if let v = p.taxCode { out.append(("tax_code", .text(v))) }
        if let v = p.isAdi { out.append(("is_adi", .int(v ? 1 : 0))) }
        if let v = p.isArchived { out.append(("is_archived", .int(v ? 1 : 0))) }
        // monitoring_profile is NOT an ENCRYPTED_FIELD (lib/db.ts): stored plaintext.
        appendPlain(&out, "monitoring_profile", p.monitoringProfile)
        // ENCRYPTED string fields: JSON.stringify(value) then AES-GCM (seal).
        guard appendSealedString(&out, "address", p.address, masterKey),
              appendSealedString(&out, "phone", p.phone, masterKey),
              appendSealedString(&out, "caregiver", p.caregiver, masterKey),
              appendSealedString(&out, "notes", p.notes, masterKey),
              appendSealedString(&out, "status_reason", p.statusReason, masterKey)
        else { return nil }
        // diagnoses + exemptions are STRUCTURED ENCRYPTED fields: the plaintext is the
        // array JSON itself (NOT JSON.stringify'd again, unlike a string field), so the
        // array JSON string is encrypted directly. See PatientFieldCrypto.decryptStructuredField.
        // (Permissive like the web's normalizeStructuredPatientField: the caller-supplied
        // string is stored verbatim; callers pass canonical array-JSON from the codecs.)
        guard appendSealedStructured(&out, "diagnoses", p.diagnoses, masterKey),
              appendSealedStructured(&out, "exemptions", p.exemptions, masterKey)
        else { return nil }
        // birth_date is plaintext (integer seconds); omit/null/value like the web.
        switch p.birthDate {
        case .omit: break
        case .null: out.append(("birth_date", .null))
        case .value(let date): out.append(("birth_date", .int(Int(date.timeIntervalSince1970))))
        }
        return out
    }

    private func appendPlain(_ out: inout [(column: String, bind: SQLiteBind)], _ column: String, _ value: PatchValue<String>) {
        switch value {
        case .omit: break
        case .null: out.append((column, .null))
        case .value(let v): out.append((column, .text(v)))
        }
    }

    private func appendSealedString(
        _ out: inout [(column: String, bind: SQLiteBind)], _ column: String,
        _ value: PatchValue<String>, _ key: SymmetricKey
    ) -> Bool {
        switch value {
        case .omit: return true
        case .null: out.append((column, .null)); return true
        case .value(let v):
            // sealOrPassthrough (Fase 3): the model may hand us a value ALREADY sealed
            // for the HTTP path; authenticated ciphertext passes through verbatim to
            // avoid double-encryption, plaintext is sealed, a forged "ENC:" is sealed.
            guard case .sealed(let enc?) = CryptoService.sealOrPassthrough(v, masterKey: key) else { return false }
            out.append((column, .text(enc)))
            return true
        }
    }

    private func appendSealedStructured(
        _ out: inout [(column: String, bind: SQLiteBind)], _ column: String,
        _ value: PatchValue<String>, _ key: SymmetricKey
    ) -> Bool {
        switch value {
        case .omit: return true
        case .null: out.append((column, .null)); return true
        case .value(let json):
            guard case .sealed(let enc?) = CryptoService.encryptOrPassthrough(json, masterKey: key) else { return false }
            out.append((column, .text(enc)))
            return true
        }
    }

    private func applyPatientUpdate(
        _ db: SQLiteConnection, id: String, expected: Int, nextVersion: Int,
        assignments: [(column: String, bind: SQLiteBind)], now: Date
    ) throws {
        var columns = assignments
        columns.append(("version", .int(nextVersion)))
        // updated_at is stored as unixepoch SECONDS (drizzle timestamp mode), the
        // same unit listPatients/loadPatientDetail read back.
        columns.append(("updated_at", .int(Int(now.timeIntervalSince1970))))
        let setClause = columns.map { "\($0.column) = ?" }.joined(separator: ", ")
        // The UPDATE is version-guarded + active-only (not scope-joined): scope was
        // already enforced by selectScopedSnapshot, exactly like the web.
        let sql = "UPDATE patients SET \(setClause) WHERE id = ? AND version = ? AND deleted_at IS NULL"
        let binds = columns.map { $0.bind } + [.text(id), .int(expected)]
        _ = try db.run(sql, bind: binds) { _ in 0 }  // an UPDATE yields no rows
    }

    private func selectScopedSnapshot(
        _ db: SQLiteConnection, id: String, scope: String
    ) throws -> PatientConcurrency.ConflictSource? {
        // Scope via the membership join (1:1 with updateNetworkScopedPatient's existing
        // check), not the denormalized patients.ambulatory_id.
        let sql = """
        SELECT p.id, p.version, p.updated_at, p.is_archived
        FROM patients p JOIN patients_to_ambulatories pa ON p.id = pa.patient_id AND pa.ambulatory_id = ?
        WHERE p.id = ? AND p.deleted_at IS NULL
        """
        return try db.run(sql, bind: [.text(scope), .text(id)]) { row in
            PatientConcurrency.ConflictSource(
                id: row.text(0) ?? "", version: row.int(1) ?? 1,
                updatedAt: row.date(2), isArchived: row.bool(3))
        }.first
    }

    private func selectConflictSnapshot(
        _ db: SQLiteConnection, id: String
    ) throws -> PatientConcurrency.ConflictSource? {
        let sql = "SELECT id, version, updated_at, is_archived FROM patients WHERE id = ? AND deleted_at IS NULL"
        return try db.run(sql, bind: [.text(id)]) { row in
            PatientConcurrency.ConflictSource(
                id: row.text(0) ?? "", version: row.int(1) ?? 1,
                updatedAt: row.date(2), isArchived: row.bool(3))
        }.first
    }

    private func selectTombstonedSnapshot(
        _ db: SQLiteConnection, id: String
    ) throws -> PatientConcurrency.ConflictSource? {
        let sql = "SELECT id, version, updated_at, is_archived FROM patients WHERE id = ? AND deleted_at IS NOT NULL"
        return try db.run(sql, bind: [.text(id)]) { row in
            PatientConcurrency.ConflictSource(
                id: row.text(0) ?? "", version: row.int(1) ?? 1,
                updatedAt: row.date(2), isArchived: row.bool(3))
        }.first
    }

    /// Membership guard for scoped lifecycle writes: no scope means no restriction
    /// (operator-route semantics), a scope requires the patients_to_ambulatories row.
    private func isMemberOfScope(
        _ db: SQLiteConnection, patientId: String, scopeAmbulatoryId: String?
    ) throws -> Bool {
        guard let scope = scopeAmbulatoryId else { return true }
        let sql = "SELECT 1 FROM patients_to_ambulatories WHERE patient_id = ? AND ambulatory_id = ?"
        return try db.run(sql, bind: [.text(patientId), .text(scope)]) { _ in 1 }.first != nil
    }
}
