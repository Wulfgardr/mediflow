// Codex: created 2026-04-18
// @Codex
import XCTest
@testable import MediFlowAppleShared

final class AppleFoundationLaunchOverridesTests: XCTestCase {
    func testAutomaticActionsSkipAutoLoadWhenAutoLoginDidNotCreateASession() {
        XCTAssertFalse(
            AppleFoundationLaunchOverrides.AutomaticActions(
                autoDiscover: false,
                autoLogin: true,
                autoLoadPatients: true
            )
            .shouldAutoLoadPatients(hasActiveSession: false)
        )
    }

    func testAutomaticActionsAllowAutoLoadAfterSuccessfulAutoLogin() {
        XCTAssertTrue(
            AppleFoundationLaunchOverrides.AutomaticActions(
                autoDiscover: false,
                autoLogin: true,
                autoLoadPatients: true
            )
            .shouldAutoLoadPatients(hasActiveSession: true)
        )
    }

    func testAutomaticActionsKeepStandaloneAutoLoadBehavior() {
        XCTAssertTrue(
            AppleFoundationLaunchOverrides.AutomaticActions(
                autoDiscover: false,
                autoLogin: false,
                autoLoadPatients: true
            )
            .shouldAutoLoadPatients(hasActiveSession: false)
        )
    }

    func testLoadParsesInitialSectionAndAutomaticActions() {
        let overrides = AppleFoundationLaunchOverrides.load(environment: [
            "MEDIFLOW_APPLE_INITIAL_SECTION": "modules",
            "MEDIFLOW_HOMEBASE_AUTODISCOVER": "yes",
            "MEDIFLOW_HOMEBASE_AUTOLOGIN": "true",
            "MEDIFLOW_HOMEBASE_AUTOLOAD_PATIENTS": "1",
        ])

        XCTAssertEqual(overrides.initialSection, .modules)
        XCTAssertEqual(
            overrides.automaticActions,
            AppleFoundationLaunchOverrides.AutomaticActions(
                autoDiscover: true,
                autoLogin: true,
                autoLoadPatients: true
            )
        )
    }

    func testLoadTrimsCredentialOverridesAndDropsBlankValues() {
        let overrides = AppleFoundationLaunchOverrides.load(environment: [
            "MEDIFLOW_HOMEBASE_SERVER_URL": " https://localhost:3443 ",
            "MEDIFLOW_HOMEBASE_TLS_PIN": " abc123 ",
            "MEDIFLOW_HOMEBASE_PAIRED_CLIENT_ID": " paired-client ",
            "MEDIFLOW_HOMEBASE_PAIRED_CLIENT_TOKEN": " paired-token ",
            "MEDIFLOW_HOMEBASE_USERNAME": " doctor ",
            "MEDIFLOW_HOMEBASE_OPERATOR_PIN": " 1992 ",
            "MEDIFLOW_HOMEBASE_AMBULATORY_ID": " amb-42 ",
            "MEDIFLOW_APPLE_INITIAL_SECTION": "unknown",
            "MEDIFLOW_HOMEBASE_AUTOLOGIN": "off",
        ])

        XCTAssertNil(overrides.initialSection)
        XCTAssertEqual(overrides.serverURL, "https://localhost:3443")
        XCTAssertEqual(overrides.tlsPin, "abc123")
        XCTAssertEqual(overrides.pairedClientId, "paired-client")
        XCTAssertEqual(overrides.pairedClientToken, "paired-token")
        XCTAssertEqual(overrides.username, "doctor")
        XCTAssertEqual(overrides.password, "1992")
        XCTAssertEqual(overrides.ambulatoryId, "amb-42")
        XCTAssertFalse(overrides.automaticActions.autoDiscover)
        XCTAssertFalse(overrides.automaticActions.autoLogin)
        XCTAssertFalse(overrides.automaticActions.autoLoadPatients)
    }
}
