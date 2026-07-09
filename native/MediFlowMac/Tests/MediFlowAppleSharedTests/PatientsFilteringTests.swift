import XCTest
@testable import MediFlowAppleShared

final class PatientsFilteringTests: XCTestCase {
    private func patient(
        _ id: String,
        last: String,
        first: String,
        tax: String,
        archived: Bool = false,
        updated: TimeInterval = 0,
        deleted: Bool = false,
        deletionReason: String? = nil
    ) -> HomeBasePatientSummary {
        HomeBasePatientSummary(
            id: id, firstName: first, lastName: last, birthDate: nil, taxCode: tax,
            isAdi: false, isArchived: archived, version: 1,
            updatedAt: Date(timeIntervalSince1970: updated),
            deletedAt: deleted ? Date(timeIntervalSince1970: 600) : nil,
            deletionReason: deletionReason
        )
    }

    private lazy var sample: [HomeBasePatientSummary] = [
        patient("1", last: "Rossi", first: "Mario", tax: "RSSMRA80A01H501U", updated: 300),
        patient("2", last: "Bianchi", first: "Anna", tax: "BNCNNA85M41F205X", updated: 200),
        patient("3", last: "Verdi", first: "Luigi", tax: "VRDLGU70T10L219Z", archived: true, updated: 100),
        patient("4", last: "Neri", first: "Carla", tax: "NRECRL75P41F205Y", archived: true, updated: 400, deleted: true, deletionReason: "duplicato")
    ]

    func testActiveFilterExcludesArchived() {
        let result = PatientsFiltering.apply(patients: sample, query: "", viewMode: .active, sortMode: .alpha)
        XCTAssertEqual(result.map(\.id), ["2", "1"])
    }

    func testArchivedFilterShowsOnlyArchived() {
        let result = PatientsFiltering.apply(patients: sample, query: "", viewMode: .archived, sortMode: .alpha)
        XCTAssertEqual(result.map(\.id), ["3"])
    }

    func testTrashFilterShowsOnlyTombstonedPatients() {
        let result = PatientsFiltering.apply(patients: sample, query: "", viewMode: .trash, sortMode: .alpha)
        XCTAssertEqual(result.map(\.id), ["4"])
    }

    func testActiveFilterExcludesTombstonedEvenWhenNotArchived() {
        let deletedActive = patient("d", last: "A", first: "B", tax: "DDD", deleted: true)
        let active = patient("a", last: "C", first: "D", tax: "AAA")
        let result = PatientsFiltering.apply(patients: [deletedActive, active], query: "", viewMode: .active, sortMode: .alpha)
        XCTAssertEqual(result.map(\.id), ["a"])
    }

    func testSearchByNameIsCaseInsensitiveAndMultiTerm() {
        let result = PatientsFiltering.apply(patients: sample, query: "  ROSSI mario ", viewMode: .active, sortMode: .alpha)
        XCTAssertEqual(result.map(\.id), ["1"])
    }

    func testSearchByTaxCode() {
        let result = PatientsFiltering.apply(patients: sample, query: "bncnna", viewMode: .active, sortMode: .alpha)
        XCTAssertEqual(result.map(\.id), ["2"])
    }

    func testRecentSortIsByUpdatedAtDescending() {
        let result = PatientsFiltering.apply(patients: sample, query: "", viewMode: .active, sortMode: .recent)
        XCTAssertEqual(result.map(\.id), ["1", "2"])
    }

    func testAlphaSortIsByLastNameThenFirstName() {
        let result = PatientsFiltering.apply(patients: sample, query: "", viewMode: .active, sortMode: .alpha)
        XCTAssertEqual(result.map(\.id), ["2", "1"])
    }

    func testNoMatchReturnsEmpty() {
        let result = PatientsFiltering.apply(patients: sample, query: "zzz", viewMode: .active, sortMode: .alpha)
        XCTAssertTrue(result.isEmpty)
    }

    func testRecentSortIsDeterministicViaTaxCodeTieBreaker() {
        // Same updatedAt, lastName and firstName: order must fall back to taxCode,
        // independent of input order.
        let a = patient("a", last: "Rossi", first: "Mario", tax: "AAA", updated: 500)
        let b = patient("b", last: "Rossi", first: "Mario", tax: "BBB", updated: 500)
        XCTAssertEqual(
            PatientsFiltering.apply(patients: [b, a], query: "", viewMode: .active, sortMode: .recent).map(\.id),
            ["a", "b"]
        )
        XCTAssertEqual(
            PatientsFiltering.apply(patients: [a, b], query: "", viewMode: .active, sortMode: .recent).map(\.id),
            ["a", "b"]
        )
    }

    func testAlphaSortIsDeterministicViaTaxCodeTieBreaker() {
        // Same lastName and firstName: alpha order must fall back to taxCode,
        // independent of input order.
        let a = patient("a", last: "Rossi", first: "Mario", tax: "AAA")
        let b = patient("b", last: "Rossi", first: "Mario", tax: "BBB")
        XCTAssertEqual(
            PatientsFiltering.apply(patients: [b, a], query: "", viewMode: .active, sortMode: .alpha).map(\.id),
            ["a", "b"]
        )
        XCTAssertEqual(
            PatientsFiltering.apply(patients: [a, b], query: "", viewMode: .active, sortMode: .alpha).map(\.id),
            ["a", "b"]
        )
    }
}
