// Decrypts the ENCRYPTED_FIELDS of the clinical sub-resources (lib/db.ts) the same
// way PatientFieldCrypto does for the patient: ENC -> decrypt (+ JSON-unwrap for
// string fields), plaintext (API-direct / test seeds) passes through, and an
// undecryptable ENC value becomes empty/nil so ciphertext is never shown.
import Foundation
import Crypto  // swift-crypto: re-exports CryptoKit on Apple, BoringSSL on Linux/Windows (ADR 0071)

public enum ClinicalFieldCrypto {
    private static func string(_ value: String?, _ key: SymmetricKey?) -> String? {
        PatientFieldCrypto.decryptStringField(value, masterKey: key)
    }

    private static func structured(_ value: String?, _ key: SymmetricKey?) -> String? {
        PatientFieldCrypto.decryptStructuredField(value, masterKey: key)
    }

    public static func decryptEntry(_ e: HomeBaseEntrySummary, masterKey: SymmetricKey?) -> HomeBaseEntrySummary {
        HomeBaseEntrySummary(
            id: e.id, patientId: e.patientId, type: e.type,
            title: string(e.title, masterKey) ?? "",
            date: e.date,
            content: string(e.content, masterKey) ?? "",
            setting: e.setting,
            metadata: structured(e.metadata, masterKey),
            attachments: structured(e.attachments, masterKey),
            deletedAt: e.deletedAt,
            deletionReason: string(e.deletionReason, masterKey),
            version: e.version, createdAt: e.createdAt, updatedAt: e.updatedAt
        )
    }

    public static func decryptTherapy(_ t: HomeBaseTherapySummary, masterKey: SymmetricKey?) -> HomeBaseTherapySummary {
        HomeBaseTherapySummary(
            id: t.id, patientId: t.patientId, drugName: t.drugName, aic: t.aic, atc: t.atc,
            activePrinciple: t.activePrinciple, dosage: t.dosage,
            motivation: string(t.motivation, masterKey),
            diagnosisCode: t.diagnosisCode, diagnosisName: t.diagnosisName, status: t.status,
            startDate: t.startDate, endDate: t.endDate, version: t.version,
            createdAt: t.createdAt, updatedAt: t.updatedAt, deletedAt: t.deletedAt,
            deletionReason: string(t.deletionReason, masterKey)
        )
    }

    public static func decryptCheckup(_ c: HomeBaseCheckupSummary, masterKey: SymmetricKey?) -> HomeBaseCheckupSummary {
        HomeBaseCheckupSummary(
            id: c.id, patientId: c.patientId, date: c.date, title: c.title,
            notes: string(c.notes, masterKey),
            status: c.status, source: c.source, version: c.version,
            createdAt: c.createdAt, updatedAt: c.updatedAt, deletedAt: c.deletedAt,
            deletionReason: string(c.deletionReason, masterKey)
        )
    }

    public static func decryptObservation(_ o: HomeBaseObservationSummary, masterKey: SymmetricKey?) -> HomeBaseObservationSummary {
        HomeBaseObservationSummary(
            id: o.id, patientId: o.patientId, codeSystem: o.codeSystem, code: o.code,
            display: o.display, unitSystem: o.unitSystem, unitCode: o.unitCode, value: o.value,
            notes: string(o.notes, masterKey),
            observedAt: o.observedAt, source: o.source, version: o.version,
            createdAt: o.createdAt, updatedAt: o.updatedAt, deletedAt: o.deletedAt,
            deletionReason: string(o.deletionReason, masterKey)
        )
    }
}
