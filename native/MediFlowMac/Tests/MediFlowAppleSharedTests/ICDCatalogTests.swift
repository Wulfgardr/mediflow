import XCTest
@testable import MediFlowAppleShared

final class ICDCatalogTests: XCTestCase {
    func testEmptyQueryReturnsNothing() {
        XCTAssertTrue(ICDCatalog.search("").isEmpty)
        XCTAssertTrue(ICDCatalog.search("   ").isEmpty)
    }

    func testExactCodeRanksFirst() {
        let results = ICDCatalog.search("I10")
        XCTAssertEqual(results.first?.code, "I10")
    }

    func testCodePrefixMatches() {
        let results = ICDCatalog.search("E11")
        XCTAssertTrue(results.contains { $0.code == "E11.9" })
    }

    func testDescriptionSubstringMatchesCaseInsensitive() {
        let results = ICDCatalog.search("diabete")
        let codes = Set(results.map(\.code))
        XCTAssertTrue(codes.contains("E11.9"))
        XCTAssertTrue(codes.contains("E10.9"))
        // Uppercase query finds the same.
        XCTAssertEqual(Set(ICDCatalog.search("DIABETE").map(\.code)), codes)
    }

    func testResultsAreCappedByLimit() {
        XCTAssertLessThanOrEqual(ICDCatalog.search("a", limit: 3).count, 3)
    }

    func testCatalogEntriesAreWellFormed() {
        XCTAssertGreaterThan(ICDCatalog.codes.count, 20)
        for entry in ICDCatalog.codes {
            XCTAssertFalse(entry.code.isEmpty)
            XCTAssertFalse(entry.description.isEmpty)
            // 1:1 with the web Diagnosis system whitelist (ICD-9 | ICD-10 | ICD-11).
            XCTAssertTrue(["ICD-9", "ICD-10", "ICD-11"].contains(entry.system), "system \(entry.system)")
        }
    }

    func testNoDuplicateCodes() {
        let codes = ICDCatalog.codes.map(\.code)
        XCTAssertEqual(codes.count, Set(codes).count, "the catalog must not contain duplicate codes")
    }
}
