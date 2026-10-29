// @Codex
#if os(macOS)
import XCTest
import SwiftUI
@testable import MediFlowAppleShared

@MainActor
final class MacWindowInspectorCommandTests: XCTestCase {
    func testClinicalSidebarExcludesDevelopmentDestinations() {
        XCTAssertEqual(MediFlowMacRootView.systemSections, [.settings])
        XCTAssertEqual(ClinicalWorkspaceSection.analytics.title, "Analisi")
    }

    func testLoadedAndVisibleCountsHaveExplicitScope() {
        let patients = [
            HomeBasePatientSummary(id: "active", firstName: "Anna", lastName: "Test", birthDate: nil, taxCode: "TEST-A", isAdi: false, isArchived: false, version: 1, updatedAt: nil),
            HomeBasePatientSummary(id: "archived", firstName: "Bruno", lastName: "Test", birthDate: nil, taxCode: "TEST-B", isAdi: false, isArchived: true, version: 1, updatedAt: nil),
            HomeBasePatientSummary(id: "deleted", firstName: "Carla", lastName: "Test", birthDate: nil, taxCode: "TEST-C", isAdi: false, isArchived: false, version: 1, updatedAt: nil, deletedAt: Date(timeIntervalSince1970: 1))
        ]
        for mode in PatientListViewMode.allCases {
            XCTAssertEqual(PatientsFiltering.apply(patients: patients, query: "", viewMode: mode, sortMode: .recent).count, 1)
        }
        XCTAssertEqual(PatientsFiltering.apply(patients: patients, query: "assente", viewMode: .active, sortMode: .recent).count, 0)
        XCTAssertEqual(MacDetailChrome<EmptyView>.patientCountLabel(patients.count), "3 pazienti caricati in totale")
        XCTAssertEqual(MacDetailChrome<EmptyView>.patientCountLabel(1), "1 paziente caricato in totale")
    }

    func testWindowSceneModelsDoNotShareSelection() {
        let firstWindow = MediFlowMacSceneModel()
        let secondWindow = MediFlowMacSceneModel()

        firstWindow.select(.agenda)

        XCTAssertEqual(firstWindow.section, .agenda)
        XCTAssertEqual(secondWindow.section, .patients)
    }

    func testFocusedInspectorActionChangesOnlyItsWindow() {
        var firstWindowPresented = false
        var secondWindowPresented = false
        let firstWindow = ClinicalWorkspaceInspectorAction(
            isEnabled: true,
            isPresented: firstWindowPresented,
            toggle: { firstWindowPresented.toggle() }
        )
        let secondWindow = ClinicalWorkspaceInspectorAction(
            isEnabled: true,
            isPresented: secondWindowPresented,
            toggle: { secondWindowPresented.toggle() }
        )

        firstWindow.toggle()

        XCTAssertTrue(firstWindowPresented)
        XCTAssertFalse(secondWindowPresented)
        XCTAssertFalse(secondWindow.isPresented)
    }

}
#endif
