// Codex: created 2026-04-17
// @Codex
import XCTest
@testable import MediFlowAppleShared

final class AppleRolloutModelTests: XCTestCase {
    func testLiveSnapshotHasExpectedSectionsAndMilestones() {
        let snapshot = AppleFoundationSnapshot.live

        XCTAssertEqual(snapshot.lanes.count, 4)
        XCTAssertEqual(snapshot.milestones.count, 5)
        XCTAssertTrue(snapshot.safetyNotes.contains { $0.contains("SQLite resta autorevole") })
    }

    func testAllMilestonesExposeAnIssueReference() {
        for milestone in AppleFoundationSnapshot.live.milestones {
            XCTAssertFalse(milestone.issue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
    }

    // @Codex: packaged runtime ownership must stay aligned with the live supervisor.
    func testRuntimeCopySeparatesManagedRuntimeFromDiagnosticProviders() throws {
        let snapshot = AppleFoundationSnapshot.live
        let runtimeLane = try XCTUnwrap(snapshot.lanes.first { $0.id == "runtime" })
        let runtimeMilestone = try XCTUnwrap(snapshot.milestones.first { $0.id == "runtime" })

        XCTAssertTrue(runtimeLane.summary.contains("supervisiona backend e proxy TLS"))
        XCTAssertTrue(runtimeLane.summary.contains("restano diagnostici"))
        XCTAssertTrue(runtimeLane.summary.contains("Docker è fuori scope"))
        XCTAssertEqual(runtimeLane.sourceOfTruth, "ADR 0048")
        XCTAssertEqual(runtimeLane.nextIssue, "Post-0.8 provider lifecycle")
        XCTAssertTrue(runtimeMilestone.summary.contains("supervisione di backend e proxy TLS"))
        XCTAssertTrue(runtimeMilestone.summary.contains("non app-managed"))
    }

    func testSettingsSectionUsesDedicatedNavigationMetadata() {
        XCTAssertEqual(ClinicalWorkspaceSection.settings.title, "Impostazioni")
        XCTAssertEqual(ClinicalWorkspaceSection.settings.symbolName, "gearshape")
        XCTAssertEqual(ClinicalWorkspaceSection.settingsSections, [.settings])
    }
}
