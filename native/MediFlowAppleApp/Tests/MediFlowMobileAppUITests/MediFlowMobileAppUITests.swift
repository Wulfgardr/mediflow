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
        // @Codex: Layout/setup fixtures must not inherit a real interoperability pairing or cache.
        app.launchEnvironment["MEDIFLOW_APPLE_DEV_SKIP_KEYCHAIN"] = "1"
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

    /* @Codex: titles and picker ID match PatientWorkspaceSection and Workspace. */
    private enum PatientSection: String {
        case overview = "Scheda"
        case diary = "Diario clinico"
        case scales = "Scale cliniche"
        case therapies = "Terapie"
        case clinical = "Controlli e osservazioni"
        case prescriptions = "Prescrizioni"
        case documents = "Documenti"

        var identifier: String {
            switch self {
            case .overview: "overview"
            case .diary: "diary"
            case .scales: "scales"
            case .therapies: "therapies"
            case .clinical: "clinical"
            case .prescriptions: "prescriptions"
            case .documents: "documents"
            }
        }
    }

    private func openPatientSection(_ section: PatientSection, file: StaticString = #filePath, line: UInt = #line) {
        // @Codex: regular width has seven direct controls; compact/AX layouts
        // keep an accessible picker for destinations without a direct control.
        XCTAssertTrue(sectionView("patient-section-navigation").waitForExistence(timeout: 15), file: file, line: line)
        let directQuery = app.buttons.matching(identifier: "patient-section-\(section.identifier)")
        if directQuery.count > 0 {
            XCTAssertEqual(directQuery.count, 1, file: file, line: line)
            let direct = directQuery.element
            XCTAssertEqual(direct.label, section.rawValue, file: file, line: line)
            XCTAssertGreaterThanOrEqual(direct.frame.height, 44, file: file, line: line)
            XCTAssertGreaterThanOrEqual(direct.frame.width, 44, file: file, line: line)
            XCTAssertTrue(direct.isHittable, "The section action must stay reachable", file: file, line: line)
            if !direct.isSelected { direct.tap() }
            let selected = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in direct.isSelected }, object: direct)
            XCTAssertEqual(XCTWaiter.wait(for: [selected], timeout: 5), .completed,
                           "Direct navigation must announce the selected section", file: file, line: line)
        } else {
            let query = app.buttons.matching(identifier: "patient-section-picker")
            let picker = query.element
            XCTAssertTrue(picker.waitForExistence(timeout: 15), "The chart needs the compact section picker", file: file, line: line)
            XCTAssertEqual(query.count, 1, "There must be one patient section picker", file: file, line: line)
            XCTAssertGreaterThanOrEqual(picker.frame.height, 44, file: file, line: line)
            if picker.value as? String != section.rawValue {
                XCTAssertTrue(picker.isHittable, "The section picker must stay reachable", file: file, line: line)
                picker.tap()
                let options = app.buttons.matching(NSPredicate(format: "label == %@", section.rawValue))
                XCTAssertTrue(options.element.waitForExistence(timeout: 5), "Missing section option: \(section.rawValue)", file: file, line: line)
                XCTAssertEqual(options.count, 1, "The menu option must be unambiguous", file: file, line: line)
                options.element.tap()
            }
            let selected = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", section.rawValue), object: picker)
            XCTAssertEqual(XCTWaiter.wait(for: [selected], timeout: 5), .completed,
                           "The picker must announce the selected section", file: file, line: line)
        }
        if section == .overview {
            XCTAssertTrue(scrollDown(to: sectionView("patient-detail-name")),
                          "The selected patient's identity must remain readable", file: file, line: line)
        }
    }

    /* @Codex: compact navigation hides the worklist; assert its selection on return. */
    private func assertPatientRemainsSelected(_ row: XCUIElement, file: StaticString = #filePath, line: UInt = #line) {
        let destination = sectionView("patient-compact-detail-destination")
        if destination.exists {
            let back = app.navigationBars.buttons.element(boundBy: 0)
            XCTAssertTrue(back.isHittable, "The native chart destination needs a reachable back action", file: file, line: line)
            back.tap()
            XCTAssertTrue(destination.waitForNonExistence(timeout: 5), file: file, line: line)
            XCTAssertTrue(row.waitForExistence(timeout: 5), file: file, line: line)
            XCTAssertTrue(row.isSelected, "The patient must remain selected in the worklist", file: file, line: line)
            row.tap()
            openPatientSection(.overview, file: file, line: line)
        } else {
            XCTAssertTrue(row.isSelected, "The visible patient row must remain selected", file: file, line: line)
        }
    }

    /* @Codex: the synthetic fixture is loaded-empty, not an unread/error fallback. */
    private func assertLoadedEmptyDocuments(file: StaticString = #filePath, line: UInt = #line) {
        let empty = sectionView("documents-empty-state")
        XCTAssertTrue(scrollDown(to: empty), file: file, line: line)
        XCTAssertEqual(empty.label, "Nessun documento caricato per questo paziente.", file: file, line: line)
        XCTAssertFalse(sectionView("documents-loading-state").exists, file: file, line: line)
        XCTAssertFalse(sectionView("documents-read-state").exists, file: file, line: line)
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

    /* @Codex */
    func testPairedStatusIsVisibleAndReachableWithSyntheticPatients() throws {
        launch(seedPatients: true)

        let status = sectionView("mobile-paired-status")
        XCTAssertTrue(status.waitForExistence(timeout: 20))
        XCTAssertGreaterThanOrEqual(status.frame.height, 44)
        XCTAssertFalse(status.value as? String == "")

        let configure = app.buttons["Configura"]
        XCTAssertTrue(configure.waitForExistence(timeout: 10))
        XCTAssertGreaterThanOrEqual(configure.frame.height, 44)
        attachScreenshot(named: UIDevice.current.userInterfaceIdiom == .pad
            ? "WUL-556-iPad-Guardia-Carta"
            : "WUL-556-iPhone-Guardia-Carta")
    }

    /// The paired state must not displace the first worklist row when the
    /// compact iPhone workspace recomposes for landscape.
    /* @Codex */
    func testPairedStatusKeepsFirstPatientReachableAcrossIPhoneRotation() throws {
        try XCTSkipUnless(UIDevice.current.userInterfaceIdiom == .phone, "iPhone-only first-viewport contract")
        launch(seedPatients: true, section: "modules")
        XCUIDevice.shared.orientation = .portrait

        let workspace = sectionView("clinical-workspace-patients-view")
        XCTAssertTrue(workspace.waitForExistence(timeout: 20))
        let window = app.windows.firstMatch
        let tabBar = app.tabBars.firstMatch
        let firstRow = app.buttons["patient-cell-uitest-1"]
        XCTAssertTrue(firstRow.waitForExistence(timeout: 15))
        XCTAssertTrue(firstRow.isHittable, "the first patient must start reachable in portrait")
        attachScreenshot(named: "WUL-556-F01-iPhone-portrait-before")

        XCUIDevice.shared.orientation = .landscapeLeft
        let landscapeCompleted = XCTNSPredicateExpectation(
            predicate: NSPredicate { object, _ in
                guard let element = object as? XCUIElement else { return false }
                return element.frame.width > element.frame.height
            },
            object: window
        )
        XCTAssertEqual(
            XCTWaiter.wait(for: [landscapeCompleted], timeout: 10),
            .completed,
            "the iPhone must complete the landscape transition"
        )

        XCTAssertTrue(firstRow.waitForExistence(timeout: 10))
        attachScreenshot(named: "WUL-556-F01-iPhone-landscape-before")
        XCTAssertTrue(tabBar.waitForExistence(timeout: 10))
        let landscapeGeometry = """
        viewport:  \(window.frame)
        first row: \(firstRow.frame)
        tab bar:   \(tabBar.frame)
        """
        let landscapeGeometryEvidence = XCTAttachment(string: landscapeGeometry)
        landscapeGeometryEvidence.name = "WUL-556-F01-iPhone-landscape-geometry"
        landscapeGeometryEvidence.lifetime = .keepAlways
        add(landscapeGeometryEvidence)
        XCTAssertTrue(firstRow.isHittable, "the first patient must remain reachable in landscape")
        XCTAssertLessThanOrEqual(
            firstRow.frame.maxY,
            window.frame.maxY,
            "the first patient row must not extend below the landscape viewport"
        )
        XCTAssertLessThanOrEqual(
            firstRow.frame.maxY,
            tabBar.frame.minY,
            "the first patient row must clear the landscape tab bar. \(landscapeGeometry)"
        )

        firstRow.tap()
        openPatientSection(.overview)
        XCTAssertTrue(sectionView("patient-detail-name").waitForExistence(timeout: 15))
        XCUIDevice.shared.orientation = .portrait
        XCTAssertTrue(
            sectionView("patient-detail-name").waitForExistence(timeout: 15),
            "selecting a patient must survive the return to portrait"
        )
        attachScreenshot(named: "WUL-556-F01-iPhone-portrait-selection")
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
        openPatientSection(.overview)
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
        openPatientSection(.overview)
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

    /* @Codex */
    func testCompactClinicalTabsExposeStableIdentifiers() throws {
        launch(seedPatients: true)

        let tabBar = app.tabBars.firstMatch
        guard tabBar.waitForExistence(timeout: 10) else {
            throw XCTSkip("Il layout regolare iPad usa la sidebar, non la tab bar compatta.")
        }

        let compactTabIdentifiers = [
            "clinical-workspace-section-patients-button",
            "clinical-workspace-section-agenda-button",
            "clinical-workspace-section-diary-button",
            "clinical-workspace-section-analytics-button",
        ]
        let identifierQuery = tabBar.descendants(matching: .any).matching(
            NSPredicate(format: "identifier IN %@", compactTabIdentifiers)
        )
        XCTAssertEqual(
            identifierQuery.count,
            compactTabIdentifiers.count,
            "La snapshot AX deve esporre una sola tab per ciascun identifier clinico compatto."
        )
    }

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

        // @Codex: the mobile recovery surface owns its native Configura action.
        let status = sectionView("mobile-paired-status")
        XCTAssertTrue(status.waitForExistence(timeout: 10),
                      "A blocking connection state should use a concise recovery banner")
        XCTAssertTrue(status.staticTexts["Home-base non configurato"].exists)
        XCTAssertFalse(
            app.textFields["homebase-server-url-field"].exists,
            "Connection credentials must not occupy the initial patient viewport"
        )
        attachScreenshot(named: "issue-143-blocked-banner")

        let setupQuery = status.buttons.matching(NSPredicate(format: "label == %@", "Configura"))
        let setup = setupQuery.element
        XCTAssertTrue(setup.waitForExistence(timeout: 10))
        XCTAssertEqual(setupQuery.count, 1, "The recovery surface must expose one configuration action")
        XCTAssertTrue(setup.isHittable)
        XCTAssertGreaterThanOrEqual(setup.frame.height, 44)
        XCTAssertGreaterThanOrEqual(setup.frame.width, 44)
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
        openPatientSection(.overview)
        assertPatientRemainsSelected(rossi)
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
            assertPatientRemainsSelected(rossi)
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
        openPatientSection(.therapies)

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
        openPatientSection(.clinical)

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
        openPatientSection(.diary)

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

    /* @Codex: run unchanged on both iPhone and iPad; each section has its own content. */
    func testPatientSectionsKeepNavigationAndContentDistinct() {
        launch(seedPatients: true, section: "modules")
        let patient = app.buttons["patient-cell-uitest-1"]
        XCTAssertTrue(patient.waitForExistence(timeout: 15))
        patient.tap()

        // @Codex: the expanded native disclosure exposes this Other container;
        // its three section links retain their own identifiers inside it.
        let contentsQuery = app.otherElements.matching(identifier: "patient-chart-contents-disclosure")
        let contents = contentsQuery.element
        openPatientSection(.overview)
        XCTAssertFalse(contents.exists, "Optional collection summaries must start behind their disclosure")
        let contentsDisclosure = app.buttons.matching(identifier: "patient-chart-contents-disclosure")
        XCTAssertTrue(contentsDisclosure.element.waitForExistence(timeout: 10))
        XCTAssertEqual(contentsDisclosure.count, 1, "The collection summary must have one interactive disclosure")
        XCTAssertTrue(revealInteropControl(contentsDisclosure.element))
        contentsDisclosure.element.tap()
        XCTAssertTrue(contents.waitForExistence(timeout: 15))
        XCTAssertEqual(contentsQuery.count, 1, "One expanded collection summary must contain the section links")
        for (raw, title) in [("diary", "Diario clinico"), ("therapies", "Terapie"), ("clinical", "Controlli e osservazioni")] {
            let links = app.buttons.matching(identifier: "patient-open-section-\(raw)")
            XCTAssertTrue(links.element.waitForExistence(timeout: 5))
            XCTAssertEqual(links.count, 1, "The overview container must preserve each link's identifier")
            XCTAssertTrue(links.element.label.contains(title))
        }
        let diaryLink = app.buttons["patient-open-section-diary"]
        XCTAssertTrue(scrollDown(to: diaryLink, requireHittable: true))
        diaryLink.tap()
        openPatientSection(.diary)
        XCTAssertTrue(sectionView("entry-row-entry-note").waitForExistence(timeout: 10))
        XCTAssertFalse(contents.exists)
        attachScreenshot(named: "mobile-harmonization-diary-navigation")

        openPatientSection(.scales)
        XCTAssertTrue(app.buttons["scale-library-row-adl"].waitForExistence(timeout: 10))
        XCTAssertFalse(sectionView("entry-row-entry-note").exists)

        openPatientSection(.therapies)
        XCTAssertTrue(sectionView("therapy-row-therapy-active").waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["scale-library-row-adl"].exists)

        openPatientSection(.clinical)
        XCTAssertTrue(sectionView("checkup-row-checkup-pending").waitForExistence(timeout: 10))
        XCTAssertFalse(sectionView("therapy-row-therapy-active").exists)

        openPatientSection(.prescriptions)
        XCTAssertTrue(app.textFields["new-service-name"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Nessuna prestazione registrata."].exists)
        XCTAssertFalse(sectionView("checkup-row-checkup-pending").exists)
        let savePrescription = app.buttons["create-service-prescription-button"]
        XCTAssertTrue(scrollDown(to: savePrescription))
        XCTAssertFalse(savePrescription.isEnabled, "An empty prescription must not become writable after navigation")

        openPatientSection(.documents)
        assertLoadedEmptyDocuments()
        XCTAssertFalse(app.textFields["new-service-name"].exists)

        openPatientSection(.overview)
        XCTAssertTrue(sectionView("patient-detail-name").label.contains("Rossi"))
        XCTAssertTrue(sectionView("patient-detail-exemptions").exists)
        XCTAssertFalse(sectionView("documents-empty-state").exists)
    }

    /* @Codex: synthetic draft only; no save, compute, recording or document import. */
    func testDiaryDraftSurvivesDocumentsRoundTripWithProgressiveTools() {
        launch(seedPatients: true, section: "modules")
        let patient = app.buttons["patient-cell-uitest-1"]
        XCTAssertTrue(patient.waitForExistence(timeout: 15))
        patient.tap()
        openPatientSection(.diary)

        let openEntry = app.buttons["homebase-open-new-entry-button"]
        let title = app.textFields["homebase-new-entry-title-field"]
        let entryType = app.buttons["homebase-new-entry-type-picker"]
        let addParagraph = app.buttons["homebase-new-entry-content-add-paragraph"]
        // .contain exposes the disclosure ID on Other; its labelled child is the button.
        let attachmentContainerID = "homebase-new-entry-attachments-disclosure"
        let attachmentContainers = app.descendants(matching: .any).matching(identifier: attachmentContainerID)
        let attachmentButtons = sectionView(attachmentContainerID).buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Allegati · "))
        let attachments = attachmentButtons.element
        let emptyAttachments = sectionView("homebase-new-entry-attachments-empty-state")
        let openVisitDraft = app.buttons["homebase-open-visit-draft-button"]
        let transcript = app.textViews["visit-draft-transcript-field"]
        let draftTitle = "Bozza sintetica tra sezioni"
        let draftBody = "Testo sintetico da conservare nel diario"
        let draftTranscript = "Trascrizione sintetica ancora da rivedere"

        // @Codex: a device-orientation event alone does not prove that the
        // app window rotated. Record and await its geometry before reading the draft.
        func waitForDiaryOrientation(isLandscape: Bool) {
            let window = app.windows.firstMatch
            let orientationCompleted = XCTNSPredicateExpectation(
                predicate: NSPredicate { object, _ in
                    guard let element = object as? XCUIElement else { return false }
                    let frame = element.frame
                    return isLandscape ? frame.width > frame.height : frame.height > frame.width
                },
                object: window
            )
            let result = XCTWaiter.wait(for: [orientationCompleted], timeout: 10)
            let requested = isLandscape ? "landscape" : "portrait"
            let geometry = XCTAttachment(string: "requested: \(requested)\nwindow: \(window.frame)")
            geometry.name = "draft-\(requested)-window-geometry"
            geometry.lifetime = .keepAlways
            add(geometry)
            if result != .completed {
                attachScreenshot(named: "draft-\(requested)-rotation-incomplete")
            }
            XCTAssertEqual(result, .completed,
                           "The app window must complete the \(requested) transition before checking the draft")
        }

        // @Codex: ScrollView's AX frame extends behind the keyboard. Derive each
        // gesture from the visible diary gutter, so scrolling cannot type keys
        // or drag inside the nested text editor. Preserve focus and both directions.
        func revealDiaryControl(_ control: XCUIElement) -> Bool {
            guard control.waitForExistence(timeout: 5) else { return false }
            let scrollView = app.scrollViews.containing(.button, identifier: "entry-type-filter").element
            guard scrollView.exists else { return false }
            func unreachable() -> Bool {
                let evidence = XCTAttachment(string: app.debugDescription)
                evidence.name = "unreachable-diary-control-\(control.identifier)"
                evidence.lifetime = .keepAlways
                add(evidence)
                return false
            }
            for _ in 0..<12 {
                if control.isHittable { return true }
                let scrollFrame = scrollView.frame
                let viewport = scrollFrame.intersection(app.frame)
                let contentTop = max(viewport.minY, sectionView("patient-section-navigation").frame.maxY)
                var contentBottom = viewport.maxY
                // Keyboard excludes its prediction/accessory row in the actual AX tree.
                for overlay in [app.keyboards.firstMatch, app.otherElements["SystemInputAssistantView"], app.tabBars.firstMatch] where overlay.exists {
                    if overlay.frame.intersects(viewport) {
                        contentBottom = min(contentBottom, overlay.frame.minY)
                    }
                }
                guard viewport.width > 0, contentBottom > contentTop else { return unreachable() }
                let inset = min(12, (contentBottom - contentTop) / 4)
                let x = viewport.minX + min(12, viewport.width / 4) - scrollFrame.minX
                let upper = contentTop + inset - scrollFrame.minY
                let lower = contentBottom - inset - scrollFrame.minY
                let movingDown = control.frame.midY <= contentTop
                let origin = scrollView.coordinate(withNormalizedOffset: .zero)
                let start = origin.withOffset(CGVector(dx: x, dy: movingDown ? upper : lower))
                let end = origin.withOffset(CGVector(dx: x, dy: movingDown ? lower : upper))
                start.press(forDuration: 0.05, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: 0)
            }
            return control.isHittable || unreachable()
        }

        XCTAssertTrue(revealDiaryControl(openEntry))
        XCTAssertEqual(openEntry.label, "Nuova voce")
        XCTAssertFalse(title.exists, "The entry form starts closed")
        XCTAssertFalse(addParagraph.exists)
        XCTAssertFalse(transcript.exists)
        openEntry.tap()

        XCTAssertTrue(title.waitForExistence(timeout: 5))
        title.tap()
        title.typeText(draftTitle)
        XCTAssertTrue(revealDiaryControl(entryType))
        entryType.tap()
        let visit = app.buttons["Visita"]
        XCTAssertTrue(visit.waitForExistence(timeout: 5))
        visit.tap()
        XCTAssertEqual(entryType.label, "Tipo, Visita", "The native menu must announce the selected entry type")

        XCTAssertTrue(revealDiaryControl(addParagraph))
        addParagraph.tap()
        let paragraphs = app.textViews.matching(NSPredicate(format: "identifier BEGINSWITH %@", "homebase-new-entry-content-text-"))
        XCTAssertTrue(paragraphs.element.waitForExistence(timeout: 5))
        XCTAssertEqual(paragraphs.count, 1)
        let paragraphID = paragraphs.element.identifier
        let paragraph = app.textViews[paragraphID]
        XCTAssertTrue(revealDiaryControl(paragraph))
        paragraph.tap()
        paragraph.typeText(draftBody)
        XCTAssertEqual(paragraph.value as? String, draftBody)
        attachScreenshot(named: "mobile-harmonization-draft-keyboard-portrait")
        // @Codex: cross the actual adaptive layout with a populated draft. A
        // reconstructed progressive shell may require resuming, but cannot lose data.
        XCUIDevice.shared.orientation = .landscapeLeft
        waitForDiaryOrientation(isLandscape: true)
        openPatientSection(.diary)
        if !title.exists {
            XCTAssertTrue(revealDiaryControl(openEntry))
            XCTAssertEqual(openEntry.label, "Riprendi nuova voce")
            openEntry.tap()
        }
        XCTAssertEqual(title.value as? String, draftTitle)
        XCTAssertTrue(revealDiaryControl(paragraph))
        XCTAssertEqual(paragraph.value as? String, draftBody)
        XCTAssertEqual(paragraphs.count, 1)
        attachScreenshot(named: "mobile-harmonization-draft-keyboard-landscape")
        XCUIDevice.shared.orientation = .portrait
        waitForDiaryOrientation(isLandscape: false)
        openPatientSection(.diary)
        if !title.exists {
            XCTAssertTrue(revealDiaryControl(openEntry))
            XCTAssertEqual(openEntry.label, "Riprendi nuova voce")
            openEntry.tap()
        }
        XCTAssertTrue(revealDiaryControl(paragraph))
        XCTAssertEqual(paragraph.value as? String, draftBody)

        XCTAssertTrue(revealDiaryControl(attachments))
        XCTAssertEqual(attachmentContainers.count, 1)
        XCTAssertEqual(attachmentButtons.count, 1, "The disclosure must expose one interactive header")
        XCTAssertTrue(attachments.label.contains("Allegati · 0 selezionati"))
        XCTAssertFalse(emptyAttachments.exists, "Attachment references start collapsed")
        attachments.tap()
        XCTAssertTrue(scrollDown(to: emptyAttachments))
        XCTAssertTrue(emptyAttachments.label.contains("Nessun documento caricato per questo paziente da referenziare."))
        attachments.tap()
        XCTAssertTrue(emptyAttachments.waitForNonExistence(timeout: 5))

        XCTAssertTrue(revealDiaryControl(openVisitDraft))
        XCTAssertEqual(openVisitDraft.label, "Bozza da trascrizione")
        XCTAssertFalse(transcript.exists, "The transcript editor needs an explicit opening action")
        openVisitDraft.tap()
        XCTAssertTrue(revealDiaryControl(transcript))
        XCTAssertFalse(openVisitDraft.exists, "The opened visit composer has no destructive collapse action")
        transcript.tap()
        transcript.typeText(draftTranscript)
        XCTAssertEqual(transcript.value as? String, draftTranscript)

        openPatientSection(.documents)
        assertLoadedEmptyDocuments()
        XCTAssertFalse(title.exists)
        XCTAssertFalse(paragraph.exists)
        XCTAssertFalse(transcript.exists)

        openPatientSection(.diary)
        XCTAssertTrue(revealDiaryControl(openEntry))
        XCTAssertEqual(openEntry.label, "Riprendi nuova voce")
        XCTAssertFalse(title.exists, "Returning keeps the draft behind its resume action")
        XCTAssertFalse(transcript.exists)
        for id in ["entry-note", "entry-visit", "entry-phone"] {
            XCTAssertTrue(sectionView("entry-row-\(id)").exists, "Navigation must preserve the loaded diary records")
        }
        let diaryRowIDs = Set(app.descendants(matching: .any)
            .matching(NSPredicate(format: "identifier BEGINSWITH %@", "entry-row-"))
            .allElementsBoundByIndex.map { $0.identifier })
        XCTAssertEqual(diaryRowIDs, Set(["entry-row-entry-note", "entry-row-entry-visit", "entry-row-entry-phone"]),
                       "The unsaved draft must not add a diary record")
        openEntry.tap()
        XCTAssertTrue(title.waitForExistence(timeout: 5))
        XCTAssertEqual(title.value as? String, draftTitle)
        XCTAssertTrue(entryType.waitForExistence(timeout: 5))
        XCTAssertEqual(entryType.label, "Tipo, Visita", "The selected entry type must survive the documents round-trip")
        XCTAssertTrue(revealDiaryControl(paragraph))
        XCTAssertEqual(paragraphs.count, 1, "The same draft block must survive without duplication")
        XCTAssertEqual(paragraph.value as? String, draftBody)
        XCTAssertTrue(revealDiaryControl(attachments))
        XCTAssertEqual(attachmentContainers.count, 1)
        XCTAssertEqual(attachmentButtons.count, 1, "The resumed disclosure must expose one interactive header")
        XCTAssertTrue(attachments.label.contains("Allegati · 0 selezionati"))
        XCTAssertFalse(emptyAttachments.exists)
        XCTAssertTrue(revealDiaryControl(openVisitDraft))
        XCTAssertEqual(openVisitDraft.label, "Riprendi bozza da trascrizione")
        XCTAssertFalse(transcript.exists)
        openVisitDraft.tap()
        XCTAssertTrue(revealDiaryControl(transcript))
        XCTAssertEqual(transcript.value as? String, draftTranscript)
        XCTAssertFalse(openVisitDraft.exists)
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
        openPatientSection(.overview)

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
        openPatientSection(.overview)
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
        openPatientSection(.overview)

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
        // @Codex: verify the actual switch transition before relying on a saved flag.
        XCTAssertTrue(revealInteropControl(archived))
        let archivedControls = archived.children(matching: .switch)
        XCTAssertEqual(archivedControls.count, 1, "The archived row must expose one native switch")
        let archivedControl = archivedControls.element
        XCTAssertTrue(archivedControl.isHittable)
        func assertArchivedValue(_ expected: String) {
            let actual = archived.value as? String
            let controlValue = archivedControl.value as? String
            if actual != expected || controlValue != expected {
                let evidence = XCTAttachment(string: app.debugDescription)
                evidence.name = "archive-switch-expected-\(expected)"
                evidence.lifetime = .keepAlways
                add(evidence)
            }
            XCTAssertEqual(actual, expected, "Archiving must change the actual switch before saving")
            XCTAssertEqual(controlValue, expected, "The native switch and its labelled row must agree")
        }
        assertArchivedValue("0")
        archivedControl.tap()
        assertArchivedValue("1")

        // @Codex: a new archive needs an explicit reason, including inline edits.
        XCTAssertFalse(app.buttons["save-patient-button"].isEnabled)
        XCTAssertTrue(sectionView("patient-archive-validation").exists)
        selectInteropArchiveReason("Assegnato a MMG")
        tapInteropButton("save-patient-button")

        // The form dismisses and the detail re-renders with the archived flag chip.
        XCTAssertTrue(app.staticTexts["Archiviato"].waitForExistence(timeout: 5))
        tapInteropButton("edit-patient-button")
        assertInteropArchiveReason("Assegnato a MMG")
        tapInteropButton("cancel-patient-button")
    }

    func testObservationTrendIndicatorShowsForRepeatReading() {
        launch(seedPatients: true, section: "modules")
        XCTAssertTrue(sectionView("clinical-workspace-patients-view").waitForExistence(timeout: 20))

        let rossi = app.buttons["patient-cell-uitest-1"]
        XCTAssertTrue(rossi.waitForExistence(timeout: 10))
        rossi.tap()
        openPatientSection(.overview)
        XCTAssertTrue(sectionView("patient-detail-name").waitForExistence(timeout: 20))

        openPatientSection(.clinical)
        // Observations follow checkups in their own section; reveal each target.
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
        openPatientSection(.overview)
        XCTAssertTrue(sectionView("patient-detail-name").waitForExistence(timeout: 20))

        // #3: the document-insights read panel renders when the field is present.
        XCTAssertTrue(scrollDown(to: sectionView("patient-detail-document-insights")),
                      "The document insights panel should render")

        openPatientSection(.therapies)
        let overflow = app.buttons["therapy-actions-overflow"]
        if overflow.exists {
            XCTAssertTrue(scrollDown(to: overflow, requireHittable: true))
            overflow.tap()
        }
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
        openPatientSection(.overview)
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
        openPatientSection(.overview)
        XCTAssertTrue(sectionView("patient-detail-name").waitForExistence(timeout: 20))

        openPatientSection(.diary)
        // Open the ADL scale form from the diary section header.
        let scaleButton = app.buttons["new-scale-button"]
        XCTAssertTrue(scrollDown(to: scaleButton), "The scale entry button should be available")
        scaleButton.tap()
        let adlOption = app.buttons["new-scale-option-adl"]
        XCTAssertTrue(adlOption.waitForExistence(timeout: 5), "The ADL scale option should be available")
        adlOption.tap()

        // @Codex MF085-003: no first-option defaults; explicit zero is a real response.
        XCTAssertTrue(app.buttons["scale-question-bath"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["scale-incomplete"].exists)
        XCTAssertFalse(app.staticTexts["scale-score"].exists)
        XCTAssertFalse(app.buttons["submit-scale-button"].isEnabled)
        for (index, id) in ["bath", "dress", "toilet", "transfer", "cont", "feed"].enumerated() {
            let picker = app.buttons["scale-question-\(id)"]
            XCTAssertTrue(scrollDown(to: picker))
            picker.tap()
            app.buttons["Dipendente"].tap()
            if index < 5 {
                XCTAssertFalse(app.buttons["submit-scale-button"].isEnabled)
                XCTAssertFalse(app.staticTexts["scale-score"].exists)
            }
        }
        XCTAssertTrue(app.buttons["submit-scale-button"].isEnabled)
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
        openPatientSection(.overview)
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

    // @Codex: Observation only. Capture the actual native picker before choosing
    // its date-selection strategy; no save, production flags or guessed roles.
    func testObservePatientBirthDatePickerAccessibility() {
        launch(seedPatients: true, section: "modules")
        defer { app.terminate() }
        let patient = app.buttons["patient-cell-uitest-1"]
        XCTAssertTrue(patient.waitForExistence(timeout: 20))
        patient.tap()
        openPatientSection(.overview)
        tapInteropButton("edit-patient-button")
        let controls = app.descendants(matching: .any).matching(identifier: "edit-patient-birthDate")
        XCTAssertTrue(controls.element.waitForExistence(timeout: 10))
        XCTAssertEqual(controls.count, 1)
        XCTAssertTrue(revealInteropControl(controls.element))
        func capture(_ stage: String) {
            let tree = XCTAttachment(string: app.debugDescription)
            tree.name = "dob-picker-\(stage)-accessibility"
            tree.lifetime = .keepAlways
            add(tree)
            attachScreenshot(named: "dob-picker-\(stage)")
        }
        capture("before-open")
        controls.element.tap()
        capture("after-open")
    }

    // MARK: - Actual paired client / host interoperability (opt-in, no demo)

    /* @Codex: The descriptor is supplied to the test runner in a private xctestrun.
       These tests are deliberately separate from launch(seedPatients:), because
       ordinary pairing/cache and the real HTTPS transport are part of the proof. */
    private struct InteropInput: Decodable {
        struct Host: Decodable { let os: String; let sourceCommit: String; let httpsURL: String; let tlsPinSHA256: String }
        struct Operator: Decodable { let username: String; let pin: String; let ambulatoryId: String }
        struct Patient: Decodable { let id: String; let firstName: String; let lastName: String }
        struct Client: Decodable { let id: String; let token: String }
        struct PreviousPairing: Decodable { let serverURL: String; let id: String }
        struct CASCase: Decodable {
            let schemaVersion: Int
            let synthetic: Bool
            let fixtureId: String
            let groupID: String
            let patientId: String
            let entryID: String
            let baseVersion: Int
            let baseTitle: String
            let baseBody: String
            let baseType: String

            func title(_ role: String) -> String { "CAS \(role) \(groupID)" }
            func body(_ role: String) -> String { "Paragrafo sintetico \(role) \(groupID)" }
            func fields(_ role: String? = nil) -> [String: String] {
                func paragraph(_ text: String) -> String {
                    "<p>" + text.replacingOccurrences(of: "&", with: "&amp;")
                        .replacingOccurrences(of: "<", with: "&lt;") + "</p>"
                }
                let content = paragraph(baseBody) + (role.map { paragraph(body($0)) } ?? "")
                return ["title": role.map { title($0) } ?? baseTitle, "content": content, "type": baseType]
            }
        }
        let schemaVersion: Int
        let synthetic: Bool
        let fixtureId: String
        let runID: String
        let clientPlatform: String
        let host: Host
        let operatorInfo: Operator
        let patient: Patient
        let client: Client
        let expectedAddress: String?
        let expectedDiaryTitle: String?
        let expectedDiaryID: String?
        let expectedPopulationInRange: Int?
        let previousPairings: [PreviousPairing]?
        let cas: CASCase?

        enum CodingKeys: String, CodingKey {
            case schemaVersion, synthetic, fixtureId, runID, clientPlatform, host, patient, client
            case expectedAddress, expectedDiaryTitle, expectedDiaryID, expectedPopulationInRange, previousPairings
            case cas
            case operatorInfo = "operator"
        }
        var writeAddress: String { "Via Interop \(runID) \(clientPlatform)" }
        var writeTitle: String { "Interop \(runID) \(clientPlatform)" }
        var writeBody: String { "Testo sintetico completo per la verifica tra client e host." }
    }

    private func interopInput() throws -> InteropInput {
        guard let json = ProcessInfo.processInfo.environment["MEDIFLOW_INTEROP_INPUT"] else {
            throw XCTSkip("Actual host interoperability requires its explicit private descriptor; fixture runs are not pairing proof.")
        }
        let input = try JSONDecoder().decode(InteropInput.self, from: Data(json.utf8))
        XCTAssertEqual(input.schemaVersion, 1)
        XCTAssertTrue(input.synthetic)
        XCTAssertEqual(input.clientPlatform, UIDevice.current.userInterfaceIdiom == .pad ? "ipados" : "ios")
        XCTAssertTrue(input.host.httpsURL.hasPrefix("https://"))
        XCTAssertEqual(input.host.sourceCommit.count, 40)
        XCTAssertEqual(input.host.tlsPinSHA256.count, 64)
        XCTAssertNotNil(input.runID.range(of: "^[A-Za-z0-9._-]{1,100}$", options: .regularExpression))
        return input
    }

    /// Uses the actual target frame and its enclosing scroll view, including
    /// recovery after a keyboard-sized viewport has been scrolled past the target.
    private func revealInteropControl(_ element: XCUIElement) -> Bool {
        guard element.waitForExistence(timeout: 15) else { return false }
        for _ in 0..<16 {
            // @Codex: a system Home gesture must fail, never count as revealing a control.
            guard app.state == .runningForeground else { return false }
            if element.isHittable { return true }
            let target = element.identifier.isEmpty ? element.label : element.identifier
            let containers = app.scrollViews.containing(element.elementType, identifier: target)
                .allElementsBoundByIndex.filter { $0.exists && $0.frame.height > 0 }
            guard let scroll = containers.min(by: { $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height }) else {
                return false
            }
            // @Codex: use the same measured gutter as the verified draft helper;
            // a generic swipe can hit the keyboard accessory or nested editor.
            let scrollFrame = scroll.frame
            let viewport = scrollFrame.intersection(app.frame)
            let navigation = sectionView("patient-section-navigation")
            var top = viewport.minY
            if navigation.exists && navigation.isHittable && navigation.frame.intersects(viewport) {
                top = max(top, navigation.frame.maxY)
            }
            let navigationBar = app.navigationBars.firstMatch
            if navigationBar.exists && navigationBar.frame.intersects(viewport) {
                top = max(top, navigationBar.frame.maxY)
            }
            var bottom = viewport.maxY
            for overlay in [app.keyboards.firstMatch, app.otherElements["SystemInputAssistantView"], app.tabBars.firstMatch] where overlay.exists {
                if overlay.frame.intersects(viewport) { bottom = min(bottom, overlay.frame.minY) }
            }
            guard viewport.width > 0, bottom > top else { return false }
            // @Codex: the iPad archive recording showed a 12pt bottom inset
            // opening Dock/App Switcher. Keep both endpoints inside the measured
            // unobscured viewport, including when the keyboard shortens it.
            let inset = min((bottom - top) / 4, max(24, (bottom - top) * 0.15))
            let x = viewport.minX + min(12, viewport.width / 4) - scrollFrame.minX
            let upper = top + inset - scrollFrame.minY
            let lower = bottom - inset - scrollFrame.minY
            let movingDown = element.frame.midY <= top
            let origin = scroll.coordinate(withNormalizedOffset: .zero)
            let start = origin.withOffset(CGVector(dx: x, dy: movingDown ? upper : lower))
            let end = origin.withOffset(CGVector(dx: x, dy: movingDown ? lower : upper))
            start.press(forDuration: 0.05, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: 0)
        }
        return app.state == .runningForeground && element.isHittable
    }

    private func fillInteropField(_ identifier: String, value: String, secure: Bool = false) {
        let field = secure ? app.secureTextFields[identifier] : app.textFields[identifier]
        XCTAssertTrue(revealInteropControl(field), "The connection/edit field must be reachable: \(identifier)")
        field.tap()
        if let existing = field.value as? String, existing != field.placeholderValue {
            field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: existing.count))
        }
        field.typeText(value)
        if !secure { XCTAssertEqual(field.value as? String, value) }
    }

    private func launchAndLoginInterop(_ input: InteropInput, useSavedPairing: Bool = false, fromRoot: Bool = false) {
        app.launchArguments = []
        app.launchEnvironment = [:]
        app.launch()
        if fromRoot {
            // @Codex: prove the ordinary first-open Configura path, without an
            // initial-section shortcut or an injected operator session.
            XCTAssertTrue(openSection("Pazienti"))
            let status = sectionView("mobile-paired-status")
            XCTAssertTrue(status.waitForExistence(timeout: 20))
            let configure = status.buttons.matching(NSPredicate(format: "label == %@", "Configura"))
            XCTAssertEqual(configure.count, 1)
            XCTAssertTrue(revealInteropControl(configure.element))
            configure.element.tap()
            loginInteropFromSettings(input, useSavedPairing: useSavedPairing, connectionAlreadyOpen: true)
        } else {
            XCTAssertTrue(openSection("Impostazioni"))
            loginInteropFromSettings(input, useSavedPairing: useSavedPairing)
        }
    }

    // @Codex: Local-lock recovery must reuse the running app. Launching again
    // would clear memory independently and conceal retained clinical drafts.
    private func loginInteropFromSettings(_ input: InteropInput, useSavedPairing: Bool, verifyClearBeforeRead: Bool = false,
                                         connectionAlreadyOpen: Bool = false) {
        let connection = app.buttons["settings-mediflow-connection-button"]
        if !connectionAlreadyOpen {
            XCTAssertTrue(sectionView("clinical-workspace-settings-view").waitForExistence(timeout: 20))
            XCTAssertTrue(revealInteropControl(connection))
            connection.tap()
        }
        let idField = app.textFields["homebase-paired-client-id-field"]
        XCTAssertTrue(idField.waitForExistence(timeout: 10))
        let savedIDValue = idField.value as? String ?? ""
        let savedID = savedIDValue == idField.placeholderValue ? "" : savedIDValue
        let serverField = app.textFields["homebase-server-url-field"]
        let savedServer = serverField.value as? String ?? ""
        if useSavedPairing {
            XCTAssertEqual(savedID, input.client.id, "The ordinary app must retain its own pairing across relaunch")
            XCTAssertEqual(savedServer, input.host.httpsURL)
            XCTAssertEqual(app.textFields["homebase-tls-pin-field"].value as? String, input.host.tlsPinSHA256)
        } else {
            let knownPairing = savedID == input.client.id && savedServer == input.host.httpsURL
                || (input.previousPairings ?? []).contains { $0.id == savedID && $0.serverURL == savedServer }
            XCTAssertTrue(savedID.isEmpty || knownPairing,
                          "Unexpected stored pairing: preserve it and stop; only this lane's synthetic pairings may be replaced")
            fillInteropField("homebase-server-url-field", value: input.host.httpsURL)
            fillInteropField("homebase-tls-pin-field", value: input.host.tlsPinSHA256)
            fillInteropField("homebase-paired-client-id-field", value: input.client.id)
            fillInteropField("homebase-paired-client-token-field", value: input.client.token, secure: true)
            fillInteropField("homebase-username-field", value: input.operatorInfo.username)
            fillInteropField("homebase-ambulatory-field", value: input.operatorInfo.ambulatoryId)
        }
        fillInteropField("homebase-password-field", value: input.operatorInfo.pin, secure: true)
        let login = app.buttons["homebase-login-button"]
        XCTAssertTrue(revealInteropControl(login))
        login.tap()
        let activeSession = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "label == %@", "Sessione operatore attiva."),
            object: app.staticTexts["homebase-status-message"]
        )
        XCTAssertEqual(XCTWaiter.wait(for: [activeSession], timeout: 30), .completed,
                       "Real operator login must also unlock field encryption")
        if verifyClearBeforeRead {
            app.buttons["homebase-configuration-close-button"].tap()
            XCTAssertTrue(openSection("Pazienti"))
            XCTAssertTrue(sectionView("clinical-workspace-patients-view").waitForExistence(timeout: 5))
            XCTAssertFalse(app.buttons["patient-cell-\(input.patient.id)"].exists,
                           "A new login must not restore the old patient list without a fresh read")
            XCTAssertFalse(sectionView("patient-detail-name").exists)
            XCTAssertFalse(sectionView("patient-cached-profile").exists)
            XCTAssertFalse(sectionView("homebase-new-entry-content-field").exists)
            XCTAssertFalse(sectionView("homebase-edit-entry-content-field").exists)
            XCTAssertTrue(openSection("Impostazioni"))
            XCTAssertTrue(revealInteropControl(connection))
            connection.tap()
        }
        let load = app.buttons["homebase-load-patients-button"]
        XCTAssertTrue(revealInteropControl(load))
        load.tap()
        let online = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "label CONTAINS %@", "pazienti caricati in lettura."),
            object: app.staticTexts["homebase-status-message"]
        )
        XCTAssertEqual(XCTWaiter.wait(for: [online], timeout: 30), .completed, "The app must read the actual host")
        app.buttons["homebase-configuration-close-button"].tap()
        XCTAssertTrue(openSection("Pazienti"))
        let patient = app.buttons["patient-cell-\(input.patient.id)"]
        XCTAssertTrue(patient.waitForExistence(timeout: 20))
        XCTAssertTrue(patient.label.contains(input.patient.lastName))
        XCTAssertTrue(revealInteropControl(patient))
        patient.tap()
        openPatientSection(.overview)
        XCTAssertTrue(sectionView("patient-detail-name").label.contains(input.patient.lastName))
    }

    private func assertInteropReread(_ input: InteropInput, address: String, title: String) {
        openPatientSection(.overview)
        XCTAssertTrue(app.staticTexts[address].waitForExistence(timeout: 15), "The real client must decrypt the persisted address")
        openPatientSection(.diary)
        let titleText = app.staticTexts.matching(NSPredicate(format: "label == %@", title))
        XCTAssertTrue(titleText.element.waitForExistence(timeout: 20))
        XCTAssertEqual(titleText.count, 1, "The saved entry must not be duplicated by refresh or relaunch")
        let entry = app.descendants(matching: .any)
            .matching(NSPredicate(format: "identifier BEGINSWITH %@", "entry-row-"))
            .containing(.staticText, identifier: title)
        XCTAssertEqual(entry.count, 1, "The title must identify one actual diary record")
        XCTAssertTrue(entry.element.staticTexts[input.writeBody].waitForExistence(timeout: 10),
                      "The selected persisted rich-text body must decrypt and render completely")
        attachScreenshot(named: "interop-\(input.host.os)-\(input.clientPlatform)-persisted-diary")
    }

    /* @Codex: Run once per actual host and idiom, then independently reread via web API and the other app. */
    func testRealPairedHostWorkflow() throws {
        let input = try interopInput()
        defer { app.terminate() }
        launchAndLoginInterop(input, fromRoot: true)
        if let address = input.expectedAddress, let title = input.expectedDiaryTitle {
            assertInteropReread(input, address: address, title: title)
            openPatientSection(.overview)
        }
        attachScreenshot(named: "interop-\(input.host.os)-\(input.clientPlatform)-host-patient")
        let edit = app.buttons["edit-patient-button"]
        XCTAssertTrue(revealInteropControl(edit))
        edit.tap()
        fillInteropField("edit-patient-address", value: input.writeAddress)
        let savePatient = app.buttons["save-patient-button"]
        XCTAssertTrue(revealInteropControl(savePatient))
        XCTAssertTrue(savePatient.isEnabled)
        savePatient.tap()
        XCTAssertTrue(app.staticTexts[input.writeAddress].waitForExistence(timeout: 20))

        openPatientSection(.diary)
        let openEntry = app.buttons["homebase-open-new-entry-button"]
        XCTAssertTrue(revealInteropControl(openEntry))
        XCTAssertFalse(app.textFields["homebase-new-entry-title-field"].exists)
        openEntry.tap()
        fillInteropField("homebase-new-entry-title-field", value: input.writeTitle)
        let addParagraph = app.buttons["homebase-new-entry-content-add-paragraph"]
        XCTAssertTrue(revealInteropControl(addParagraph))
        addParagraph.tap()
        let paragraphs = app.textViews.matching(NSPredicate(format: "identifier BEGINSWITH %@", "homebase-new-entry-content-text-"))
        XCTAssertTrue(paragraphs.element.waitForExistence(timeout: 10))
        XCTAssertEqual(paragraphs.count, 1)
        let paragraph = paragraphs.element
        let blockID = paragraph.identifier
        XCTAssertTrue(revealInteropControl(paragraph))
        paragraph.tap()
        paragraph.typeText(input.writeBody)
        XCTAssertEqual(paragraph.value as? String, input.writeBody)
        openPatientSection(.documents)
        XCTAssertFalse(app.textFields["homebase-new-entry-title-field"].exists)
        openPatientSection(.diary)
        XCTAssertTrue(revealInteropControl(openEntry))
        XCTAssertEqual(openEntry.label, "Riprendi nuova voce")
        openEntry.tap()
        XCTAssertEqual(app.textFields["homebase-new-entry-title-field"].value as? String, input.writeTitle)
        XCTAssertTrue(revealInteropControl(app.textViews[blockID]))
        XCTAssertEqual(app.textViews[blockID].value as? String, input.writeBody)
        let saveEntry = app.buttons["homebase-create-entry-button"]
        XCTAssertTrue(revealInteropControl(saveEntry))
        XCTAssertTrue(saveEntry.isEnabled, "A real writer grant, active session and unlocked key are required")
        saveEntry.tap()
        XCTAssertTrue(app.staticTexts[input.writeTitle].waitForExistence(timeout: 20))
        app.terminate()
        launchAndLoginInterop(input, useSavedPairing: true)
        assertInteropReread(input, address: input.writeAddress, title: input.writeTitle)
    }

    /* @Codex: Return the first client after the peer's write; no mutation in this phase. */
    func testRealPairedOtherClientReread() throws {
        let input = try interopInput()
        let address = try XCTUnwrap(input.expectedAddress, "The peer's exact persisted address is required")
        let title = try XCTUnwrap(input.expectedDiaryTitle, "The peer's exact persisted diary title is required")
        defer { app.terminate() }
        launchAndLoginInterop(input, useSavedPairing: true)
        assertInteropReread(input, address: address, title: title)
    }

    /* @Codex: This barrier lives in the test runner's own temporary directory.
       Only the fixture owner may produce the HTTP receipts. Neither the app
       nor its credentials, storage, API or clock acquire a test seam. */
    private struct InteropLockBarrier {
        struct Event: Decodable {
            let schemaVersion: Int
            let runId: String
            let fixtureId: String
            let event: String
            let requestID: String?
            let method: String?
            let path: String?
            let httpStatus: Int?
            let upstreamHttpStatus: Int?
            let serverLogoutCompleted: Bool?
            let responseForwarded: Bool?
            let heldUntilClientClearVerified: Bool?
            let clientDisconnectedBeforeRelease: Bool?
        }

        let directory: URL
        let runID: String
        let fixtureID: String

        init(runID: String, fixtureID: String) throws {
            self.runID = runID
            self.fixtureID = fixtureID
            directory = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
                .appendingPathComponent("mediflow-interop-\(runID)", isDirectory: true)
            XCTAssertFalse(FileManager.default.fileExists(atPath: directory.path),
                           "A lock run must never reuse stale barrier receipts")
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false,
                                                    attributes: [.posixPermissions: 0o700])
        }

        func emit(_ event: String, requestID: String? = nil) throws {
            var value: [String: Any] = [
                "schemaVersion": 1, "runId": runID, "fixtureId": fixtureID, "event": event,
                "method": "POST", "path": "/api/auth/native/logout",
            ]
            if let requestID { value["requestID"] = requestID }
            let data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
            let path = directory.appendingPathComponent("\(event).json").path
            XCTAssertFalse(FileManager.default.fileExists(atPath: path))
            let temporaryPath = directory.appendingPathComponent(".\(event)-\(UUID().uuidString).json").path
            XCTAssertTrue(FileManager.default.createFile(atPath: temporaryPath, contents: data,
                                                         attributes: [.posixPermissions: 0o600]))
            try FileManager.default.moveItem(atPath: temporaryPath, toPath: path)
        }

        func waitFor(_ name: String) throws -> Event {
            let url = directory.appendingPathComponent("\(name).json")
            let receipt = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                FileManager.default.fileExists(atPath: url.path)
            }, object: nil)
            XCTAssertEqual(XCTWaiter.wait(for: [receipt], timeout: 30), .completed,
                           "Missing actual fixture HTTP receipt: \(name)")
            let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
            XCTAssertEqual(attributes[.type] as? FileAttributeType, .typeRegular)
            let permissions = try XCTUnwrap(attributes[.posixPermissions] as? NSNumber)
            XCTAssertEqual(permissions.intValue & 0o777, 0o600)
            let event = try JSONDecoder().decode(Event.self, from: Data(contentsOf: url))
            XCTAssertEqual(event.schemaVersion, 1)
            XCTAssertEqual(event.runId, runID)
            XCTAssertEqual(event.fixtureId, fixtureID)
            XCTAssertEqual(event.event, name)
            XCTAssertEqual(event.method, "POST")
            XCTAssertEqual(event.path, "/api/auth/native/logout")
            return event
        }

        func assertStillHeld() {
            for name in ["logout-released", "logout-aborted"] {
                XCTAssertFalse(FileManager.default.fileExists(atPath: directory.appendingPathComponent("\(name).json").path),
                               "The clear must be observed before response release or client timeout")
            }
        }
    }

    /* @Codex: Positive data assertions precede the negative lock assertions.
       A fresh process or an already-empty fixture cannot satisfy this proof. */
    func testRealPairedLockClearsClinicalPresentationBeforeLogoutCompletes() throws {
        let input = try interopInput()
        let address = try XCTUnwrap(input.expectedAddress)
        let savedTitle = try XCTUnwrap(input.expectedDiaryTitle)
        let entryID = try XCTUnwrap(input.expectedDiaryID)
        let population = try XCTUnwrap(input.expectedPopulationInRange)
        XCTAssertFalse(address.isEmpty)
        XCTAssertFalse(savedTitle.isEmpty)
        XCTAssertFalse(entryID.isEmpty)
        XCTAssertGreaterThan(population, 0, "The analytics fixture must contain an in-range patient")
        let barrier = try InteropLockBarrier(runID: input.runID, fixtureID: input.fixtureId)
        addTeardownBlock { try? barrier.emit("test-finished") }
        defer { app.terminate() }
        let location = XCTAttachment(string: barrier.directory.path)
        location.name = "interop-lock-owner-barrier-directory"
        location.lifetime = .keepAlways
        add(location)
        launchAndLoginInterop(input)
        assertInteropReread(input, address: address, title: savedTitle)
        XCTAssertTrue(sectionView("entry-row-\(entryID)").exists)

        let analyticsFooter = "Le percentuali sono sui \(population) pazienti in fascia. Chi non ha una data di nascita resta fuori dalla fascia e non entra in quel conteggio."
        XCTAssertTrue(openSection("Diario"))
        XCTAssertTrue(sectionView("clinical-workspace-diary-view").waitForExistence(timeout: 10))
        let globalRow = sectionView("clinical-workspace-diary-row-\(entryID)")
        XCTAssertTrue(globalRow.waitForExistence(timeout: 20))
        XCTAssertTrue(globalRow.staticTexts[savedTitle].exists)
        XCTAssertTrue(globalRow.staticTexts[input.writeBody].exists, "The global diary must first expose the persisted body")
        attachScreenshot(named: "interop-lock-global-diary-populated")
        XCTAssertTrue(openSection("Analytics"))
        XCTAssertTrue(sectionView("clinical-workspace-analytics-view").waitForExistence(timeout: 10))
        let analyticsSummary = sectionView("clinical-workspace-analytics-summary")
        XCTAssertTrue(analyticsSummary.waitForExistence(timeout: 20))
        XCTAssertTrue(analyticsSummary.staticTexts["Pazienti in fascia"].exists)
        XCTAssertTrue(analyticsSummary.staticTexts.matching(NSPredicate(format: "label == %@", String(population))).firstMatch.exists)
        XCTAssertTrue(app.staticTexts[analyticsFooter].waitForExistence(timeout: 20),
                      "Expected host-derived population data must be present before lock")
        attachScreenshot(named: "interop-lock-analytics-populated")

        XCTAssertTrue(openSection("Pazienti"))
        if !sectionView("patient-section-navigation").exists {
            let patient = app.buttons["patient-cell-\(input.patient.id)"]
            XCTAssertTrue(revealInteropControl(patient))
            patient.tap()
        }
        openPatientSection(.diary)
        let newTitle = "Bozza nuova \(input.runID)"
        let newBody = "Corpo non salvato \(input.runID)"
        let editTitle = "Modifica non salvata \(input.runID)"
        let editBody = "Revisione non salvata \(input.runID)"
        let openEntry = app.buttons["homebase-open-new-entry-button"]
        XCTAssertTrue(revealInteropControl(openEntry))
        XCTAssertEqual(openEntry.label, "Nuova voce")
        openEntry.tap()
        fillInteropField("homebase-new-entry-title-field", value: newTitle)
        let add = app.buttons["homebase-new-entry-content-add-paragraph"]
        XCTAssertTrue(revealInteropControl(add))
        add.tap()
        let newParagraphs = app.textViews.matching(NSPredicate(format: "identifier BEGINSWITH %@", "homebase-new-entry-content-text-"))
        XCTAssertTrue(newParagraphs.element.waitForExistence(timeout: 10))
        XCTAssertEqual(newParagraphs.count, 1)
        let newParagraph = newParagraphs.element
        XCTAssertTrue(revealInteropControl(newParagraph))
        newParagraph.tap()
        newParagraph.typeText(newBody)
        XCTAssertEqual(newParagraph.value as? String, newBody)
        XCTAssertTrue(app.buttons["homebase-create-entry-button"].isEnabled)

        let edit = app.buttons["homebase-edit-entry-button-\(entryID)"]
        XCTAssertTrue(revealInteropControl(edit))
        edit.tap()
        fillInteropField("homebase-edit-entry-title-field", value: editTitle)
        let editParagraphs = app.textViews.matching(NSPredicate(format: "identifier BEGINSWITH %@", "homebase-edit-entry-content-text-"))
        XCTAssertTrue(editParagraphs.element.waitForExistence(timeout: 10))
        XCTAssertEqual(editParagraphs.count, 1, "Use the prior one-paragraph actual workflow entry")
        let originalEditBlockID = editParagraphs.element.identifier
        XCTAssertEqual(editParagraphs.element.value as? String, input.writeBody)
        let addEditParagraph = app.buttons["homebase-edit-entry-content-add-paragraph"]
        XCTAssertTrue(revealInteropControl(addEditParagraph))
        addEditParagraph.tap()
        XCTAssertEqual(editParagraphs.count, 2)
        let appended = editParagraphs.allElementsBoundByIndex.filter { $0.identifier != originalEditBlockID }
        XCTAssertEqual(appended.count, 1)
        let editParagraph = try XCTUnwrap(appended.first)
        XCTAssertTrue(revealInteropControl(editParagraph))
        editParagraph.tap()
        editParagraph.typeText(editBody)
        XCTAssertEqual(editParagraph.value as? String, editBody)
        XCTAssertTrue(app.buttons["homebase-update-entry-button"].isEnabled)
        XCTAssertEqual(app.textFields["homebase-new-entry-title-field"].value as? String, newTitle)
        XCTAssertEqual(newParagraph.value as? String, newBody)
        attachScreenshot(named: "interop-lock-both-drafts-populated")

        XCTAssertTrue(openSection("Impostazioni"))
        let locks = app.buttons.matching(NSPredicate(format: "label == %@", "Blocca sessione adesso"))
        XCTAssertTrue(locks.element.waitForExistence(timeout: 10))
        XCTAssertEqual(locks.count, 1)
        XCTAssertTrue(revealInteropControl(locks.element))
        XCTAssertTrue(locks.element.isEnabled)
        try barrier.emit("populated-ready")
        _ = try barrier.waitFor("logout-armed")
        locks.element.tap()
        let held = try barrier.waitFor("logout-held")
        let requestID = try XCTUnwrap(held.requestID)
        XCTAssertFalse(requestID.isEmpty)
        // The genuine host route has returned; only delivery to the client is
        // delayed. This does not claim that server session retirement is pending.
        XCTAssertEqual(held.upstreamHttpStatus, 204)
        XCTAssertEqual(held.serverLogoutCompleted, true)
        XCTAssertEqual(held.responseForwarded, false)

        func assertClinicalContentAbsent() {
            for identifier in ["patient-detail-name", "patient-detail-diagnoses", "patient-detail-ai-summary",
                               "patient-detail-document-insights", "patient-cached-profile", "patient-cell-\(input.patient.id)",
                               "entry-row-\(entryID)", "homebase-new-entry-title-field", "homebase-new-entry-content-field",
                               "homebase-edit-entry-title-field", "homebase-edit-entry-content-field"] {
                XCTAssertFalse(sectionView(identifier).exists, "Locked clinical presentation retained: \(identifier)")
            }
            for text in [input.patient.lastName, address, savedTitle, input.writeBody, newTitle, newBody, editTitle, editBody] {
                XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", text)).firstMatch.exists,
                               "A previously observed synthetic clinical value remains after local lock")
            }
            for identifier in ["homebase-open-new-entry-button", "homebase-create-entry-button", "homebase-update-entry-button"] {
                for control in app.buttons.matching(identifier: identifier).allElementsBoundByIndex {
                    XCTAssertFalse(control.isEnabled, "A clinical writer remains available after local lock")
                }
            }
        }

        func assertLockedSurfaces() {
            XCTAssertTrue(openSection("Pazienti"))
            XCTAssertTrue(sectionView("clinical-workspace-patients-view").waitForExistence(timeout: 5))
            assertClinicalContentAbsent()
            attachScreenshot(named: "interop-lock-patients-cleared")
            XCTAssertTrue(openSection("Diario"))
            XCTAssertTrue(sectionView("clinical-workspace-diary-view").waitForExistence(timeout: 5))
            XCTAssertFalse(globalRow.exists)
            assertClinicalContentAbsent()
            attachScreenshot(named: "interop-lock-global-diary-cleared")
            XCTAssertTrue(openSection("Analytics"))
            XCTAssertTrue(sectionView("clinical-workspace-analytics-view").waitForExistence(timeout: 5))
            XCTAssertFalse(analyticsSummary.exists)
            XCTAssertFalse(app.staticTexts[analyticsFooter].exists)
            XCTAssertFalse(app.staticTexts["Pazienti in fascia"].exists)
            XCTAssertFalse(app.staticTexts["Senza data di nascita"].exists)
            assertClinicalContentAbsent()
            attachScreenshot(named: "interop-lock-analytics-cleared")
        }

        barrier.assertStillHeld()
        assertLockedSurfaces()
        barrier.assertStillHeld()
        try barrier.emit("client-clear-verified", requestID: requestID)
        let released = try barrier.waitFor("logout-released")
        XCTAssertEqual(released.requestID, requestID)
        XCTAssertEqual(released.httpStatus, 204)
        XCTAssertEqual(released.upstreamHttpStatus, 204)
        XCTAssertEqual(released.serverLogoutCompleted, true)
        XCTAssertEqual(released.responseForwarded, true)
        XCTAssertEqual(released.heldUntilClientClearVerified, true)
        XCTAssertEqual(released.clientDisconnectedBeforeRelease, false,
                       "A timed-out request cannot prove clear while logout was pending")
        assertLockedSurfaces()

        XCTAssertTrue(openSection("Impostazioni"))
        // No terminate/launch here: the same process must require ordinary PIN
        // entry and a fresh host read without recovering either unsaved draft.
        loginInteropFromSettings(input, useSavedPairing: true, verifyClearBeforeRead: true)
        assertInteropReread(input, address: address, title: savedTitle)
        XCTAssertTrue(sectionView("entry-row-\(entryID)").exists)
        XCTAssertFalse(sectionView("homebase-edit-entry-content-field").exists)
        XCTAssertTrue(revealInteropControl(openEntry))
        XCTAssertEqual(openEntry.label, "Nuova voce", "Local lock must discard the previous unsaved new draft")
        openEntry.tap()
        let freshTitle = app.textFields["homebase-new-entry-title-field"]
        XCTAssertTrue(freshTitle.waitForExistence(timeout: 5))
        XCTAssertTrue((freshTitle.value as? String ?? "").isEmpty || freshTitle.value as? String == freshTitle.placeholderValue)
        XCTAssertEqual(newParagraphs.count, 0)
        XCTAssertFalse(app.buttons["homebase-create-entry-button"].isEnabled)
        try barrier.emit("same-process-relogin-verified", requestID: requestID)
        attachScreenshot(named: "interop-lock-fresh-read-without-unsaved-drafts")
    }

    /* @Codex: Per-mutation checkpoints stop the UI until an independent normal
       HTTPS reader has checked the exact record/version. These are distinct
       from the fixture tests and from the other native app's later reread. */
    private final class InteropModuleProbe {
        let directory: URL
        let input: InteropInput
        private var stepCount = 0

        init(_ input: InteropInput) throws {
            self.input = input
            directory = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
                .appendingPathComponent("mediflow-interop-modules-\(input.runID)", isDirectory: true)
            XCTAssertFalse(FileManager.default.fileExists(atPath: directory.path))
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false,
                                                    attributes: [.posixPermissions: 0o700])
        }

        func write(_ name: String, values: [String: Any]) throws {
            let common: [String: Any] = ["schemaVersion": 1, "synthetic": true, "runID": input.runID,
                                         "fixtureId": input.fixtureId, "clientPlatform": input.clientPlatform]
            let data = try JSONSerialization.data(withJSONObject: common.merging(values) { _, new in new }, options: [.sortedKeys])
            let temporary = directory.appendingPathComponent(".\(UUID().uuidString).json")
            XCTAssertTrue(FileManager.default.createFile(atPath: temporary.path, contents: data,
                                                         attributes: [.posixPermissions: 0o600]))
            try FileManager.default.moveItem(at: temporary, to: directory.appendingPathComponent("\(name).json"))
        }

        func checkpoint(module: String, recordID: String, version: Int, expected: [String: String], deleted: Bool = false,
                        patientID: String? = nil, lifecycleStage: String? = nil,
                        expectedFlags: [String: Bool] = [:], expectedNulls: [String] = []) throws {
            stepCount += 1
            let stepID = String(format: "step-%03d", stepCount)
            var values: [String: Any] = ["stepID": stepID, "module": module, "recordId": recordID,
                                        "patientId": patientID ?? input.patient.id, "version": version,
                                        "expected": expected, "deleted": deleted]
            if let lifecycleStage {
                values["lifecycleStage"] = lifecycleStage
                values["expectedFlags"] = expectedFlags
                values["expectedNulls"] = expectedNulls
            }
            try write(stepID, values: values)
            let receiptURL = directory.appendingPathComponent("\(stepID)-receipt.json")
            let receiptArrived = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                FileManager.default.fileExists(atPath: receiptURL.path)
            }, object: nil)
            XCTAssertEqual(XCTWaiter.wait(for: [receiptArrived], timeout: 30), .completed,
                           "No independent HTTPS receipt for \(module) \(stepID)")
            let attributes = try FileManager.default.attributesOfItem(atPath: receiptURL.path)
            XCTAssertEqual(attributes[.type] as? FileAttributeType, .typeRegular)
            XCTAssertEqual((attributes[.posixPermissions] as? NSNumber)?.intValue, 0o600)
            let receipt = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: receiptURL)) as? [String: Any])
            XCTAssertEqual(receipt["schemaVersion"] as? Int, 1)
            XCTAssertEqual(receipt["runID"] as? String, input.runID)
            XCTAssertEqual(receipt["fixtureId"] as? String, input.fixtureId)
            XCTAssertEqual(receipt["stepID"] as? String, stepID)
            XCTAssertEqual(receipt["module"] as? String, module)
            XCTAssertEqual(receipt["recordId"] as? String, recordID)
            XCTAssertEqual(receipt["hostSourceCommit"] as? String, input.host.sourceCommit)
            XCTAssertEqual(receipt["writerClientPlatform"] as? String, input.clientPlatform)
            XCTAssertEqual(receipt["status"] as? String, "pass", "Actual UI must not continue past a failed host reread")
            let comparison = try XCTUnwrap(receipt["comparison"] as? [String: Any])
            XCTAssertEqual(comparison["version"] as? Int, version)
            XCTAssertEqual(comparison["deleted"] as? Bool, deleted)
            if let lifecycleStage { XCTAssertEqual(receipt["lifecycleStage"] as? String, lifecycleStage) }
        }

        func complete() throws { try write("ui-complete", values: ["stepCount": stepCount]) }
    }

    private func makeInteropModuleProbe(_ input: InteropInput) throws -> InteropModuleProbe {
        let probe = try InteropModuleProbe(input)
        let location = XCTAttachment(string: probe.directory.path)
        location.name = "interop-module-verifier-directory"
        location.lifetime = .keepAlways
        add(location)
        addTeardownBlock { try? probe.write("ui-finished", values: [:]) }
        return probe
    }

    // @Codex: The two live app processes exchange only test-run receipts through
    // a controller-owned relay. Neither app receives a fake transport or write.
    private func prepareInteropCAS(_ input: InteropInput, role: String) throws -> (InteropInput.CASCase, InteropModuleProbe) {
        let cas = try XCTUnwrap(input.cas, "A prior actual UI-created diary entry is required")
        XCTAssertEqual(cas.schemaVersion, 1)
        XCTAssertTrue(cas.synthetic)
        XCTAssertEqual(cas.fixtureId, input.fixtureId)
        XCTAssertEqual(cas.patientId, input.patient.id)
        XCTAssertGreaterThan(cas.baseVersion, 0)
        XCTAssertFalse(cas.entryID.isEmpty)
        XCTAssertFalse(cas.baseTitle.isEmpty)
        XCTAssertFalse(cas.baseBody.isEmpty)
        XCTAssertFalse(cas.baseBody.contains("\n"), "Use the observed one-paragraph workflow fixture")
        XCTAssertFalse(cas.baseBody.contains("\r"))
        XCTAssertTrue(["note", "visit", "phone", "other"].contains(cas.baseType))
        XCTAssertNotNil(cas.groupID.range(of: "^[A-Za-z0-9._-]{1,100}$", options: .regularExpression))
        let probe = try makeInteropModuleProbe(input)
        try probe.write("cas-participant", values: ["casRole": role, "casGroupID": cas.groupID,
                        "entryID": cas.entryID, "baseVersion": cas.baseVersion, "hostSourceCommit": input.host.sourceCommit])
        return (cas, probe)
    }

    private func signalInteropCAS(_ event: String, checkpoint: String, cas: InteropInput.CASCase,
                                  probe: InteropModuleProbe) throws {
        try probe.write("cas-\(event)", values: ["event": event, "casGroupID": cas.groupID,
                        "entryID": cas.entryID, "baseVersion": cas.baseVersion, "checkpointID": checkpoint])
    }

    private func waitForInteropCAS(_ event: String, cas: InteropInput.CASCase, probe: InteropModuleProbe) throws {
        let file = probe.directory.appendingPathComponent("cas-relay-\(event).json")
        let aborted = probe.directory.appendingPathComponent("cas-aborted.json")
        let available = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            FileManager.default.fileExists(atPath: file.path) || FileManager.default.fileExists(atPath: aborted.path)
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [available], timeout: 300), .completed,
                       "The other real UI writer did not produce its matching checkpoint")
        XCTAssertFalse(FileManager.default.fileExists(atPath: aborted.path), "The two-app run was aborted")
        let attributes = try FileManager.default.attributesOfItem(atPath: file.path)
        XCTAssertEqual(attributes[.type] as? FileAttributeType, .typeRegular)
        XCTAssertEqual((attributes[.posixPermissions] as? NSNumber)?.intValue, 0o600)
        let receipt = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: file)) as? [String: Any])
        XCTAssertEqual(receipt["schemaVersion"] as? Int, 1)
        XCTAssertEqual(receipt["synthetic"] as? Bool, true)
        XCTAssertEqual(receipt["runID"] as? String, probe.input.runID)
        XCTAssertEqual(receipt["fixtureId"] as? String, probe.input.fixtureId)
        XCTAssertEqual(receipt["casGroupID"] as? String, cas.groupID)
        XCTAssertEqual(receipt["entryID"] as? String, cas.entryID)
        XCTAssertEqual(receipt["baseVersion"] as? Int, cas.baseVersion)
        XCTAssertEqual(receipt["event"] as? String, event)
        XCTAssertEqual(receipt["hostSourceCommit"] as? String, probe.input.host.sourceCommit)
        XCTAssertEqual(receipt["sourceClientPlatform"] as? String, probe.input.clientPlatform == "ios" ? "ipados" : "ios")
        let sourceRunID = try XCTUnwrap(receipt["sourceRunID"] as? String)
        XCTAssertNotNil(sourceRunID.range(of: "^[A-Za-z0-9._-]{1,100}$", options: .regularExpression))
        XCTAssertNotEqual(sourceRunID, probe.input.runID)
        let digest = try XCTUnwrap(receipt["sourceReceiptSHA256"] as? String)
        XCTAssertNotNil(digest.range(of: "^[a-f0-9]{64}$", options: .regularExpression))
    }

    private func prepareInteropCASDraft(_ cas: InteropInput.CASCase, role: String) throws -> [String: String] {
        tapInteropButton("homebase-edit-entry-button-\(cas.entryID)")
        XCTAssertEqual(app.textFields["homebase-edit-entry-title-field"].value as? String, cas.baseTitle)
        fillInteropField("homebase-edit-entry-title-field", value: cas.title(role))
        let paragraphs = app.textViews.matching(NSPredicate(format: "identifier BEGINSWITH %@", "homebase-edit-entry-content-text-"))
        XCTAssertTrue(paragraphs.element.waitForExistence(timeout: 10))
        XCTAssertEqual(paragraphs.count, 1)
        let originalID = paragraphs.element.identifier
        XCTAssertEqual(paragraphs.element.value as? String, cas.baseBody)
        tapInteropButton("homebase-edit-entry-content-add-paragraph")
        XCTAssertEqual(paragraphs.count, 2)
        let added = paragraphs.allElementsBoundByIndex.filter { $0.identifier != originalID }
        XCTAssertEqual(added.count, 1)
        let paragraph = try XCTUnwrap(added.first)
        XCTAssertTrue(revealInteropControl(paragraph))
        paragraph.tap()
        paragraph.typeText(cas.body(role))
        XCTAssertEqual(paragraph.value as? String, cas.body(role))
        return [originalID: cas.baseBody, paragraph.identifier: cas.body(role)]
    }

    private func assertInteropCASDraft(_ blocks: [String: String], title: String) {
        XCTAssertEqual(app.textFields["homebase-edit-entry-title-field"].value as? String, title)
        let paragraphs = app.textViews.matching(NSPredicate(format: "identifier BEGINSWITH %@", "homebase-edit-entry-content-text-"))
        XCTAssertEqual(paragraphs.count, blocks.count)
        for (identifier, text) in blocks {
            XCTAssertTrue(app.textViews[identifier].exists, "Reload/reconciliation must preserve the actual block UUID")
            XCTAssertEqual(app.textViews[identifier].value as? String, text)
        }
    }

    private func assertInteropCASEntry(_ cas: InteropInput.CASCase, role: String? = nil) {
        let row = sectionView("entry-row-\(cas.entryID)")
        XCTAssertTrue(row.waitForExistence(timeout: 20))
        XCTAssertTrue(revealInteropControl(row))
        XCTAssertTrue(row.staticTexts[role.map { cas.title($0) } ?? cas.baseTitle].exists)
        // The source renders all HTML paragraphs in one attributed Text.
        let body = row.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", cas.baseBody))
        XCTAssertEqual(body.count, 1)
        let expectedParagraphs = [cas.baseBody] + (role.map { [cas.body($0)] } ?? [])
        XCTAssertEqual(body.element.label.components(separatedBy: .newlines).filter { !$0.isEmpty }, expectedParagraphs)
    }

    /* @Codex: App A keeps its stale draft while app B commits through normal UI.
       Reload and explicit local reconciliation must each leave B's data intact. */
    func testRealPairedDiaryCASContenderPreservesDraftUntilExplicitSave() throws {
        let input = try interopInput()
        let (cas, probe) = try prepareInteropCAS(input, role: "contender")
        defer { app.terminate() }
        launchAndLoginInterop(input)
        openPatientSection(.diary)
        assertInteropCASEntry(cas)
        try probe.checkpoint(module: "entry", recordID: cas.entryID, version: cas.baseVersion, expected: cas.fields())
        let blocks = try prepareInteropCASDraft(cas, role: "contender")
        assertInteropCASDraft(blocks, title: cas.title("contender"))
        let reconciliation = sectionView("homebase-edit-entry-reconciliation")
        XCTAssertFalse(reconciliation.exists)
        try signalInteropCAS("contender-ready", checkpoint: "step-001", cas: cas, probe: probe)
        try waitForInteropCAS("peer-saved", cas: cas, probe: probe)

        tapInteropButton("homebase-update-entry-button")
        // The inline conflict review is mounted on both idioms; the worklist
        // banner belongs to the previous destination on a compact iPhone.
        XCTAssertTrue(reconciliation.waitForExistence(timeout: 20))
        XCTAssertTrue(revealInteropControl(reconciliation))
        assertInteropCASDraft(blocks, title: cas.title("contender"))
        XCTAssertFalse(app.buttons["homebase-update-entry-button"].isEnabled)
        try probe.checkpoint(module: "entry", recordID: cas.entryID, version: cas.baseVersion + 1, expected: cas.fields("peer"))
        attachScreenshot(named: "interop-cas-real-conflict-draft-preserved")

        tapInteropButton("homebase-edit-entry-reload-for-review-button")
        let version = sectionView("homebase-edit-entry-remote-version")
        XCTAssertTrue(version.waitForExistence(timeout: 20))
        XCTAssertEqual(version.label, "Voce corrente · versione \(cas.baseVersion + 1)")
        let remote = sectionView("homebase-edit-entry-remote-content")
        XCTAssertTrue(revealInteropControl(remote))
        XCTAssertEqual(remote.elementType, .staticText, "The freshly read comparison must be read-only")
        XCTAssertEqual(remote.label.components(separatedBy: .newlines).filter { !$0.isEmpty }, [cas.baseBody, cas.body("peer")])
        assertInteropCASDraft(blocks, title: cas.title("contender"))
        XCTAssertFalse(app.buttons["homebase-update-entry-button"].isEnabled)
        try probe.checkpoint(module: "entry", recordID: cas.entryID, version: cas.baseVersion + 1, expected: cas.fields("peer"))

        tapInteropButton("homebase-edit-entry-confirm-reconciliation-button")
        assertInteropCASDraft(blocks, title: cas.title("contender"))
        XCTAssertTrue(app.buttons["homebase-update-entry-button"].isEnabled)
        // This HTTP reread occurs after the local review gesture but before Save.
        try probe.checkpoint(module: "entry", recordID: cas.entryID, version: cas.baseVersion + 1, expected: cas.fields("peer"))
        attachScreenshot(named: "interop-cas-confirmation-has-not-written")
        tapInteropButton("homebase-update-entry-button")
        XCTAssertTrue(app.textFields["homebase-edit-entry-title-field"].waitForNonExistence(timeout: 20))
        assertInteropCASEntry(cas, role: "contender")
        try probe.checkpoint(module: "entry", recordID: cas.entryID, version: cas.baseVersion + 2, expected: cas.fields("contender"))
        try signalInteropCAS("contender-saved", checkpoint: "step-005", cas: cas, probe: probe)
        try waitForInteropCAS("peer-reread", cas: cas, probe: probe)
        try probe.complete()
    }

    /* @Codex: App B is an actual second UI writer, then independently relaunches,
       logs in with its saved pairing and rereads A's reconciled final content. */
    func testRealPairedDiaryCASPeerWritesAndRereadsReconciledEntry() throws {
        let input = try interopInput()
        let (cas, probe) = try prepareInteropCAS(input, role: "peer")
        defer { app.terminate() }
        launchAndLoginInterop(input)
        openPatientSection(.diary)
        assertInteropCASEntry(cas)
        try probe.checkpoint(module: "entry", recordID: cas.entryID, version: cas.baseVersion, expected: cas.fields())
        try waitForInteropCAS("contender-ready", cas: cas, probe: probe)
        let blocks = try prepareInteropCASDraft(cas, role: "peer")
        assertInteropCASDraft(blocks, title: cas.title("peer"))
        tapInteropButton("homebase-update-entry-button")
        XCTAssertTrue(app.textFields["homebase-edit-entry-title-field"].waitForNonExistence(timeout: 20))
        assertInteropCASEntry(cas, role: "peer")
        try probe.checkpoint(module: "entry", recordID: cas.entryID, version: cas.baseVersion + 1, expected: cas.fields("peer"))
        try signalInteropCAS("peer-saved", checkpoint: "step-002", cas: cas, probe: probe)
        attachScreenshot(named: "interop-cas-second-native-writer-saved")
        try waitForInteropCAS("contender-saved", cas: cas, probe: probe)
        app.terminate()
        launchAndLoginInterop(input, useSavedPairing: true)
        openPatientSection(.diary)
        assertInteropCASEntry(cas, role: "contender")
        try probe.checkpoint(module: "entry", recordID: cas.entryID, version: cas.baseVersion + 2, expected: cas.fields("contender"))
        try signalInteropCAS("peer-reread", checkpoint: "step-003", cas: cas, probe: probe)
        attachScreenshot(named: "interop-cas-other-app-fresh-reread")
        try probe.complete()
    }

    // @Codex: exact source identifier and option labels; the selected native
    // value may be announced as the picker value or included in its label.
    private func assertInteropArchiveReason(_ title: String) {
        let query = app.descendants(matching: .any).matching(identifier: "patient-archive-reason")
        XCTAssertTrue(query.element.waitForExistence(timeout: 5))
        XCTAssertEqual(query.count, 1, "The archive form must expose one reason picker")
        XCTAssertTrue(revealInteropControl(query.element))
        let selected = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            query.element.value as? String == title || query.element.label == "Motivo, \(title)"
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [selected], timeout: 5), .completed,
                       "The reason picker must announce the exact selected reason: \(title)")
    }

    private func selectInteropArchiveReason(_ title: String) {
        let query = app.descendants(matching: .any).matching(identifier: "patient-archive-reason")
        XCTAssertTrue(query.element.waitForExistence(timeout: 5))
        XCTAssertEqual(query.count, 1)
        XCTAssertTrue(revealInteropControl(query.element))
        XCTAssertTrue(query.element.isEnabled)
        query.element.tap()
        let options = app.buttons.matching(NSPredicate(format: "label == %@", title))
        XCTAssertTrue(options.element.waitForExistence(timeout: 5))
        XCTAssertEqual(options.count, 1, "Select one explicit archive reason")
        XCTAssertTrue(options.element.isHittable)
        options.element.tap()
        assertInteropArchiveReason(title)
    }

    private func tapInteropButton(_ identifier: String) {
        let buttons = app.buttons.matching(identifier: identifier)
        XCTAssertTrue(buttons.element.waitForExistence(timeout: 15))
        XCTAssertEqual(buttons.count, 1, "The intended operation must have one exact action")
        XCTAssertTrue(revealInteropControl(buttons.element))
        XCTAssertTrue(buttons.element.isEnabled, "The actual session and declared capability must allow this operation")
        buttons.element.tap()
    }

    private func interopRecordIDs(actionPrefix: String) -> Set<String> {
        Set(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", actionPrefix))
            .allElementsBoundByIndex.map { String($0.identifier.dropFirst(actionPrefix.count)) })
    }

    private func newInteropRecordID(actionPrefix: String, excluding existing: Set<String>, title: String) throws -> String {
        XCTAssertTrue(app.staticTexts[title].waitForExistence(timeout: 20), "The saved synthetic content must render")
        let created = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            self.interopRecordIDs(actionPrefix: actionPrefix).subtracting(existing).count == 1
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [created], timeout: 10), .completed,
                       "One save must expose exactly one newly identified record")
        return try XCTUnwrap(interopRecordIDs(actionPrefix: actionPrefix).subtracting(existing).first)
    }

    // @Codex: Return through the actual navigation destination, on either idiom.
    private func returnToInteropWorklist() {
        let destination = sectionView("patient-compact-detail-destination")
        if destination.exists {
            let back = app.navigationBars.buttons.element(boundBy: 0)
            XCTAssertTrue(back.isHittable, "The compact patient destination needs its native back action")
            back.tap()
            XCTAssertTrue(destination.waitForNonExistence(timeout: 5))
        }
        XCTAssertTrue(sectionView("clinical-workspace-patients-view").waitForExistence(timeout: 5))
        XCTAssertTrue(sectionView("patient-view-mode").exists)
    }

    private func selectInteropPatientScope(_ title: String) {
        // Actual runs use the ordinary default text size. Do not replace a
        // missing segmented control with an unscoped label or injected filter.
        let control = app.segmentedControls["patient-view-mode"]
        XCTAssertTrue(revealInteropControl(control))
        let option = control.buttons.matching(NSPredicate(format: "label == %@", title))
        XCTAssertEqual(option.count, 1)
        XCTAssertTrue(option.element.isHittable)
        option.element.tap()
        let selected = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in option.element.isSelected }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [selected], timeout: 5), .completed)
    }

    /* @Codex: All seven checkpoints concern a newly UI-created auxiliary
       patient. The descriptor patient remains available to the other phases. */
    func testRealPairedNewPatientLifecycleWithIndependentRereads() throws {
        let input = try interopInput()
        let probe = try makeInteropModuleProbe(input)
        defer { app.terminate() }
        launchAndLoginInterop(input)
        returnToInteropWorklist()
        selectInteropPatientScope("Attivi")
        let firstName = "Sintetico"
        let lastName = "Interop \(input.runID) \(input.clientPlatform)"
        // The canonical manual create contract requires a nonempty code; this
        // explicit synthetic marker is intentionally not a person's tax code.
        let taxCode = "SYN-\(input.runID)-\(input.clientPlatform)"
        let identity = ["firstName": firstName, "lastName": lastName, "taxCode": taxCode]
        let candidateRows = app.buttons.matching(NSPredicate(
            format: "identifier BEGINSWITH %@ AND label CONTAINS %@", "patient-cell-", lastName))
        XCTAssertEqual(candidateRows.count, 0, "A unique run must not adopt a pre-existing patient")
        tapInteropButton("new-patient-button")
        XCTAssertFalse(app.buttons["create-patient-button"].isEnabled)
        fillInteropField("new-patient-first-name", value: firstName)
        fillInteropField("new-patient-last-name", value: lastName)
        XCTAssertFalse(app.buttons["create-patient-button"].isEnabled, "The required code cannot be omitted")
        fillInteropField("new-patient-tax-code", value: taxCode)
        XCTAssertFalse(app.datePickers["new-patient-birth-date"].exists, "No invented birth date for this fixture")
        var expected = identity
        expected["address"] = "Via sintetica \(input.runID)"
        expected["phone"] = "0000000000"
        expected["caregiver"] = "Referente sintetico \(input.runID)"
        for field in ["address", "phone", "caregiver"] {
            fillInteropField("new-patient-\(field)", value: try XCTUnwrap(expected[field]))
        }
        tapInteropButton("create-patient-button")
        XCTAssertTrue(app.textFields["new-patient-first-name"].waitForNonExistence(timeout: 20))
        XCTAssertTrue(candidateRows.element.waitForExistence(timeout: 20))
        XCTAssertEqual(candidateRows.count, 1, "The exact synthetic identity must map to one saved row")
        let patientID = String(candidateRows.element.identifier.dropFirst("patient-cell-".count))
        XCTAssertFalse(patientID.isEmpty)
        XCTAssertNotEqual(patientID, input.patient.id)

        func openCreatedPatient() {
            let row = app.buttons["patient-cell-\(patientID)"]
            XCTAssertTrue(row.waitForExistence(timeout: 20))
            XCTAssertTrue(row.label.contains(lastName))
            XCTAssertTrue(revealInteropControl(row))
            row.tap()
            openPatientSection(.overview)
            XCTAssertTrue(sectionView("patient-detail-name").label.contains(lastName))
        }
        func checkpoint(_ stage: String, version: Int, deleted: Bool = false, archived: Bool = false) throws {
            var values = expected
            if deleted {
                values = identity
                values["deletionReason"] = "Eliminazione sintetica \(input.runID)"
            }
            if archived {
                values["archiveReason"] = "other"
                values["archiveNote"] = "Archiviazione sintetica \(input.runID)"
            }
            try probe.checkpoint(module: "patient", recordID: patientID, version: version, expected: values,
                                 deleted: deleted, patientID: patientID, lifecycleStage: stage,
                                 expectedFlags: ["isArchived": archived, "isAdi": false],
                                 expectedNulls: deleted ? ["birthDate"] : archived ? ["birthDate", "deletionReason"]
                                    : ["birthDate", "deletionReason", "archiveReason", "archiveNote"])
            attachScreenshot(named: "interop-new-patient-\(stage)")
        }
        openCreatedPatient()
        XCTAssertTrue(app.staticTexts[taxCode].exists)
        XCTAssertTrue(revealInteropControl(app.staticTexts[try XCTUnwrap(expected["address"])]))
        try checkpoint("created", version: 1)

        tapInteropButton("edit-patient-button")
        expected["address"] = "Via aggiornata sintetica \(input.runID)"
        expected["notes"] = "Nota sintetica conservata \(input.runID)"
        fillInteropField("edit-patient-address", value: try XCTUnwrap(expected["address"]))
        fillInteropField("edit-patient-notes", value: try XCTUnwrap(expected["notes"]))
        tapInteropButton("save-patient-button")
        XCTAssertTrue(app.textFields["edit-patient-address"].waitForNonExistence(timeout: 20))
        XCTAssertTrue(revealInteropControl(app.staticTexts[try XCTUnwrap(expected["address"])]))
        try checkpoint("profile-updated", version: 2)

        // @Codex: Lifecycle commands belong to the ordinary overflow menu.
        tapInteropButton("patient-actions-overflow")
        tapInteropButton("archive-patient-button")
        XCTAssertTrue(app.staticTexts["\(lastName) \(firstName)"].exists)
        XCTAssertFalse(app.buttons["patient-archive-confirm-button"].isEnabled)
        selectInteropArchiveReason("Altro")
        XCTAssertFalse(app.buttons["patient-archive-confirm-button"].isEnabled, "Other requires a nonempty note")
        fillInteropField("patient-archive-note", value: "Archiviazione sintetica \(input.runID)")
        tapInteropButton("patient-archive-confirm-button")
        XCTAssertTrue(app.buttons["patient-archive-confirm-button"].waitForNonExistence(timeout: 20))
        returnToInteropWorklist()
        XCTAssertFalse(app.buttons["patient-cell-\(patientID)"].exists, "Archived patient must leave the active list")
        selectInteropPatientScope("Archiviati")
        openCreatedPatient()
        tapInteropButton("edit-patient-button")
        assertInteropArchiveReason("Altro")
        let archiveNote = app.textFields["patient-archive-note"]
        XCTAssertTrue(revealInteropControl(archiveNote))
        XCTAssertEqual(archiveNote.value as? String, "Archiviazione sintetica \(input.runID)")
        tapInteropButton("cancel-patient-button")
        tapInteropButton("patient-actions-overflow")
        XCTAssertTrue(app.buttons["unarchive-patient-button"].exists)
        XCTAssertEqual(app.buttons.matching(identifier: "unarchive-patient-button").count, 1)
        XCTAssertTrue(app.buttons["unarchive-patient-button"].isEnabled)
        try checkpoint("archived", version: 3, archived: true)

        tapInteropButton("unarchive-patient-button")
        tapInteropButton("patient-unarchive-confirm-button")
        XCTAssertTrue(app.buttons["patient-unarchive-confirm-button"].waitForNonExistence(timeout: 20))
        returnToInteropWorklist()
        XCTAssertFalse(app.buttons["patient-cell-\(patientID)"].exists, "Reactivated patient must leave the archived list")
        selectInteropPatientScope("Attivi")
        openCreatedPatient()
        try checkpoint("reactivated", version: 4)

        tapInteropButton("patient-actions-overflow")
        tapInteropButton("soft-delete-patient-button")
        XCTAssertTrue(app.staticTexts["\(lastName) \(firstName)"].exists)
        fillInteropField("patient-delete-reason-field", value: "Eliminazione sintetica \(input.runID)")
        tapInteropButton("patient-delete-confirm-button")
        XCTAssertTrue(app.buttons["patient-delete-confirm-button"].waitForNonExistence(timeout: 20))
        XCTAssertTrue(sectionView("patient-detail-name").waitForNonExistence(timeout: 5))
        returnToInteropWorklist()
        XCTAssertFalse(app.buttons["patient-cell-\(patientID)"].exists)
        selectInteropPatientScope("Cestino")
        let trashRow = sectionView("patient-trash-row-\(patientID)")
        XCTAssertTrue(trashRow.waitForExistence(timeout: 20))
        XCTAssertTrue(revealInteropControl(trashRow))
        try checkpoint("trashed", version: 5, deleted: true)

        tapInteropButton("restore-patient-button-\(patientID)")
        XCTAssertTrue(trashRow.waitForNonExistence(timeout: 20))
        selectInteropPatientScope("Attivi")
        openCreatedPatient()
        XCTAssertTrue(revealInteropControl(app.staticTexts[try XCTUnwrap(expected["address"])]))
        try checkpoint("restored", version: 6)

        app.terminate()
        launchAndLoginInterop(input, useSavedPairing: true)
        returnToInteropWorklist()
        selectInteropPatientScope("Attivi")
        openCreatedPatient()
        XCTAssertTrue(revealInteropControl(app.staticTexts[try XCTUnwrap(expected["address"])]))
        try checkpoint("restored-reread", version: 6)
        try probe.complete()
    }

    private func exerciseInteropClinicalCRUD(
        _ input: InteropInput, module: String, section: PatientSection,
        createFields: [(suffix: String, value: String)], expected: [String: String],
        updateSuffix: String, updateValue: String, updateField: String,
        statusLabel: String? = nil, statusValue: String? = nil,
        cancelledLabel: String, confirmation: String
    ) throws {
        let probe = try makeInteropModuleProbe(input)
        defer { app.terminate() }
        launchAndLoginInterop(input)
        openPatientSection(section)
        let createID = "homebase-create-\(module)-button"
        let updateID = "homebase-update-\(module)-button"
        let editPrefix = "homebase-edit-\(module)-button-"
        let prior = interopRecordIDs(actionPrefix: editPrefix)
        for field in createFields { fillInteropField("\(createID)-\(field.suffix)", value: field.value) }
        tapInteropButton(createID)
        let recordID = try newInteropRecordID(actionPrefix: editPrefix, excluding: prior, title: createFields[0].value)
        try probe.checkpoint(module: module, recordID: recordID, version: 1, expected: expected)
        attachScreenshot(named: "interop-\(module)-created")

        tapInteropButton("\(editPrefix)\(recordID)")
        fillInteropField("\(updateID)-\(updateSuffix)", value: updateValue)
        var updated = expected
        updated[updateField] = updateValue
        if let statusLabel, let statusValue {
            let status = app.segmentedControls["\(updateID)-status"]
            XCTAssertTrue(revealInteropControl(status))
            let choices = status.buttons.matching(NSPredicate(format: "label == %@", statusLabel))
            XCTAssertEqual(choices.count, 1)
            choices.element.tap()
            XCTAssertTrue(choices.element.isSelected)
            updated["status"] = statusValue
        }
        tapInteropButton(updateID)
        XCTAssertTrue(app.staticTexts[updateValue].waitForExistence(timeout: 20))
        try probe.checkpoint(module: module, recordID: recordID, version: 2, expected: updated)
        attachScreenshot(named: "interop-\(module)-updated")

        tapInteropButton("homebase-delete-\(module)-button-\(recordID)")
        let confirm = app.buttons.matching(NSPredicate(format: "label == %@", confirmation))
        XCTAssertTrue(confirm.element.waitForExistence(timeout: 5))
        XCTAssertEqual(confirm.count, 1)
        confirm.element.tap()
        XCTAssertTrue(app.staticTexts[cancelledLabel].waitForExistence(timeout: 20))
        XCTAssertFalse(app.buttons["\(editPrefix)\(recordID)"].exists)
        try probe.checkpoint(module: module, recordID: recordID, version: 3, expected: updated, deleted: true)
        attachScreenshot(named: "interop-\(module)-historical-soft-delete")
        try probe.complete()
    }

    func testRealPairedTherapyCRUDWithIndependentRereads() throws {
        let input = try interopInput()
        let name = "Terapia sintetica \(input.runID)"
        try exerciseInteropClinicalCRUD(input, module: "therapy", section: .therapies,
            createFields: [("drug-name", name), ("dosage", "Posologia solo fixture"), ("motivation", "Verifica manuale sintetica")],
            expected: ["drugName": name, "dosage": "Posologia solo fixture", "motivation": "Verifica manuale sintetica", "status": "active"],
            updateSuffix: "dosage", updateValue: "Posologia aggiornata solo fixture", updateField: "dosage",
            statusLabel: "Sospesa", statusValue: "suspended", cancelledLabel: "Terapia annullata", confirmation: "Annulla terapia")
    }

    func testRealPairedCheckupCRUDWithIndependentRereads() throws {
        let input = try interopInput()
        let title = "Controllo sintetico \(input.runID)"
        try exerciseInteropClinicalCRUD(input, module: "checkup", section: .clinical,
            createFields: [("title", title), ("notes", "Nota controllo solo fixture")],
            expected: ["title": title, "notes": "Nota controllo solo fixture", "status": "pending"],
            updateSuffix: "notes", updateValue: "Nota controllo aggiornata", updateField: "notes",
            statusLabel: "Completato", statusValue: "completed", cancelledLabel: "Controllo annullato", confirmation: "Annulla controllo")
    }

    func testRealPairedObservationCRUDWithIndependentRereads() throws {
        let input = try interopInput()
        let display = "Peso sintetico \(input.runID)"
        try exerciseInteropClinicalCRUD(input, module: "observation", section: .clinical,
            createFields: [("display", display), ("code", "29463-7"), ("value", "73"), ("unit-code", "kg"), ("notes", "Rilevazione sintetica")],
            expected: ["display": display, "code": "29463-7", "value": "73", "unitCode": "kg", "notes": "Rilevazione sintetica"],
            updateSuffix: "value", updateValue: "74", updateField: "value",
            cancelledLabel: "Osservazione annullata", confirmation: "Annulla osservazione")
    }

    func testRealPairedServiceAndItemLifecycleWithIndependentRereads() throws {
        let input = try interopInput()
        let probe = try makeInteropModuleProbe(input)
        defer { app.terminate() }
        launchAndLoginInterop(input)
        openPatientSection(.prescriptions)
        let title = "Prestazione sintetica \(input.runID)"
        let itemNames = ["Voce A \(input.runID)", "Voce B \(input.runID)"]
        let prior = interopRecordIDs(actionPrefix: "service-prescription-book-")
        fillInteropField("new-service-name", value: title)
        fillInteropField("new-service-clinical-question", value: "Quesito solo fixture")
        fillInteropField("new-service-provider", value: "Erogatore sintetico")
        fillInteropField("new-service-items", value: "SYN001 \(itemNames[0])\nSYN002 \(itemNames[1])")
        tapInteropButton("create-service-prescription-button")
        let recordID = try newInteropRecordID(actionPrefix: "service-prescription-book-", excluding: prior, title: title)
        let row = sectionView("service-prescription-row-\(recordID)")
        XCTAssertTrue(row.exists)
        var itemIDs: [String] = []
        for name in itemNames {
            let items = row.descendants(matching: .any)
                .matching(NSPredicate(format: "identifier BEGINSWITH %@", "service-prescription-item-row-"))
                .containing(.staticText, identifier: name)
            XCTAssertTrue(items.element.waitForExistence(timeout: 10))
            XCTAssertEqual(items.count, 1, "Each requested line must produce one separate item")
            itemIDs.append(String(items.element.identifier.dropFirst("service-prescription-item-row-".count)))
        }
        XCTAssertNotEqual(itemIDs[0], itemIDs[1])

        func check(_ status: String, version: Int) throws {
            try probe.checkpoint(module: "service", recordID: recordID, version: version,
                expected: ["serviceName": title, "clinicalQuestion": "Quesito solo fixture", "provider": "Erogatore sintetico", "status": status])
            for (index, itemID) in itemIDs.enumerated() {
                try probe.checkpoint(module: "service-item", recordID: itemID, version: version,
                    expected: ["prescriptionId": recordID, "serviceName": itemNames[index], "serviceCode": "SYN00\(index + 1)", "status": status])
            }
        }
        try check("prescribed", version: 1)
        for (index, transition) in [("book", "booked", "Prenotata"), ("perform", "performed", "Eseguita"),
                                    ("report", "report_received", "Referto ricevuto")].enumerated() {
            tapInteropButton("service-prescription-\(transition.0)-\(recordID)")
            XCTAssertTrue(row.staticTexts[transition.2].waitForExistence(timeout: 20))
            try check(transition.1, version: index + 2)
            attachScreenshot(named: "interop-service-and-items-\(transition.1)")
        }
        XCTAssertFalse(app.buttons["service-prescription-book-\(recordID)"].isEnabled)
        XCTAssertFalse(app.buttons["service-prescription-perform-\(recordID)"].isEnabled)
        XCTAssertFalse(app.buttons["service-prescription-report-\(recordID)"].isEnabled)
        XCTAssertFalse(app.buttons["service-prescription-cancel-\(recordID)"].isEnabled)
        // Cancel a distinct still-prescribed record; never bypass a transition
        // guard on the already performed/reported prescription above.
        let cancellationTitle = "Prestazione da annullare \(input.runID)"
        let beforeCancel = interopRecordIDs(actionPrefix: "service-prescription-book-")
        fillInteropField("new-service-name", value: cancellationTitle)
        tapInteropButton("create-service-prescription-button")
        let cancelledID = try newInteropRecordID(actionPrefix: "service-prescription-book-", excluding: beforeCancel, title: cancellationTitle)
        try probe.checkpoint(module: "service", recordID: cancelledID, version: 1,
                             expected: ["serviceName": cancellationTitle, "status": "prescribed"])
        tapInteropButton("service-prescription-cancel-\(cancelledID)")
        XCTAssertTrue(sectionView("service-prescription-row-\(cancelledID)").staticTexts["Annullata"].waitForExistence(timeout: 20))
        try probe.checkpoint(module: "service", recordID: cancelledID, version: 2,
                             expected: ["serviceName": cancellationTitle, "status": "cancelled"])
        try probe.complete()
    }

    func testRealPairedProstheticCreateAndTestWithIndependentRereads() throws {
        let input = try interopInput()
        let probe = try makeInteropModuleProbe(input)
        defer { app.terminate() }
        launchAndLoginInterop(input)
        openPatientSection(.prescriptions)
        let title = "Ausilio sintetico \(input.runID)"
        let prior = interopRecordIDs(actionPrefix: "prosthetic-test-")
        for (field, value) in [("description", title), ("measures", "Misure solo fixture"),
                               ("clinical-reason", "Motivo sintetico"), ("supplier", "Fornitore sintetico")] {
            fillInteropField("new-prosthetic-\(field)", value: value)
        }
        tapInteropButton("create-prosthetic-prescription-button")
        let recordID = try newInteropRecordID(actionPrefix: "prosthetic-test-", excluding: prior, title: title)
        var expected = ["description": title, "measures": "Misure solo fixture", "clinicalReason": "Motivo sintetico",
                        "supplier": "Fornitore sintetico", "status": "prescribed"]
        try probe.checkpoint(module: "prosthetic", recordID: recordID, version: 1, expected: expected)
        tapInteropButton("prosthetic-test-\(recordID)")
        let row = sectionView("prosthetic-prescription-row-\(recordID)")
        XCTAssertTrue(row.staticTexts["Collaudo registrato in MediFlow."].waitForExistence(timeout: 20))
        XCTAssertFalse(app.buttons["prosthetic-test-\(recordID)"].isEnabled)
        expected["status"] = "tested"
        expected["collaudoOutcome"] = "Collaudo registrato in MediFlow."
        try probe.checkpoint(module: "prosthetic", recordID: recordID, version: 2, expected: expected)
        attachScreenshot(named: "interop-prosthetic-tested")
        try probe.complete()
    }

    func testRealPairedScaleSubmissionWithIndependentReread() throws {
        let input = try interopInput()
        let probe = try makeInteropModuleProbe(input)
        defer { app.terminate() }
        launchAndLoginInterop(input)
        openPatientSection(.diary)
        let prior = interopRecordIDs(actionPrefix: "homebase-edit-entry-button-")
        tapInteropButton("new-scale-button")
        tapInteropButton("new-scale-option-adl")
        XCTAssertTrue(app.staticTexts["scale-incomplete"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts["scale-score"].exists)
        XCTAssertFalse(app.buttons["submit-scale-button"].isEnabled)
        for (index, question) in ["bath", "dress", "toilet", "transfer", "cont", "feed"].enumerated() {
            tapInteropButton("scale-question-\(question)")
            let answer = app.buttons.matching(NSPredicate(format: "label == %@", "Dipendente"))
            XCTAssertEqual(answer.count, 1)
            answer.element.tap()
            if index < 5 { XCTAssertFalse(app.buttons["submit-scale-button"].isEnabled) }
        }
        XCTAssertEqual(app.staticTexts["scale-score"].label, "Punteggio: 0/6")
        attachScreenshot(named: "interop-scale-complete-explicit-zero")
        tapInteropButton("submit-scale-button")
        let recordID = try newInteropRecordID(actionPrefix: "homebase-edit-entry-button-", excluding: prior, title: "ADL (Indice di Katz)")
        try probe.checkpoint(module: "entry", recordID: recordID, version: 1,
                             expected: ["title": "ADL (Indice di Katz)", "type": "scale"])
        openPatientSection(.scales)
        let history = sectionView("scale-history-row-\(recordID)")
        XCTAssertTrue(revealInteropControl(history), "The newly persisted scale must be reachable in its own history row")
        XCTAssertTrue(history.staticTexts["ADL (Indice di Katz)"].exists)
        XCTAssertTrue(history.staticTexts["0/6"].exists)
        attachScreenshot(named: "interop-scale-history")
        try probe.complete()
    }

    /// Swipes the detail scroll view up until `element` is in the accessibility

    /// Swipes the detail scroll view up until `element` is in the accessibility
    /// tree (or a swipe budget is exhausted). Returns whether it became present.
    /// Interactive targets may also require a reachable hit point before tapping.
    private func scrollDown(to element: XCUIElement, maxSwipes: Int = 12, requireHittable: Bool = false) -> Bool {
        var attempts = 0
        while (!element.exists || (requireHittable && !element.isHittable)) && attempts < maxSwipes {
            app.swipeUp()
            attempts += 1
        }
        return element.waitForExistence(timeout: 5) && (!requireHittable || element.isHittable)
    }
}
