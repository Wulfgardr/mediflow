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

        // Stable identifiers (not display text). Seed: 1=Rossi, 2=Bianchi, 3=Verdi(archived).
        let rossi = app.buttons["patient-cell-uitest-1"]
        let bianchi = app.buttons["patient-cell-uitest-2"]
        let verdi = app.buttons["patient-cell-uitest-3"]

        // Active filter: Rossi + Bianchi visible, archived Verdi hidden.
        XCTAssertTrue(rossi.waitForExistence(timeout: 10))
        XCTAssertTrue(bianchi.exists)
        XCTAssertTrue(verdi.waitForNonExistence(timeout: 3), "Archived patient should be hidden by the active filter")

        // Typing narrows the list; the clear button appearing is the sync point.
        search.tap()
        search.typeText("rossi")
        XCTAssertTrue(app.buttons["patient-search-clear"].waitForExistence(timeout: 5))
        XCTAssertTrue(rossi.exists)
        XCTAssertTrue(bianchi.waitForNonExistence(timeout: 3), "Search should filter out non-matching patients")
    }

    func testSelectingPatientShowsEnrichedDetail() {
        launch(seedPatients: true, section: "modules")
        XCTAssertTrue(sectionView("apple-foundation-modules-view").waitForExistence(timeout: 20))

        let rossi = app.buttons["patient-cell-uitest-1"]
        XCTAssertTrue(rossi.waitForExistence(timeout: 10))
        rossi.tap()

        // Detail renders the name and the decoded exemptions (ExemptionCodesCodec).
        XCTAssertTrue(sectionView("patient-detail-name").waitForExistence(timeout: 10),
                      "Selecting a patient should show the enriched detail")
        XCTAssertTrue(sectionView("patient-detail-exemptions").waitForExistence(timeout: 10),
                      "Detail should show decoded exemption codes")
    }

    func testTherapyStatusFilterNarrowsList() {
        launch(seedPatients: true, section: "modules")
        XCTAssertTrue(sectionView("apple-foundation-modules-view").waitForExistence(timeout: 20))

        let rossi = app.buttons["patient-cell-uitest-1"]
        XCTAssertTrue(rossi.waitForExistence(timeout: 10))
        rossi.tap()

        // Seeded therapies (one per status) render.
        XCTAssertTrue(sectionView("therapy-row-therapy-active").waitForExistence(timeout: 10))
        XCTAssertTrue(sectionView("therapy-row-therapy-suspended").exists)
        XCTAssertTrue(sectionView("therapy-row-therapy-completed").exists)

        // Filter to "Sospese" via the menu; only the suspended therapy remains.
        let filter = app.buttons["therapy-status-filter"]
        XCTAssertTrue(filter.waitForExistence(timeout: 5))
        filter.tap()
        app.buttons["Sospese"].tap()

        XCTAssertTrue(sectionView("therapy-row-therapy-suspended").waitForExistence(timeout: 5))
        XCTAssertTrue(sectionView("therapy-row-therapy-active").waitForNonExistence(timeout: 3))
        XCTAssertTrue(sectionView("therapy-row-therapy-completed").waitForNonExistence(timeout: 3))
    }

    func testCheckupStatusFilterNarrowsList() {
        launch(seedPatients: true, section: "modules")
        XCTAssertTrue(sectionView("apple-foundation-modules-view").waitForExistence(timeout: 20))

        let rossi = app.buttons["patient-cell-uitest-1"]
        XCTAssertTrue(rossi.waitForExistence(timeout: 10))
        rossi.tap()

        // Seeded checkups (one per status) render.
        XCTAssertTrue(sectionView("checkup-row-checkup-pending").waitForExistence(timeout: 10))
        XCTAssertTrue(sectionView("checkup-row-checkup-completed").exists)
        XCTAssertTrue(sectionView("checkup-row-checkup-cancelled").exists)

        // Filter to "Completati"; only the completed checkup remains. (Uses the
        // plural filter label, distinct from the row's singular "Completato", so
        // the query is unambiguous.)
        let filter = app.buttons["checkup-status-filter"]
        XCTAssertTrue(filter.waitForExistence(timeout: 5))
        filter.tap()
        app.buttons["Completati"].tap()

        XCTAssertTrue(sectionView("checkup-row-checkup-completed").waitForExistence(timeout: 5))
        XCTAssertTrue(sectionView("checkup-row-checkup-pending").waitForNonExistence(timeout: 3))
        XCTAssertTrue(sectionView("checkup-row-checkup-cancelled").waitForNonExistence(timeout: 3))
    }

    func testDiaryTypeFilterNarrowsList() {
        launch(seedPatients: true, section: "modules")
        XCTAssertTrue(sectionView("apple-foundation-modules-view").waitForExistence(timeout: 20))

        let rossi = app.buttons["patient-cell-uitest-1"]
        XCTAssertTrue(rossi.waitForExistence(timeout: 10))
        rossi.tap()

        // Seeded diary entries (one per type) render.
        XCTAssertTrue(sectionView("entry-row-entry-note").waitForExistence(timeout: 10))
        XCTAssertTrue(sectionView("entry-row-entry-visit").exists)
        XCTAssertTrue(sectionView("entry-row-entry-phone").exists)

        // Filter to "Visite" (distinct from the row chip "Visita"); only the visit remains.
        let filter = app.buttons["entry-type-filter"]
        XCTAssertTrue(filter.waitForExistence(timeout: 5))
        filter.tap()
        app.buttons["Visite"].tap()

        XCTAssertTrue(sectionView("entry-row-entry-visit").waitForExistence(timeout: 5))
        XCTAssertTrue(sectionView("entry-row-entry-note").waitForNonExistence(timeout: 3))
        XCTAssertTrue(sectionView("entry-row-entry-phone").waitForNonExistence(timeout: 3))
    }
}
