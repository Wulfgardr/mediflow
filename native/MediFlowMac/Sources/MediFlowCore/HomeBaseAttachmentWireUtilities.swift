// Wire-format helpers for the paired document domain (ADR 0076 Classe A, D2/D12).
// The decrypted `data` field is always a browser-style data URL
// ("data:<mime>;base64,<payload>", FileReader.readAsDataURL in
// components/document-upload.tsx:179-193): this decodes it in memory for
// preview (D12: never a temp file for preview) and estimates the wire size a
// new upload will reach BEFORE sealing, so the client can warn honestly instead
// of failing a real request against the host's wire limit.
import Foundation

public enum HomeBaseAttachmentDataURL {
    public struct Decoded: Equatable, Sendable {
        public let mimeType: String
        public let bytes: Data
    }

    /// Decodes a "data:<mime>;base64,<payload>" string in memory. Returns nil for
    /// anything else (missing prefix, non-base64 encoding, invalid payload) so
    /// callers fall back to the "metadata + share" non-previewable path.
    public static func decode(_ dataURL: String) -> Decoded? {
        guard dataURL.hasPrefix("data:"), let commaIndex = dataURL.firstIndex(of: ",") else { return nil }
        let header = dataURL[dataURL.index(dataURL.startIndex, offsetBy: 5)..<commaIndex]
        guard header.hasSuffix(";base64") else { return nil }
        let mimeType = String(header.dropLast(";base64".count)).trimmedOrNil ?? "application/octet-stream"
        let payload = String(dataURL[dataURL.index(after: commaIndex)...])
        guard let bytes = Data(base64Encoded: payload) else { return nil }
        return Decoded(mimeType: mimeType, bytes: bytes)
    }

    /// Builds the same data URL shape the web writes, from raw file bytes.
    public static func encode(mimeType: String, bytes: Data) -> String {
        "data:\(mimeType);base64,\(bytes.base64EncodedString())"
    }
}

/// Client-side pre-check for the attachment wire size limit (ADR 0076 Classe A,
/// D2/D12). The host enforces MEDIFLOW_ATTACHMENT_MAX_BYTES (default 25 MB,
/// lib/attachment-payload.ts resolveMaxAttachmentBytes) on the WIRE size of the
/// sealed `data` field (Content-Length and the ENC ciphertext byte length), not
/// on the raw file bytes. The wire pipeline expands the raw bytes TWICE with
/// base64 (raw -> base64 data URL -> AEAD ciphertext -> base64 inside the ENC
/// envelope), so the effective expansion is about 16/9 (~1.78x) plus small
/// constants; the estimate mirrors that pipeline with conservative allowances
/// so a file passing the pre-check is never rejected by the host limit. The
/// effective raw-file ceiling is about 14 MB at the 25 MB default.
public enum HomeBaseAttachmentWirePrecheck {
    /// Host default when MEDIFLOW_ATTACHMENT_MAX_BYTES is unset.
    public static let defaultWireLimitBytes = 25 * 1024 * 1024

    /// Allowance for "data:<mime>;base64," (mime types are short strings).
    private static let dataURLHeaderAllowanceBytes = 64
    /// Allowance for AEAD overhead inside the sealed segment (GCM tag + slack).
    private static let aeadOverheadAllowanceBytes = 32
    /// Allowance for the "ENC:<b64 nonce>:" envelope around the ciphertext.
    private static let envelopeAllowanceBytes = 64

    private static func base64Length(ofByteCount count: Int) -> Int {
        ((count + 2) / 3) * 4
    }

    public static func estimatedWireBytes(rawByteCount: Int) -> Int {
        let dataURLBytes = base64Length(ofByteCount: rawByteCount) + dataURLHeaderAllowanceBytes
        let sealedBytes = dataURLBytes + aeadOverheadAllowanceBytes
        return base64Length(ofByteCount: sealedBytes) + envelopeAllowanceBytes
    }

    public static func maxRecommendedRawBytes(wireLimitBytes: Int = defaultWireLimitBytes) -> Int {
        let maxCiphertextBase64 = max(0, wireLimitBytes - envelopeAllowanceBytes)
        let maxSealedBytes = (maxCiphertextBase64 / 4) * 3
        let maxDataURLBytes = max(0, maxSealedBytes - aeadOverheadAllowanceBytes)
        let maxRawBase64 = max(0, maxDataURLBytes - dataURLHeaderAllowanceBytes)
        return (maxRawBase64 / 4) * 3
    }

    public struct Result: Equatable, Sendable {
        public let estimatedWireBytes: Int
        public let maxRecommendedRawBytes: Int
        public let exceedsLimit: Bool
        public let message: String?
    }

    public static func check(rawByteCount: Int, wireLimitBytes: Int = defaultWireLimitBytes) -> Result {
        let estimate = estimatedWireBytes(rawByteCount: rawByteCount)
        let maxRaw = maxRecommendedRawBytes(wireLimitBytes: wireLimitBytes)
        guard estimate > wireLimitBytes else {
            return Result(estimatedWireBytes: estimate, maxRecommendedRawBytes: maxRaw, exceedsLimit: false, message: nil)
        }
        let maxRawMB = Int((Double(maxRaw) / (1024 * 1024)).rounded())
        let message = "Il file e troppo grande per il caricamento: la cifratura aumenta la dimensione reale trasmessa, il massimo effettivo e circa \(maxRawMB) MB. Scegli un file piu piccolo."
        return Result(estimatedWireBytes: estimate, maxRecommendedRawBytes: maxRaw, exceedsLimit: true, message: message)
    }
}

/// Writes decrypted bytes to a temporary file for sharing. Same posture as the
/// existing W1 report/export flow (PatientReportPDFRenderer.render,
/// PatientReportDocument.swift:329): a temporary file on disk is the established
/// pattern in this repo for handing data to the system share sheet, not a
/// regression. Lifecycle hardening of these temp files is tracked separately,
/// out of W5 scope (docs/analysis/2026-07-10-parita-w5-spec.md D12).
public enum HomeBaseAttachmentShareFile {
    public enum ShareFileError: Error, Equatable {
        case emptyFileName
    }

    public static func write(bytes: Data, suggestedName: String, to directory: URL = FileManager.default.temporaryDirectory) throws -> URL {
        let trimmedName = suggestedName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedName.isEmpty else { throw ShareFileError.emptyFileName }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let url = directory.appendingPathComponent(trimmedName)
        if FileManager.default.fileExists(atPath: url.path) {
            try FileManager.default.removeItem(at: url)
        }
        try bytes.write(to: url, options: [.atomic])
        return url
    }
}
