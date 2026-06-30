// Zero-knowledge field crypto for the paired Apple client, byte-compatible with
// the web (lib/security.ts). The home-base stores ENC:base64(iv):base64(ct‖tag)
// ciphertext; the server never holds the key. The operator PIN derives a KEK
// (PBKDF2-HMAC-SHA256, 100k) that unwraps the AES-256-GCM master key, which then
// decrypts/encrypts clinical fields. Verified against web-produced test vectors.
//
// Plaintext convention (matches encryptData/decryptData): the value is
// JSON.stringify-d before encryption. So a string field decrypts to a quoted
// JSON string ("foo") and an array field (diagnoses) decrypts to its array JSON.
import Foundation
// ADR 0071: the core uses swift-crypto's `Crypto` (one source path on every OS).
// On Apple platforms `Crypto` re-exports CryptoKit, so SymmetricKey/AES.GCM/HMAC
// are the same types the rest of the Apple code uses; on Linux/Windows the same
// API is BoringSSL-backed. The golden-vector gate proves byte-compatibility.
import Crypto

public enum CryptoService {
    public static let encPrefix = "ENC:"
    private static let pbkdf2Iterations = 100_000

    // MARK: AES-GCM field crypto

    /// Decrypt an "ENC:iv:data" field to its JSON string. Returns the input
    /// unchanged when it is not an ENC value (API-direct plaintext), and nil only
    /// when an ENC value fails to decrypt (wrong key / tampered).
    public static func decryptField(_ value: String, masterKey: SymmetricKey) -> String? {
        guard value.hasPrefix(encPrefix) else { return value }
        let parts = value.split(separator: ":", omittingEmptySubsequences: false)
        guard parts.count == 3,
              let iv = Data(base64Encoded: String(parts[1])),
              let combined = Data(base64Encoded: String(parts[2])),
              combined.count >= 16 else { return nil }
        // WebCrypto appends the 16-byte tag to the ciphertext; iv is separate.
        let ciphertext = combined.prefix(combined.count - 16)
        let tag = combined.suffix(16)
        do {
            let nonce = try AES.GCM.Nonce(data: iv)
            let box = try AES.GCM.SealedBox(nonce: nonce, ciphertext: ciphertext, tag: tag)
            let plaintext = try AES.GCM.open(box, using: masterKey)
            return String(data: plaintext, encoding: .utf8)
        } catch {
            return nil
        }
    }

    /// Encrypt a JSON string to "ENC:iv:data" with a fresh random 12-byte iv.
    public static func encryptField(_ jsonString: String, masterKey: SymmetricKey) -> String? {
        guard let data = jsonString.data(using: .utf8) else { return nil }
        do {
            let nonce = AES.GCM.Nonce()  // random 12 bytes
            let box = try AES.GCM.seal(data, using: masterKey, nonce: nonce)
            let ivB64 = Data(nonce).base64EncodedString()
            let combined = box.ciphertext + box.tag  // ct‖tag, matching WebCrypto
            return "\(encPrefix)\(ivB64):\(combined.base64EncodedString())"
        } catch {
            return nil
        }
    }

    // MARK: JSON value helpers (the JSON.stringify convention)

    /// JSON-encode a Swift string the way JSON.stringify(string) does ("foo").
    public static func jsonEncode(_ string: String) -> String? {
        guard let data = try? JSONEncoder().encode(string) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    /// JSON-decode a quoted JSON string back to its Swift string value.
    public static func jsonDecodeString(_ jsonString: String) -> String? {
        guard let data = jsonString.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(String.self, from: data)
    }

    // MARK: Write sealing

    /// Outcome of sealing one write field. `.failed` lets the caller abort the
    /// whole write rather than ever send plaintext into an encrypted column.
    public enum FieldSeal: Equatable {
        case sealed(String?)  // nil passthrough (field absent/clear), or the ENC string
        case failed
    }

    /// Seal an optional plaintext field for write: nil stays nil; a value is
    /// JSON.stringify-d (matching the web) then AES-GCM encrypted to ENC:.
    public static func seal(_ plaintext: String?, masterKey: SymmetricKey) -> FieldSeal {
        guard let plaintext else { return .sealed(nil) }
        guard let json = jsonEncode(plaintext), let enc = encryptField(json, masterKey: masterKey) else {
            return .failed
        }
        return .sealed(enc)
    }

    /// True only for AUTHENTICATED ciphertext under `masterKey`: the ENC: prefix AND a
    /// successful AES-GCM open (which validates the 3 parts, base64, nonce/tag, and the
    /// tag itself). A plaintext value - even one literally starting "ENC:" - is false
    /// (decryptField returns nil for a malformed/forged ENC, and returns the value
    /// unchanged for a non-ENC string, so the prefix guard excludes that case).
    public static func isEncryptedUnder(_ value: String, masterKey: SymmetricKey) -> Bool {
        value.hasPrefix(encPrefix) && decryptField(value, masterKey: masterKey) != nil
    }

    /// Seal a STRING field unless it is ALREADY authenticated ciphertext under this key,
    /// in which case store it verbatim (the caller pre-sealed it). Fail-closed: a value
    /// that merely looks like ENC: but is not decryptable is treated as plaintext and
    /// sealed, never passed through. Lets one core write path accept both pre-sealed
    /// payloads (today's PairedPatientsWorkspaceModel) and plaintext (reversed-flow).
    public static func sealOrPassthrough(_ plaintext: String?, masterKey: SymmetricKey) -> FieldSeal {
        guard let plaintext else { return .sealed(nil) }
        if isEncryptedUnder(plaintext, masterKey: masterKey) { return .sealed(plaintext) }
        return seal(plaintext, masterKey: masterKey)
    }

    /// Same fail-closed passthrough for a STRUCTURED field (array/object JSON): the
    /// plaintext is the JSON itself (NOT JSON.stringify-d again), so a fresh value is
    /// encryptField-ed directly; authenticated ciphertext passes through verbatim.
    public static func encryptOrPassthrough(_ value: String?, masterKey: SymmetricKey) -> FieldSeal {
        guard let value else { return .sealed(nil) }
        if isEncryptedUnder(value, masterKey: masterKey) { return .sealed(value) }
        guard let enc = encryptField(value, masterKey: masterKey) else { return .failed }
        return .sealed(enc)
    }

    // MARK: Key derivation + master-key wrap

    /// PBKDF2-HMAC-SHA256(pin, salt, 100k) -> 256-bit KEK, matching deriveKeyFromPin.
    public static func deriveKEK(pin: String, salt: Data) -> SymmetricKey {
        let derived = pbkdf2SHA256(password: Data(pin.utf8), salt: salt,
                                   iterations: pbkdf2Iterations, keyLength: 32)
        return SymmetricKey(data: derived)
    }

    /// Unwrap base64(iv‖AES-GCM(rawMasterKey)) with the KEK -> master key.
    public static func unwrapMasterKey(wrappedBase64: String, kek: SymmetricKey) -> SymmetricKey? {
        guard let combined = Data(base64Encoded: wrappedBase64), combined.count >= 12 + 16 else { return nil }
        let iv = combined.prefix(12)
        let rest = combined.suffix(from: combined.startIndex + 12)
        let ciphertext = rest.prefix(rest.count - 16)
        let tag = rest.suffix(16)
        do {
            let nonce = try AES.GCM.Nonce(data: iv)
            let box = try AES.GCM.SealedBox(nonce: nonce, ciphertext: ciphertext, tag: tag)
            let raw = try AES.GCM.open(box, using: kek)
            return SymmetricKey(data: raw)
        } catch {
            return nil
        }
    }

    /// Wrap a master key with the KEK as base64(iv‖ct‖tag), matching wrapMasterKey.
    public static func wrapMasterKey(_ masterKey: SymmetricKey, kek: SymmetricKey) -> String? {
        let raw = masterKey.withUnsafeBytes { Data($0) }
        do {
            let nonce = AES.GCM.Nonce()
            let box = try AES.GCM.seal(raw, using: kek, nonce: nonce)
            let combined = Data(nonce) + box.ciphertext + box.tag
            return combined.base64EncodedString()
        } catch {
            return nil
        }
    }

    // MARK: PBKDF2 (HMAC-SHA256), pure CryptoKit

    /// For a 32-byte output with SHA-256, PBKDF2 needs a single block T1 = XOR of
    /// `iterations` HMAC chains. Implemented with CryptoKit HMAC (no CommonCrypto).
    static func pbkdf2SHA256(password: Data, salt: Data, iterations: Int, keyLength: Int) -> Data {
        precondition(keyLength <= 32, "this PBKDF2 helper emits a single SHA-256 block")
        let key = SymmetricKey(data: password)
        var block = salt
        block.append(contentsOf: [0, 0, 0, 1])  // INT_32_BE(1)
        var u = Data(HMAC<SHA256>.authenticationCode(for: block, using: key))
        var result = u
        for _ in 1..<iterations {
            u = Data(HMAC<SHA256>.authenticationCode(for: u, using: key))
            for i in 0..<result.count { result[i] ^= u[i] }
        }
        return result.prefix(keyLength)
    }
}
