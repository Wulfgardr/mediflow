import XCTest

extension XCTestCase {
    func waitForUIReady(_ element: XCUIElement, in app: XCUIApplication,
                        timeout: TimeInterval = 30,
                        file: StaticString = #filePath, line: UInt = #line) {
        let ready = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "exists == true AND hittable == true AND enabled == true"),
            object: element)
        let result = XCTWaiter.wait(for: [ready], timeout: timeout)
        if result != .completed {
            attachUIReadinessDiagnostics(in: app, named: "Controllo non pronto - \(element)")
        }
        XCTAssertEqual(result, .completed,
                       "Il controllo deve essere visibile e abilitato: \(element)", file: file, line: line)
    }

    func attachUIReadinessDiagnostics(in app: XCUIApplication, named name: String) {
        let tree = app.debugDescription
        let accessibilityTree = XCTAttachment(string: tree)
        accessibilityTree.name = "\(name) - albero accessibilità"
        accessibilityTree.lifetime = .keepAlways
        add(accessibilityTree)
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "\(name) - schermata"
        screenshot.lifetime = .keepAlways
        add(screenshot)
        print("\(name): \(tree)")
    }
}
