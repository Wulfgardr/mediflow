// @Codex
#if DEBUG
import XCTest
@testable import MediFlowAppleShared

final class MobilePairedStatusUITestOverrideTests: XCTestCase {
    func testAcceptsOnlyTheSixDocumentedStates() {
        XCTAssertEqual(
            Set(MobilePairedStatusUITestOverride.State.allCases.map(\.rawValue)),
            Set(["online", "cached", "offline", "sessionExpired", "error", "loading"])
        )
    }

    func testUnknownOrBlankEnvironmentValuesFailClosed() {
        XCTAssertNil(MobilePairedStatusUITestOverride.load(environment: [:]))
        XCTAssertNil(MobilePairedStatusUITestOverride.load(environment: [
            "MEDIFLOW_APPLE_UITEST_PAIRED_STATUS": " ",
        ]))
        XCTAssertNil(MobilePairedStatusUITestOverride.load(environment: [
            "MEDIFLOW_APPLE_UITEST_PAIRED_STATUS": "stale",
        ]))
    }

    func testEveryOverrideBuildsTheExpectedPresentation() {
        let expectations: [(MobilePairedStatusUITestOverride.State, MobilePairedStatusPresentation.Phase, String)] = [
            (.online, .online, "Home-base collegato"),
            (.cached, .cached, "Cache locale"),
            (.offline, .offline, "Offline, sola lettura"),
            (.sessionExpired, .sessionExpired, "Sessione scaduta"),
            (.error, .error, "Aggiornamento non riuscito"),
            (.loading, .loading, "Aggiornamento in corso"),
        ]

        for (state, phase, title) in expectations {
            let override = MobilePairedStatusUITestOverride.load(environment: [
                "MEDIFLOW_APPLE_UITEST_PAIRED_STATUS": state.rawValue,
            ])
            XCTAssertEqual(override?.presentation.phase, phase)
            XCTAssertEqual(override?.presentation.title, title)
        }
    }
}
#endif
