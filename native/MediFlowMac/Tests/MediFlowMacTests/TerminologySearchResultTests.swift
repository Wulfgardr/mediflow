// @Codex
import XCTest
@testable import MediFlowMac

/* @Codex */
final class TerminologySearchResultTests: XCTestCase {
    func testTerminologySearchItemDecodesAndExposesStableIdentity() throws {
        let data = """
        [
            {
                "system": "LOINC",
                "code": "8480-6",
                "display": "Systolic blood pressure",
                "version": "2.78",
                "source": "local-pilot-catalog"
            }
        ]
        """.data(using: .utf8)!

        let results = try JSONDecoder().decode([TerminologySearchItem].self, from: data)

        XCTAssertEqual(results.count, 1)
        XCTAssertEqual(results.first?.id, "LOINC:8480-6")
        XCTAssertEqual(results.first?.display, "Systolic blood pressure")
        XCTAssertEqual(results.first?.version, "2.78")
    }
}
