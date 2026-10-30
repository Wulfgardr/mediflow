import XCTest
import Crypto
import MediFlowCore

/// ADR 0071 Fase 0/1: the platform-free core (CryptoService in MediFlowCore) MUST
/// reproduce the language-neutral zero-knowledge crypto oracle byte-for-byte. The
/// fixture at native/contracts/crypto-golden-vectors.v1.json is generated from the
/// web WebCrypto reference (lib/security.ts); this test is the gate that proves the
/// Swift implementation agrees. The same fixture + this target gate the
/// Windows-MSVC and Linux Swift toolchains (swift-crypto) in CI.
final class CryptoGoldenVectorsTests: XCTestCase {

    func testAttachmentFileSharedVectorAndLockedState() throws {
        let nativeDir = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
        let vector = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: nativeDir.appendingPathComponent("contracts/attachment-file-golden.v2.json"))) as? [String: Any])
        let master = SymmetricKey(data: try XCTUnwrap(Data(base64Encoded: vector["masterKey"] as! String)))
        let envelope = try XCTUnwrap(vector["data"] as? String)
        let original = try XCTUnwrap(vector["original"] as? String)
        XCTAssertEqual(PatientFieldCrypto.decryptStringField(envelope, masterKey: master), "data:application/pdf;base64," + original)
        XCTAssertTrue(PatientFieldCrypto.isLocked(envelope, masterKey: nil))
        XCTAssertNil(PatientFieldCrypto.decryptStringField(envelope, masterKey: nil))
        XCTAssertTrue(PatientFieldCrypto.isLocked(envelope, masterKey: SymmetricKey(size: .bits256)))
        for index in 1...4 {
            var parts = envelope.components(separatedBy: ":")
            var bytes = try XCTUnwrap(Data(base64Encoded: parts[index])); bytes[0] ^= 1
            parts[index] = bytes.base64EncodedString()
            XCTAssertNil(CryptoService.decryptField(parts.joined(separator: ":"), masterKey: master))
        }
    }

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
