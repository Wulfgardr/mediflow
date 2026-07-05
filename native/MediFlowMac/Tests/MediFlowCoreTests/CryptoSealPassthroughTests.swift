import XCTest
import Crypto
@testable import MediFlowCore

/// ADR 0071 Fase 3 (Codex-directed): strict seal-or-passthrough. A write field is
/// sealed UNLESS it is already authenticated ciphertext under THIS key (then verbatim),
/// so one core write path accepts both the model's pre-sealed payloads and plaintext,
/// without double-encrypting and without ever passing through a forged/foreign "ENC:".
final class CryptoSealPassthroughTests: XCTestCase {
    private let key = SymmetricKey(
        data: Data(hexString: "404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f"))

    func testSealsPlaintext() {
        guard case .sealed(let enc?) = CryptoService.sealOrPassthrough("Via Roma 1", masterKey: key) else {
            return XCTFail("expected sealed")
        }
        XCTAssertTrue(enc.hasPrefix("ENC:"))
        XCTAssertEqual(PatientFieldCrypto.decryptStringField(enc, masterKey: key), "Via Roma 1")
    }

    func testPassesAuthenticatedCiphertextVerbatim() {
        guard case .sealed(let presealed?) = CryptoService.seal("secret", masterKey: key),
              case .sealed(let out?) = CryptoService.sealOrPassthrough(presealed, masterKey: key) else {
            return XCTFail("expected sealed")
        }
        XCTAssertEqual(out, presealed)  // verbatim, NOT re-encrypted -> no double-encryption
    }

    func testSealsForgedEncPrefix() {
        // Looks like ENC: but is not authenticated -> sealed as plaintext (fail-closed).
        guard case .sealed(let enc?) = CryptoService.sealOrPassthrough("ENC:not-real:data", masterKey: key) else {
            return XCTFail("expected sealed")
        }
        XCTAssertFalse(CryptoService.isEncryptedUnder("ENC:not-real:data", masterKey: key))
        XCTAssertEqual(PatientFieldCrypto.decryptStringField(enc, masterKey: key), "ENC:not-real:data")
    }

    func testReSealsCiphertextFromAnotherKey() {
        guard case .sealed(let presealed?) = CryptoService.seal("secret", masterKey: key) else {
            return XCTFail("expected sealed")
        }
        let wrong = SymmetricKey(size: .bits256)
        // Not authenticated under `wrong` -> re-sealed (never blindly passed through).
        XCTAssertFalse(CryptoService.isEncryptedUnder(presealed, masterKey: wrong))
        guard case .sealed(let out?) = CryptoService.sealOrPassthrough(presealed, masterKey: wrong) else {
            return XCTFail("expected sealed")
        }
        XCTAssertNotEqual(out, presealed)
    }

    func testStructuredEncryptOrPassthrough() {
        let arrayJSON = "[\"048\",\"C01\"]"
        guard case .sealed(let enc?) = CryptoService.encryptOrPassthrough(arrayJSON, masterKey: key) else {
            return XCTFail("expected sealed")
        }
        // Structured: the plaintext is the array JSON itself (no JSON-unwrap on decrypt).
        XCTAssertEqual(CryptoService.decryptField(enc, masterKey: key), arrayJSON)
        guard case .sealed(let out?) = CryptoService.encryptOrPassthrough(enc, masterKey: key) else {
            return XCTFail("expected sealed")
        }
        XCTAssertEqual(out, enc)  // authenticated ciphertext passes through
    }

    func testNilStaysNil() {
        XCTAssertEqual(CryptoService.sealOrPassthrough(nil, masterKey: key), .sealed(nil))
        XCTAssertEqual(CryptoService.encryptOrPassthrough(nil, masterKey: key), .sealed(nil))
    }
}

private extension Data {
    init(hexString: String) {
        var data = Data(capacity: hexString.count / 2)
        var index = hexString.startIndex
        while index < hexString.endIndex {
            let next = hexString.index(index, offsetBy: 2)
            data.append(UInt8(hexString[index..<next], radix: 16)!)
            index = next
        }
        self = data
    }
}
