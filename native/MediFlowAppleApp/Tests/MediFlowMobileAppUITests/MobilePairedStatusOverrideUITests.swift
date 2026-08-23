// @Codex
import XCTest

final class MobilePairedStatusOverrideUITests: XCTestCase {
    private let app = XCUIApplication()

    func testDebugOverrideMountsEveryPairedStatusPresentation() {
        let expectedTitles = [
            "online": "Home-base collegato",
            "cached": "Cache locale",
            "offline": "Offline, sola lettura",
            "sessionExpired": "Sessione scaduta",
            "error": "Aggiornamento non riuscito",
            "loading": "Aggiornamento in corso",
        ]

        for (state, title) in expectedTitles {
            app.terminate()
            app.launchEnvironment = [
                "MEDIFLOW_APPLE_UITEST_PATIENTS": "1",
                "MEDIFLOW_APPLE_UITEST_PAIRED_STATUS": state,
            ]
            app.launch()

            XCTAssertTrue(app.otherElements["mobile-paired-status"].waitForExistence(timeout: 10))
            XCTAssertTrue(
                app.staticTexts[title].waitForExistence(timeout: 5),
                "Expected the \(state) presentation to mount."
            )
        }
    }
}
