import Foundation

/// S7 (Wave 5, ADR 0076 Classe B): decodes the DECRYPTED `attachments` field of
/// a diary entry (a JSON array of attachment ids, sealed `ENC:` by
/// `ClinicalFieldCrypto.sealEntryAttachmentReferences` on write) back into
/// plain ids for display. Read-side counterpart to that seal: no validation
/// here, ownership was already enforced client-side before the seal.
public enum HomeBaseEntryAttachmentReferencesCodec {
    public static func decode(_ decrypted: String?) -> [String] {
        guard let decrypted, let data = decrypted.data(using: .utf8) else { return [] }
        return (try? JSONDecoder().decode([String].self, from: data)) ?? []
    }
}
