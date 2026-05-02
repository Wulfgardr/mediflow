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
}
