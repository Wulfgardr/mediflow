import Foundation
import XCTest
@testable import MediFlowMac

final class OncologyPathwayEngineTests: XCTestCase {
    func testAdvanceMovesPatientToNextStepAndSchedulesNextBooking() {
        let baseDate = Date(timeIntervalSince1970: 1_000)
        let patient = PatientCase.make(
            fullName: "Caso Demo",
            age: 64,
            mmgName: "MMG Demo",
            referringUnit: "Territorio",
            track: .hcc,
            suspectedCondition: "Lesione epatica",
            confirmedCondition: "HCC in workup",
            currentStepIndex: 0,
            boardRecommendation: "Attendere imaging.",
            lastReportSummary: "Nessun referto specialistico.",
            baseDate: baseDate
        )

        let updated = OncologyPathwayEngine.advance(
            patient: patient,
            actorRole: .oncologist,
            settings: PrototypeSettings()
        )

        XCTAssertEqual(updated.steps[0].status, .completed)
        XCTAssertEqual(updated.steps[1].status, .current)
        XCTAssertEqual(updated.currentLocation, updated.steps[1].owner)
        XCTAssertFalse(updated.bookings.isEmpty)
        XCTAssertEqual(updated.bookings.first?.status, .scheduled)
    }

    func testAdvanceBlocksWhenInvalidBookingExistsAndStrictValidationIsEnabled() {
        let patient = PatientCase.make(
            fullName: "Caso Critico",
            age: 58,
            mmgName: "MMG Demo",
            referringUnit: "Territorio",
            track: .sclc,
            suspectedCondition: "Sospetto SCLC",
            confirmedCondition: "SCLC in staging",
            currentStepIndex: 2,
            boardRecommendation: "Completare staging.",
            lastReportSummary: "Broncoscopia positiva.",
            baseDate: Date(timeIntervalSince1970: 2_000)
        )

        let withIssue = OncologyPathwayEngine.injectInvalidBooking(
            into: patient,
            settings: PrototypeSettings(strictPathwayValidation: true)
        )
        let blocked = OncologyPathwayEngine.advance(
            patient: withIssue,
            actorRole: .oncologist,
            settings: PrototypeSettings(strictPathwayValidation: true)
        )

        XCTAssertEqual(blocked.currentStep?.status, .blocked)
        XCTAssertTrue(blocked.unresolvedAlerts.contains(where: { $0.kind == .invalidBooking }))
    }

    func testResolveAlertRestoresCurrentStepAndSanitizesBookingStatus() throws {
        let patient = PatientCase.make(
            fullName: "Caso Agenda",
            age: 70,
            mmgName: "MMG Demo",
            referringUnit: "Territorio",
            track: .nsclc,
            suspectedCondition: "Nodulo toracico",
            confirmedCondition: "NSCLC in staging",
            currentStepIndex: 1,
            boardRecommendation: "Completare istologia.",
            lastReportSummary: "Materiale in analisi.",
            baseDate: Date(timeIntervalSince1970: 3_000)
        )

        let withIssue = OncologyPathwayEngine.injectInvalidBooking(
            into: patient,
            settings: PrototypeSettings(strictPathwayValidation: true)
        )
        let alertID = try XCTUnwrap(withIssue.unresolvedAlerts.first?.id)
        let resolved = OncologyPathwayEngine.resolveAlert(in: withIssue, alertID: alertID)

        XCTAssertEqual(resolved.currentStep?.status, .current)
        XCTAssertTrue(resolved.bookings.allSatisfy { $0.status == .scheduled || $0.status == .completed })
        XCTAssertTrue(resolved.alerts.contains(where: { $0.id == alertID && $0.isResolved }))
    }

    func testAdminConsultationHidesClinicalNarrative() {
        let patient = PatientCase.make(
            fullName: "Caso Limitato",
            age: 62,
            mmgName: "MMG Demo",
            referringUnit: "Territorio",
            track: .hcc,
            suspectedCondition: "Lesione epatica",
            confirmedCondition: "HCC in board",
            currentStepIndex: 3,
            boardRecommendation: "Board in 48h.",
            lastReportSummary: "TC suggestiva per HCC.",
            baseDate: Date(timeIntervalSince1970: 4_000)
        )

        let brief = OncologyPathwayEngine.consultation(
            for: patient,
            role: .adminOperator,
            settings: PrototypeSettings(intelligenceMode: .rules)
        )

        XCTAssertTrue(brief.conditionSummary.contains("Vista amministrativa"))
        XCTAssertTrue(brief.nextSteps.contains(where: { $0.contains("agenda") || $0.contains("prestazione") }))
    }
}
