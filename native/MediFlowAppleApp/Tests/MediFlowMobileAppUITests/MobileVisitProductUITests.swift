import XCTest

final class MobileVisitProductUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testVisitEntryKeepsFirstPatientVisibleAtAX5() throws {
        try XCTSkipUnless(UIDevice.current.userInterfaceIdiom == .phone, "compact-only layout contract")
        let app = XCUIApplication()
        app.launchEnvironment = [
            "MEDIFLOW_APPLE_UITEST_PATIENTS": "1",
            "MEDIFLOW_APPLE_UITEST_VISIT": UUID().uuidString,
            "MEDIFLOW_APPLE_UITEST_DYNAMIC_TYPE_SIZE": "accessibility5"
        ]
        app.launch()
        let row = app.buttons["patient-cell-visit-synthetic-patient"]
        XCTAssertTrue(row.waitForExistence(timeout: 15))
        let tabBar = app.tabBars.firstMatch
        XCTAssertTrue(tabBar.waitForExistence(timeout: 10))
        XCTAssertTrue(row.isHittable)
        XCTAssertLessThanOrEqual(row.frame.maxY, tabBar.frame.minY)

        openVisit(app)
        let close = app.buttons["mobile-visit-close"]
        XCTAssertTrue(close.waitForExistence(timeout: 5))
        close.tap()
        XCTAssertTrue(close.waitForNonExistence(timeout: 5))
        XCTAssertTrue(row.isHittable)
        XCTAssertLessThanOrEqual(row.frame.maxY, tabBar.frame.minY)
        row.tap()
        XCTAssertTrue(app.descendants(matching: .any)
            .matching(identifier: "patient-detail-name").firstMatch.waitForExistence(timeout: 10))
    }

    func testRealAppVisitPreparationOfflineRestartAndOrdinaryRegistration() {
        let app = XCUIApplication()
        let run = UUID().uuidString
        app.launchEnvironment = ["MEDIFLOW_APPLE_UITEST_PATIENTS": "1", "MEDIFLOW_APPLE_UITEST_VISIT": run]
        app.launch()
        openVisit(app)
        waitForUIReady(app.buttons["mobile-visit-choose-patient"], in: app)
        app.buttons["mobile-visit-choose-patient"].tap()
        waitForUIReady(app.buttons["Sintetico Paziente"].firstMatch, in: app)
        app.buttons["Sintetico Paziente"].firstMatch.tap()
        waitForUIReady(app.buttons["mobile-visit-prepare"], in: app)
        app.buttons["mobile-visit-prepare"].tap()
        waitForUIReady(app.buttons["Acconsento e preparo il dossier"], in: app)
        app.buttons["Acconsento e preparo il dossier"].tap()
        let note = app.textViews["mobile-visit-note"]
        waitForUIReady(note, in: app, timeout: 10)
        note.tap()
        note.typeText("Appunto solo sintetico conservato senza rete.")
        app.terminate()
        app.launchEnvironment["MEDIFLOW_APPLE_UITEST_VISIT_OFFLINE"] = "1"
        app.launch()
        openVisit(app)
        waitForUIReady(app.buttons["mobile-visit-unlock"], in: app)
        app.buttons["mobile-visit-unlock"].tap()
        waitForUIReady(app.buttons["mobile-visit-open-note"].firstMatch, in: app, timeout: 10)
        app.buttons["mobile-visit-open-note"].firstMatch.tap()
        waitForUIReady(note, in: app, timeout: 5)
        XCTAssertEqual(note.value as? String, "Appunto solo sintetico conservato senza rete.")
        let offline = XCTAttachment(screenshot: app.screenshot())
        offline.name = "real-app-synthetic-offline-note"
        offline.lifetime = .keepAlways
        add(offline)
        app.terminate()
        app.launchEnvironment["MEDIFLOW_APPLE_UITEST_VISIT_OFFLINE"] = nil
        app.launch()
        openVisit(app)
        waitForUIReady(app.buttons["mobile-visit-unlock"], in: app)
        app.buttons["mobile-visit-unlock"].tap()
        let review = app.buttons["mobile-visit-review"].firstMatch
        scrollTo(review, in: app)
        review.tap()
        waitForUIReady(app.secureTextFields["mobile-visit-password"], in: app)
        app.secureTextFields["mobile-visit-password"].tap()
        app.secureTextFields["mobile-visit-password"].typeText(String(Int.random(in: 1000...9999)))
        app.buttons["mobile-visit-authenticate"].tap()
        let consent = app.switches["Ho confrontato le fonti aggiornate e rivisto l’appunto"]
        scrollTo(consent, in: app)
        waitForUIReady(consent, in: app, timeout: 10)
        consent.tap()
        app.buttons["mobile-visit-import"].tap()
        let diary = app.buttons["patient-section-diary"]
        XCTAssertTrue(diary.waitForExistence(timeout: 10))
        XCTAssertTrue(diary.isSelected, "Import must reveal the ordinary diary, preserving the prepared draft")
        let composer = app.buttons["homebase-open-new-entry-button"]
        scrollTo(composer, in: app)
        XCTAssertTrue(composer.waitForExistence(timeout: 10))
        composer.tap()
        let save = app.buttons["homebase-create-entry-button"]
        scrollTo(save, in: app)
        let title = app.textFields["homebase-new-entry-title-field"]
        XCTAssertEqual(title.value as? String, "Appunto visita")
        save.tap()
        let saved = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value != %@", "Appunto visita"), object: title)
        XCTAssertEqual(XCTWaiter.wait(for: [saved], timeout: 15), .completed)
        app.terminate()
        app.launch()
        openVisit(app)
        waitForUIReady(app.buttons["mobile-visit-unlock"], in: app)
        app.buttons["mobile-visit-unlock"].tap()
        let receipt = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "registrato in cartella e confermato")).firstMatch
        scrollTo(receipt, in: app)
        XCTAssertTrue(receipt.waitForExistence(timeout: 10))
        let confirmed = XCTAttachment(screenshot: app.screenshot())
        confirmed.name = "real-app-synthetic-confirmed-receipt"
        confirmed.lifetime = .keepAlways
        add(confirmed)
    }

    private func openVisit(_ app: XCUIApplication) {
        XCTAssertTrue(app.descendants(matching: .any)
            .matching(identifier: "clinical-workspace-patients-view").firstMatch.waitForExistence(timeout: 15))
        let entry = app.buttons["mobile-visit-entry"]
        if !entry.isHittable {
            let tools = app.buttons["patient-worklist-tools-menu"]
            if tools.isHittable {
                tools.tap()
            } else {
                let overflow = app.buttons["OverflowBarButtonItem"]
                XCTAssertTrue(overflow.waitForExistence(timeout: 5))
                overflow.tap()
                let menu = tools.isHittable ? tools : app.buttons["Elenco"]
                XCTAssertTrue(menu.waitForExistence(timeout: 5))
                menu.tap()
            }
        }
        waitForUIReady(entry, in: app, timeout: 5)
        entry.tap()
    }

    private func scrollTo(_ element: XCUIElement, in app: XCUIApplication) {
        for _ in 0..<12 {
            if element.exists && element.isHittable { return }
            app.swipeUp()
        }
    }
}
