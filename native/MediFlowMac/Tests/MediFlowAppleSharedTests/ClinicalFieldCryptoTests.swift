import XCTest
import CryptoKit
@testable import MediFlowAppleShared

final class ClinicalFieldCryptoTests: XCTestCase {
    private let rawKeyB64 = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8="
    // Web vector: ENC of JSON.stringify("Referto: quadro stabile").
    private let encString = "ENC:ZGVmZ2hpamtsbW5v:akm7ABybIvEEQi6duwEYkmKxcmvpBZ8Xhf/mV+9XRjK5m/MiBpaG3SU="
    private var key: SymmetricKey { SymmetricKey(data: Data(base64Encoded: rawKeyB64)!) }
    private let epoch = Date(timeIntervalSince1970: 1_750_000_000)

    func testDecryptEntryDecryptsTitleAndContentAndPassesPlaintext() {
        let encContent = CryptoService.encryptField(CryptoService.jsonEncode("Contenuto riservato")!, masterKey: key)!
        let entry = HomeBaseEntrySummary(
            id: "e1", patientId: "p1", type: "note", title: encString, date: epoch,
            content: encContent, setting: nil, metadata: nil, attachments: nil,
            deletedAt: nil, deletionReason: nil, version: 1, createdAt: nil, updatedAt: nil
        )
        let result = ClinicalFieldCrypto.decryptEntry(entry, masterKey: key)
        XCTAssertEqual(result.title, "Referto: quadro stabile")
        XCTAssertEqual(result.content, "Contenuto riservato")
        XCTAssertEqual(result.type, "note", "non-encrypted fields untouched")
    }

    func testDecryptEntryHidesCiphertextWithoutKey() {
        let entry = HomeBaseEntrySummary(
            id: "e1", patientId: "p1", type: "note", title: encString, date: epoch,
            content: encString, setting: nil, metadata: nil, attachments: nil,
            deletedAt: nil, deletionReason: nil, version: 1, createdAt: nil, updatedAt: nil
        )
        let result = ClinicalFieldCrypto.decryptEntry(entry, masterKey: nil)
        XCTAssertEqual(result.title, "", "ciphertext must not be shown")
        XCTAssertEqual(result.content, "")
    }

    func testDecryptTherapyDecryptsMotivation() {
        let encMot = CryptoService.encryptField(CryptoService.jsonEncode("Profilassi")!, masterKey: key)!
        let therapy = HomeBaseTherapySummary(
            id: "t1", patientId: "p1", drugName: "ASA", aic: nil, atc: nil, activePrinciple: nil,
            dosage: "100mg", motivation: encMot, diagnosisCode: nil, diagnosisName: nil,
            status: "active", startDate: epoch, endDate: nil, version: 1, createdAt: nil,
            updatedAt: nil, deletedAt: nil, deletionReason: nil
        )
        XCTAssertEqual(ClinicalFieldCrypto.decryptTherapy(therapy, masterKey: key).motivation, "Profilassi")
    }

    func testDecryptCheckupDecryptsNotes() {
        let encNotes = CryptoService.encryptField(CryptoService.jsonEncode("Controllo regolare")!, masterKey: key)!
        let checkup = HomeBaseCheckupSummary(
            id: "c1", patientId: "p1", date: epoch, title: "Visita", notes: encNotes,
            status: "pending", source: nil, version: 1, createdAt: nil, updatedAt: nil,
            deletedAt: nil, deletionReason: nil
        )
        XCTAssertEqual(ClinicalFieldCrypto.decryptCheckup(checkup, masterKey: key).notes, "Controllo regolare")
    }

    func testDecryptObservationDecryptsNotesAndKeepsValue() {
        let encNotes = CryptoService.encryptField(CryptoService.jsonEncode("A digiuno")!, masterKey: key)!
        let obs = HomeBaseObservationSummary(
            id: "o1", patientId: "p1", codeSystem: "loinc", code: "x", display: "Glicemia",
            unitSystem: "ucum", unitCode: "mg/dL", value: "95", notes: encNotes, observedAt: epoch,
            source: nil, version: 1, createdAt: nil, updatedAt: nil, deletedAt: nil, deletionReason: nil
        )
        let result = ClinicalFieldCrypto.decryptObservation(obs, masterKey: key)
        XCTAssertEqual(result.notes, "A digiuno")
        XCTAssertEqual(result.value, "95", "value is not encrypted and must stay")
    }

    func testPlaintextSeedPassesThrough() {
        let entry = HomeBaseEntrySummary(
            id: "e1", patientId: "p1", type: "note", title: "Nota in chiaro", date: epoch,
            content: "Testo in chiaro", setting: nil, metadata: nil, attachments: nil,
            deletedAt: nil, deletionReason: nil, version: 1, createdAt: nil, updatedAt: nil
        )
        let result = ClinicalFieldCrypto.decryptEntry(entry, masterKey: nil)
        XCTAssertEqual(result.title, "Nota in chiaro")
        XCTAssertEqual(result.content, "Testo in chiaro")
    }
}
