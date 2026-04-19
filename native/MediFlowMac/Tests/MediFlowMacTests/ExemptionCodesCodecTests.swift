// @Codex
import XCTest
@testable import MediFlowMac

/* @Codex */
final class ExemptionCodesCodecTests: XCTestCase {
    func testDecodePrefersJSONAndNormalizesCodes() {
        let decoded = ExemptionCodesCodec.decode(#"[" aa12 ","bb34","AA12"]"#)

        XCTAssertEqual(decoded, ["AA12", "BB34"])
    }

    func testDecodeFallsBackToCommaSeparatedCodes() {
        let decoded = ExemptionCodesCodec.decode("aa12, bb34")

        XCTAssertEqual(decoded, ["AA12", "BB34"])
    }

    func testEncodeReturnsJSONStringForSelectedCodes() {
        let encoded = ExemptionCodesCodec.encode(["aa12", "bb34"])

        XCTAssertEqual(encoded, #"["AA12","BB34"]"#)
    }

    func testEncodeReturnsNilForEmptySelection() {
        XCTAssertNil(ExemptionCodesCodec.encode([]))
    }
}
