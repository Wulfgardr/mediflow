import XCTest
@testable import MediFlowAppleShared

final class TherapyFilteringTests: XCTestCase {
    private func therapy(_ id: String, status: String) -> HomeBaseTherapySummary {
        HomeBaseTherapySummary(
            id: id, patientId: "p", drugName: "Drug", aic: nil, atc: nil,
            activePrinciple: nil, dosage: "1", motivation: nil, diagnosisCode: nil,
            diagnosisName: nil, status: status, startDate: Date(timeIntervalSince1970: 0),
            endDate: nil, version: 1, createdAt: nil, updatedAt: nil,
            deletedAt: nil, deletionReason: nil
        )
    }

    private lazy var sample = [
        therapy("a", status: "active"),
        therapy("s", status: "suspended"),
        therapy("c", status: "completed"),
        therapy("x", status: "legacy-unknown")
    ]

    func testAllReturnsEverythingInOrder() {
        XCTAssertEqual(TherapyFiltering.apply(sample, filter: .all).map(\.id), ["a", "s", "c", "x"])
    }

    func testActiveFilter() {
        XCTAssertEqual(TherapyFiltering.apply(sample, filter: .active).map(\.id), ["a"])
    }

    func testSuspendedFilter() {
        XCTAssertEqual(TherapyFiltering.apply(sample, filter: .suspended).map(\.id), ["s"])
    }

    func testCompletedFilter() {
        XCTAssertEqual(TherapyFiltering.apply(sample, filter: .completed).map(\.id), ["c"])
    }

    func testUnknownStatusOnlyAppearsUnderAll() {
        XCTAssertFalse(TherapyFiltering.apply(sample, filter: .active).map(\.id).contains("x"))
        XCTAssertFalse(TherapyFiltering.apply(sample, filter: .suspended).map(\.id).contains("x"))
        XCTAssertTrue(TherapyFiltering.apply(sample, filter: .all).map(\.id).contains("x"))
    }
}
