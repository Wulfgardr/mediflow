// Applies the zero-knowledge field crypto to a fetched patient. The home-base
// serves ENCRYPTED_FIELDS (lib/db.ts) as ENC:iv:data; this decrypts them with the
// operator master key. It also tolerates plaintext (API-direct data / test seeds):
// a non-ENC value passes through unchanged. Structured fields (exemptions,
// diagnoses) keep their decrypted array JSON for the codecs; plain string fields
// are JSON-unwrapped (the web stores JSON.stringify(value)).
import Foundation
import Crypto  // swift-crypto: re-exports CryptoKit on Apple, BoringSSL on Linux/Windows (ADR 0071)

public enum PatientFieldCrypto {
    /* @Codex */
    public enum EditableField: Equatable, Sendable {
        case absent
        case plaintext(String)
        case locked(ciphertext: String)

        public var isLocked: Bool {
            if case .locked = self { return true }
            return false
        }
    }

    /* @Codex */
    public static func resolveStringField(_ value: String?, masterKey: SymmetricKey?) -> EditableField {
        resolveField(value, masterKey: masterKey) { CryptoService.jsonDecodeString($0) ?? $0 }
    }

    /* @Codex */
    public static func resolveStructuredField(_ value: String?, masterKey: SymmetricKey?) -> EditableField {
        resolveField(value, masterKey: masterKey) { $0 }
    }

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

    /// Return a copy of the summary with its ENCRYPTED_FIELDS decrypted. With no
    /// master key, ENC values become nil (hidden) and plaintext stays visible.
    public static func decryptSummary(_ summary: HomeBasePatientSummary, masterKey: SymmetricKey?) -> HomeBasePatientSummary {
        HomeBasePatientSummary(
            id: summary.id,
            firstName: summary.firstName,
            lastName: summary.lastName,
            birthDate: summary.birthDate,
            taxCode: summary.taxCode,
            isAdi: summary.isAdi,
            isArchived: summary.isArchived,
            version: summary.version,
            updatedAt: summary.updatedAt,
            deletedAt: summary.deletedAt,
            deletionReason: decryptStringField(summary.deletionReason, masterKey: masterKey),
            diagnoses: decryptStructuredField(summary.diagnoses, masterKey: masterKey)
        )
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
            updatedAt: detail.updatedAt,
            deletedAt: detail.deletedAt,
            deletionReason: decryptStringField(detail.deletionReason, masterKey: masterKey)
        )
    }

    /* @Codex */
    public static func encryptedPatchValue(
        _ plaintext: String?, original: EditableField, masterKey: SymmetricKey, structured: Bool = false
    ) -> PatchValue<String> {
        guard !original.isLocked else { return .omit }
        guard let plaintext, !plaintext.isEmpty else { return .null }
        let value = structured ? plaintext : (CryptoService.jsonEncode(plaintext) ?? "")
        guard !value.isEmpty, let encrypted = CryptoService.encryptField(value, masterKey: masterKey) else {
            return .omit
        }
        return .value(encrypted)
    }

    private static func resolveField(
        _ value: String?, masterKey: SymmetricKey?, transform: (String) -> String
    ) -> EditableField {
        guard let value else { return .absent }
        guard value.hasPrefix(CryptoService.encPrefix) else { return .plaintext(value) }
        guard let masterKey, let decrypted = CryptoService.decryptField(value, masterKey: masterKey) else {
            return .locked(ciphertext: value)
        }
        return .plaintext(transform(decrypted))
    }
}
