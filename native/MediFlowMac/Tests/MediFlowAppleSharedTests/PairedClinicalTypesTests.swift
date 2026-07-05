import XCTest
@testable import MediFlowAppleShared

final class PairedClinicalTypesTests: XCTestCase {
    // The status -> VetroTone mapping drives the semantic color of clinical
    // status text. The `switch` is compiler-enforced exhaustive, so a new case
    // can't be added without a tone; these lock the chosen mapping.
    func testTherapyStatusTone() {
        XCTAssertEqual(PairedTherapyStatus.active.tone, .positive)
        XCTAssertEqual(PairedTherapyStatus.suspended.tone, .attention)
        XCTAssertEqual(PairedTherapyStatus.completed.tone, .neutral)
    }

    func testCheckupStatusTone() {
        XCTAssertEqual(PairedCheckupStatus.pending.tone, .info)
        XCTAssertEqual(PairedCheckupStatus.completed.tone, .positive)
        XCTAssertEqual(PairedCheckupStatus.cancelled.tone, .neutral)
    }
}
