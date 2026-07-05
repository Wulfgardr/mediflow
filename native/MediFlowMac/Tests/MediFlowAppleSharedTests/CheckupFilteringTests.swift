import XCTest
@testable import MediFlowAppleShared

final class CheckupFilteringTests: XCTestCase {
    private func checkup(_ id: String, status: String) -> HomeBaseCheckupSummary {
        HomeBaseCheckupSummary(
            id: id, patientId: "p", date: Date(timeIntervalSince1970: 0), title: "C",
            notes: nil, status: status, source: nil, version: 1, createdAt: nil,
            updatedAt: nil, deletedAt: nil, deletionReason: nil
        )
    }

    private lazy var sample = [
        checkup("p", status: "pending"),
        checkup("c", status: "completed"),
        checkup("x", status: "cancelled"),
        checkup("u", status: "legacy-unknown")
    ]

    func testAllReturnsEverything() {
        XCTAssertEqual(CheckupFiltering.apply(sample, filter: .all).map(\.id), ["p", "c", "x", "u"])
    }

    func testPendingFilter() {
        XCTAssertEqual(CheckupFiltering.apply(sample, filter: .pending).map(\.id), ["p"])
    }

    func testCompletedFilter() {
        XCTAssertEqual(CheckupFiltering.apply(sample, filter: .completed).map(\.id), ["c"])
    }

    func testCancelledFilter() {
        XCTAssertEqual(CheckupFiltering.apply(sample, filter: .cancelled).map(\.id), ["x"])
    }

    func testUnknownStatusOnlyAppearsUnderAll() {
        XCTAssertFalse(CheckupFiltering.apply(sample, filter: .pending).map(\.id).contains("u"))
        XCTAssertTrue(CheckupFiltering.apply(sample, filter: .all).map(\.id).contains("u"))
    }
}
