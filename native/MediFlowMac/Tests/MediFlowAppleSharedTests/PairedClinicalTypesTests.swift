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

    /* @Codex */
    func testPrescriptionWireValueSetsMatchTheWebContract() {
        XCTAssertEqual(PairedServicePrescriptionStatus.allCases.map(\.rawValue), ["prescribed", "booked", "performed", "report_received", "cancelled"])
        XCTAssertEqual(PairedServicePrescriptionCategory.allCases.map(\.rawValue), ["lab", "imaging", "visit", "rehab", "screening", "procedure", "other"])
        XCTAssertEqual(PairedServicePrescriptionPriority.allCases.map(\.rawValue), ["routine", "P", "D", "B", "U", "unknown"])
        XCTAssertEqual(PairedPrescriptionSource.allCases.map(\.rawValue), ["manual", "document_review"])
        XCTAssertEqual(PairedProstheticPrescriptionStatus.allCases.map(\.rawValue), ["draft", "prescribed", "submitted", "authorized", "delivered", "tested", "cancelled"])
        XCTAssertEqual(PairedProstheticPrescriptionCategory.allCases.map(\.rawValue), ["standard", "oxygen", "repair", "replacement", "trial", "other"])
    }

    /* @Codex */
    func testClinicalSignalCountBelowLimitIsExact() {
        let signal = ClinicalSignalCount.fromLoadedList(count: 12, loadedCount: 12, limit: 100)

        XCTAssertEqual(signal, ClinicalSignalCount(count: 12, atCap: false))
        XCTAssertEqual(signal.displayText, "12")
    }

    /* @Codex */
    func testClinicalSignalCountAtLimitIsPartial() {
        let signal = ClinicalSignalCount.fromLoadedList(count: 42, loadedCount: 100, limit: 100)

        XCTAssertTrue(signal.atCap)
        XCTAssertEqual(signal.displayText, "42+")
    }

    /* @Codex */
    func testClinicalSignalCountFormatsHundredPlus() {
        let signal = ClinicalSignalCount.fromLoadedList(count: 100, loadedCount: 100, limit: 100)

        XCTAssertEqual(signal.displayText, "100+")
    }
}
