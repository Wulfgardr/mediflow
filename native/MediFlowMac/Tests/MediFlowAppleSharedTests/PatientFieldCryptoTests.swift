import XCTest
import CryptoKit
@testable import MediFlowAppleShared

final class PatientFieldCryptoTests: XCTestCase {
    // Web vector: ENC of JSON.stringify("Referto: quadro stabile") under key bytes 0..31.
    private let rawKeyB64 = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8="
    private let encString = "ENC:ZGVmZ2hpamtsbW5v:akm7ABybIvEEQi6duwEYkmKxcmvpBZ8Xhf/mV+9XRjK5m/MiBpaG3SU="

    private var key: SymmetricKey { SymmetricKey(data: Data(base64Encoded: rawKeyB64)!) }

    private func detail(address: String?, diagnoses: String?, notes: String?) -> HomeBasePatientDetail {
        HomeBasePatientDetail(
            id: "p1", firstName: "Mario", lastName: "Rossi", birthDate: nil, taxCode: "RSSMRA",
            address: address, phone: nil, caregiver: nil, exemptions: nil, diagnoses: diagnoses,
            monitoringProfile: nil, statusReason: nil, notes: notes, aiSummary: nil,
            documentInsights: nil, isAdi: false, isArchived: false, version: 1,
            ambulatoryId: "AMB-1", createdAt: nil, updatedAt: nil
        )
    }

    func testDecryptStringFieldDecryptsEncAndUnwrapsJson() {
        XCTAssertEqual(PatientFieldCrypto.decryptStringField(encString, masterKey: key), "Referto: quadro stabile")
    }

    func testPlaintextStringFieldPassesThrough() {
        XCTAssertEqual(PatientFieldCrypto.decryptStringField("Via Roma 1", masterKey: key), "Via Roma 1")
    }

    func testEncFieldWithoutKeyIsHidden() {
        XCTAssertNil(PatientFieldCrypto.decryptStringField(encString, masterKey: nil),
                     "ciphertext must never be shown when the key is unavailable")
    }

    /* @Codex */
    func testEditableFieldResolvesAbsentPlaintextAndLockedByteExactly() {
        XCTAssertEqual(PatientFieldCrypto.resolveStringField(nil, masterKey: key), .absent)
        XCTAssertEqual(
            PatientFieldCrypto.resolveStringField("Via Roma 1", masterKey: key),
            .plaintext("Via Roma 1"))

        let wrongKey = SymmetricKey(size: .bits256)
        let locked = PatientFieldCrypto.resolveStringField(encString, masterKey: wrongKey)
        XCTAssertEqual(locked, .locked(ciphertext: encString))
        XCTAssertEqual(
            PatientFieldCrypto.resolveStringField("ENC:corrupt:value", masterKey: key),
            .locked(ciphertext: "ENC:corrupt:value"))
    }

    /* @Codex */
    func testLockedEditableFieldEncodesAsOmit() {
        let wrongKey = SymmetricKey(size: .bits256)
        let locked = PatientFieldCrypto.resolveStringField(encString, masterKey: wrongKey)
        guard case .omit = PatientFieldCrypto.encryptedPatchValue(
            "", original: locked, masterKey: wrongKey) else {
            return XCTFail("locked fields must be omitted")
        }
    }

    func testStructuredFieldRoundTripsArrayJson() {
        let arrayJSON = "[{\"code\":\"E11.9\",\"description\":\"Diabete\",\"system\":\"ICD-10\",\"date\":\"2026-01-01T00:00:00.000Z\"}]"
        let enc = CryptoService.encryptField(arrayJSON, masterKey: key)!
        let decrypted = PatientFieldCrypto.decryptStructuredField(enc, masterKey: key)
        XCTAssertEqual(decrypted, arrayJSON, "a structured field decrypts back to its array JSON")
        // And the codec can parse it.
        XCTAssertEqual(DiagnosesCodec.decode(decrypted).first?.code, "E11.9")
    }

    func testPlaintextStructuredFieldPassesThrough() {
        let arrayJSON = "[{\"code\":\"I10\",\"description\":\"Ipertensione\"}]"
        XCTAssertEqual(PatientFieldCrypto.decryptStructuredField(arrayJSON, masterKey: key), arrayJSON)
    }

    func testDecryptDetailDecryptsEncryptedFieldsAndLeavesPlaintext() {
        let arrayJSON = "[{\"code\":\"E11.9\",\"description\":\"Diabete\",\"system\":\"ICD-10\",\"date\":\"2026-01-01T00:00:00.000Z\"}]"
        let encDiagnoses = CryptoService.encryptField(arrayJSON, masterKey: key)!
        let input = detail(address: "Via Roma 1", diagnoses: encDiagnoses, notes: encString)
        let result = PatientFieldCrypto.decryptDetail(input, masterKey: key)

        XCTAssertEqual(result.firstName, "Mario", "non-encrypted fields are untouched")
        XCTAssertEqual(result.taxCode, "RSSMRA")
        XCTAssertEqual(result.address, "Via Roma 1", "plaintext field stays")
        XCTAssertEqual(result.notes, "Referto: quadro stabile", "ENC string field is decrypted + unwrapped")
        XCTAssertEqual(DiagnosesCodec.decode(result.diagnoses).first?.code, "E11.9", "ENC structured field is decrypted")
    }
}
