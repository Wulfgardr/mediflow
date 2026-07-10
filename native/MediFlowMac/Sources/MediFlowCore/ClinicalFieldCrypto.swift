// Decrypts the ENCRYPTED_FIELDS of the clinical sub-resources (lib/db.ts) the same
// way PatientFieldCrypto does for the patient: ENC -> decrypt (+ JSON-unwrap for
// string fields), plaintext (API-direct / test seeds) passes through, and an
// undecryptable ENC value becomes empty/nil so ciphertext is never shown.
import Foundation
import Crypto  // swift-crypto: re-exports CryptoKit on Apple, BoringSSL on Linux/Windows (ADR 0071)

public enum HomeBaseAttachmentCryptoError: LocalizedError, Equatable {
    case attachmentNotOwned([String])
    case invalidSize
    case sealingFailed

    public var errorDescription: String? {
        switch self {
        case .attachmentNotOwned(let ids):
            return "Riferimenti allegato non appartenenti al paziente: \(ids.joined(separator: ", "))"
        case .invalidSize:
            return "La dimensione dell'allegato non puo essere negativa."
        case .sealingFailed:
            return "Cifratura dell'allegato non riuscita."
        }
    }
}

public struct HomeBaseSealedEntryAttachmentReferences: Equatable, Sendable {
    let encodedValue: String?

    public var isClear: Bool { encodedValue == nil }
}

public enum HomeBaseAttachmentReferenceValidator {
    @discardableResult
    public static func validate(
        patientAttachmentIds: Set<String>,
        referencedAttachmentIds: [String]
    ) throws -> [String] {
        let unknown = Array(Set(referencedAttachmentIds).subtracting(patientAttachmentIds)).sorted()
        guard unknown.isEmpty else {
            throw HomeBaseAttachmentCryptoError.attachmentNotOwned(unknown)
        }
        return referencedAttachmentIds
    }
}

public enum ClinicalFieldCrypto {
    private static func string(_ value: String?, _ key: SymmetricKey?) -> String? {
        PatientFieldCrypto.decryptStringField(value, masterKey: key)
    }

    private static func structured(_ value: String?, _ key: SymmetricKey?) -> String? {
        PatientFieldCrypto.decryptStructuredField(value, masterKey: key)
    }

    public static func sealAttachmentCreatePayload(
        name: String,
        path: String,
        data: String,
        type: String,
        size: Int,
        masterKey: SymmetricKey
    ) throws -> HomeBaseAttachmentCreatePayload {
        guard size >= 0 else { throw HomeBaseAttachmentCryptoError.invalidSize }
        return HomeBaseAttachmentCreatePayload(
            name: try sealString(name, masterKey: masterKey),
            path: try sealString(path, masterKey: masterKey),
            data: try sealString(data, masterKey: masterKey),
            type: type,
            size: size
        )
    }

    public static func sealEntryAttachmentReferences(
        patientAttachmentIds: Set<String>,
        referencedAttachmentIds: [String],
        masterKey: SymmetricKey
    ) throws -> HomeBaseSealedEntryAttachmentReferences {
        let validated = try HomeBaseAttachmentReferenceValidator.validate(
            patientAttachmentIds: patientAttachmentIds,
            referencedAttachmentIds: referencedAttachmentIds
        )
        guard !validated.isEmpty else {
            return HomeBaseSealedEntryAttachmentReferences(encodedValue: nil)
        }
        let jsonData = try JSONEncoder().encode(validated)
        guard let json = String(data: jsonData, encoding: .utf8),
              let sealed = CryptoService.encryptField(json, masterKey: masterKey) else {
            throw HomeBaseAttachmentCryptoError.sealingFailed
        }
        return HomeBaseSealedEntryAttachmentReferences(encodedValue: sealed)
    }

    private static func sealString(_ value: String, masterKey: SymmetricKey) throws -> String {
        guard let json = CryptoService.jsonEncode(value),
              let sealed = CryptoService.encryptField(json, masterKey: masterKey) else {
            throw HomeBaseAttachmentCryptoError.sealingFailed
        }
        return sealed
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

    // S6 (Wave 5, ADR 0076 Classe A): attachments encrypt name/path/data/
    // summarySnapshot/parseEvidenceArtifactSnapshot (lib/db.ts ENCRYPTED_FIELDS);
    // type/size/ocrQueue*/ocrReplayArtifactSnapshot/createdAt stay plaintext, same
    // as the host (the queue state machine and the size limit both need to read
    // them without the operator key).
    public static func decryptAttachment(_ a: HomeBaseAttachmentSummary, masterKey: SymmetricKey?) -> HomeBaseAttachmentSummary {
        HomeBaseAttachmentSummary(
            id: a.id, patientId: a.patientId,
            name: string(a.name, masterKey) ?? "",
            type: a.type, size: a.size,
            path: string(a.path, masterKey) ?? "",
            summarySnapshot: string(a.summarySnapshot, masterKey),
            parseEvidenceArtifactSnapshot: string(a.parseEvidenceArtifactSnapshot, masterKey),
            ocrQueueState: a.ocrQueueState, ocrQueueReason: a.ocrQueueReason, ocrQueueUpdatedAt: a.ocrQueueUpdatedAt,
            ocrReplayArtifactSnapshot: a.ocrReplayArtifactSnapshot,
            createdAt: a.createdAt
        )
    }

    public static func decryptAttachmentDetail(_ a: HomeBaseAttachmentDetail, masterKey: SymmetricKey?) -> HomeBaseAttachmentDetail {
        HomeBaseAttachmentDetail(
            id: a.id, patientId: a.patientId,
            name: string(a.name, masterKey) ?? "",
            type: a.type, size: a.size,
            path: string(a.path, masterKey) ?? "",
            summarySnapshot: string(a.summarySnapshot, masterKey),
            parseEvidenceArtifactSnapshot: string(a.parseEvidenceArtifactSnapshot, masterKey),
            ocrQueueState: a.ocrQueueState, ocrQueueReason: a.ocrQueueReason, ocrQueueUpdatedAt: a.ocrQueueUpdatedAt,
            ocrReplayArtifactSnapshot: a.ocrReplayArtifactSnapshot,
            createdAt: a.createdAt,
            data: string(a.data, masterKey)
        )
    }
}
