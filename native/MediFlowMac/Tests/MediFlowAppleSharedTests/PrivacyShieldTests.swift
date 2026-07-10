import XCTest
import SwiftUI
@testable import MediFlowAppleShared

final class PrivacyShieldTests: XCTestCase {
    func testForcedAlwaysRedacts() {
        XCTAssertTrue(PrivacyShield.shouldRedact(scenePhase: .active, forced: true, userEnabled: false))
        XCTAssertTrue(PrivacyShield.shouldRedact(scenePhase: .background, forced: true, userEnabled: false))
    }

    func testActiveAndNotForcedDoesNotRedact() {
        XCTAssertFalse(PrivacyShield.shouldRedact(scenePhase: .active, forced: false, userEnabled: false))
    }

    func testUserPrivacyPreferenceRedactsOnEveryPlatform() {
        XCTAssertTrue(PrivacyShield.shouldRedact(scenePhase: .active, forced: false, userEnabled: true, platform: .iOS))
        XCTAssertTrue(PrivacyShield.shouldRedact(scenePhase: .background, forced: false, userEnabled: true, platform: .macOS))
    }

    func testIOSRedactsWhenItsSceneIsNotActive() {
        XCTAssertTrue(PrivacyShield.shouldRedact(scenePhase: .inactive, forced: false, userEnabled: false, platform: .iOS))
        XCTAssertTrue(PrivacyShield.shouldRedact(scenePhase: .background, forced: false, userEnabled: false, platform: .iOS))
    }

    func testMacOSDoesNotRedactWhenOnlyItsSceneIsInactive() {
        XCTAssertFalse(PrivacyShield.shouldRedact(scenePhase: .inactive, forced: false, userEnabled: false, platform: .macOS))
        XCTAssertFalse(PrivacyShield.shouldRedact(scenePhase: .background, forced: false, userEnabled: false, platform: .macOS))
    }
}
