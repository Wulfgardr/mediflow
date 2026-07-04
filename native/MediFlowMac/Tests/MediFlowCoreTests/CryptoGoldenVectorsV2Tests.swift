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
