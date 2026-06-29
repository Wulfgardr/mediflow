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
        XCTAssertTrue(sectionView("patient-detail-ai-summary").waitForExistence(timeout: 10),
                      "Detail should show the AI insight summary when present")
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

    func testPrivacyShieldRedactsContentWhenForced() {
        // The Debug force hook stands in for the app-switcher (inactive scene),
        // which can't be driven headlessly. The overlay must cover the content.
        app.launchEnvironment["MEDIFLOW_APPLE_UITEST_FORCE_PRIVACY"] = "1"
        app.launch()
        XCTAssertTrue(
            sectionView("privacy-shield").waitForExistence(timeout: 20),
            "Privacy shield should cover the clinical content when the scene is not active"
        )
    }

    func testEditPatientFormSavesAnagrafica() {
        launch(seedPatients: true, section: "modules")
        XCTAssertTrue(sectionView("apple-foundation-modules-view").waitForExistence(timeout: 20))

        let rossi = app.buttons["patient-cell-uitest-1"]
        XCTAssertTrue(rossi.waitForExistence(timeout: 10))
        rossi.tap()

        XCTAssertTrue(sectionView("patient-detail-name").waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Via Roma 1, Milano"].waitForExistence(timeout: 5))

        // Open the edit form and replace the address.
        app.buttons["edit-patient-button"].tap()
        let address = app.textFields["edit-patient-address"]
        XCTAssertTrue(address.waitForExistence(timeout: 5))
        address.tap()
        if let existing = address.value as? String {
            address.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: existing.count))
        }
        address.typeText("Via Nuova 5")

        app.buttons["save-patient-button"].tap()

        // The detail re-renders with the new address; the form is dismissed.
        XCTAssertTrue(app.staticTexts["Via Nuova 5"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Via Roma 1, Milano"].waitForNonExistence(timeout: 3))
    }

    func testEditPatientFormArchivesPatient() {
        launch(seedPatients: true, section: "modules")
        XCTAssertTrue(sectionView("apple-foundation-modules-view").waitForExistence(timeout: 20))

        let rossi = app.buttons["patient-cell-uitest-1"]
        XCTAssertTrue(rossi.waitForExistence(timeout: 10))
        rossi.tap()

        // Generous timeout: alphabetically this is the first edit test to run, so it
        // pays the cold-launch tax for the detail navigation.
        XCTAssertTrue(sectionView("patient-detail-name").waitForExistence(timeout: 20))
        // Rossi starts active: the "Archiviato" flag chip is absent (singular chip,
        // distinct from the list's plural "Archiviati" filter, so the query is exact).
        XCTAssertTrue(app.staticTexts["Archiviato"].waitForNonExistence(timeout: 3))

        // Open the edit form and turn the archived toggle on.
        app.buttons["edit-patient-button"].tap()
        let archived = app.switches["edit-patient-archived"]
        XCTAssertTrue(archived.waitForExistence(timeout: 5))
        archived.tap()

        app.buttons["save-patient-button"].tap()

        // The form dismisses and the detail re-renders with the archived flag chip.
        XCTAssertTrue(app.staticTexts["Archiviato"].waitForExistence(timeout: 5))
    }

    func testObservationTrendIndicatorShowsForRepeatReading() {
        launch(seedPatients: true, section: "modules")
        XCTAssertTrue(sectionView("apple-foundation-modules-view").waitForExistence(timeout: 20))

        let rossi = app.buttons["patient-cell-uitest-1"]
        XCTAssertTrue(rossi.waitForExistence(timeout: 10))
        rossi.tap()
        XCTAssertTrue(sectionView("patient-detail-name").waitForExistence(timeout: 20))

        // The observations section sits near the bottom of the detail scroll view,
        // and SwiftUI only surfaces on-screen rows in the accessibility tree, so each
        // assertion scrolls its target into view first.
        let risingArrow = app.images["observation-trend-obs-weight-new"]
        XCTAssertTrue(scrollDown(to: risingArrow),
                      "The newer weight reading (82 after 80) should show a trend arrow")
        // Assert the direction, not just the presence: 82 after 80 is rising.
        XCTAssertEqual(risingArrow.label, "Valore in aumento rispetto alla rilevazione precedente")

        // The heart-rate pair (72 after 80) trends the other way.
        let fallingArrow = app.images["observation-trend-obs-hr-new"]
        XCTAssertTrue(scrollDown(to: fallingArrow))
        XCTAssertEqual(fallingArrow.label, "Valore in diminuzione rispetto alla rilevazione precedente")

        // Anchor on the single-reading glucose row, then assert it shows no arrow
        // (so the negative check can't pass merely because the row is off screen).
        XCTAssertTrue(scrollDown(to: app.staticTexts["Glicemia"]))
        XCTAssertFalse(app.images["observation-trend-obs-glucose"].exists,
                       "A single-reading code should not render a trend arrow")
    }

    private func launchWithForcedConflict() -> XCUIElement {
        // The Debug force hook stands in for a real 409 from the home-base, which
        // can't be driven headlessly.
        app.launchEnvironment["MEDIFLOW_APPLE_UITEST_PATIENTS"] = "1"
        app.launchEnvironment["MEDIFLOW_APPLE_INITIAL_SECTION"] = "modules"
        app.launchEnvironment["MEDIFLOW_APPLE_UITEST_FORCE_CONFLICT"] = "1"
        app.launch()
        XCTAssertTrue(sectionView("apple-foundation-modules-view").waitForExistence(timeout: 20))
        let banner = sectionView("version-conflict-banner")
        XCTAssertTrue(banner.waitForExistence(timeout: 10),
                      "A typed 409 conflict should surface the reconciliation banner")
        return banner
    }

    func testVersionConflictBannerReloadsAfterConflict() {
        let banner = launchWithForcedConflict()

        // Reloading clears the conflict (the safe no-clobber resolution) and runs
        // the reload path, which is what sets the "ricaricati" status.
        app.buttons["reload-after-conflict-button"].tap()
        XCTAssertTrue(banner.waitForNonExistence(timeout: 5),
                      "Reloading after the conflict should dismiss the banner")
        XCTAssertTrue(app.staticTexts["Dati ricaricati."].waitForExistence(timeout: 5),
                      "Reload should run the reload path (distinct from a bare dismiss)")
    }

    func testVersionConflictBannerDismissesWithoutReload() {
        let banner = launchWithForcedConflict()

        // Dismiss clears the banner WITHOUT running the reload path.
        app.buttons["dismiss-conflict-button"].tap()
        XCTAssertTrue(banner.waitForNonExistence(timeout: 5),
                      "Dismiss should clear the banner")
        XCTAssertFalse(app.staticTexts["Dati ricaricati."].exists,
                       "Dismiss must not run the reload path")
    }

    func testAmbulatoryScopePickerSwitchesScope() {
        launch(seedPatients: true, section: "modules")
        XCTAssertTrue(sectionView("apple-foundation-modules-view").waitForExistence(timeout: 20))

        let picker = app.buttons["ambulatory-scope-picker"]
        XCTAssertTrue(picker.waitForExistence(timeout: 10),
                      "The scope picker should appear once ambulatories are loaded")
        picker.tap()
        // Menu option label is the ambulatory name (distinct from the picker label).
        app.buttons["Ambulatorio Nord"].tap()

        XCTAssertTrue(app.staticTexts["Scope attivo: AMB-2."].waitForExistence(timeout: 5),
                      "Selecting an ambulatory should switch the active scope")
    }

    /// Swipes the detail scroll view up until `element` is in the accessibility
    /// tree (or a swipe budget is exhausted). Returns whether it became present.
    private func scrollDown(to element: XCUIElement, maxSwipes: Int = 12) -> Bool {
        var attempts = 0
        while !element.exists && attempts < maxSwipes {
            app.swipeUp()
            attempts += 1
        }
        return element.waitForExistence(timeout: 5)
    }
}
