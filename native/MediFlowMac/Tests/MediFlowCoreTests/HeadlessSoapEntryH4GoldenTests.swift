/* @Codex */
import XCTest
import Crypto
@testable import MediFlowCore

final class HeadlessSoapEntryH4GoldenTests: XCTestCase {
    private let masterKey = SymmetricKey(data: Data(hex: "404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f"))

    func testMaterializeSealAndReopenMatchTheFrozenH4Oracle() throws {
        let fixture: Fixture = try loadFixture()
        let h1Digest = HeadlessSoapEntryH4Codec.Digest(
            codec: fixture.h1Digest.codec,
            sha256: .init(bytes: fixture.h1Digest.sha256.bytes, hex: fixture.h1Digest.sha256.hex)
        )
        let fieldSet = try HeadlessSoapEntryH4Codec.materialize(
            subjective: fixture.inputs.subjective,
            objective: fixture.inputs.objective,
            assessment: fixture.inputs.assessment,
            plan: fixture.inputs.plan,
            h1Digest: h1Digest,
            epochMilliseconds: fixture.inputs.epochMilliseconds
        )

        XCTAssertEqual(fieldSet.schema, fixture.fieldSet.schema)
        XCTAssertEqual(fieldSet.type, fixture.fieldSet.type)
        XCTAssertEqual(fieldSet.title, fixture.fieldSet.title)
        XCTAssertEqual(fieldSet.date, fixture.fieldSet.date)
        XCTAssertEqual(fieldSet.content, fixture.fieldSet.content)
        XCTAssertEqual(fieldSet.setting, fixture.fieldSet.setting)
        XCTAssertEqual(fieldSet.metadata.canonicalJSON, fixture.canonical.metadataJSON)
        XCTAssertEqual(fieldSet.payloadDigest.sha256.hex, fixture.fieldSet.payloadDigest.sha256.hex)
        XCTAssertEqual(fieldSet.payloadDigest.sha256.bytes, fixture.fieldSet.payloadDigest.sha256.bytes)

        let sections = try HeadlessSoapEntryH4Codec.decodeContent(fieldSet.content)
        XCTAssertEqual(sections.subjective, fixture.inputs.subjective)
        XCTAssertEqual(sections.objective, fixture.inputs.objective)
        XCTAssertEqual(sections.assessment, fixture.inputs.assessment)
        XCTAssertEqual(sections.plan, fixture.inputs.plan)

        let bundle = try HeadlessSoapEntryH4Codec.seal(
            fieldSet,
            masterKey: masterKey,
            titleIV: Data(hex: fixture.inputs.titleIVHex),
            contentIV: Data(hex: fixture.inputs.contentIVHex),
            metadataIV: Data(hex: fixture.inputs.metadataIVHex)
        )
        XCTAssertEqual(bundle.schema, fixture.seal.schema)
        XCTAssertEqual(bundle.title, fixture.seal.title)
        XCTAssertEqual(bundle.content, fixture.seal.content)
        XCTAssertEqual(bundle.metadata, fixture.seal.metadata)
        XCTAssertEqual(bundle.sealDigest.sha256.hex, fixture.seal.sealDigest.sha256.hex)
        XCTAssertEqual(bundle.sealDigest.sha256.bytes, fixture.seal.sealDigest.sha256.bytes)
        XCTAssertEqual(try HeadlessSoapEntryH4Codec.reopen(bundle, masterKey: masterKey, expected: fieldSet), fieldSet)
    }

    func testCodecRejectsNonCanonicalContentAndTamperedSeal() throws {
        let fixture: Fixture = try loadFixture()
        XCTAssertThrowsError(try HeadlessSoapEntryH4Codec.decodeContent(fixture.fieldSet.content.replacingOccurrences(of: "<br>", with: "<br/>")))
        let fieldSet = try makeFieldSet(from: fixture)
        let bundle = try HeadlessSoapEntryH4Codec.seal(
            fieldSet,
            masterKey: masterKey,
            titleIV: Data(hex: fixture.inputs.titleIVHex),
            contentIV: Data(hex: fixture.inputs.contentIVHex),
            metadataIV: Data(hex: fixture.inputs.metadataIVHex)
        )
        let tampered = bundle.replacing(content: bundle.content + "A")
        XCTAssertThrowsError(try HeadlessSoapEntryH4Codec.reopen(tampered, masterKey: masterKey, expected: fieldSet))
        XCTAssertThrowsError(try HeadlessSoapEntryH4Codec.reopen(
            bundle,
            masterKey: SymmetricKey(data: Data(repeating: 0, count: 32)),
            expected: fieldSet
        ))
        XCTAssertThrowsError(try HeadlessSoapEntryH4Codec.seal(
            fieldSet,
            masterKey: SymmetricKey(data: Data(repeating: 0, count: 16))
        ))
        XCTAssertThrowsError(try HeadlessSoapEntryH4Codec.seal(
            fieldSet,
            masterKey: masterKey,
            titleIV: Data(hex: fixture.inputs.titleIVHex),
            contentIV: Data(hex: fixture.inputs.titleIVHex),
            metadataIV: Data(hex: fixture.inputs.metadataIVHex)
        ))
        XCTAssertThrowsError(try HeadlessSoapEntryH4Codec.materialize(
            subjective: fixture.inputs.subjective,
            objective: fixture.inputs.objective,
            assessment: fixture.inputs.assessment,
            plan: fixture.inputs.plan,
            h1Digest: fieldSet.metadata,
            epochMilliseconds: -1
        ))
    }

    func testRandomOracleSealUsesThreeDistinctIVsAndReopens() throws {
        let fixture: Fixture = try loadFixture()
        let fieldSet = try makeFieldSet(from: fixture)
        let bundle = try HeadlessSoapEntryH4Codec.seal(fieldSet, masterKey: masterKey)
        let ivs = try [bundle.title, bundle.content, bundle.metadata].map { value -> Data in
            let parts = value.split(separator: ":", omittingEmptySubsequences: false)
            return try XCTUnwrap(parts.count == 3 ? Data(base64Encoded: String(parts[1])) : nil)
        }
        XCTAssertEqual(Set(ivs).count, 3)
        XCTAssertTrue(ivs.allSatisfy { $0.count == 12 })
        XCTAssertEqual(try HeadlessSoapEntryH4Codec.reopen(bundle, masterKey: masterKey, expected: fieldSet), fieldSet)
    }

    private struct Fixture: Decodable {
        let inputs: Inputs
        let h1Digest: DigestFixture
        let fieldSet: FieldSetFixture
        let canonical: CanonicalFixture
        let seal: SealFixture
    }

    private struct Inputs: Decodable {
        let epochMilliseconds: Int64
        let rawMasterKeyHex: String
        let titleIVHex: String
        let contentIVHex: String
        let metadataIVHex: String
        let subjective: String
        let objective: String
        let assessment: String
        let plan: String
    }

    private struct DigestFixture: Decodable {
        let codec: String
        let sha256: HashFixture
    }

    private struct HashFixture: Decodable {
        let bytes: [UInt8]
        let hex: String
    }

    private struct FieldSetFixture: Decodable {
        let schema: String
        let type: String
        let title: String
        let date: String
        let content: String
        let setting: String
        let payloadDigest: DigestFixture
    }

    private struct CanonicalFixture: Decodable {
        let metadataJSON: String
    }

    private struct SealFixture: Decodable {
        let schema: String
        let title: String
        let content: String
        let metadata: String
        let sealDigest: DigestFixture
    }

    private func loadFixture() throws -> Fixture {
        let nativeDirectory = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
        let url = nativeDirectory.appendingPathComponent("contracts/headless-soap-entry-h4-golden.v1.json")
        return try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
    }

    private func makeFieldSet(from fixture: Fixture) throws -> HeadlessSoapEntryH4Codec.FieldSet {
        try HeadlessSoapEntryH4Codec.materialize(
            subjective: fixture.inputs.subjective,
            objective: fixture.inputs.objective,
            assessment: fixture.inputs.assessment,
            plan: fixture.inputs.plan,
            h1Digest: .init(
                codec: fixture.h1Digest.codec,
                sha256: .init(bytes: fixture.h1Digest.sha256.bytes, hex: fixture.h1Digest.sha256.hex)
            ),
            epochMilliseconds: fixture.inputs.epochMilliseconds
        )
    }
}

private extension Data {
    init(hex: String) {
        precondition(hex.count.isMultiple(of: 2))
        self.init(capacity: hex.count / 2)
        var index = hex.startIndex
        while index < hex.endIndex {
            let next = hex.index(index, offsetBy: 2)
            append(UInt8(hex[index..<next], radix: 16)!)
            index = next
        }
    }
}
