// @Codex
import XCTest
@testable import MediFlowMac

/* @Codex */
final class PatientsFilteringTests: XCTestCase {
    func testActiveModeExcludesArchivedPatients() {
        let patients = [
            makePatient(id: "p1", firstName: "Mario", lastName: "Rossi", taxCode: "RSSMRA", archived: false),
            makePatient(id: "p2", firstName: "Lucia", lastName: "Bianchi", taxCode: "BNCLCU", archived: true)
        ]

        let result = PatientsFiltering.apply(
            patients: patients,
            query: "",
            viewMode: .active,
            sortMode: .alpha
        )

        XCTAssertEqual(result.map(\.id), ["p1"])
    }

    func testArchivedModeKeepsOnlyArchivedPatients() {
        let patients = [
            makePatient(id: "p1", firstName: "Mario", lastName: "Rossi", taxCode: "RSSMRA", archived: false),
            makePatient(id: "p2", firstName: "Lucia", lastName: "Bianchi", taxCode: "BNCLCU", archived: true)
        ]

        let result = PatientsFiltering.apply(
            patients: patients,
            query: "",
            viewMode: .archived,
            sortMode: .alpha
        )

        XCTAssertEqual(result.map(\.id), ["p2"])
    }

    func testQueryMatchesAcrossNameSurnameAndTaxCode() {
        let patients = [
            makePatient(id: "p1", firstName: "Giovanni", lastName: "Verdi", taxCode: "VRDGNN80A01F205X", archived: false),
            makePatient(id: "p2", firstName: "Marta", lastName: "Rosa", taxCode: "RSOMRT91B12H501K", archived: false)
        ]

        let result = PatientsFiltering.apply(
            patients: patients,
            query: "verdi f205x",
            viewMode: .active,
            sortMode: .alpha
        )

        XCTAssertEqual(result.map(\.id), ["p1"])
    }

    func testAlphaSortUsesSurnameNameAndTaxCode() {
        let patients = [
            makePatient(id: "p1", firstName: "Luca", lastName: "Bianchi", taxCode: "ZZZ", archived: false),
            makePatient(id: "p2", firstName: "Anna", lastName: "Bianchi", taxCode: "AAA", archived: false),
            makePatient(id: "p3", firstName: "Bruno", lastName: "Rossi", taxCode: "CCC", archived: false)
        ]

        let result = PatientsFiltering.apply(
            patients: patients,
            query: "",
            viewMode: .active,
            sortMode: .alpha
        )

        XCTAssertEqual(result.map(\.id), ["p2", "p1", "p3"])
    }

    func testRecentSortPlacesMostRecentlyUpdatedFirst() {
        let now = Date()
        let patients = [
            makePatient(id: "p1", firstName: "Luca", lastName: "Bianchi", taxCode: "AAA", archived: false, updatedAt: now.addingTimeInterval(-120)),
            makePatient(id: "p2", firstName: "Anna", lastName: "Verdi", taxCode: "BBB", archived: false, updatedAt: now),
            makePatient(id: "p3", firstName: "Marco", lastName: "Rossi", taxCode: "CCC", archived: false, updatedAt: nil)
        ]

        let result = PatientsFiltering.apply(
            patients: patients,
            query: "",
            viewMode: .active,
            sortMode: .recent
        )

        XCTAssertEqual(result.map(\.id), ["p2", "p1", "p3"])
    }

    private func makePatient(
        id: String,
        firstName: String,
        lastName: String,
        taxCode: String,
        archived: Bool,
        updatedAt: Date? = nil
    ) -> PatientSummary {
        PatientSummary(
            id: id,
            firstName: firstName,
            lastName: lastName,
            birthDate: nil,
            taxCode: taxCode,
            isAdi: false,
            isArchived: archived,
            version: 1,
            updatedAt: updatedAt
        )
    }
}
