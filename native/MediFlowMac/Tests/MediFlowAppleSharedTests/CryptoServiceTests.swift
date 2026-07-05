import XCTest
import CryptoKit
@testable import MediFlowAppleShared

/// Vectors produced by the web crypto (lib/security.ts via Web Crypto) with fixed
/// inputs, so these prove byte-compatibility, not just internal round-trips.
final class CryptoServiceTests: XCTestCase {
    // 32-byte master key = bytes 0..31; 12-byte iv = bytes 100..111.
    private let rawKeyB64 = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8="
    private let encString = "ENC:ZGVmZ2hpamtsbW5v:akm7ABybIvEEQi6duwEYkmKxcmvpBZ8Xhf/mV+9XRjK5m/MiBpaG3SU="
    private let plaintextJSON = "\"Referto: quadro stabile\""  // JSON.stringify("Referto: quadro stabile")
    // PBKDF2(pin "1234", salt bytes [0,2,4,..30], 100k, SHA-256) -> KEK raw.
    private let saltB64 = "AAIEBggKDA4QEhQWGBocHg=="
    private let kekRawB64 = "a3Q2jlTYrclIA58N0b0Xr5oLIL1srhTnfi6YkEVtPS0="

    private func key(_ b64: String) -> SymmetricKey {
        SymmetricKey(data: Data(base64Encoded: b64)!)
    }

    func testDecryptsWebProducedCiphertext() {
        let result = CryptoService.decryptField(encString, masterKey: key(rawKeyB64))
        XCTAssertEqual(result, plaintextJSON, "must decrypt web ENC: output byte-for-byte")
    }

    func testDecryptThenJsonDecodeYieldsTheStringValue() {
        let decrypted = CryptoService.decryptField(encString, masterKey: key(rawKeyB64))!
        XCTAssertEqual(CryptoService.jsonDecodeString(decrypted), "Referto: quadro stabile")
    }

    func testEncryptRoundTrips() {
        let masterKey = key(rawKeyB64)
        let enc = CryptoService.encryptField(plaintextJSON, masterKey: masterKey)!
        XCTAssertTrue(enc.hasPrefix("ENC:"))
        XCTAssertEqual(CryptoService.decryptField(enc, masterKey: masterKey), plaintextJSON)
    }

    func testPbkdf2MatchesWebKEK() {
        let salt = Data(base64Encoded: saltB64)!
        let kek = CryptoService.deriveKEK(pin: "1234", salt: salt)
        let kekRaw = kek.withUnsafeBytes { Data($0) }.base64EncodedString()
        XCTAssertEqual(kekRaw, kekRawB64, "PBKDF2 KEK must match the web derivation")
    }

    func testMasterKeyWrapRoundTrip() {
        let masterKey = SymmetricKey(size: .bits256)
        let kek = CryptoService.deriveKEK(pin: "9999", salt: Data(base64Encoded: saltB64)!)
        let wrapped = CryptoService.wrapMasterKey(masterKey, kek: kek)!
        let unwrapped = CryptoService.unwrapMasterKey(wrappedBase64: wrapped, kek: kek)!
        XCTAssertEqual(
            unwrapped.withUnsafeBytes { Data($0) },
            masterKey.withUnsafeBytes { Data($0) },
            "unwrap(wrap(k)) must return the same key"
        )
    }

    func testNonEncValuePassesThroughUnchanged() {
        XCTAssertEqual(CryptoService.decryptField("plain text", masterKey: key(rawKeyB64)), "plain text")
    }

    func testWrongKeyFailsClosed() {
        let wrong = SymmetricKey(size: .bits256)
        XCTAssertNil(CryptoService.decryptField(encString, masterKey: wrong),
                     "a wrong key must fail to nil, never return garbage")
    }

    func testJsonEncodeMatchesStringify() {
        XCTAssertEqual(CryptoService.jsonEncode("foo"), "\"foo\"")
        XCTAssertEqual(CryptoService.jsonDecodeString("\"foo\""), "foo")
    }

    func testSealNilPassesThrough() {
        XCTAssertEqual(CryptoService.seal(nil, masterKey: key(rawKeyB64)), .sealed(nil))
    }

    func testSealValueRoundTripsThroughDecrypt() {
        let masterKey = key(rawKeyB64)
        guard case .sealed(let sealedValue) = CryptoService.seal("Motivo clinico", masterKey: masterKey) else {
            return XCTFail("sealing a value must succeed")
        }
        let enc = try? XCTUnwrap(sealedValue)
        XCTAssertEqual(enc?.hasPrefix("ENC:"), true, "a sealed field must be ciphertext")
        // The read path (decryptStringField) recovers the original plaintext.
        XCTAssertEqual(PatientFieldCrypto.decryptStringField(enc, masterKey: masterKey), "Motivo clinico")
    }
}
