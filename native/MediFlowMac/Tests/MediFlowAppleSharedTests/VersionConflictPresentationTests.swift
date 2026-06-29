import XCTest
@testable import MediFlowAppleShared

final class VersionConflictPresentationTests: XCTestCase {
    private func payload(
        entity: String = "patient",
        expected: Int = 1,
        current: Int? = 2,
        updatedAt: String? = "2026-06-29T10:15:00.000Z"
    ) -> VersionConflictPayload {
        VersionConflictPayload(
            error: "Version conflict", code: "VERSION_CONFLICT", entity: entity,
            recordId: "r1", expectedVersion: expected, currentVersion: current,
            currentUpdatedAt: updatedAt, currentState: "active",
            currentSnapshot: nil
        )
    }

    func testEntityLabelsAreHumanReadable() {
        XCTAssertEqual(VersionConflictPresentation.entityLabel("patient"), "anagrafica paziente")
        XCTAssertEqual(VersionConflictPresentation.entityLabel("entry"), "voce di diario")
        XCTAssertEqual(VersionConflictPresentation.entityLabel("therapy"), "terapia")
        XCTAssertEqual(VersionConflictPresentation.entityLabel("checkup"), "controllo")
        XCTAssertEqual(VersionConflictPresentation.entityLabel("observation"), "osservazione")
    }

    func testUnknownEntityFallsBackToRawCode() {
        XCTAssertEqual(VersionConflictPresentation.entityLabel("prescription"), "prescription")
    }

    func testTitleAndDetailCarryVersions() {
        let p = VersionConflictPresentation(payload: payload(entity: "therapy", expected: 3, current: 5))
        XCTAssertEqual(p.title, "Conflitto di versione: terapia")
        XCTAssertTrue(p.detail.contains("versione 3 e superata dalla versione 5"))
        XCTAssertTrue(p.detail.contains("Ricarica i dati aggiornati"))
    }

    func testNilCurrentVersionReadsAsMoreRecent() {
        let p = VersionConflictPresentation(payload: payload(current: nil))
        XCTAssertTrue(p.detail.contains("superata dalla versione piu recente"))
    }

    func testDayPrefixExtractsIsoDate() {
        XCTAssertEqual(VersionConflictPresentation.dayPrefix("2026-06-29T10:15:00.000Z"), "2026-06-29")
        let p = VersionConflictPresentation(payload: payload(updatedAt: "2026-06-29T10:15:00.000Z"))
        XCTAssertTrue(p.detail.contains("Aggiornata il 2026-06-29."))
    }

    func testDayPrefixRejectsMalformedOrMissing() {
        XCTAssertNil(VersionConflictPresentation.dayPrefix(nil))
        XCTAssertNil(VersionConflictPresentation.dayPrefix("short"))
        XCTAssertNil(VersionConflictPresentation.dayPrefix("2026/06/29T..."))
        XCTAssertNil(VersionConflictPresentation.dayPrefix("2026-06-2x"), "non-digit in a date slot must be rejected")
        XCTAssertNil(VersionConflictPresentation.dayPrefix("20x6-06-29"))
        // No timestamp line when the date is absent.
        let p = VersionConflictPresentation(payload: payload(updatedAt: nil))
        XCTAssertFalse(p.detail.contains("Aggiornata"))
    }
}
