import XCTest
import CryptoKit
@testable import MediFlowAppleShared

/// ADR 0071 Fase 0: the Swift core (CryptoService) MUST reproduce the
/// language-neutral zero-knowledge crypto oracle byte-for-byte. The fixture at
/// native/contracts/crypto-golden-vectors.v1.json is generated from the web
/// WebCrypto reference (lib/security.ts); this test is the gate that proves the
/// Swift implementation agrees. The same fixture will gate the Windows-MSVC and
/// Linux Swift toolchains once MediFlowCore is extracted.
final class CryptoGoldenVectorsTests: XCTestCase {

    private struct Fixture: Decodable {
        let version: Int
        let inputs: Inputs
        let vectors: Vectors
    }
    private struct Inputs: Decodable {
        let pin: String
        let saltHex: String
        let rawMasterKeyHex: String
    }
    private struct Vectors: Decodable {
        let kekFromPinHex: String
        let wrappedMasterKeyB64: String
        let fields: [FieldVec]
    }
    private struct FieldVec: Decodable {
        let name: String
        let json: String
        let enc: String
    }

    private func loadFixture() throws -> Fixture {
        // native/MediFlowMac/Tests/MediFlowAppleSharedTests/<this file> -> up 4 = native/
        let nativeDir = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
        let url = nativeDir.appendingPathComponent("contracts/crypto-golden-vectors.v1.json")
        let data = try Data(contentsOf: url)
        return try JSONDecoder().decode(Fixture.self, from: data)
    }

    func testKEKFromPinMatchesOracle() throws {
        let f = try loadFixture()
        let kek = CryptoService.deriveKEK(pin: f.inputs.pin, salt: Data(hexString: f.inputs.saltHex))
        XCTAssertEqual(kek.hexString, f.vectors.kekFromPinHex,
                       "PBKDF2-HMAC-SHA256(pin,salt,100k) KEK must match the web oracle")
    }

    func testUnwrapMasterKeyMatchesOracle() throws {
        let f = try loadFixture()
        let kek = CryptoService.deriveKEK(pin: f.inputs.pin, salt: Data(hexString: f.inputs.saltHex))
        let masterKey = try XCTUnwrap(
            CryptoService.unwrapMasterKey(wrappedBase64: f.vectors.wrappedMasterKeyB64, kek: kek),
            "unwrapMasterKey should succeed on the oracle's wrapped key")
        XCTAssertEqual(masterKey.hexString, f.inputs.rawMasterKeyHex,
                       "unwrapped master key must equal the raw master key from the oracle")
    }

    func testFieldDecryptMatchesOracle() throws {
        let f = try loadFixture()
        let masterKey = SymmetricKey(data: Data(hexString: f.inputs.rawMasterKeyHex))
        for field in f.vectors.fields {
            // plaintext is JSON.stringify(value); decryptField returns that JSON string.
            XCTAssertEqual(CryptoService.decryptField(field.enc, masterKey: masterKey), field.json,
                           "decryptField must reproduce the oracle plaintext for \(field.name)")
        }
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

private extension SymmetricKey {
    var hexString: String {
        withUnsafeBytes { Data($0).map { String(format: "%02x", $0) }.joined() }
    }
}
