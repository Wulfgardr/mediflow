import XCTest
@testable import MediFlowAppleShared

final class EntryFilteringTests: XCTestCase {
    private func entry(_ id: String, type: String, deleted: Bool = false) -> HomeBaseEntrySummary {
        HomeBaseEntrySummary(
            id: id, patientId: "p", type: type, title: "T", date: Date(timeIntervalSince1970: 0),
            content: "c", setting: nil, metadata: nil, attachments: nil,
            deletedAt: deleted ? Date(timeIntervalSince1970: 10) : nil,
            deletionReason: deleted ? "duplicata" : nil,
            version: 1, createdAt: nil, updatedAt: nil
        )
    }

    private lazy var sample = [
        entry("n", type: "note"),
        entry("v", type: "visit"),
        entry("p", type: "phone"),
        entry("o", type: "other"),
        entry("u", type: "legacy-unknown"),
        entry("d", type: "note", deleted: true)
    ]

    func testAllExcludesDeletedByDefault() {
        XCTAssertEqual(EntryFiltering.apply(sample, filter: .all).map(\.id), ["n", "v", "p", "o", "u"])
    }

    func testAllCanIncludeDeleted() {
        XCTAssertEqual(EntryFiltering.apply(sample, filter: .all, includeDeleted: true).map(\.id), ["n", "v", "p", "o", "u", "d"])
    }

    func testNoteFilter() {
        XCTAssertEqual(EntryFiltering.apply(sample, filter: .note).map(\.id), ["n"])
    }

    func testNoteFilterCanIncludeDeleted() {
        XCTAssertEqual(EntryFiltering.apply(sample, filter: .note, includeDeleted: true).map(\.id), ["n", "d"])
    }

    func testVisitFilter() {
        XCTAssertEqual(EntryFiltering.apply(sample, filter: .visit).map(\.id), ["v"])
    }

    func testPhoneFilter() {
        XCTAssertEqual(EntryFiltering.apply(sample, filter: .phone).map(\.id), ["p"])
    }

    func testOtherFilter() {
        XCTAssertEqual(EntryFiltering.apply(sample, filter: .other).map(\.id), ["o"])
    }

    func testUnknownTypeOnlyAppearsUnderAll() {
        XCTAssertFalse(EntryFiltering.apply(sample, filter: .note).map(\.id).contains("u"))
        XCTAssertTrue(EntryFiltering.apply(sample, filter: .all).map(\.id).contains("u"))
    }
}
