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
