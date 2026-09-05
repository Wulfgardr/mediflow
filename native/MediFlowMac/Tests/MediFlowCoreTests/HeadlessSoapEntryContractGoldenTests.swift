/* @Codex */
import Foundation
import XCTest
@testable import MediFlowCore

final class HeadlessSoapEntryContractGoldenTests: XCTestCase {
    func testGoldenDraftAndReceiptRoundTripByteExactly() throws {
        let fixture = try loadFixture()
        XCTAssertEqual(fixture["version"] as? Int, 1)
        XCTAssertEqual(
            fixture["draftKeyOrder"] as? [String],
            HeadlessSoapEntryContractCodec.draftKeys
        )
        XCTAssertEqual(
            fixture["receiptKeyOrder"] as? [String],
            HeadlessSoapEntryContractCodec.receiptKeys
        )

        let draft = try HeadlessSoapEntryContractCodec.decodeDraft(data(for: "draft", in: fixture))
        let receipt = try HeadlessSoapEntryContractCodec.decodeReceipt(data(for: "receipt", in: fixture))
        let canonical = try XCTUnwrap(fixture["canonical"] as? [String: Any])
        let expectedDraftJSON = try XCTUnwrap(canonical["draftJSON"] as? String)
        let expectedReceiptJSON = try XCTUnwrap(canonical["receiptJSON"] as? String)

        XCTAssertEqual(draft.schema, HeadlessSoapEntryContractCodec.draftSchema)
        XCTAssertEqual(draft.operationId, HeadlessSoapEntryContractCodec.operationId)
        XCTAssertEqual(receipt.schema, HeadlessSoapEntryContractCodec.receiptSchema)
        XCTAssertEqual(receipt.operationId, HeadlessSoapEntryContractCodec.operationId)
        XCTAssertEqual(receipt.outcome, HeadlessSoapEntryContractCodec.receiptOutcome)
        XCTAssertEqual(receipt.patientVersion, 7)
        XCTAssertEqual(receipt.entryVersion, 1)
        XCTAssertEqual(receipt.committedAt, "2026-08-31T23:45:12.000Z")

        XCTAssertEqual(try HeadlessSoapEntryContractCodec.canonicalDraftJSON(draft), expectedDraftJSON)
        XCTAssertEqual(try HeadlessSoapEntryContractCodec.canonicalReceiptJSON(receipt), expectedReceiptJSON)
        XCTAssertEqual(
            try HeadlessSoapEntryContractCodec.decodeDraft(Data(expectedDraftJSON.utf8)),
            draft
        )
        XCTAssertEqual(
            try HeadlessSoapEntryContractCodec.decodeReceipt(Data(expectedReceiptJSON.utf8)),
            receipt
        )

        let expectedDraftDigest = try XCTUnwrap(fixture["draftDigest"] as? [String: Any])
        let expectedDraftSHA = try XCTUnwrap(expectedDraftDigest["sha256"] as? [String: Any])
        let draftDigest = try HeadlessSoapEntryContractCodec.draftDigest(draft)
        XCTAssertEqual(draftDigest.codec, expectedDraftDigest["codec"] as? String)
        XCTAssertEqual(draftDigest.hex, expectedDraftSHA["hex"] as? String)
        XCTAssertEqual(draftDigest.bytes, expectedDraftSHA["bytes"] as? [UInt8])

        let receiptDigest = try HeadlessSoapEntryContractCodec.receiptDigest(receipt)
        XCTAssertEqual(receiptDigest.codec, canonical["receiptDigestCodec"] as? String)
        XCTAssertEqual(receiptDigest.hex, canonical["receiptDigestHex"] as? String)
    }

    func testDraftDecoderRejectsNonClosedShapeWrongLiteralAndWrongType() throws {
        let fixture = try loadFixture()
        let source = try object(for: "draft", in: fixture)

        XCTAssertThrowsError(try decodeDraft(mutating: source) { $0["extra"] = "not-authority" })
        XCTAssertThrowsError(try decodeDraft(mutating: source) { $0.removeValue(forKey: "plan") })
        XCTAssertThrowsError(try decodeDraft(mutating: source) {
            $0["operationId"] = "MEDIFLOW.CLINICAL_DIARY.APPEND_SOAP.V1"
        })
        XCTAssertThrowsError(try decodeDraft(mutating: source) { $0["subjective"] = 7 })
    }

    func testReceiptDecoderRejectsNonClosedShapePatternsVersionsAndTimestamp() throws {
        let fixture = try loadFixture()
        let source = try object(for: "receipt", in: fixture)
        let maximumSafeInteger: Int64 = 9_007_199_254_740_991

        let maximum = try decodeReceipt(mutating: source) {
            $0["patientVersion"] = maximumSafeInteger
        }
        XCTAssertEqual(maximum.patientVersion, maximumSafeInteger)

        XCTAssertThrowsError(try decodeReceipt(mutating: source) { $0["extra"] = "not-authority" })
        XCTAssertThrowsError(try decodeReceipt(mutating: source) { $0.removeValue(forKey: "auditDigest") })
        XCTAssertThrowsError(try decodeReceipt(mutating: source) {
            $0["bindingDigest"] = String(repeating: "E", count: 64)
        })
        XCTAssertThrowsError(try decodeReceipt(mutating: source) { $0["patientVersion"] = 0 })
        XCTAssertThrowsError(try decodeReceipt(mutating: source) {
            $0["patientVersion"] = maximumSafeInteger + 1
        })
        XCTAssertThrowsError(try decodeReceipt(mutating: source) { $0["entryVersion"] = 2 })
        XCTAssertThrowsError(try decodeReceipt(mutating: source) {
            $0["committedAt"] = "2026-02-29T23:45:12.000Z"
        })
        XCTAssertThrowsError(try decodeReceipt(mutating: source) {
            $0["committedAt"] = "2026-08-31T23:45:12.001Z"
        })
        XCTAssertThrowsError(try decodeReceipt(mutating: source) { $0["patientVersion"] = "7" })
    }

    private func decodeDraft(
        mutating source: [String: Any],
        _ mutate: (inout [String: Any]) -> Void
    ) throws -> HeadlessSoapEntryContractCodec.Draft {
        var candidate = source
        mutate(&candidate)
        return try HeadlessSoapEntryContractCodec.decodeDraft(JSONSerialization.data(withJSONObject: candidate))
    }

    private func decodeReceipt(
        mutating source: [String: Any],
        _ mutate: (inout [String: Any]) -> Void
    ) throws -> HeadlessSoapEntryContractCodec.Receipt {
        var candidate = source
        mutate(&candidate)
        return try HeadlessSoapEntryContractCodec.decodeReceipt(JSONSerialization.data(withJSONObject: candidate))
    }

    private func loadFixture() throws -> [String: Any] {
        let nativeDirectory = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
        let url = nativeDirectory.appendingPathComponent("contracts/headless-soap-entry-contract-golden.v1.json")
        return try XCTUnwrap(
            JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any]
        )
    }

    private func object(for key: String, in fixture: [String: Any]) throws -> [String: Any] {
        try XCTUnwrap(fixture[key] as? [String: Any])
    }

    private func data(for key: String, in fixture: [String: Any]) throws -> Data {
        try JSONSerialization.data(withJSONObject: object(for: key, in: fixture))
    }
}
