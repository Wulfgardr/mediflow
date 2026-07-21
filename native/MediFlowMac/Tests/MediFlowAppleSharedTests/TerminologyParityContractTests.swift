import Foundation
import XCTest
@testable import MediFlowAppleShared

/* @Codex */
final class TerminologyParityContractTests: XCTestCase {
    private struct Fixture: Decodable {
        let schemaVersion: Int
        let systems: [String]
        let registry: [HomeBaseTerminologyRegistryEntry]
        let items: [HomeBaseTerminologyItem]
        let webDrug: HomeBaseDrugSummary
    }

    private func loadFixture() throws -> Fixture {
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("contracts/terminology-parity.v1.json")
        return try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
    }

    func testSharedFixtureDecodesCanonicalTerminologyContract() throws {
        let fixture = try loadFixture()

        XCTAssertEqual(fixture.schemaVersion, 1)
        XCTAssertEqual(fixture.systems, ["ATC", "LOINC", "UCUM"])
        XCTAssertEqual(fixture.registry.map(\.system), fixture.systems)
        XCTAssertEqual(fixture.registry.map(\.version), [nil, "2.78", "2.1"])
        XCTAssertEqual(fixture.items.map(\.system), fixture.systems)
        XCTAssertEqual(fixture.items.map(\.version), [nil, "2.78", "2.1"])
        XCTAssertEqual(fixture.items.map(\.source), [
            "local-aifa-drug-catalog",
            "local-pilot-catalog",
            "local-pilot-catalog",
        ])
        XCTAssertEqual(fixture.webDrug.atc, fixture.items.first?.code)
    }
}
