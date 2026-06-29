// Applies the zero-knowledge field crypto to a fetched patient. The home-base
// serves ENCRYPTED_FIELDS (lib/db.ts) as ENC:iv:data; this decrypts them with the
// operator master key. It also tolerates plaintext (API-direct data / test seeds):
// a non-ENC value passes through unchanged. Structured fields (exemptions,
// diagnoses) keep their decrypted array JSON for the codecs; plain string fields
// are JSON-unwrapped (the web stores JSON.stringify(value)).
import Foundation
import CryptoKit

public enum PatientFieldCrypto {
    /// A plain string field: ENC -> decrypt -> JSON-unwrap; plaintext -> as-is;
    /// undecryptable ENC (no/wrong key) -> nil so ciphertext is never shown.
    public static func decryptStringField(_ value: String?, masterKey: SymmetricKey?) -> String? {
        guard let value else { return nil }
        guard value.hasPrefix(CryptoService.encPrefix) else { return value }
        guard let masterKey, let decrypted = CryptoService.decryptField(value, masterKey: masterKey) else {
            return nil
        }
        return CryptoService.jsonDecodeString(decrypted) ?? decrypted
    }

    /// A structured field (exemptions, diagnoses): ENC -> decrypt to the array
    /// JSON the codecs expect; plaintext -> as-is; undecryptable -> nil.
    public static func decryptStructuredField(_ value: String?, masterKey: SymmetricKey?) -> String? {
        guard let value else { return nil }
        guard value.hasPrefix(CryptoService.encPrefix) else { return value }
        guard let masterKey else { return nil }
        return CryptoService.decryptField(value, masterKey: masterKey)
    }

    /// Return a copy of the detail with its ENCRYPTED_FIELDS decrypted. With no
    /// master key, ENC values become nil (hidden) and plaintext stays visible.
    public static func decryptDetail(_ detail: HomeBasePatientDetail, masterKey: SymmetricKey?) -> HomeBasePatientDetail {
        HomeBasePatientDetail(
            id: detail.id,
            firstName: detail.firstName,
            lastName: detail.lastName,
            birthDate: detail.birthDate,
            taxCode: detail.taxCode,
            address: decryptStringField(detail.address, masterKey: masterKey),
            phone: decryptStringField(detail.phone, masterKey: masterKey),
            caregiver: decryptStringField(detail.caregiver, masterKey: masterKey),
            exemptions: decryptStructuredField(detail.exemptions, masterKey: masterKey),
            diagnoses: decryptStructuredField(detail.diagnoses, masterKey: masterKey),
            monitoringProfile: detail.monitoringProfile,
            statusReason: decryptStringField(detail.statusReason, masterKey: masterKey),
            notes: decryptStringField(detail.notes, masterKey: masterKey),
            aiSummary: decryptStringField(detail.aiSummary, masterKey: masterKey),
            documentInsights: decryptStringField(detail.documentInsights, masterKey: masterKey),
            isAdi: detail.isAdi,
            isArchived: detail.isArchived,
            version: detail.version,
            ambulatoryId: detail.ambulatoryId,
            createdAt: detail.createdAt,
            updatedAt: detail.updatedAt
        )
    }
}
