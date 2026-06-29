import XCTest

/// Interaction tests for the universal app shell on a compact (iPhone) layout:
/// the app launches into the overview and the Liquid Glass tab bar drives the
/// sections. These exercise the real navigation, not just that it compiles.
final class MediFlowMobileAppUITests: XCTestCase {
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
    }

    private func launch(seedPatients: Bool = false, section: String? = nil) {
        if seedPatients { app.launchEnvironment["MEDIFLOW_APPLE_UITEST_PATIENTS"] = "1" }
        if let section { app.launchEnvironment["MEDIFLOW_APPLE_INITIAL_SECTION"] = section }
        app.launch()
    }

    /// Section container views carry accessibilityIdentifier; match across element
    /// types since SwiftUI may expose a container as otherElements/scrollViews.
    private func sectionView(_ identifier: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: identifier).firstMatch
    }

    private func tab(_ label: String) -> XCUIElement {
        let inTabBar = app.tabBars.buttons[label]
        return inTabBar.exists ? inTabBar : app.buttons[label]
    }

    func testLaunchShowsOverview() {
        launch()
        XCTAssertTrue(
            sectionView("apple-foundation-overview-view").waitForExistence(timeout: 20),
            "Overview section should render on launch"
        )
    }

    func testTabBarNavigatesBetweenSections() {
        launch()
        XCTAssertTrue(sectionView("apple-foundation-overview-view").waitForExistence(timeout: 20))

        tab("Pazienti").tap()
        XCTAssertTrue(
            sectionView("apple-foundation-modules-view").waitForExistence(timeout: 10),
            "Tapping Pazienti should show the clinical workspace"
        )

        tab("Tappe").tap()
        XCTAssertTrue(
            sectionView("apple-foundation-milestones-view").waitForExistence(timeout: 10),
            "Tapping Tappe should show the milestones"
        )

        tab("Panoramica").tap()
        XCTAssertTrue(
            sectionView("apple-foundation-overview-view").waitForExistence(timeout: 10),
            "Tapping Panoramica should return to the overview"
        )
    }

    func testPatientsSectionShowsConsultationState() {
        launch()
        tab("Pazienti").tap()
        XCTAssertTrue(sectionView("apple-foundation-modules-view").waitForExistence(timeout: 10))
        XCTAssertTrue(
            sectionView("homebase-connection-state").waitForExistence(timeout: 10),
            "The clinical workspace should show the home-base connection state"
        )
    }

    func testPatientSearchFiltersTheList() {
        // Seed deterministic patients and open the workspace directly.
        launch(seedPatients: true, section: "modules")
        XCTAssertTrue(sectionView("apple-foundation-modules-view").waitForExistence(timeout: 20))

        let search = app.textFields["patient-search-field"]
        XCTAssertTrue(search.waitForExistence(timeout: 10), "Search field should render with patients present")

        // Active filter: Rossi + Bianchi visible, archived Verdi hidden.
        XCTAssertTrue(app.staticTexts["Rossi Mario"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Bianchi Anna"].exists)
        XCTAssertFalse(app.staticTexts["Verdi Luigi"].exists, "Archived patient should be hidden by the active filter")

        // Typing narrows the list; the clear button appearing is the sync point.
        search.tap()
        search.typeText("rossi")
        XCTAssertTrue(app.buttons["patient-search-clear"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Rossi Mario"].exists)
        XCTAssertFalse(app.staticTexts["Bianchi Anna"].exists, "Search should filter out non-matching patients")
    }
}
