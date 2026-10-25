import XCTest

final class MobileVisitProductUITests: XCTestCase {
    func testRealAppVisitPreparationOfflineRestartAndOrdinaryRegistration() {
        let app = XCUIApplication()
        let run = UUID().uuidString
        app.launchEnvironment = ["MEDIFLOW_APPLE_UITEST_PATIENTS": "1", "MEDIFLOW_APPLE_UITEST_VISIT": run]
        app.launch()
        openVisit(app)
        app.buttons["mobile-visit-choose-patient"].tap()
        app.buttons["Sintetico Paziente"].firstMatch.tap()
        XCTAssertTrue(app.buttons["mobile-visit-prepare"].waitForExistence(timeout: 10))
        app.buttons["mobile-visit-prepare"].tap()
        app.buttons["Acconsento e preparo il dossier"].tap()
        let note = app.textViews["mobile-visit-note"]
        XCTAssertTrue(note.waitForExistence(timeout: 10))
        note.tap()
        note.typeText("Appunto solo sintetico conservato senza rete.")
        app.terminate()
        app.launchEnvironment["MEDIFLOW_APPLE_UITEST_VISIT_OFFLINE"] = "1"
        app.launch()
        openVisit(app)
        app.buttons["mobile-visit-unlock"].tap()
        XCTAssertTrue(app.buttons["mobile-visit-open-note"].firstMatch.waitForExistence(timeout: 10))
        app.buttons["mobile-visit-open-note"].firstMatch.tap()
        XCTAssertTrue(note.waitForExistence(timeout: 5))
        XCTAssertEqual(note.value as? String, "Appunto solo sintetico conservato senza rete.")
        let offline = XCTAttachment(screenshot: app.screenshot())
        offline.name = "real-app-synthetic-offline-note"
        offline.lifetime = .keepAlways
        add(offline)
        app.terminate()
        app.launchEnvironment["MEDIFLOW_APPLE_UITEST_VISIT_OFFLINE"] = nil
        app.launch()
        openVisit(app)
        app.buttons["mobile-visit-unlock"].tap()
        let review = app.buttons["mobile-visit-review"].firstMatch
        scrollTo(review, in: app)
        review.tap()
        app.secureTextFields["mobile-visit-password"].tap()
        app.secureTextFields["mobile-visit-password"].typeText(String(Int.random(in: 1000...9999)))
        app.buttons["mobile-visit-authenticate"].tap()
        let consent = app.switches["Ho confrontato le fonti aggiornate e rivisto l’appunto"]
        scrollTo(consent, in: app)
        XCTAssertTrue(consent.waitForExistence(timeout: 10))
        consent.tap()
        app.buttons["mobile-visit-import"].tap()
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
        XCTAssertTrue(app.buttons["mobile-visit-entry"].waitForExistence(timeout: 15))
        app.buttons["mobile-visit-entry"].tap()
    }

    private func scrollTo(_ element: XCUIElement, in app: XCUIApplication) {
        for _ in 0..<12 {
            if element.exists && element.isHittable { return }
            app.swipeUp()
        }
    }
}
