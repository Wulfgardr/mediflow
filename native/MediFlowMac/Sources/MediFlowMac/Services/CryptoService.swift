// Codex: created 2026-02-01
import Foundation
import CryptoKit
import CommonCrypto

enum CryptoService {
    static let encryptedPrefix = "ENC:"
    static let pbkdf2Iterations: UInt32 = 100_000
    static let keyLength = 32
    static let ivLength = 12

    struct CryptoError: LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }

    static func deriveKeyFromPin(pin: String, salt: Data) throws -> SymmetricKey {
        let passwordData = Data(pin.utf8)
        var derivedKey = Data(count: keyLength)

        let status = derivedKey.withUnsafeMutableBytes { derivedBytes in
            salt.withUnsafeBytes { saltBytes in
                passwordData.withUnsafeBytes { passwordBytes in
                    guard let passwordBase = passwordBytes.bindMemory(to: Int8.self).baseAddress,
                          let saltBase = saltBytes.bindMemory(to: UInt8.self).baseAddress,
                          let derivedBase = derivedBytes.bindMemory(to: UInt8.self).baseAddress else {
                        return Int(kCCParamError)
                    }

                    return Int(CCKeyDerivationPBKDF(
                        CCPBKDFAlgorithm(kCCPBKDF2),
                        passwordBase,
                        passwordData.count,
                        saltBase,
                        salt.count,
                        CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256),
                        pbkdf2Iterations,
                        derivedBase,
                        keyLength
                    ))
                }
            }
        }

        guard status == kCCSuccess else {
            throw CryptoError(message: "PBKDF2 fallita (status: \(status))")
        }

        return SymmetricKey(data: derivedKey)
    }

    static func unwrapMasterKey(encryptedMasterKeyB64: String, kek: SymmetricKey) throws -> SymmetricKey {
        guard let combined = Data(base64Encoded: encryptedMasterKeyB64) else {
            throw CryptoError(message: "Master key non valida")
        }

        let sealedBox = try AES.GCM.SealedBox(combined: combined)
        let rawKey = try AES.GCM.open(sealedBox, using: kek)
        return SymmetricKey(data: rawKey)
    }

    static func encryptString(_ value: String, with key: SymmetricKey) throws -> String {
        let jsonData = try JSONSerialization.data(withJSONObject: value, options: [])
        let iv = AES.GCM.Nonce()
        let sealedBox = try AES.GCM.seal(jsonData, using: key, nonce: iv)

        let ivData = Data(iv)
        let cipherData = sealedBox.ciphertext + sealedBox.tag
        let ivB64 = ivData.base64EncodedString()
        let cipherB64 = cipherData.base64EncodedString()
        return "ENC:\(ivB64):\(cipherB64)"
    }

    static func decryptIfNeeded(_ value: String, with key: SymmetricKey?) -> String? {
        guard value.hasPrefix(encryptedPrefix) else { return value }
        guard let key else { return nil }

        let parts = value.split(separator: ":", omittingEmptySubsequences: false)
        guard parts.count == 3 else { return nil }

        let ivB64 = String(parts[1])
        let cipherB64 = String(parts[2])
        guard let ivData = Data(base64Encoded: ivB64),
              let cipherData = Data(base64Encoded: cipherB64) else {
            return nil
        }

        let combined = ivData + cipherData
        do {
            let sealedBox = try AES.GCM.SealedBox(combined: combined)
            let decrypted = try AES.GCM.open(sealedBox, using: key)
            let jsonObject = try JSONSerialization.jsonObject(with: decrypted, options: [])
            if let string = jsonObject as? String {
                return string
            }
            return String(describing: jsonObject)
        } catch {
            return nil
        }
    }
}
