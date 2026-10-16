import XCTest
import Crypto
import MediFlowCore

/// Stream F (KDF v2 upgrade): the platform-free core (CryptoService) MUST
/// reproduce the v2 wrapped-master-key oracle byte-for-byte. The fixture at
/// native/contracts/crypto-golden-vectors.v2.json is generated from the web
/// WebCrypto reference (lib/security.ts) at 600,000 PBKDF2 iterations and in the
/// versioned "v2:<base64>" form. This test is the gate that proves the Swift
/// implementation derives the same KEK and unwraps the same master key after the
/// upgrade, so paired clients stay in lockstep with the web.
final class CryptoGoldenVectorsV2Tests: XCTestCase {

    func testV3PolicyCountsNormalizedScalarsAndDoesNotTruncateUTF8At72Bytes() throws {
        XCTAssertNotNil(CryptoService.normalizedPassphrase(String(repeating: "😀", count: 15)))
        XCTAssertNil(CryptoService.normalizedPassphrase(String(repeating: "😀", count: 14)))
        let shared = String(repeating: "é", count: 50)
        let salt = Data(repeating: 5, count: 16)
        let first = try XCTUnwrap(CryptoService.deriveUnlockMaterial(passphrase: shared + "A", salt: salt))
        let second = try XCTUnwrap(CryptoService.deriveUnlockMaterial(passphrase: shared + "B", salt: salt))
        XCTAssertNotEqual(first.verifier, second.verifier)
    }

    func testV3WebCryptoVerifierAndUnwrapMatchWithNFKC() throws {
        struct V3: Decodable { let version: Int; let passphrase: String; let salt: String; let verifier: String; let rawMasterKeyHex: String; let wrappedMasterKey: String }
        let native = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
        let vector = try JSONDecoder().decode(V3.self, from: Data(contentsOf: native.appendingPathComponent("contracts/crypto-golden-vectors.v3.json")))
        let salt = try XCTUnwrap(Data(base64Encoded: vector.salt))
        let material = try XCTUnwrap(CryptoService.deriveUnlockMaterial(passphrase: vector.passphrase, salt: salt))
        XCTAssertEqual(material.verifier, vector.verifier)
        let key = try XCTUnwrap(CryptoService.unwrapMasterKeyVersioned(blob: vector.wrappedMasterKey, pin: vector.passphrase, salt: salt))
        XCTAssertEqual(key.hexString, vector.rawMasterKeyHex)
        XCTAssertNil(CryptoService.unwrapMasterKeyVersioned(blob: vector.wrappedMasterKey, pin: vector.passphrase + "wrong", salt: salt))
        XCTAssertNil(CryptoService.deriveUnlockMaterial(passphrase: vector.passphrase, salt: Data(repeating: 0, count: 15)))
        XCTAssertNil(CryptoService.deriveUnlockMaterial(passphrase: "short", salt: salt))
        XCTAssertNil(CryptoService.unwrapMasterKeyVersioned(blob: "v4:unknown", pin: vector.passphrase, salt: salt))
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
        let wrappedMasterKeyVersioned: String
    }

    private func loadFixture() throws -> Fixture {
        // native/MediFlowMac/Tests/MediFlowCoreTests/<this file> -> up 4 = native/
        let nativeDir = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
        let url = nativeDir.appendingPathComponent("contracts/crypto-golden-vectors.v2.json")
        let data = try Data(contentsOf: url)
        return try JSONDecoder().decode(Fixture.self, from: data)
    }

    func testFixtureIsVersion2() throws {
        let f = try loadFixture()
        XCTAssertEqual(f.version, 2)
        XCTAssertEqual(CryptoService.kdfVersion(of: f.vectors.wrappedMasterKeyVersioned), 2,
                       "the versioned blob must self-describe as v2")
    }

    func testKEKAt600kMatchesOracle() throws {
        let f = try loadFixture()
        let kek = CryptoService.deriveKEK(pin: f.inputs.pin, salt: Data(hexString: f.inputs.saltHex),
                                          iterations: CryptoService.kdfIterations[2]!)
        XCTAssertEqual(kek.hexString, f.vectors.kekFromPinHex,
                       "PBKDF2-HMAC-SHA256(pin,salt,600k) KEK must match the web oracle")
    }

    func testUnwrapVersionedV2MatchesOracle() throws {
        let f = try loadFixture()
        let masterKey = try XCTUnwrap(
            CryptoService.unwrapMasterKeyVersioned(
                blob: f.vectors.wrappedMasterKeyVersioned,
                pin: f.inputs.pin,
                salt: Data(hexString: f.inputs.saltHex)),
            "unwrapMasterKeyVersioned should succeed on the v2 oracle blob")
        XCTAssertEqual(masterKey.hexString, f.inputs.rawMasterKeyHex,
                       "unwrapped master key must equal the raw master key from the oracle")
    }

    func testWrapVersionedRoundTripsAtCurrentVersion() throws {
        let f = try loadFixture()
        let masterKey = SymmetricKey(data: Data(hexString: f.inputs.rawMasterKeyHex))
        let salt = Data(hexString: f.inputs.saltHex)
        let blob = try XCTUnwrap(
            CryptoService.wrapMasterKeyVersioned(masterKey, pin: f.inputs.pin, salt: salt),
            "wrapMasterKeyVersioned should produce a versioned blob")
        XCTAssertEqual(CryptoService.kdfVersion(of: blob), CryptoService.currentKdfVersion)
        let roundTripped = try XCTUnwrap(
            CryptoService.unwrapMasterKeyVersioned(blob: blob, pin: f.inputs.pin, salt: salt))
        XCTAssertEqual(roundTripped.hexString, f.inputs.rawMasterKeyHex)
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
