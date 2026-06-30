import XCTest
import Crypto
@testable import MediFlowCore

/// ADR 0071 Fase 2: the read-only SQLitePatientStore opens a real medical.db,
/// reads the active patients, and decrypts ENCRYPTED_FIELDS with the operator
/// master key. The fixture (Fixtures/medical_fixture.db) was sealed with the
/// golden-vector master key, so the test decrypts without an operator PIN and
/// proves the on-device store reads + decrypts byte-equal with the web.
final class SQLitePatientStoreTests: XCTestCase {

    // Same raw key the fixture (and the crypto golden vectors) were sealed with.
    private let masterKey = SymmetricKey(
        data: Data(hexString: "404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f"))

    private func fixturePath() -> String {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .appendingPathComponent("Fixtures/medical_fixture.db")
            .path
    }

    func testListPatientsReadsPlaintextSummary() throws {
        let store = SQLitePatientStore(path: fixturePath())
        let patients = try store.listPatients()
        XCTAssertEqual(patients.count, 1)
        let p = try XCTUnwrap(patients.first)
        XCTAssertEqual(p.id, "fixture-1")
        XCTAssertEqual(p.firstName, "Mario")
        XCTAssertEqual(p.lastName, "Rossi")
        XCTAssertEqual(p.taxCode, "RSSMRA80A01H501U")
        XCTAssertEqual(p.version, 1)
        XCTAssertEqual(p.isArchived, false)
    }

    func testLoadPatientDetailDecryptsEncryptedFields() throws {
        let store = SQLitePatientStore(path: fixturePath())
        let detail = try XCTUnwrap(try store.loadPatientDetail(id: "fixture-1", masterKey: masterKey))

        // String ENCRYPTED_FIELDS decrypt + JSON-unwrap to their plaintext.
        XCTAssertEqual(detail.address, "Via Roma 1, Milano")
        XCTAssertEqual(detail.phone, "+39 02 1234567")
        XCTAssertEqual(detail.caregiver, "Caregiver Test")
        // Plaintext columns survive untouched.
        XCTAssertEqual(detail.firstName, "Mario")
        XCTAssertEqual(detail.ambulatoryId, "AMB-1")

        // Structured ENCRYPTED_FIELDS decrypt to JSON the codecs then parse.
        XCTAssertEqual(ExemptionCodesCodec.decode(detail.exemptions), ["048", "C01"])
        let diagnoses = DiagnosesCodec.decode(detail.diagnoses)
        XCTAssertEqual(diagnoses.first?.code, "E11.9")
        XCTAssertEqual(diagnoses.first?.system, "ICD-10")
    }

    func testLoadPatientDetailMissingIdReturnsNil() throws {
        let store = SQLitePatientStore(path: fixturePath())
        XCTAssertNil(try store.loadPatientDetail(id: "does-not-exist", masterKey: masterKey))
    }

    // MARK: Write path (reversed flow: the core is the on-device write authority)

    /// A throwaway writable copy of the fixture so the committed db stays pristine.
    private func writableFixtureCopy() throws -> String {
        let destination = NSTemporaryDirectory() + "mediflow-write-\(UUID().uuidString).db"
        try? FileManager.default.removeItem(atPath: destination)
        try FileManager.default.copyItem(atPath: fixturePath(), toPath: destination)
        return destination
    }

    func testUpdatePatientBumpsVersionSealsFieldsAndPersists() throws {
        let path = try writableFixtureCopy()
        defer { try? FileManager.default.removeItem(atPath: path) }
        let store = SQLitePatientStore(path: path)

        let payload = HomeBasePatientUpdatePayload(
            version: 1, firstName: "Maria", address: .value("Via Milano 9"))
        let outcome = try store.updatePatient(
            id: "fixture-1", scopeAmbulatoryId: "AMB-1", payload: payload, masterKey: masterKey)
        XCTAssertEqual(outcome, .updated(version: 2))

        let detail = try XCTUnwrap(try store.loadPatientDetail(id: "fixture-1", masterKey: masterKey))
        XCTAssertEqual(detail.firstName, "Maria")
        XCTAssertEqual(detail.address, "Via Milano 9")
        XCTAssertEqual(detail.version, 2)
        // Untouched encrypted field still decrypts (we only wrote address).
        XCTAssertEqual(detail.phone, "+39 02 1234567")

        // Proof of zero-knowledge at rest: the wrong key can't read the new address
        // (it is ENC:, not plaintext) while the plaintext column stays visible.
        let wrongKey = SymmetricKey(size: .bits256)
        let masked = try XCTUnwrap(try store.loadPatientDetail(id: "fixture-1", masterKey: wrongKey))
        XCTAssertNil(masked.address)
        XCTAssertEqual(masked.firstName, "Maria")
    }

    func testUpdatePatientStructuredDiagnosesSealedAtRest() throws {
        let path = try writableFixtureCopy()
        defer { try? FileManager.default.removeItem(atPath: path) }
        let store = SQLitePatientStore(path: path)

        let diagnoses = [ClinicalDiagnosis(code: "I10", description: "Ipertensione", system: "ICD-10")]
        let diagnosesJSON = try XCTUnwrap(
            DiagnosesCodec.encode(diagnoses, defaultDate: "2026-01-01T00:00:00.000Z"))
        let payload = HomeBasePatientUpdatePayload(version: 1, diagnoses: .value(diagnosesJSON))
        XCTAssertEqual(
            try store.updatePatient(id: "fixture-1", scopeAmbulatoryId: "AMB-1",
                                    payload: payload, masterKey: masterKey),
            .updated(version: 2))

        let detail = try XCTUnwrap(try store.loadPatientDetail(id: "fixture-1", masterKey: masterKey))
        XCTAssertEqual(DiagnosesCodec.decode(detail.diagnoses).first?.code, "I10")
        // ENC at rest: undecryptable with the wrong key.
        let masked = try XCTUnwrap(try store.loadPatientDetail(id: "fixture-1", masterKey: SymmetricKey(size: .bits256)))
        XCTAssertTrue(DiagnosesCodec.decode(masked.diagnoses).isEmpty)
    }

    func testUpdatePatientClearsNullableFieldWithExplicitNull() throws {
        let path = try writableFixtureCopy()
        defer { try? FileManager.default.removeItem(atPath: path) }
        let store = SQLitePatientStore(path: path)

        let payload = HomeBasePatientUpdatePayload(version: 1, address: .null)
        XCTAssertEqual(
            try store.updatePatient(id: "fixture-1", scopeAmbulatoryId: "AMB-1",
                                    payload: payload, masterKey: masterKey),
            .updated(version: 2))
        let detail = try XCTUnwrap(try store.loadPatientDetail(id: "fixture-1", masterKey: masterKey))
        XCTAssertNil(detail.address)
        XCTAssertEqual(detail.version, 2)
    }

    func testUpdatePatientVersionMismatchReturnsConflictAndRollsBack() throws {
        let path = try writableFixtureCopy()
        defer { try? FileManager.default.removeItem(atPath: path) }
        let store = SQLitePatientStore(path: path)

        let payload = HomeBasePatientUpdatePayload(version: 99, firstName: "Stale")
        let outcome = try store.updatePatient(
            id: "fixture-1", scopeAmbulatoryId: "AMB-1", payload: payload, masterKey: masterKey)
        guard case .conflict(let conflict) = outcome else {
            return XCTFail("expected a version conflict, got \(outcome)")
        }
        XCTAssertEqual(conflict.code, "VERSION_CONFLICT")
        XCTAssertEqual(conflict.entity, "patient")
        XCTAssertEqual(conflict.recordId, "fixture-1")
        XCTAssertEqual(conflict.expectedVersion, 99)
        XCTAssertEqual(conflict.currentVersion, 1)
        XCTAssertEqual(conflict.currentState, "present")
        XCTAssertEqual(conflict.currentSnapshot?.isArchived, false)

        // The conflicting write left no trace (rolled back).
        let detail = try XCTUnwrap(try store.loadPatientDetail(id: "fixture-1", masterKey: masterKey))
        XCTAssertEqual(detail.version, 1)
        XCTAssertEqual(detail.firstName, "Mario")
    }

    func testUpdatePatientMissingIdReturnsNotFound() throws {
        let path = try writableFixtureCopy()
        defer { try? FileManager.default.removeItem(atPath: path) }
        let store = SQLitePatientStore(path: path)
        let payload = HomeBasePatientUpdatePayload(version: 1, firstName: "Ghost")
        XCTAssertEqual(
            try store.updatePatient(id: "no-such-id", scopeAmbulatoryId: "AMB-1",
                                    payload: payload, masterKey: masterKey),
            .notFound)
    }

    func testUpdatePatientOutOfScopeReturnsNotFound() throws {
        let path = try writableFixtureCopy()
        defer { try? FileManager.default.removeItem(atPath: path) }
        let store = SQLitePatientStore(path: path)
        let payload = HomeBasePatientUpdatePayload(version: 1, firstName: "Wrong scope")
        XCTAssertEqual(
            try store.updatePatient(id: "fixture-1", scopeAmbulatoryId: "AMB-OTHER",
                                    payload: payload, masterKey: masterKey),
            .notFound)
    }

    func testUpdatePatientVersionZeroIsVersionRequired() throws {
        let path = try writableFixtureCopy()
        defer { try? FileManager.default.removeItem(atPath: path) }
        let store = SQLitePatientStore(path: path)
        let payload = HomeBasePatientUpdatePayload(version: 0, firstName: "NoVersion")
        XCTAssertEqual(
            try store.updatePatient(id: "fixture-1", scopeAmbulatoryId: "AMB-1",
                                    payload: payload, masterKey: masterKey),
            .versionRequired)
    }

    func testUpdatePatientWithNoFieldsIsNoValidFields() throws {
        let path = try writableFixtureCopy()
        defer { try? FileManager.default.removeItem(atPath: path) }
        let store = SQLitePatientStore(path: path)
        let payload = HomeBasePatientUpdatePayload(version: 1)  // version only, all else omit/nil
        XCTAssertEqual(
            try store.updatePatient(id: "fixture-1", scopeAmbulatoryId: "AMB-1",
                                    payload: payload, masterKey: masterKey),
            .noValidFields)
    }

    // MARK: Create

    func testCreatePatientInsertsAndSealsFields() throws {
        let path = try writableFixtureCopy()
        defer { try? FileManager.default.removeItem(atPath: path) }
        let store = SQLitePatientStore(path: path)

        let diagnosesJSON = try XCTUnwrap(DiagnosesCodec.encode(
            [ClinicalDiagnosis(code: "I10", description: "Ipertensione", system: "ICD-10")],
            defaultDate: "2026-01-01T00:00:00.000Z"))
        let payload = HomeBasePatientCreatePayload(
            firstName: "Lucia", lastName: "Bianchi", taxCode: "BNCLCU85M41F205X",
            address: "Via Verdi 3", diagnoses: diagnosesJSON, isAdi: true)
        XCTAssertEqual(
            try store.createPatient(payload, id: "new-1", scopeAmbulatoryId: "AMB-1", masterKey: masterKey),
            .created(id: "new-1", version: 1))

        XCTAssertEqual(try store.listPatients().count, 2)  // fixture-1 + new-1
        let detail = try XCTUnwrap(try store.loadPatientDetail(id: "new-1", masterKey: masterKey))
        XCTAssertEqual(detail.firstName, "Lucia")
        XCTAssertEqual(detail.address, "Via Verdi 3")
        XCTAssertEqual(detail.version, 1)
        XCTAssertEqual(detail.ambulatoryId, "AMB-1")
        XCTAssertEqual(detail.isAdi, true)
        XCTAssertEqual(DiagnosesCodec.decode(detail.diagnoses).first?.code, "I10")

        // Encrypted at rest: the wrong key cannot read address, plaintext stays visible.
        let masked = try XCTUnwrap(try store.loadPatientDetail(id: "new-1", masterKey: SymmetricKey(size: .bits256)))
        XCTAssertNil(masked.address)
        XCTAssertEqual(masked.firstName, "Lucia")
    }

    func testCreatePatientGeneratesLowercaseUUIDWhenIdOmitted() throws {
        let path = try writableFixtureCopy()
        defer { try? FileManager.default.removeItem(atPath: path) }
        let store = SQLitePatientStore(path: path)

        let payload = HomeBasePatientCreatePayload(firstName: "Anon", lastName: "X", taxCode: "T")
        guard case .created(let id, let version) = try store.createPatient(
            payload, scopeAmbulatoryId: nil, masterKey: masterKey) else {
            return XCTFail("expected create success")
        }
        XCTAssertEqual(version, 1)
        XCTAssertEqual(id, id.lowercased())
        XCTAssertEqual(id.count, 36)  // uuidv4 format
        XCTAssertNotNil(try store.loadPatientDetail(id: id, masterKey: masterKey))
    }

    func testCreatePatientCollapsesEmptyNotesToNull() throws {
        let path = try writableFixtureCopy()
        defer { try? FileManager.default.removeItem(atPath: path) }
        let store = SQLitePatientStore(path: path)

        let payload = HomeBasePatientCreatePayload(firstName: "Empty", lastName: "Notes", taxCode: "T", notes: "")
        _ = try store.createPatient(payload, id: "n2", scopeAmbulatoryId: nil, masterKey: masterKey)
        let detail = try XCTUnwrap(try store.loadPatientDetail(id: "n2", masterKey: masterKey))
        XCTAssertNil(detail.notes)
    }

    // MARK: Soft-delete (ADR 0066 tombstone)

    func testSoftDeletePatientTombstonesAndHidesFromReads() throws {
        let path = try writableFixtureCopy()
        defer { try? FileManager.default.removeItem(atPath: path) }
        let store = SQLitePatientStore(path: path)

        XCTAssertEqual(
            try store.softDeletePatient(id: "fixture-1", scopeAmbulatoryId: "AMB-1",
                                        version: 1, masterKey: masterKey),
            .updated(version: 2))
        // The tombstoned patient drops out of every active read path.
        XCTAssertTrue(try store.listPatients().isEmpty)
        XCTAssertNil(try store.loadPatientDetail(id: "fixture-1", masterKey: masterKey))
    }

    func testSoftDeletePatientVersionMismatchConflictsAndRollsBack() throws {
        let path = try writableFixtureCopy()
        defer { try? FileManager.default.removeItem(atPath: path) }
        let store = SQLitePatientStore(path: path)

        guard case .conflict(let conflict) = try store.softDeletePatient(
            id: "fixture-1", scopeAmbulatoryId: "AMB-1", version: 99, masterKey: masterKey) else {
            return XCTFail("expected a version conflict")
        }
        XCTAssertEqual(conflict.entity, "patient")
        XCTAssertEqual(conflict.currentVersion, 1)
        // Still present + active (rolled back).
        XCTAssertNotNil(try store.loadPatientDetail(id: "fixture-1", masterKey: masterKey))
    }

    func testSoftDeletePatientVersionZeroIsVersionRequired() throws {
        let path = try writableFixtureCopy()
        defer { try? FileManager.default.removeItem(atPath: path) }
        let store = SQLitePatientStore(path: path)
        XCTAssertEqual(
            try store.softDeletePatient(id: "fixture-1", scopeAmbulatoryId: "AMB-1",
                                        version: 0, masterKey: masterKey),
            .versionRequired)
    }

    func testSoftDeletePatientMissingIdReturnsNotFound() throws {
        let path = try writableFixtureCopy()
        defer { try? FileManager.default.removeItem(atPath: path) }
        let store = SQLitePatientStore(path: path)
        XCTAssertEqual(
            try store.softDeletePatient(id: "ghost", scopeAmbulatoryId: "AMB-1",
                                        version: 1, masterKey: masterKey),
            .notFound)
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
