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

    override func tearDown() {
        // Orientation is device state, not app state: leaving a rotated simulator
        // behind would silently change the layout every later test measures.
        XCUIDevice.shared.orientation = .portrait
        super.tearDown()
    }

    /* @Codex */
    private func launch(
        seedPatients: Bool = false,
        singlePatient: Bool = false,
        lockedPatientFields: Bool = false,
        section: String? = nil,
        dynamicTypeSize: String? = nil
    ) {
        if seedPatients { app.launchEnvironment["MEDIFLOW_APPLE_UITEST_PATIENTS"] = "1" }
        if singlePatient { app.launchEnvironment["MEDIFLOW_APPLE_UITEST_SINGLE_PATIENT"] = "1" }
        if lockedPatientFields { app.launchEnvironment["MEDIFLOW_APPLE_UITEST_LOCKED_PATIENT_FIELDS"] = "1" }
        if let section { app.launchEnvironment["MEDIFLOW_APPLE_INITIAL_SECTION"] = section }
        if let dynamicTypeSize {
            app.launchEnvironment["MEDIFLOW_APPLE_UITEST_DYNAMIC_TYPE_SIZE"] = dynamicTypeSize
        }
        app.launch()
    }

    /// Section container views carry accessibilityIdentifier; match across element
    /// types since SwiftUI may expose a container as otherElements/scrollViews.
    private func sectionView(_ identifier: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: identifier).firstMatch
    }

    /* @Codex */
    private func attachScreenshot(named name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func tab(_ label: String) -> XCUIElement {
        let inTabBar = app.tabBars.buttons[label]
        return inTabBar.exists ? inTabBar : app.buttons[label]
    }

    // MARK: - Navigazione fra sezioni, su entrambi gli idiomi

    /// Opens a section by name, wherever this idiom keeps its sections.
    ///
    /// On iPhone they are tabs. On iPad they are rows in the `NavigationSplitView`
    /// sidebar, and that sidebar starts at `.detailOnly` — hidden. `tab(_:)`
    /// therefore found nothing on iPad, which is most of why the navigation tests
    /// failed there: not a layout regression, a helper that only knew one idiom.
    ///
    /// Reveals the sidebar only when the row is not already reachable, so on
    /// iPhone this stays exactly the tap it was.
    @discardableResult
    private func openSection(_ label: String) -> Bool {
        let direct = tab(label)
        if direct.exists && direct.isHittable {
            direct.tap()
            return true
        }

        // iPhone: six sections do not all fit the bar, so the last ones sit
        // behind the system's overflow. Reaching them is an extra step there and
        // not on iPad, which is itself a difference worth having encoded.
        for overflow in ["Altro", "More"] {
            let button = app.tabBars.buttons[overflow]
            if button.exists && button.isHittable {
                button.tap()
                let row = app.buttons[label]
                if row.waitForExistence(timeout: 5) {
                    row.tap()
                    return true
                }
            }
        }

        // iPad: the sections live in the split-view sidebar, which starts hidden.
        // The system's toggle carries no stable identifier, so it is found by
        // position: the leading control of the navigation bar.
        let toggle = app.navigationBars.buttons.element(boundBy: 0)
        if toggle.exists && toggle.isHittable {
            toggle.tap()
        }

        let row = app.buttons[label].exists ? app.buttons[label] : app.staticTexts[label]
        guard row.waitForExistence(timeout: 5) else { return false }
        row.tap()
        return true
    }

    /// Every surface the mobile shell offers, with the identifier it publishes.
    ///
    /// Two sections are deliberately absent, and both absences are decisions
    /// written into `detailView(for:)` rather than gaps:
    ///
    /// - `.host`, because administering the archive is offered from loopback
    ///   alone and a paired iPhone is not the machine holding it.
    /// - `.repertori`, because catalogue browsing is a macOS surface for now and
    ///   mobile reaches the same data through the therapy and exemption pickers.
    ///
    /// Listing them here would not test parity, it would demand that the shell
    /// grow two navigation entries leading to `EmptyView`.
    private static let clinicalSurfaces: [(label: String, identifier: String)] = [
        ("Pazienti", "clinical-workspace-patients-view"),
        ("Agenda", "clinical-workspace-agenda-view"),
        ("Diario", "clinical-workspace-diary-view"),
        ("Analytics", "clinical-workspace-analytics-view"),
        ("Scale", "clinical-workspace-scales-view"),
        ("Impostazioni", "clinical-workspace-settings-view"),
    ]

    // MARK: - Native search helpers

    /// The affordance that leads to search, whatever stage it is in: the expanded
    /// system field, or the collapsed toolbar control that expands into it.
    /// Returned as a query so callers can require exactly one match.
    private func nativeSearchAffordances() -> XCUIElementQuery {
        if app.searchFields.count > 0 { return app.searchFields }
        // The minimized trigger is a global button, not a navigation-bar
        // descendant, and it carries its meaning in the label rather than an
        // identifier. Matched on exact terms so a partial match cannot pull in
        // some other control.
        return app.buttons.matching(
            NSPredicate(
                format: "identifier ==[c] %@ OR identifier ==[c] %@ OR label ==[c] %@ OR label ==[c] %@",
                "Search", "Cerca", "Search", "Cerca"
            )
        )
    }

    /// Opens the system search field and returns it, requiring exactly one match
    /// at every stage so a stray element cannot satisfy the gate by accident.
    @discardableResult
    private func openNativeSearchField() -> XCUIElement {
        if app.searchFields.count == 0 {
            let triggers = nativeSearchAffordances()
            XCTAssertEqual(
                triggers.count, 1,
                "expected exactly one native search trigger, got \(triggers.count)"
            )
            triggers.element.tap()
        }
        let fields = app.searchFields
        let field = fields.element
        XCTAssertTrue(field.waitForExistence(timeout: 5), "the native search field should appear")
        XCTAssertEqual(
            fields.count, 1,
            "expected exactly one native search field, got \(fields.count)"
        )
        XCTAssertEqual(
            field.elementType, .searchField,
            "the native search target must expose the SearchField role"
        )
        XCTAssertEqual(
            field.placeholderValue, "Cerca per nome o codice fiscale",
            "the native search field must expose the expected prompt"
        )
        return field
    }

    /// Sort now lives in the toolbar. Required unique so the locator cannot drift
    /// onto some other menu.
    private func sortControl() -> XCUIElement {
        let query = app.buttons.matching(identifier: "patient-sort-menu")
        XCTAssertTrue(
            query.element.waitForExistence(timeout: 15),
            "the sort control should exist in the toolbar"
        )
        XCTAssertEqual(
            query.count, 1,
            "patient-sort-menu must identify exactly one control, got \(query.count)"
        )
        return query.element
    }

    func testProjectMenuOpensEverySurface() throws {
        /* La meta speculare della matrice adattiva. I quattro contratti solo-iPad
           si auto-saltano su iPhone; questi cinque pretendono il cromo compatto,
           cioe la tab bar mobile e il menu Progetto che vive solo nel ramo TabView,
           e su iPad quel cromo non esiste per scelta dichiarata (#142): li la
           navigazione e una NavigationSplitView con la sidebar. Un test che lo
           pretende su iPad asserisce l opposto del progetto. La copertura iPad
           equivalente esiste gia in testEveryClinicalSurfaceOpensOnThisIdiom, che
           gira su entrambi gli idiomi. */
        try XCTSkipUnless(UIDevice.current.userInterfaceIdiom == .phone, "compact-only layout contract")
        launch()
        XCTAssertTrue(sectionView("clinical-workspace-patients-view").waitForExistence(timeout: 20))
        let projectButton = app.navigationBars.buttons["Progetto"].firstMatch
        XCTAssertTrue(projectButton.waitForExistence(timeout: 10))
        projectButton.tap()

        let surfaces = [
            (label: "Runtime", identifier: "apple-foundation-runtime-view"),
            (label: "Panoramica", identifier: "apple-foundation-overview-view"),
            (label: "Tappe", identifier: "apple-foundation-milestones-view"),
        ]
        for (index, surface) in surfaces.enumerated() {
            let link = app.buttons[surface.label]
            XCTAssertTrue(link.waitForExistence(timeout: 10))
            link.tap()
            XCTAssertTrue(
                sectionView(surface.identifier).waitForExistence(timeout: 20),
                "The project menu should open \(surface.label)"
            )
            if index < surfaces.count - 1 {
                let backButton = app.navigationBars.buttons["Progetto"].firstMatch
                XCTAssertTrue(backButton.waitForExistence(timeout: 10))
                backButton.tap()
            }
        }
    }

    // @Codex #142: the outer project sidebar must overlay the iPad patient workspace.
    func testProjectSidebarPreservesPatientWorkspaceWidthOnIPad() throws {
        // Not applicable on iPhone: skipping keeps the iPhone suite meaningful
        // instead of reporting a device mismatch as a product failure.
        try XCTSkipUnless(UIDevice.current.userInterfaceIdiom == .pad, "iPad-only layout contract")

        launch(seedPatients: true, section: "modules")
        let patientWorkspace = sectionView("clinical-workspace-patients-view")
        XCTAssertTrue(patientWorkspace.waitForExistence(timeout: 20))
        let workspaceFrameBeforeOverlay = patientWorkspace.frame

        let navigationButtons = app.navigationBars.buttons
        XCTAssertGreaterThan(navigationButtons.count, 0, "iPad should expose the system sidebar control")
        navigationButtons.element(boundBy: 0).tap()

        let projectSidebar = sectionView("clinical-workspace-project-sidebar")
        XCTAssertTrue(projectSidebar.waitForExistence(timeout: 10))
        XCTAssertTrue(
            sectionView("clinical-workspace-patients-view").exists,
            "Opening the project sidebar must preserve the patient workspace behind the overlay"
        )
        let workspaceFrameWithOverlay = patientWorkspace.frame
        XCTAssertEqual(
            workspaceFrameWithOverlay.minX,
            workspaceFrameBeforeOverlay.minX,
            accuracy: 2,
            "Opening the overlay must not shift the patient workspace"
        )
        XCTAssertEqual(
            workspaceFrameWithOverlay.width,
            workspaceFrameBeforeOverlay.width,
            accuracy: 2,
            "Opening the overlay must not compress the patient workspace"
        )
        let overlayEvidence = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        overlayEvidence.name = "issue-142-project-sidebar-overlay"
        overlayEvidence.lifetime = .keepAlways
        add(overlayEvidence)

        app.buttons["Agenda"].firstMatch.tap()
        XCTAssertTrue(sectionView("clinical-workspace-agenda-view").waitForExistence(timeout: 10))
        XCTAssertTrue(
            projectSidebar.waitForNonExistence(timeout: 5),
            "Selecting a destination should dismiss the project sidebar"
        )
    }

    // @Codex #142: AX Dynamic Type must select the existing single-column path.
    func testAccessibilityDynamicTypeUsesSinglePatientColumnOnIPad() throws {
        // Not applicable on iPhone: skipping keeps the iPhone suite meaningful
        // instead of reporting a device mismatch as a product failure.
        try XCTSkipUnless(UIDevice.current.userInterfaceIdiom == .pad, "iPad-only layout contract")

        launch(
            seedPatients: true,
            section: "modules",
            dynamicTypeSize: "accessibility5"
        )
        let initialEvidence = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        initialEvidence.name = "issue-142-ax5-initial-layout"
        initialEvidence.lifetime = .keepAlways
        add(initialEvidence)

        let patientWorkspace = sectionView("clinical-workspace-patients-view")
        XCTAssertTrue(patientWorkspace.waitForExistence(timeout: 20))
        let patient = app.buttons["patient-cell-uitest-1"]
        XCTAssertTrue(patient.waitForExistence(timeout: 10))
        XCTAssertGreaterThan(
            patient.frame.width,
            patientWorkspace.frame.width * 0.75,
            "AX5 must give the patient list one full content column, not a fixed split column"
        )
        XCTAssertGreaterThan(
            patient.frame.height,
            100,
            "The deterministic AX5 override must produce the accessibility row geometry"
        )
        patient.tap()
        XCTAssertTrue(sectionView("patient-detail-name").waitForExistence(timeout: 10))

        let detailEvidence = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        detailEvidence.name = "issue-142-ax5-single-layer-detail"
        detailEvidence.lifetime = .keepAlways
        add(detailEvidence)
    }

    // MARK: - Adaptive layout matrix

    /// The list must remain usable as the container changes. It may keep the same
    /// width after reaching its intentional cap; the detail then absorbs the
    /// additional landscape space.
    /* @Codex */
    func testIPadListColumnFollowsTheContainerAcrossRotation() throws {
        // Not applicable on iPhone: skipping keeps the iPhone suite meaningful
        // instead of reporting a device mismatch as a product failure.
        try XCTSkipUnless(UIDevice.current.userInterfaceIdiom == .pad, "iPad-only layout contract")
        launch(seedPatients: true, section: "modules")
        XCUIDevice.shared.orientation = .portrait

        func requireUnique(
            _ query: XCUIElementQuery,
            named name: String,
            timeout: TimeInterval
        ) -> XCUIElement {
            let element = query.element
            XCTAssertTrue(element.waitForExistence(timeout: timeout), "\(name) should exist")
            XCTAssertEqual(query.count, 1, "\(name) must resolve exactly once; got \(query.count)")
            return element
        }

        let windows = app.windows.containing(
            .any,
            identifier: "clinical-workspace-patients-view"
        )
        let rows = app.buttons.matching(identifier: "patient-cell-uitest-1")
        let window = requireUnique(windows, named: "application window", timeout: 20)
        let row = requireUnique(rows, named: "first patient row", timeout: 10)
        let portraitContainer = window.frame.width
        let portraitRow = row.frame.width
        attachScreenshot(named: "matrix-ipad-portrait-split")

        XCUIDevice.shared.orientation = .landscapeLeft
        let rotationCompleted = XCTNSPredicateExpectation(
            predicate: NSPredicate { object, _ in
                guard let element = object as? XCUIElement else { return false }
                return element.frame.width > portraitContainer
            },
            object: window
        )
        XCTAssertEqual(
            XCTWaiter.wait(for: [rotationCompleted], timeout: 10),
            .completed,
            "the window must complete the transition to a wider landscape container"
        )

        let landscapeWindow = requireUnique(windows, named: "landscape application window", timeout: 10)
        let landscapePatientRow = requireUnique(rows, named: "landscape first patient row", timeout: 10)
        let landscapeContainer = landscapeWindow.frame.width
        let landscapeRow = landscapePatientRow.frame.width
        attachScreenshot(named: "matrix-ipad-landscape-split")

        XCTAssertGreaterThan(landscapeContainer, portraitContainer, "landscape must be the wider container")
        XCTAssertGreaterThanOrEqual(
            landscapeRow,
            portraitRow,
            "the list must not shrink when the container widens"
        )
        for (row, container, label) in [
            (portraitRow, portraitContainer, "portrait"),
            (landscapeRow, landscapeContainer, "landscape")
        ] {
            XCTAssertLessThan(row, container * 0.5, "the list must not take half the workspace in \(label)")
        }

        let portraitDetailSpace = portraitContainer - portraitRow
        let landscapeDetailSpace = landscapeContainer - landscapeRow
        XCTAssertGreaterThan(portraitDetailSpace, 0, "portrait must leave space for the detail")
        XCTAssertGreaterThan(landscapeDetailSpace, 0, "landscape must leave space for the detail")
        XCTAssertGreaterThan(
            landscapeDetailSpace,
            portraitDetailSpace,
            "the detail must absorb the additional landscape width"
        )
    }

    /// Selection is the thing the design contract says must survive recomposition.
    func testIPadKeepsTheOpenChartAcrossRotation() throws {
        // Not applicable on iPhone: skipping keeps the iPhone suite meaningful
        // instead of reporting a device mismatch as a product failure.
        try XCTSkipUnless(UIDevice.current.userInterfaceIdiom == .pad, "iPad-only layout contract")
        launch(seedPatients: true, section: "modules")
        XCUIDevice.shared.orientation = .portrait
        XCTAssertTrue(sectionView("clinical-workspace-patients-view").waitForExistence(timeout: 20))
        let row = app.buttons["patient-cell-uitest-1"]
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        row.tap()
        XCTAssertTrue(sectionView("patient-detail-name").waitForExistence(timeout: 15))

        XCUIDevice.shared.orientation = .landscapeLeft
        XCTAssertTrue(
            sectionView("patient-detail-name").waitForExistence(timeout: 15),
            "rotating must not drop the open chart"
        )
        XCUIDevice.shared.orientation = .portrait
        XCTAssertTrue(
            sectionView("patient-detail-name").waitForExistence(timeout: 15),
            "rotating back must not drop the open chart"
        )
        attachScreenshot(named: "matrix-ipad-selection-preserved")
    }

    /// Clinical content must stay inside the workspace at the largest text size.
    /// The worklist row is the densest thing on the home: name, masked tax code,
    /// diagnosis summary and relative update all compete for the same width.
    func testWorklistContentStaysInsideTheWorkspaceAtAX5() {
        launch(seedPatients: true, section: "modules", dynamicTypeSize: "accessibility5")
        let workspace = sectionView("clinical-workspace-patients-view")
        XCTAssertTrue(workspace.waitForExistence(timeout: 20))
        let row = app.buttons["patient-cell-uitest-1"]
        XCTAssertTrue(row.waitForExistence(timeout: 15))
        let diagnosis = sectionView("patient-cell-diagnosis-uitest-1")
        XCTAssertTrue(diagnosis.waitForExistence(timeout: 15))
        attachScreenshot(named: "matrix-ax5-worklist")

        // Each element is checked against the box that actually owns it: the row
        // against the window, the diagnosis against its own row.
        for (element, bounds, name) in [
            (row, app.windows.firstMatch.frame, "patient row"),
            (diagnosis, row.frame, "diagnosis summary")
        ] {
            XCTAssertGreaterThanOrEqual(
                element.frame.minX, bounds.minX - 1,
                "\(name) starts outside its container at AX5"
            )
            XCTAssertLessThanOrEqual(
                element.frame.maxX, bounds.maxX + 1,
                "\(name) overflows its container at AX5"
            )
        }
        XCTAssertTrue(
            diagnosis.label.contains("Diabete tipo 2"),
            "the diagnosis must stay readable at AX5, got: \(diagnosis.label)"
        )
    }

    /// The floating tab bar overlays the scroll view. Without a bottom safe-area
    /// inset the last row can never be scrolled clear of it, so clinical text
    /// stays physically occluded no matter how far the clinician scrolls.
    ///
    /// This asserts vertical occlusion, not horizontal overflow: XCUI clips
    /// element frames to the visible region, so a horizontal-bounds check is
    /// satisfied by the very clipping it is meant to catch.
    func testWorklistLastRowClearsTheFloatingTabBarAtAX5() throws {
        /* La meta speculare della matrice adattiva. I quattro contratti solo-iPad
           si auto-saltano su iPhone; questi cinque pretendono il cromo compatto,
           cioe la tab bar mobile e il menu Progetto che vive solo nel ramo TabView,
           e su iPad quel cromo non esiste per scelta dichiarata (#142): li la
           navigazione e una NavigationSplitView con la sidebar. Un test che lo
           pretende su iPad asserisce l opposto del progetto. La copertura iPad
           equivalente esiste gia in testEveryClinicalSurfaceOpensOnThisIdiom, che
           gira su entrambi gli idiomi. */
        try XCTSkipUnless(UIDevice.current.userInterfaceIdiom == .phone, "compact-only layout contract")
        launch(seedPatients: true, section: "modules", dynamicTypeSize: "accessibility5")
        XCTAssertTrue(sectionView("clinical-workspace-patients-view").waitForExistence(timeout: 20))
        let tabBar = app.tabBars.firstMatch
        XCTAssertTrue(tabBar.waitForExistence(timeout: 10), "compact layout should present the tab bar")

        // A visible anchor. Off-screen elements report clipped frames, which is
        // how a bounds check can pass while the content it measures is in fact
        // unreachable, so the anchor must be on screen to mean anything.
        let anchor = app.buttons["patient-cell-uitest-1"]
        XCTAssertTrue(anchor.waitForExistence(timeout: 15))
        XCTAssertTrue(anchor.isHittable, "the anchor row must start visible")

        // The final row must start out of reach, otherwise this gate proves
        // nothing about scrolling.
        let lastRow = app.buttons["patient-cell-uitest-2"]
        XCTAssertTrue(lastRow.waitForExistence(timeout: 15))
        XCTAssertFalse(
            lastRow.isHittable && lastRow.frame.maxY <= tabBar.frame.minY,
            "precondition: at AX5 the last row must require scrolling; if it is already clear, "
                + "this gate cannot detect the defect"
        )

        let anchorBefore = anchor.frame
        attachScreenshot(named: "ax5-worklist-at-rest")
        app.swipeUp()
        let anchorAfter = anchor.frame
        attachScreenshot(named: "ax5-worklist-after-swipe")

        let geometry = """
        anchor patient-cell-uitest-1 before: \(anchorBefore)
        anchor patient-cell-uitest-1 after:  \(anchorAfter)
        tab bar: \(tabBar.frame)
        """
        let geometryEvidence = XCTAttachment(string: geometry)
        geometryEvidence.name = "ax5-anchor-geometry"
        geometryEvidence.lifetime = .keepAlways
        add(geometryEvidence)

        // The content must actually move. This is unconditional: a worklist that
        // cannot scroll strands every row below the fold.
        XCTAssertNotEqual(
            anchorBefore.minY, anchorAfter.minY, accuracy: 0.5,
            "the worklist did not scroll at AX5, so content below the fold can never be read. \(geometry)"
        )

        // And the final row must end up genuinely usable: hittable and wholly
        // above the floating tab bar.
        var previous = anchorAfter.minY
        for _ in 0..<12 {
            if lastRow.isHittable && lastRow.frame.maxY <= tabBar.frame.minY { break }
            app.swipeUp()
            let current = anchor.frame.minY
            if abs(current - previous) < 0.5 { break }
            previous = current
        }
        attachScreenshot(named: "ax5-worklist-at-end")
        XCTAssertTrue(lastRow.isHittable, "the last patient row must become hittable at AX5")
        XCTAssertLessThanOrEqual(
            lastRow.frame.maxY,
            tabBar.frame.minY,
            "the last patient row must end wholly above the floating tab bar; "
                + "row maxY \(lastRow.frame.maxY) vs tab bar minY \(tabBar.frame.minY)"
        )
    }

    /// Patients-first has to hold at AX5 too, where header controls are largest.
    /// The first patient must be reachable in the first viewport, above the
    /// floating tab bar, without scrolling.
    func testFirstPatientIsVisibleInTheFirstViewportAtAX5() throws {
        /* La meta speculare della matrice adattiva. I quattro contratti solo-iPad
           si auto-saltano su iPhone; questi cinque pretendono il cromo compatto,
           cioe la tab bar mobile e il menu Progetto che vive solo nel ramo TabView,
           e su iPad quel cromo non esiste per scelta dichiarata (#142): li la
           navigazione e una NavigationSplitView con la sidebar. Un test che lo
           pretende su iPad asserisce l opposto del progetto. La copertura iPad
           equivalente esiste gia in testEveryClinicalSurfaceOpensOnThisIdiom, che
           gira su entrambi gli idiomi. */
        try XCTSkipUnless(UIDevice.current.userInterfaceIdiom == .phone, "compact-only layout contract")
        launch(seedPatients: true, section: "modules", dynamicTypeSize: "accessibility5")
        XCTAssertTrue(sectionView("clinical-workspace-patients-view").waitForExistence(timeout: 20))
        let tabBar = app.tabBars.firstMatch
        XCTAssertTrue(tabBar.waitForExistence(timeout: 10))
        let firstRow = app.buttons["patient-cell-uitest-1"]
        XCTAssertTrue(firstRow.waitForExistence(timeout: 15))
        attachScreenshot(named: "ax5-first-viewport")

        XCTAssertTrue(firstRow.isHittable, "the first patient must be reachable without scrolling at AX5")

        let geometry = """
        first row: \(firstRow.frame)
        tab bar:   \(tabBar.frame)
        overlap:   \(firstRow.frame.maxY - tabBar.frame.minY)
        """
        let geometryEvidence = XCTAttachment(string: geometry)
        geometryEvidence.name = "ax5-first-row-geometry"
        geometryEvidence.lifetime = .keepAlways
        add(geometryEvidence)

        // The whole row, strictly: a minY check passes while the bottom of the
        // row is still buried under the bar, and any tolerance here is slack for
        // occluded clinical content.
        XCTAssertLessThanOrEqual(
            firstRow.frame.maxY,
            tabBar.frame.minY,
            "the entire first patient row must clear the floating tab bar at AX5. \(geometry)"
        )
    }

    /// The scope filter is a segmented control, which truncates instead of
    /// wrapping. At accessibility sizes it has to become a menu so the active
    /// scope is still legible.
    func testScopeFilterRemainsLegibleAtAX5() {
        launch(seedPatients: true, section: "modules", dynamicTypeSize: "accessibility5")
        XCTAssertTrue(sectionView("clinical-workspace-patients-view").waitForExistence(timeout: 20))
        let scope = sectionView("patient-view-mode")
        XCTAssertTrue(scope.waitForExistence(timeout: 15))
        XCTAssertTrue(
            scope.frame.width > 0 && scope.frame.height > 0,
            "the scope control must still be laid out at AX5"
        )
        attachScreenshot(named: "matrix-ax5-scope-filter")
    }

    /// The sort control has to state the active order on its own face: the old
    /// bare arrow pair required opening the menu to learn the current sort.
    func testSortControlShowsTheActiveOrder() {
        launch(seedPatients: true, section: "modules")
        XCTAssertTrue(sectionView("clinical-workspace-patients-view").waitForExistence(timeout: 20))
        let sort = sortControl()
        let face = "\(sort.label) \(sort.value as? String ?? "")"
        XCTAssertTrue(
            face.localizedCaseInsensitiveContains("Recenti"),
            "the sort control must show the active order without being opened, got: \(face)"
        )
    }

    // MARK: - Il giro completo, sullo stesso codice per iPhone e iPad

    /// Opens every clinical surface on whichever idiom is running and requires
    /// each one to render.
    ///
    /// Deliberately not skipped on either idiom: the point is that the same
    /// sweep passes on both, which is the only way "universal app" means
    /// anything. The iPad half was previously unreachable because the sidebar
    /// starts hidden, so these surfaces had never been opened by a test there.
    func testEveryClinicalSurfaceOpensOnThisIdiom() throws {
        launch(seedPatients: true)
        XCTAssertTrue(sectionView("clinical-workspace-patients-view").waitForExistence(timeout: 20))

        for surface in Self.clinicalSurfaces {
            XCTAssertTrue(
                openSection(surface.label),
                "\(surface.label) non e raggiungibile su questo idioma"
            )
            XCTAssertTrue(
                sectionView(surface.identifier).waitForExistence(timeout: 15),
                "\(surface.label) non ha reso la sua vista (\(surface.identifier))"
            )
            attachScreenshot(named: "superficie-\(surface.label)")
        }
    }

    // @Codex
    func testAccessibilityAuditCoversWorklistAndAgenda() throws {
        // Let XCTest vary Dynamic Type during the accessibility audit. The
        // debug AX5 override belongs to the dedicated layout tests; here it
        // would make the audit's Dynamic Type result non-probative.
        launch(seedPatients: true, singlePatient: true)
        XCTAssertTrue(sectionView("clinical-workspace-patients-view").waitForExistence(timeout: 20))

        let firstPatientRow = app.buttons["patient-cell-uitest-1"]
        let secondPatientRow = app.buttons["patient-cell-uitest-2"]
        XCTAssertTrue(firstPatientRow.waitForExistence(timeout: 15))
        XCTAssertTrue(secondPatientRow.waitForNonExistence(timeout: 5))
        XCTAssertTrue(firstPatientRow.isHittable, "the seeded patient row must be operable before audit")

        let status = sectionView("workspace-status-message")
        XCTAssertTrue(status.waitForExistence(timeout: 5))
        XCTAssertTrue(status.isHittable, "the operational status must be visible before audit")
        let window = app.windows.firstMatch
        XCTAssertGreaterThanOrEqual(status.frame.minY, window.frame.minY)
        XCTAssertLessThanOrEqual(status.frame.maxY, window.frame.maxY)

        let ambulatoryScopePicker = app.buttons["ambulatory-scope-picker"]
        XCTAssertTrue(ambulatoryScopePicker.waitForExistence(timeout: 5))
        XCTAssertTrue(ambulatoryScopePicker.isHittable)
        try app.performAccessibilityAudit()

        XCTAssertTrue(openSection("Agenda"), "Agenda non e raggiungibile per l'audit accessibilita")
        XCTAssertTrue(sectionView("clinical-workspace-agenda-view").waitForExistence(timeout: 15))
        try app.performAccessibilityAudit()
    }

    /// The three cross-patient views must say something true about themselves,
    /// whatever state they are in.
    ///
    /// This is the coverage that was missing. The suite asserted that the
    /// containers existed and never what they contained, which is how a build
    /// shipped where the Agenda stated "Nessuna visita pianificata." without
    /// having read the archive at all: 32 tests passed with a false sentence
    /// about a clinical diary on screen.
    ///
    /// So the requirement here is not "shows rows". It is: never claim an empty
    /// result while the archive has not been read. Without a home base the
    /// honest sentence is the one about connecting; the empty-result sentence
    /// belongs only after a read that returned nothing.
    func testCrossPatientViewsNeverClaimAnEmptyArchiveTheyHaveNotRead() throws {
        launch(seedPatients: true)
        XCTAssertTrue(sectionView("clinical-workspace-patients-view").waitForExistence(timeout: 20))

        openSection("Agenda")
        XCTAssertTrue(sectionView("clinical-workspace-agenda-view").waitForExistence(timeout: 15))
        let agendaUnread = app.staticTexts["Collega l'home-base prima di caricare l'agenda."]
        if agendaUnread.waitForExistence(timeout: 5) {
            XCTAssertFalse(
                app.staticTexts["Nessuna visita pianificata."].exists,
                "L'agenda dichiara che non ci sono visite mentre dichiara anche di non avere letto l'archivio"
            )
        }

        openSection("Diario")
        XCTAssertTrue(sectionView("clinical-workspace-diary-view").waitForExistence(timeout: 15))
        let diaryUnread = app.staticTexts["Collega l'home-base prima di caricare il diario globale."]
        if diaryUnread.waitForExistence(timeout: 5) {
            XCTAssertFalse(
                app.staticTexts["Nessuna voce di diario."].exists,
                "Il diario dichiara di essere vuoto mentre dichiara anche di non avere letto l'archivio"
            )
            XCTAssertFalse(
                app.staticTexts["0 voci attive, 0 pazienti"].exists,
                "Il diario conta voci e pazienti senza avere letto"
            )
        }

        openSection("Analytics")
        XCTAssertTrue(sectionView("clinical-workspace-analytics-view").waitForExistence(timeout: 15))
        // Analytics used to render nothing at all without a connection: the age
        // steppers and no statement underneath them. Something must be said.
        let analyticsSaysSomething = app.staticTexts.count > 0
        XCTAssertTrue(analyticsSaysSomething, "Analytics non dice nulla sul perche non ci siano numeri")
    }

    func testTabBarNavigatesBetweenSections() throws {
        /* La meta speculare della matrice adattiva. I quattro contratti solo-iPad
           si auto-saltano su iPhone; questi cinque pretendono il cromo compatto,
           cioe la tab bar mobile e il menu Progetto che vive solo nel ramo TabView,
           e su iPad quel cromo non esiste per scelta dichiarata (#142): li la
           navigazione e una NavigationSplitView con la sidebar. Un test che lo
           pretende su iPad asserisce l opposto del progetto. La copertura iPad
           equivalente esiste gia in testEveryClinicalSurfaceOpensOnThisIdiom, che
           gira su entrambi gli idiomi. */
        try XCTSkipUnless(UIDevice.current.userInterfaceIdiom == .phone, "compact-only layout contract")
        launch()
        XCTAssertTrue(sectionView("clinical-workspace-patients-view").waitForExistence(timeout: 20))

        tab("Agenda").tap()
        XCTAssertTrue(
            sectionView("clinical-workspace-agenda-view").waitForExistence(timeout: 10),
            "Tapping Agenda should show the cross-patient agenda"
        )

        tab("Diario").tap()
        XCTAssertTrue(
            sectionView("clinical-workspace-diary-view").waitForExistence(timeout: 10),
            "Tapping Diario should show the global clinical diary"
        )

        tab("Pazienti").tap()
        XCTAssertTrue(
            sectionView("clinical-workspace-patients-view").waitForExistence(timeout: 10),
            "Tapping Pazienti should return to the patient workspace"
        )
    }

    /* @Codex */
    func testPatientsSectionKeepsConnectionFormBehindSetupSheet() {
        launch()
        XCTAssertTrue(sectionView("clinical-workspace-patients-view").waitForExistence(timeout: 10))

        XCTAssertTrue(
            sectionView("homebase-connection-banner").waitForExistence(timeout: 10),
            "A blocking connection state should use a concise recovery banner"
        )
        XCTAssertFalse(
            app.textFields["homebase-server-url-field"].exists,
            "Connection credentials must not occupy the initial patient viewport"
        )
        attachScreenshot(named: "issue-143-blocked-banner")

        let setup = app.buttons["homebase-configuration-button"]
        XCTAssertTrue(setup.waitForExistence(timeout: 10))
        setup.tap()

        XCTAssertTrue(
            sectionView("homebase-configuration-sheet").waitForExistence(timeout: 10),
            "The setup action should open the system sheet"
        )
        XCTAssertTrue(app.textFields["homebase-server-url-field"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.secureTextFields["homebase-password-field"].exists)
        attachScreenshot(named: "issue-143-connection-sheet")

        let dissociate = app.buttons["homebase-clear-pairing-button"]
        for _ in 0..<8 where !dissociate.isHittable {
            app.swipeUp()
        }
        XCTAssertTrue(
            dissociate.isHittable,
            "Long setup content should remain reachable by scrolling, including at accessibility text sizes"
        )
        attachScreenshot(named: "issue-143-connection-sheet-bottom")

        let close = app.buttons["homebase-configuration-close-button"]
        XCTAssertTrue(close.waitForExistence(timeout: 10), "The setup sheet needs an accessible close action")
        close.tap()
        XCTAssertTrue(
            app.textFields["homebase-server-url-field"].waitForNonExistence(timeout: 5),
            "Closing setup should return to the patient home without leaving the form visible"
        )
    }

    /* @Codex */
    func testUsablePatientHomeShowsWorklistBeforeConnectionSetup() throws {
        /* La meta speculare della matrice adattiva. I quattro contratti solo-iPad
           si auto-saltano su iPhone; questi cinque pretendono il cromo compatto,
           cioe la tab bar mobile e il menu Progetto che vive solo nel ramo TabView,
           e su iPad quel cromo non esiste per scelta dichiarata (#142): li la
           navigazione e una NavigationSplitView con la sidebar. Un test che lo
           pretende su iPad asserisce l opposto del progetto. La copertura iPad
           equivalente esiste gia in testEveryClinicalSurfaceOpensOnThisIdiom, che
           gira su entrambi gli idiomi. */
        try XCTSkipUnless(UIDevice.current.userInterfaceIdiom == .phone, "compact-only layout contract")
        launch(seedPatients: true, section: "modules")
        XCTAssertTrue(sectionView("clinical-workspace-patients-view").waitForExistence(timeout: 20))

        XCTAssertTrue(app.buttons["new-patient-button"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["patient-cell-uitest-1"].waitForExistence(timeout: 10))
        XCTAssertTrue(sectionView("patient-view-mode").exists)
        // Search moved to the navigation bar: it must stay reachable from home,
        // and there must be exactly one way in.
        XCTAssertEqual(
            nativeSearchAffordances().count, 1,
            "exactly one native search affordance must be reachable from the patient home"
        )
        XCTAssertFalse(
            sectionView("homebase-connection-banner").exists,
            "A usable worklist should not show a technical connection banner"
        )
        XCTAssertFalse(
            app.textFields["homebase-server-url-field"].exists,
            "The credentials form should remain absent until setup is requested"
        )
        XCTAssertFalse(
            app.buttons["homebase-configuration-button"].exists,
            "A usable patient home should not add a connection action to the navigation bar"
        )
        attachScreenshot(named: "issue-143-usable-patient-home")

        let visibleTabs = app.tabBars.firstMatch.buttons.allElementsBoundByIndex
        XCTAssertEqual(visibleTabs.count, 5, "Compact navigation should expose four sections and system overflow")
        visibleTabs[4].tap()

        let overflowDestinations = app.tables.firstMatch.cells
        XCTAssertEqual(overflowDestinations.count, 2, "Compact overflow should contain Scale and Settings")
        overflowDestinations.element(boundBy: 1).tap()
        XCTAssertTrue(sectionView("clinical-workspace-settings-view").waitForExistence(timeout: 10))

        let connection = app.buttons["settings-mediflow-connection-button"]
        XCTAssertTrue(connection.waitForExistence(timeout: 10))
        attachScreenshot(named: "issue-143-settings-entry")
        connection.tap()
        XCTAssertTrue(app.textFields["homebase-server-url-field"].waitForExistence(timeout: 10))
    }

    func testPatientSearchFiltersTheList() {
        // Seed deterministic patients and open the workspace directly.
        launch(seedPatients: true, section: "modules")
        XCTAssertTrue(sectionView("clinical-workspace-patients-view").waitForExistence(timeout: 20))

        // Stable identifiers (not display text). Seed: 1=Rossi, 2=Bianchi, 3=Verdi(archived).
        let rossi = app.buttons["patient-cell-uitest-1"]
        let bianchi = app.buttons["patient-cell-uitest-2"]
        let verdi = app.buttons["patient-cell-uitest-3"]

        // Active filter: Rossi + Bianchi visible, archived Verdi hidden.
        XCTAssertTrue(rossi.waitForExistence(timeout: 10))
        XCTAssertTrue(bianchi.exists)
        XCTAssertTrue(verdi.waitForNonExistence(timeout: 3), "Archived patient should be hidden by the active filter")

        let search = openNativeSearchField()
        search.tap()
        // Focus is proved by the system presenting the keyboard, not by assuming
        // the tap landed.
        XCTAssertTrue(
            app.keyboards.element.waitForExistence(timeout: 5),
            "focusing the native search field must present the keyboard"
        )

        search.typeText("rossi")
        XCTAssertTrue(rossi.waitForExistence(timeout: 5), "the matching patient must remain")
        XCTAssertTrue(
            bianchi.waitForNonExistence(timeout: 5),
            "Search should filter out non-matching patients"
        )

        // Clearing by keyboard rather than by a localized button label.
        search.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 5))
        XCTAssertTrue(rossi.waitForExistence(timeout: 5), "clearing the query must restore the list")
        XCTAssertTrue(bianchi.waitForExistence(timeout: 5), "clearing the query must restore the list")
    }

    /* @Codex */
    func testActivePatientRowShowsSourceOrderedDiagnosisSummaryAndOmitsMalformedData() {
        launch(seedPatients: true, section: "modules")
        XCTAssertTrue(sectionView("clinical-workspace-patients-view").waitForExistence(timeout: 20))

        let diagnosis = sectionView("patient-cell-diagnosis-uitest-1")
        XCTAssertTrue(diagnosis.waitForExistence(timeout: 10))
        for _ in 0..<12 where !diagnosis.isHittable {
            app.swipeUp()
        }
        XCTAssertTrue(diagnosis.isHittable, "The diagnosis summary should be visible in the worklist")
        let tabBar = app.tabBars.firstMatch
        if tabBar.exists, diagnosis.frame.maxY > tabBar.frame.minY {
            let dragStart = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.72))
            let dragEnd = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.55))
            dragStart.press(forDuration: 0.1, thenDragTo: dragEnd)
        }
        if tabBar.exists {
            XCTAssertLessThanOrEqual(
                diagnosis.frame.maxY,
                tabBar.frame.minY,
                "The diagnosis summary should remain fully above the floating tab bar at AX5"
            )
        }
        XCTAssertTrue(diagnosis.label.contains("E11.9 - Diabete tipo 2"))
        let patientRow = app.buttons["patient-cell-uitest-1"]
        XCTAssertTrue(
            patientRow.label.contains("Un'altra diagnosi registrata"),
            "Unexpected patient-row accessibility label: \(patientRow.label)"
        )
        XCTAssertFalse(sectionView("patient-cell-diagnosis-uitest-2").exists)
        let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        screenshot.name = "active-patient-diagnosis-summary"
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }

    func testSelectingPatientShowsEnrichedDetail() {
        launch(seedPatients: true, section: "modules")
        XCTAssertTrue(sectionView("clinical-workspace-patients-view").waitForExistence(timeout: 20))

        let rossi = app.buttons["patient-cell-uitest-1"]
        XCTAssertTrue(rossi.waitForExistence(timeout: 10))
        rossi.tap()
        XCTAssertTrue(
            rossi.isSelected,
            "The selected patient row should expose its state without a decorative chevron"
        )
        attachScreenshot(named: "issue-145-selected-patient")

        if UIDevice.current.userInterfaceIdiom == .phone {
            let tree = XCTAttachment(string: app.debugDescription)
            tree.name = "tree-after-selecting-patient"
            tree.lifetime = .keepAlways
            add(tree)

            // Restricted to buttons on purpose: an earlier revision resolved this
            // identifier to an inert StaticText, which let the test "pass" while
            // tapping nothing. If the identifier ever lands on a non-interactive
            // node again, this query finds nothing and the gate fails.
            // Exact identifier, no predicate and no firstMatch: the query must
            // resolve one element and only one. The workspace ancestor is now an
            // accessibility container, so it no longer propagates its identifier
            // onto this control.
            let disclosureQuery = app.buttons.matching(identifier: "patient-compact-header-disclosure")
            XCTAssertTrue(
                disclosureQuery.element.waitForExistence(timeout: 5),
                "the chart header must expose its disclosure as an interactive button"
            )
            XCTAssertEqual(
                disclosureQuery.count, 1,
                "patient-compact-header-disclosure must identify exactly one button, got \(disclosureQuery.count)"
            )
            let disclosure = disclosureQuery.element
            XCTAssertEqual(disclosure.elementType, .button, "the locator must resolve the interactive control")
            XCTAssertTrue(disclosure.isHittable, "the disclosure control must be hittable")
            XCTAssertTrue(
                disclosure.label.contains("Rossi Mario"),
                "the disclosure must announce the open patient, got: \(disclosure.label)"
            )

            // Expansion is proved by the exact revealed child, again by identifier
            // and again required to be unique.
            let taxCodeQuery = app.staticTexts.matching(identifier: "patient-compact-header-taxcode")
            XCTAssertEqual(taxCodeQuery.count, 0, "the identity block starts collapsed")

            disclosure.tap()
            let expandedTree = XCTAttachment(string: app.debugDescription)
            expandedTree.name = "tree-after-expanding-disclosure"
            expandedTree.lifetime = .keepAlways
            add(expandedTree)
            XCTAssertTrue(
                taxCodeQuery.element.waitForExistence(timeout: 5),
                "expanding must reveal the identity block"
            )
            XCTAssertEqual(
                taxCodeQuery.count, 1,
                "patient-compact-header-taxcode must identify exactly one element, got \(taxCodeQuery.count)"
            )

            disclosure.tap()
            XCTAssertTrue(
                taxCodeQuery.element.waitForNonExistence(timeout: 5),
                "collapsing must hide it again"
            )

            // Continuity: operating the disclosure must not disturb the open
            // chart or the list selection behind it.
            XCTAssertTrue(rossi.isSelected, "the patient must stay selected across disclosure use")
            XCTAssertTrue(
                sectionView("patient-detail-name").exists,
                "the open chart must survive expanding and collapsing the header"
            )
        }

        // Detail renders the name and the decoded exemptions (ExemptionCodesCodec).
        XCTAssertTrue(sectionView("patient-detail-name").waitForExistence(timeout: 10),
                      "Selecting a patient should show the enriched detail")
        XCTAssertTrue(sectionView("patient-detail-exemptions").waitForExistence(timeout: 10),
                      "Detail should show decoded exemption codes")
        XCTAssertTrue(sectionView("patient-detail-diagnoses").waitForExistence(timeout: 10),
                      "Detail should show decoded diagnoses")
        XCTAssertTrue(sectionView("patient-detail-ai-summary").waitForExistence(timeout: 10),
                      "Detail should show the AI insight summary when present")
    }

    /* @Codex */
    func testPatientSortMenuUsesReadableLabelAndChangesOrder() {
        launch(seedPatients: true, section: "modules")
        XCTAssertTrue(sectionView("clinical-workspace-patients-view").waitForExistence(timeout: 20))

        let sortMenu = sortControl()
        XCTAssertTrue(
            sortMenu.label.localizedCaseInsensitiveContains("Ordina"),
            "The sort menu should describe its purpose instead of exposing only an icon"
        )
        XCTAssertEqual(
            sortMenu.value as? String, "Recenti",
            "the closed sort control must expose the active order as its value"
        )

        let rossi = app.buttons["patient-cell-uitest-1"]
        let bianchi = app.buttons["patient-cell-uitest-2"]
        XCTAssertTrue(rossi.waitForExistence(timeout: 10))
        XCTAssertTrue(bianchi.exists)
        XCTAssertLessThan(rossi.frame.minY, bianchi.frame.minY)

        sortMenu.tap()
        let alphabetical = app.buttons["Alfabetico"]
        XCTAssertTrue(alphabetical.waitForExistence(timeout: 5))
        alphabetical.tap()

        XCTAssertLessThan(
            bianchi.frame.minY,
            rossi.frame.minY,
            "Alphabetical sorting should move Bianchi before Rossi"
        )
        attachScreenshot(named: "issue-145-alphabetical-sort")
    }

    func testTherapyStatusFilterNarrowsList() {
        launch(seedPatients: true, section: "modules")
        XCTAssertTrue(sectionView("clinical-workspace-patients-view").waitForExistence(timeout: 20))

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
        XCTAssertTrue(sectionView("clinical-workspace-patients-view").waitForExistence(timeout: 20))

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
        XCTAssertTrue(sectionView("clinical-workspace-patients-view").waitForExistence(timeout: 20))

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
        XCTAssertTrue(sectionView("clinical-workspace-patients-view").waitForExistence(timeout: 20))

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

    /* @Codex */
    func testEditPatientFormDisablesLockedFieldWithoutShowingCiphertext() {
        launch(seedPatients: true, lockedPatientFields: true, section: "modules")
        XCTAssertTrue(sectionView("clinical-workspace-patients-view").waitForExistence(timeout: 20))
        app.buttons["patient-cell-uitest-1"].tap()
        XCTAssertTrue(sectionView("patient-detail-name").waitForExistence(timeout: 10))

        app.buttons["edit-patient-button"].tap()
        let address = app.textFields["edit-patient-address"]
        XCTAssertTrue(address.waitForExistence(timeout: 5))
        XCTAssertFalse(address.isEnabled)
        XCTAssertTrue(sectionView("edit-patient-locked-fields-message").exists)
        XCTAssertFalse(app.staticTexts["ENC:locked:uitest"].exists)
    }

    func testEditPatientFormArchivesPatient() {
        launch(seedPatients: true, section: "modules")
        XCTAssertTrue(sectionView("clinical-workspace-patients-view").waitForExistence(timeout: 20))

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
        XCTAssertTrue(sectionView("clinical-workspace-patients-view").waitForExistence(timeout: 20))

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
        XCTAssertTrue(sectionView("clinical-workspace-patients-view").waitForExistence(timeout: 20))
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
        XCTAssertTrue(sectionView("clinical-workspace-patients-view").waitForExistence(timeout: 20))

        let picker = app.buttons["ambulatory-scope-picker"]
        XCTAssertTrue(picker.waitForExistence(timeout: 10),
                      "The scope picker should appear once ambulatories are loaded")
        picker.tap()
        // Menu option label is the ambulatory name (distinct from the picker label).
        app.buttons["Ambulatorio Nord"].tap()

        XCTAssertTrue(app.staticTexts["Scope attivo: AMB-2."].waitForExistence(timeout: 5),
                      "Selecting an ambulatory should switch the active scope")
    }

    func testDetailShowsDocumentInsightsAndTherapyExport() {
        launch(seedPatients: true, section: "modules")
        XCTAssertTrue(sectionView("clinical-workspace-patients-view").waitForExistence(timeout: 20))
        let rossi = app.buttons["patient-cell-uitest-1"]
        XCTAssertTrue(rossi.waitForExistence(timeout: 10))
        rossi.tap()
        XCTAssertTrue(sectionView("patient-detail-name").waitForExistence(timeout: 20))

        // #3: the document-insights read panel renders when the field is present.
        XCTAssertTrue(scrollDown(to: sectionView("patient-detail-document-insights")),
                      "The document insights panel should render")

        // #5: the therapy-plan export (share) action is available with therapies.
        XCTAssertTrue(scrollDown(to: app.buttons["export-therapy-plan-button"]),
                      "The therapy plan export should be available")
    }

    func testEditPatientFormAddsDiagnosis() {
        launch(seedPatients: true, section: "modules")
        XCTAssertTrue(sectionView("clinical-workspace-patients-view").waitForExistence(timeout: 20))
        let rossi = app.buttons["patient-cell-uitest-1"]
        XCTAssertTrue(rossi.waitForExistence(timeout: 10))
        rossi.tap()
        XCTAssertTrue(sectionView("patient-detail-name").waitForExistence(timeout: 20))

        app.buttons["edit-patient-button"].tap()
        let code = app.textFields["new-diagnosis-code"]
        XCTAssertTrue(scrollDown(to: code), "The diagnosis editor should appear in the edit form")
        code.tap()
        code.typeText("J45")
        let description = app.textFields["new-diagnosis-description"]
        description.tap()
        description.typeText("Asma")
        app.buttons["add-diagnosis-button"].tap()
        app.buttons["save-patient-button"].tap()

        // The detail re-renders with the new diagnosis (existing one is preserved).
        XCTAssertTrue(app.staticTexts["J45 - Asma"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["E11.9 - Diabete tipo 2"].waitForExistence(timeout: 5),
                      "The pre-existing diagnosis must survive the round-trip")
    }

    func testScaleFormSubmitsAndAppearsInDiary() {
        launch(seedPatients: true, section: "modules")
        XCTAssertTrue(sectionView("clinical-workspace-patients-view").waitForExistence(timeout: 20))
        let rossi = app.buttons["patient-cell-uitest-1"]
        XCTAssertTrue(rossi.waitForExistence(timeout: 10))
        rossi.tap()
        XCTAssertTrue(sectionView("patient-detail-name").waitForExistence(timeout: 20))

        // Open the ADL scale form from the diary section header.
        let scaleButton = app.buttons["new-scale-button"]
        XCTAssertTrue(scrollDown(to: scaleButton), "The scale entry button should be available")
        scaleButton.tap()
        let adlOption = app.buttons["new-scale-option-adl"]
        XCTAssertTrue(adlOption.waitForExistence(timeout: 5), "The ADL scale option should be available")
        adlOption.tap()

        // The ADL form rendered: items + the live score (scoring is unit-tested).
        XCTAssertTrue(app.switches["scale-question-bath"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["scale-score"].exists, "The live score should be shown")
        app.switches["scale-question-bath"].tap()

        app.buttons["submit-scale-button"].tap()

        // The scale entry appears in the diary (seed short-circuit inserts it).
        XCTAssertTrue(app.staticTexts["ADL (Indice di Katz)"].waitForExistence(timeout: 5))
    }

    func testICDSearchAddsCodedDiagnosis() {
        launch(seedPatients: true, section: "modules")
        XCTAssertTrue(sectionView("clinical-workspace-patients-view").waitForExistence(timeout: 20))
        let rossi = app.buttons["patient-cell-uitest-1"]
        XCTAssertTrue(rossi.waitForExistence(timeout: 10))
        rossi.tap()
        XCTAssertTrue(sectionView("patient-detail-name").waitForExistence(timeout: 20))

        app.buttons["edit-patient-button"].tap()
        let icdSearch = app.textFields["icd-search-field"]
        XCTAssertTrue(scrollDown(to: icdSearch), "The in-app ICD search should be in the edit form")
        icdSearch.tap()
        icdSearch.typeText("ipertensione")

        // The in-app catalog returns I10 with no external dependency.
        let result = app.buttons["icd-result-I10"]
        XCTAssertTrue(result.waitForExistence(timeout: 5))
        result.tap()
        app.buttons["save-patient-button"].tap()

        // The coded diagnosis appears in the detail (existing one preserved).
        XCTAssertTrue(app.staticTexts["I10 - Ipertensione essenziale (primaria)"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["E11.9 - Diabete tipo 2"].waitForExistence(timeout: 5))
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
