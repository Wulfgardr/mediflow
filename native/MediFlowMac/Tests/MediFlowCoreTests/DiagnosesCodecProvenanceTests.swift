/* @Codex */
import Foundation
import XCTest
@testable import MediFlowCore

final class DiagnosesCodecProvenanceTests: XCTestCase {
    // Synthetic identifiers: no real WHO artifact or installed dataset is represented.
    private let uri = "http://id.who.int/icd/release/11/2026-01/mms/1000000001"
    private let date = "2020-01-02T12:34:56.789Z"

    private func object(_ raw: String) throws -> NSArray {
        try XCTUnwrap(JSONSerialization.jsonObject(with: Data(raw.utf8)) as? NSArray)
    }

    func testWHOCodeTitleURIAndReferenceSurviveNativeEditCodecRoundTrip() throws {
        let raw = """
        [{"code":"AA00","description":"Synthetic WHO selection","system":"ICD-11","date":"\(date)",
          "canonicalUri":"\(uri)","reference":{"releaseId":"2026-01","language":"en",
          "bindingId":"who.icd11.v2.2026-01.mms.en.local.v1",
          "imageDigest":"sha256:\(String(repeating: "a", count: 64))",
          "datasetSnapshotId":"sha256:\(String(repeating: "b", count: 64))"}}]
        """
        let decoded = DiagnosesCodec.decode(raw)
        XCTAssertEqual(decoded.count, 1)
        XCTAssertEqual(decoded.first?.canonicalUri, uri)
        XCTAssertNotNil(decoded.first?.reference)
        let encoded = try XCTUnwrap(DiagnosesCodec.encode(decoded, defaultDate: "2099-01-01T00:00:00.000Z"))
        XCTAssertEqual(try object(encoded), try object(raw))
        XCTAssertEqual(DiagnosesCodec.decode(encoded), decoded)
    }

    func testAbsentOrExplicitNilProvenanceKeepsOldFourFieldShape() throws {
        let rows = [ClinicalDiagnosis(code: "SYN-1", description: "Synthetic manual diagnosis",
            system: "unknown-system", date: date, canonicalUri: nil, reference: nil)]
        let encoded = try XCTUnwrap(DiagnosesCodec.encode(rows, defaultDate: "unused"))
        let row = try XCTUnwrap(try object(encoded).firstObject as? NSDictionary)
        XCTAssertEqual(Set(row.allKeys.compactMap { $0 as? String }), Set(["code", "description", "system", "date"]))
        let decoded = try XCTUnwrap(DiagnosesCodec.decode(encoded).first)
        XCTAssertNil(decoded.canonicalUri)
        XCTAssertNil(decoded.reference)
        XCTAssertEqual(decoded.system, "unknown-system")
        XCTAssertEqual(decoded.date, date)
    }

    func testNullProvenanceAndOldFreeTextRemainSupported() throws {
        let raw = """
        [{"description":"Synthetic free text","canonicalUri":null,"reference":null}]
        """
        let decoded = try XCTUnwrap(DiagnosesCodec.decode(raw).first)
        XCTAssertEqual(decoded.description, "Synthetic free text")
        XCTAssertNil(decoded.canonicalUri)
        XCTAssertNil(decoded.reference)
        let encoded = try XCTUnwrap(DiagnosesCodec.encode([decoded], defaultDate: date))
        let row = try XCTUnwrap(try object(encoded).firstObject as? NSDictionary)
        XCTAssertNil(row["canonicalUri"])
        XCTAssertNil(row["reference"])
        XCTAssertEqual(row["date"] as? String, date)
    }

    func testUnknownReferenceJSONIsPreservedWithoutWHOInterpretation() throws {
        let raw = """
        [{"code":"SYN-2","description":"Synthetic external diagnosis","system":"unknown","date":"\(date)",
          "canonicalUri":"urn:synthetic:unknown","reference":{"source":"future-local",
          "flags":[true,null,3],"nested":{"release":"future"}}}]
        """
        let encoded = try XCTUnwrap(DiagnosesCodec.encode(DiagnosesCodec.decode(raw), defaultDate: "unused"))
        XCTAssertEqual(try object(encoded), try object(raw))
    }
}
