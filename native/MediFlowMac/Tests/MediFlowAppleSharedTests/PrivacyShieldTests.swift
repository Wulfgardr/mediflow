import XCTest
import SwiftUI
@testable import MediFlowAppleShared

final class PrivacyShieldTests: XCTestCase {
    func testForcedAlwaysRedacts() {
        XCTAssertTrue(PrivacyShield.shouldRedact(scenePhase: .active, forced: true))
        XCTAssertTrue(PrivacyShield.shouldRedact(scenePhase: .background, forced: true))
    }

    func testActiveAndNotForcedDoesNotRedact() {
        XCTAssertFalse(PrivacyShield.shouldRedact(scenePhase: .active, forced: false))
    }

    #if os(iOS)
    func testInactiveAndBackgroundRedactOnIOS() {
        XCTAssertTrue(PrivacyShield.shouldRedact(scenePhase: .inactive, forced: false))
        XCTAssertTrue(PrivacyShield.shouldRedact(scenePhase: .background, forced: false))
    }
    #else
    func testNonActiveDoesNotAutoRedactOnMacOS() {
        XCTAssertFalse(PrivacyShield.shouldRedact(scenePhase: .inactive, forced: false))
        XCTAssertFalse(PrivacyShield.shouldRedact(scenePhase: .background, forced: false))
    }
    #endif
}
