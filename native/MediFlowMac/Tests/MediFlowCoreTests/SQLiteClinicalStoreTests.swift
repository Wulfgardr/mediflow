import XCTest
import Crypto
@testable import MediFlowCore

/// ADR 0071 Fase 2: the clinical sub-resource WRITE authority. Tests build a writable
/// DB by copying the patient fixture (which carries fixture-1 @ AMB-1, used by the
/// in-scope join) and creating the sub-resource tables, then exercise the version-
/// guarded update + soft-delete. Encrypted fields are checked decrypted AND at-rest.
final class SQLiteClinicalStoreTests: XCTestCase {

    private let masterKey = SymmetricKey(
        data: Data(hexString: "404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f"))

    private func fixturePath() -> String {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .appendingPathComponent("Fixtures/medical_fixture.db")
            .path
    }

    /// Copy the patient fixture (which now ships the four clinical tables, each with
    /// one pre-seeded row, for the AppleShared adapter tests that cannot create
    /// tables themselves) and clear them so the write-path tests in this file start
    /// from a clean slate.
    private func makeDB() throws -> (path: String, db: SQLiteConnection) {
        let dst = NSTemporaryDirectory() + "mediflow-clinical-\(UUID().uuidString).db"
        try? FileManager.default.removeItem(atPath: dst)
        try FileManager.default.copyItem(atPath: fixturePath(), toPath: dst)
        let db = try SQLiteConnection(readWritePath: dst)
        try db.execute("DELETE FROM entries; DELETE FROM therapies; DELETE FROM checkups; DELETE FROM observations;")
        return (dst, db)
    }

    /// Raw plaintext of a column for one row (no decryption).
    private func rawText(_ db: SQLiteConnection, _ table: String, _ column: String, id: String) throws -> String? {
        try db.run("SELECT \(column) FROM \(table) WHERE id = ?", bind: [.text(id)]) { $0.text(0) }.first ?? nil
    }

    private func intCol(_ db: SQLiteConnection, _ table: String, _ column: String, id: String) throws -> Int? {
        try db.run("SELECT \(column) FROM \(table) WHERE id = ?", bind: [.text(id)]) { $0.int(0) }.first ?? nil
    }

    // MARK: Checkup (notes-only encrypted) — the representative happy + edge paths

    func testUpdateCheckupSetsFieldsSealsNotesAndBumpsVersion() throws {
        let (path, seed) = try makeDB()
        defer { try? FileManager.default.removeItem(atPath: path) }
        try seed.execute("INSERT INTO checkups (id, patient_id, date, title, status, version) VALUES ('c1', 'fixture-1', 1750000000, 'Controllo', 'pending', 1)")
        let store = SQLiteClinicalStore(path: path)

        let payload = HomeBaseCheckupUpdatePayload(
            version: 1, title: "Visita", status: "completed", notes: "Tutto regolare", source: "manual")
        XCTAssertEqual(
            try store.updateCheckup(id: "c1", patientId: "fixture-1", scopeAmbulatoryId: "AMB-1",
                                    payload: payload, masterKey: masterKey),
            .updated(version: 2))

        let reader = try SQLiteConnection(readOnlyPath: path)
        XCTAssertEqual(try intCol(reader, "checkups", "version", id: "c1"), 2)
        XCTAssertEqual(try rawText(reader, "checkups", "title", id: "c1"), "Visita")   // title plaintext
        XCTAssertEqual(try rawText(reader, "checkups", "status", id: "c1"), "completed")
        XCTAssertEqual(try rawText(reader, "checkups", "source", id: "c1"), "manual")
        // notes is ENCRYPTED: ENC at rest, decrypts to the plaintext.
        let rawNotes = try XCTUnwrap(try rawText(reader, "checkups", "notes", id: "c1"))
        XCTAssertTrue(rawNotes.hasPrefix("ENC:"))
        XCTAssertEqual(PatientFieldCrypto.decryptStringField(rawNotes, masterKey: masterKey), "Tutto regolare")
    }

    func testUpdateCheckupVersionMismatchConflicts() throws {
        let (path, seed) = try makeDB()
        defer { try? FileManager.default.removeItem(atPath: path) }
        try seed.execute("INSERT INTO checkups (id, patient_id, date, title, status, version) VALUES ('c1', 'fixture-1', 1750000000, 'Controllo', 'pending', 1)")
        let store = SQLiteClinicalStore(path: path)

        guard case .conflict(let conflict) = try store.updateCheckup(
            id: "c1", patientId: "fixture-1", scopeAmbulatoryId: "AMB-1",
            payload: HomeBaseCheckupUpdatePayload(version: 99, title: "X"), masterKey: masterKey) else {
            return XCTFail("expected conflict")
        }
        XCTAssertEqual(conflict.entity, "checkup")
        XCTAssertEqual(conflict.currentVersion, 1)
        XCTAssertEqual(conflict.currentSnapshot?.patientId, "fixture-1")
        XCTAssertNil(conflict.currentSnapshot?.isArchived)  // clinical snapshot shape
    }

    func testUpdateCheckupOutOfScopeAndMissingReturnNotFound() throws {
        let (path, seed) = try makeDB()
        defer { try? FileManager.default.removeItem(atPath: path) }
        try seed.execute("INSERT INTO checkups (id, patient_id, date, title, status, version) VALUES ('c1', 'fixture-1', 1750000000, 'Controllo', 'pending', 1)")
        let store = SQLiteClinicalStore(path: path)

        XCTAssertEqual(
            try store.updateCheckup(id: "c1", patientId: "fixture-1", scopeAmbulatoryId: "AMB-OTHER",
                                    payload: HomeBaseCheckupUpdatePayload(version: 1, title: "X"), masterKey: masterKey),
            .notFound)
        XCTAssertEqual(
            try store.updateCheckup(id: "ghost", patientId: "fixture-1", scopeAmbulatoryId: "AMB-1",
                                    payload: HomeBaseCheckupUpdatePayload(version: 1, title: "X"), masterKey: masterKey),
            .notFound)
    }

    func testUpdateCheckupVersionRequiredAndNoValidFields() throws {
        let (path, seed) = try makeDB()
        defer { try? FileManager.default.removeItem(atPath: path) }
        try seed.execute("INSERT INTO checkups (id, patient_id, date, title, status, version) VALUES ('c1', 'fixture-1', 1750000000, 'Controllo', 'pending', 1)")
        let store = SQLiteClinicalStore(path: path)

        XCTAssertEqual(
            try store.updateCheckup(id: "c1", patientId: "fixture-1", scopeAmbulatoryId: "AMB-1",
                                    payload: HomeBaseCheckupUpdatePayload(version: 0, title: "X"), masterKey: masterKey),
            .versionRequired)
        XCTAssertEqual(
            try store.updateCheckup(id: "c1", patientId: "fixture-1", scopeAmbulatoryId: "AMB-1",
                                    payload: HomeBaseCheckupUpdatePayload(version: 1), masterKey: masterKey),
            .noValidFields)
    }

    func testUpdateCheckupSoftDeleteSetsTombstoneAndSealsReason() throws {
        let (path, seed) = try makeDB()
        defer { try? FileManager.default.removeItem(atPath: path) }
        try seed.execute("INSERT INTO checkups (id, patient_id, date, title, status, version) VALUES ('c1', 'fixture-1', 1750000000, 'Controllo', 'pending', 1)")
        let store = SQLiteClinicalStore(path: path)

        let when = Date(timeIntervalSince1970: 1751000000)
        let payload = HomeBaseCheckupUpdatePayload(version: 1, deletedAt: when, deletionReason: "obsolete")
        XCTAssertEqual(
            try store.updateCheckup(id: "c1", patientId: "fixture-1", scopeAmbulatoryId: "AMB-1",
                                    payload: payload, masterKey: masterKey),
            .updated(version: 2))

        let reader = try SQLiteConnection(readOnlyPath: path)
        XCTAssertEqual(try intCol(reader, "checkups", "deleted_at", id: "c1"), 1751000000)
        // checkups: deletion_reason is NOT in ENCRYPTED_FIELDS -> stored plaintext.
        XCTAssertEqual(try rawText(reader, "checkups", "deletion_reason", id: "c1"), "obsolete")
    }

    // MARK: Entry / therapy / observation — per-entity crypto coverage

    func testUpdateEntrySealsTitleAndContent() throws {
        let (path, seed) = try makeDB()
        defer { try? FileManager.default.removeItem(atPath: path) }
        try seed.execute("INSERT INTO entries (id, patient_id, type, title, date, content, version) VALUES ('e1', 'fixture-1', 'note', 'seed', 1750000000, 'seed', 1)")
        let store = SQLiteClinicalStore(path: path)

        let when = Date(timeIntervalSince1970: 1751500000)
        let payload = HomeBaseEntryUpdatePayload(
            version: 1, title: "Diario", content: "Paziente stabile", date: when, setting: "home")
        XCTAssertEqual(
            try store.updateEntry(id: "e1", patientId: "fixture-1", scopeAmbulatoryId: "AMB-1",
                                  payload: payload, masterKey: masterKey),
            .updated(version: 2))
        let reader = try SQLiteConnection(readOnlyPath: path)
        for (column, expected) in [("title", "Diario"), ("content", "Paziente stabile")] {
            let raw = try XCTUnwrap(try rawText(reader, "entries", column, id: "e1"))
            XCTAssertTrue(raw.hasPrefix("ENC:"), "\(column) must be ENC at rest")
            XCTAssertEqual(PatientFieldCrypto.decryptStringField(raw, masterKey: masterKey), expected)
        }
        XCTAssertEqual(try rawText(reader, "entries", "setting", id: "e1"), "home")   // plaintext
        XCTAssertEqual(try intCol(reader, "entries", "date", id: "e1"), 1751500000)
    }

    func testUpdateTherapySealsMotivationAndSetsEndDate() throws {
        let (path, seed) = try makeDB()
        defer { try? FileManager.default.removeItem(atPath: path) }
        try seed.execute("INSERT INTO therapies (id, patient_id, drug_name, dosage, status, start_date, version) VALUES ('t1', 'fixture-1', 'ASA', '100mg', 'active', 1750000000, 1)")
        let store = SQLiteClinicalStore(path: path)

        let end = Date(timeIntervalSince1970: 1752000000)
        let payload = HomeBaseTherapyUpdatePayload(
            version: 1, aic: "012345", diagnosisCode: "I10", dosage: "75mg",
            endDate: end, motivation: "tapering")
        XCTAssertEqual(
            try store.updateTherapy(id: "t1", patientId: "fixture-1", scopeAmbulatoryId: "AMB-1",
                                    payload: payload, masterKey: masterKey),
            .updated(version: 2))
        let reader = try SQLiteConnection(readOnlyPath: path)
        XCTAssertEqual(try rawText(reader, "therapies", "dosage", id: "t1"), "75mg")  // plaintext
        XCTAssertEqual(try rawText(reader, "therapies", "aic", id: "t1"), "012345")
        XCTAssertEqual(try rawText(reader, "therapies", "diagnosis_code", id: "t1"), "I10")
        XCTAssertEqual(try intCol(reader, "therapies", "end_date", id: "t1"), 1752000000)
        let rawMot = try XCTUnwrap(try rawText(reader, "therapies", "motivation", id: "t1"))
        XCTAssertTrue(rawMot.hasPrefix("ENC:"))
        XCTAssertEqual(PatientFieldCrypto.decryptStringField(rawMot, masterKey: masterKey), "tapering")
    }

    func testUpdateObservationSetsValuePlaintextAndSealsNotes() throws {
        let (path, seed) = try makeDB()
        defer { try? FileManager.default.removeItem(atPath: path) }
        try seed.execute("INSERT INTO observations (id, patient_id, code_system, code, display, unit_system, unit_code, value, observed_at, version) VALUES ('o1', 'fixture-1', 'LOINC', '8480-6', 'Systolic', 'UCUM', 'mm[Hg]', '120', 1750000000, 1)")
        let store = SQLiteClinicalStore(path: path)

        let payload = HomeBaseObservationUpdatePayload(
            version: 1, value: "  130  ", observedAt: nil, notes: "post-prandiale", source: "manual")
        XCTAssertEqual(
            try store.updateObservation(id: "o1", patientId: "fixture-1", scopeAmbulatoryId: "AMB-1",
                                        payload: payload, masterKey: masterKey),
            .updated(version: 2))
        let reader = try SQLiteConnection(readOnlyPath: path)
        XCTAssertEqual(try rawText(reader, "observations", "value", id: "o1"), "130")  // plaintext + trimmed
        XCTAssertEqual(try rawText(reader, "observations", "source", id: "o1"), "manual")
        let rawNotes = try XCTUnwrap(try rawText(reader, "observations", "notes", id: "o1"))
        XCTAssertTrue(rawNotes.hasPrefix("ENC:"))
        XCTAssertEqual(PatientFieldCrypto.decryptStringField(rawNotes, masterKey: masterKey), "post-prandiale")
    }

    // MARK: Create (patient-in-scope 404, INSERT 201, entry idempotency)

    func testCreateCheckupInScopeInsertsAndSealsNotes() throws {
        let (path, _) = try makeDB()
        defer { try? FileManager.default.removeItem(atPath: path) }
        let store = SQLiteClinicalStore(path: path)

        let payload = HomeBaseCheckupCreatePayload(
            date: Date(timeIntervalSince1970: 1750000000), title: "Nuovo", status: "done", notes: "riservato")
        guard case .created(let id, let version) = try store.createCheckup(
            payload, patientId: "fixture-1", scopeAmbulatoryId: "AMB-1", masterKey: masterKey, id: "ck-new") else {
            return XCTFail("expected create success")
        }
        XCTAssertEqual(id, "ck-new")
        XCTAssertEqual(version, 1)

        let reader = try SQLiteConnection(readOnlyPath: path)
        XCTAssertEqual(try rawText(reader, "checkups", "title", id: "ck-new"), "Nuovo")  // plaintext
        XCTAssertEqual(try rawText(reader, "checkups", "status", id: "ck-new"), "completed")  // 'done' canonicalized
        XCTAssertEqual(try intCol(reader, "checkups", "version", id: "ck-new"), 1)
        XCTAssertNil(try intCol(reader, "checkups", "deleted_at", id: "ck-new"))
        let rawNotes = try XCTUnwrap(try rawText(reader, "checkups", "notes", id: "ck-new"))
        XCTAssertTrue(rawNotes.hasPrefix("ENC:"))
        XCTAssertEqual(PatientFieldCrypto.decryptStringField(rawNotes, masterKey: masterKey), "riservato")
    }

    func testCreateOutOfScopeReturnsNotFound() throws {
        let (path, _) = try makeDB()
        defer { try? FileManager.default.removeItem(atPath: path) }
        let store = SQLiteClinicalStore(path: path)
        let payload = HomeBaseCheckupCreatePayload(
            date: Date(timeIntervalSince1970: 1750000000), title: "X", status: "pending")
        XCTAssertEqual(
            try store.createCheckup(payload, patientId: "fixture-1", scopeAmbulatoryId: "AMB-OTHER",
                                    masterKey: masterKey, id: "ck-x"),
            .notFound)
        // also: a patient that does not exist at all is out of scope.
        XCTAssertEqual(
            try store.createCheckup(payload, patientId: "ghost", scopeAmbulatoryId: "AMB-1",
                                    masterKey: masterKey, id: "ck-y"),
            .notFound)
    }

    func testCreateEntrySealsFieldsAndIsIdempotent() throws {
        let (path, _) = try makeDB()
        defer { try? FileManager.default.removeItem(atPath: path) }
        let store = SQLiteClinicalStore(path: path)

        let payload = HomeBaseEntryCreatePayload(
            id: "e-new", type: "note", title: "Diario",
            date: Date(timeIntervalSince1970: 1750000000), content: "primo")
        // First create -> 201.
        XCTAssertEqual(
            try store.createEntry(payload, patientId: "fixture-1", scopeAmbulatoryId: "AMB-1", masterKey: masterKey),
            .created(id: "e-new", version: 1))
        let reader = try SQLiteConnection(readOnlyPath: path)
        for (column, expected) in [("title", "Diario"), ("content", "primo")] {
            let raw = try XCTUnwrap(try rawText(reader, "entries", column, id: "e-new"))
            XCTAssertTrue(raw.hasPrefix("ENC:"), "\(column) must be ENC at rest")
            XCTAssertEqual(PatientFieldCrypto.decryptStringField(raw, masterKey: masterKey), expected)
        }
        // Identical create (same client id) -> 200 idempotent, no second row.
        XCTAssertEqual(
            try store.createEntry(payload, patientId: "fixture-1", scopeAmbulatoryId: "AMB-1", masterKey: masterKey),
            .idempotent(id: "e-new", version: 1))
        // Same id, different content -> 409 idConflict; the stored row is untouched.
        let changed = HomeBaseEntryCreatePayload(
            id: "e-new", type: "note", title: "Diario",
            date: Date(timeIntervalSince1970: 1750000000), content: "DIVERSO")
        guard case .idConflict = try store.createEntry(
            changed, patientId: "fixture-1", scopeAmbulatoryId: "AMB-1", masterKey: masterKey) else {
            return XCTFail("expected idConflict")
        }
        XCTAssertEqual(
            PatientFieldCrypto.decryptStringField(try rawText(reader, "entries", "content", id: "e-new"), masterKey: masterKey),
            "primo")
    }

    func testCreateTherapyAndObservationSealEncryptedFieldsAndTrimValue() throws {
        let (path, _) = try makeDB()
        defer { try? FileManager.default.removeItem(atPath: path) }
        let store = SQLiteClinicalStore(path: path)

        XCTAssertEqual(
            try store.createTherapy(
                HomeBaseTherapyCreatePayload(drugName: "ASA", dosage: "100mg", status: "paused",
                                            startDate: Date(timeIntervalSince1970: 1750000000), motivation: "prevenzione"),
                patientId: "fixture-1", scopeAmbulatoryId: "AMB-1", masterKey: masterKey, id: "t-new"),
            .created(id: "t-new", version: 1))
        XCTAssertEqual(
            try store.createObservation(
                HomeBaseObservationCreatePayload(codeSystem: "loinc", code: "  8480-6  ", display: "Systolic",
                                                unitCode: "mm[Hg]", value: "  120  ",
                                                observedAt: Date(timeIntervalSince1970: 1750000000), notes: "a riposo"),
                patientId: "fixture-1", scopeAmbulatoryId: "AMB-1", masterKey: masterKey, id: "o-new"),
            .created(id: "o-new", version: 1))

        let reader = try SQLiteConnection(readOnlyPath: path)
        XCTAssertEqual(try rawText(reader, "therapies", "status", id: "t-new"), "suspended")  // 'paused' canonicalized
        let rawMot = try XCTUnwrap(try rawText(reader, "therapies", "motivation", id: "t-new"))
        XCTAssertTrue(rawMot.hasPrefix("ENC:"))
        XCTAssertEqual(PatientFieldCrypto.decryptStringField(rawMot, masterKey: masterKey), "prevenzione")
        XCTAssertEqual(try rawText(reader, "observations", "code_system", id: "o-new"), "LOINC")  // canonical literal
        XCTAssertEqual(try rawText(reader, "observations", "code", id: "o-new"), "8480-6")  // trimmed
        XCTAssertEqual(try rawText(reader, "observations", "value", id: "o-new"), "120")  // trimmed plaintext
        XCTAssertEqual(
            PatientFieldCrypto.decryptStringField(try rawText(reader, "observations", "notes", id: "o-new"), masterKey: masterKey),
            "a riposo")
    }

    // MARK: List (read), 1:1 with lib/network-{e}-read.ts listNetworkScoped*

    func testListEntriesDecryptsOrdersByDateDescAndIncludesSoftDeleted() throws {
        let (path, _) = try makeDB()
        defer { try? FileManager.default.removeItem(atPath: path) }
        let store = SQLiteClinicalStore(path: path)

        _ = try store.createEntry(
            HomeBaseEntryCreatePayload(id: "e-old", type: "note", date: Date(timeIntervalSince1970: 1_000), content: "vecchia"),
            patientId: "fixture-1", scopeAmbulatoryId: "AMB-1", masterKey: masterKey)
        _ = try store.createEntry(
            HomeBaseEntryCreatePayload(id: "e-new", type: "note", date: Date(timeIntervalSince1970: 2_000), content: "recente"),
            patientId: "fixture-1", scopeAmbulatoryId: "AMB-1", masterKey: masterKey)
        // Soft-delete the older one: the list must still include it (no active filter, matching the web).
        _ = try store.updateEntry(
            id: "e-old", patientId: "fixture-1", scopeAmbulatoryId: "AMB-1",
            payload: HomeBaseEntryUpdatePayload(version: 1, deletedAt: Date(timeIntervalSince1970: 3_000),
                                               deletionReason: "test"),
            masterKey: masterKey)

        let list = try store.listEntries(patientId: "fixture-1", scopeAmbulatoryId: "AMB-1", masterKey: masterKey)
        XCTAssertEqual(list.map(\.id), ["e-new", "e-old"])  // date DESC
        XCTAssertEqual(list.map(\.content), ["recente", "vecchia"])  // decrypted
        XCTAssertNotNil(list.last?.deletedAt)  // tombstoned row still listed
    }

    func testListEntriesOutOfScopeIsEmptyAndLimitIsRespected() throws {
        let (path, _) = try makeDB()
        defer { try? FileManager.default.removeItem(atPath: path) }
        let store = SQLiteClinicalStore(path: path)
        for i in 0..<3 {
            _ = try store.createEntry(
                HomeBaseEntryCreatePayload(id: "e\(i)", type: "note", date: Date(timeIntervalSince1970: Double(i)), content: "c\(i)"),
                patientId: "fixture-1", scopeAmbulatoryId: "AMB-1", masterKey: masterKey)
        }
        XCTAssertTrue(try store.listEntries(patientId: "fixture-1", scopeAmbulatoryId: "AMB-OTHER", masterKey: masterKey).isEmpty)
        XCTAssertEqual(try store.listEntries(patientId: "fixture-1", scopeAmbulatoryId: "AMB-1", masterKey: masterKey, limit: 2).count, 2)
    }

    func testListTherapiesOrdersByStartDateDescAndDecryptsMotivation() throws {
        let (path, _) = try makeDB()
        defer { try? FileManager.default.removeItem(atPath: path) }
        let store = SQLiteClinicalStore(path: path)
        _ = try store.createTherapy(
            HomeBaseTherapyCreatePayload(drugName: "ASA", dosage: "100mg", status: "active",
                                        startDate: Date(timeIntervalSince1970: 1_000), motivation: "prevenzione"),
            patientId: "fixture-1", scopeAmbulatoryId: "AMB-1", masterKey: masterKey, id: "t-old")
        _ = try store.createTherapy(
            HomeBaseTherapyCreatePayload(drugName: "Plavix", dosage: "75mg", status: "active",
                                        startDate: Date(timeIntervalSince1970: 2_000)),
            patientId: "fixture-1", scopeAmbulatoryId: "AMB-1", masterKey: masterKey, id: "t-new")

        let list = try store.listTherapies(patientId: "fixture-1", scopeAmbulatoryId: "AMB-1", masterKey: masterKey)
        XCTAssertEqual(list.map(\.id), ["t-new", "t-old"])
        XCTAssertEqual(list.last?.motivation, "prevenzione")
    }

    func testListCheckupsOrdersByDateDescAndDecryptsNotes() throws {
        let (path, _) = try makeDB()
        defer { try? FileManager.default.removeItem(atPath: path) }
        let store = SQLiteClinicalStore(path: path)
        _ = try store.createCheckup(
            HomeBaseCheckupCreatePayload(date: Date(timeIntervalSince1970: 1_000), title: "Vecchio", status: "pending", notes: "riservato"),
            patientId: "fixture-1", scopeAmbulatoryId: "AMB-1", masterKey: masterKey, id: "c-old")
        _ = try store.createCheckup(
            HomeBaseCheckupCreatePayload(date: Date(timeIntervalSince1970: 2_000), title: "Nuovo", status: "pending"),
            patientId: "fixture-1", scopeAmbulatoryId: "AMB-1", masterKey: masterKey, id: "c-new")

        let list = try store.listCheckups(patientId: "fixture-1", scopeAmbulatoryId: "AMB-1", masterKey: masterKey)
        XCTAssertEqual(list.map(\.id), ["c-new", "c-old"])
        XCTAssertEqual(list.last?.notes, "riservato")
    }

    func testListObservationsOrdersByObservedAtDescAndDecryptsNotes() throws {
        let (path, _) = try makeDB()
        defer { try? FileManager.default.removeItem(atPath: path) }
        let store = SQLiteClinicalStore(path: path)
        _ = try store.createObservation(
            HomeBaseObservationCreatePayload(code: "8480-6", display: "Systolic", unitCode: "mm[Hg]",
                                            value: "120", observedAt: Date(timeIntervalSince1970: 1_000), notes: "a riposo"),
            patientId: "fixture-1", scopeAmbulatoryId: "AMB-1", masterKey: masterKey, id: "o-old")
        _ = try store.createObservation(
            HomeBaseObservationCreatePayload(code: "8480-6", display: "Systolic", unitCode: "mm[Hg]",
                                            value: "130", observedAt: Date(timeIntervalSince1970: 2_000)),
            patientId: "fixture-1", scopeAmbulatoryId: "AMB-1", masterKey: masterKey, id: "o-new")

        let list = try store.listObservations(patientId: "fixture-1", scopeAmbulatoryId: "AMB-1", masterKey: masterKey)
        XCTAssertEqual(list.map(\.id), ["o-new", "o-old"])
        XCTAssertEqual(list.last?.notes, "a riposo")
        XCTAssertEqual(list.first?.value, "130")  // plaintext column, no crypto involved
    }

    /// Read-time status canonicalization, 1:1 with normalizeTherapyStatus/
    /// normalizeCheckupStatus (lib/status-normalization.ts): the web ALWAYS collapses
    /// legacy aliases on every read, not just on write. Seeded via a raw INSERT
    /// (bypassing createTherapy/createCheckup, which already canonicalize on write) so
    /// the assertion proves the READ path itself canonicalizes, independent of how the
    /// raw token got into the row (e.g. a legacy import or a direct DB write).
    func testListTherapiesAndCheckupsCanonicalizeLegacyStatusAliases() throws {
        let (path, seed) = try makeDB()
        defer { try? FileManager.default.removeItem(atPath: path) }
        try seed.execute("""
        INSERT INTO therapies (id, patient_id, drug_name, dosage, status, start_date, version)
        VALUES ('t-legacy', 'fixture-1', 'ASA', '100mg', 'paused', 1000, 1)
        """)
        try seed.execute("""
        INSERT INTO checkups (id, patient_id, date, title, status, version)
        VALUES ('c-legacy', 'fixture-1', 1000, 'Vecchio', 'done', 1)
        """)
        let store = SQLiteClinicalStore(path: path)

        let therapies = try store.listTherapies(patientId: "fixture-1", scopeAmbulatoryId: "AMB-1", masterKey: masterKey)
        XCTAssertEqual(therapies.first?.status, "suspended")  // 'paused' canonicalized
        let checkups = try store.listCheckups(patientId: "fixture-1", scopeAmbulatoryId: "AMB-1", masterKey: masterKey)
        XCTAssertEqual(checkups.first?.status, "completed")  // 'done' canonicalized
    }

    /// limit == 0 means unbounded, matching the web's JS-falsy ternary
    /// (`filters.limit ? query.limit(filters.limit) : query`).
    func testListEntriesLimitZeroIsUnbounded() throws {
        let (path, _) = try makeDB()
        defer { try? FileManager.default.removeItem(atPath: path) }
        let store = SQLiteClinicalStore(path: path)
        for i in 0..<3 {
            _ = try store.createEntry(
                HomeBaseEntryCreatePayload(id: "e\(i)", type: "note", date: Date(timeIntervalSince1970: Double(i)), content: "c\(i)"),
                patientId: "fixture-1", scopeAmbulatoryId: "AMB-1", masterKey: masterKey)
        }
        XCTAssertEqual(try store.listEntries(patientId: "fixture-1", scopeAmbulatoryId: "AMB-1", masterKey: masterKey, limit: 0).count, 3)
    }
}

private extension Data {
    init(hexString: String) {
        var data = Data(capacity: hexString.count / 2)
        var index = hexString.startIndex
        while index < hexString.endIndex {
            let next = hexString.index(index, offsetBy: 2)
            data.append(UInt8(hexString[index..<next], radix: 16)!)
            index = next
        }
        self = data
    }
}
