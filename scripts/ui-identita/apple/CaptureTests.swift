import XCTest

final class CaptureTests: XCTestCase {
    let app = XCUIApplication(bundleIdentifier: "com.mediflow.mobile")
    var theme = "giorno"
    func capture(_ name: String) {
        print("CAPTURE_READY \(name)-\(theme)")
        fflush(stdout)
        Thread.sleep(forTimeInterval: 8)
    }
    func launch(_ section: String = "patients", error: Bool = false) throws {
        let data = Data(base64Encoded: "__LAUNCH_BASE64__")!
        var env = try JSONDecoder().decode([String:String].self, from: data)
        env["MEDIFLOW_APPLE_INITIAL_SECTION"] = section
        env["MEDIFLOW_APPLE_DEV_SKIP_KEYCHAIN"] = "1"
        if error { env["MEDIFLOW_HOMEBASE_OPERATOR_PIN"] = "999999-wrong" }
        app.launchEnvironment = env
        app.launchArguments = ["-mediflow.apple.appearance.theme", theme == "giorno" ? "light" : "dark"]
        print("APPEARANCE \(theme == "giorno" ? "light" : "dark")")
        fflush(stdout)
        Thread.sleep(forTimeInterval: 2)
        app.launch()
    }
    func reveal(_ element: XCUIElement) -> Bool {
        for _ in 0..<9 {
            if element.exists && element.isHittable { return true }
            let start = app.coordinate(withNormalizedOffset: CGVector(dx: UIDevice.current.userInterfaceIdiom == .pad ? 0.75 : 0.5, dy: 0.70))
            let end = app.coordinate(withNormalizedOffset: CGVector(dx: UIDevice.current.userInterfaceIdiom == .pad ? 0.75 : 0.5, dy: 0.40))
            start.press(forDuration: 0.1, thenDragTo: end)
        }
        return element.exists && element.isHittable
    }
    func diary() {
        let direct = app.buttons["patient-section-diary"]
        if direct.exists { direct.tap() }
        else {
            app.buttons["patient-section-picker"].tap()
            app.buttons.matching(NSPredicate(format:"label == %@", "Diario clinico")).firstMatch.tap()
        }
    }
    func patient(_ needle: String) -> XCUIElement {
        app.buttons.matching(NSPredicate(format:"identifier BEGINSWITH 'patient-cell-' AND label CONTAINS[c] %@", needle)).firstMatch
    }
    func testCapture() throws {
        continueAfterFailure = false
        if UIDevice.current.userInterfaceIdiom == .pad { XCUIDevice.shared.orientation = .landscapeLeft }
        for t in ["giorno", "grafite"] {
            theme = t
            try launch()
            let row = patient("Rossi Sintetica")
            guard row.waitForExistence(timeout: 40) else { capture("diagnostica-elenco"); XCTFail("Banco patient Rossi absent"); continue }
            capture("01-elenco")
            row.tap()
            let name = app.staticTexts["patient-detail-name"]
            XCTAssertTrue(name.waitForExistence(timeout: 20))
            capture("02-scheda")
            diary()
            let entry = app.descendants(matching:.any).matching(NSPredicate(format:"identifier BEGINSWITH 'entry-row-'")).firstMatch
            XCTAssertTrue(entry.waitForExistence(timeout: 20))
            XCTAssertGreaterThanOrEqual(app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH %@", "entry-row-")).count, 3)
            capture("03-diario")
            let newEntry = app.buttons["homebase-open-new-entry-button"]
            if reveal(newEntry) {
                newEntry.tap()
                let title = app.textFields["homebase-new-entry-title-field"]
                if title.waitForExistence(timeout: 10) {
                    title.tap()
                    let tutorial = app.buttons["Continue"]
                    if tutorial.waitForExistence(timeout: 2) { tutorial.tap() }
                    title.typeText("Bozza sintetica non salvata")
                    if tutorial.exists { tutorial.tap(); title.tap(); title.typeText("Bozza sintetica non salvata") }
                    XCTAssertTrue((title.value as? String)?.contains("Bozza sintetica") == true)
                    capture("04-nuova-voce")
                }
            }
            app.terminate()
            try launch()
            let settings = app.buttons["clinical-workspace-section-settings-button"]
            if !settings.exists {
                let more = app.buttons["Altro"].firstMatch
                if more.waitForExistence(timeout: 10) { more.tap() }
            }
            if settings.waitForExistence(timeout: 10) { settings.tap() }
            XCTAssertTrue(app.buttons["settings-mediflow-connection-button"].waitForExistence(timeout: 20))
            capture("05-impostazioni")
            app.terminate()
            try launch()
            let empty = patient("Vuoto")
            if empty.waitForExistence(timeout: 30) {
                empty.tap(); _ = name.waitForExistence(timeout: 15); diary()
                XCTAssertTrue(app.staticTexts["Nessuna voce diario caricata."].waitForExistence(timeout: 5))
                capture("06-vuoto")
            }
            app.terminate()
            try launch("patients", error: true)
            _ = app.staticTexts.matching(NSPredicate(format:"label CONTAINS[c] 'PIN' OR label CONTAINS[c] 'credenzial' OR label CONTAINS[c] 'errore'")).firstMatch.waitForExistence(timeout: 20)
            capture("07-errore")
            app.terminate()
        }
    }
}
