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

    func presentedMenu(in app: XCUIApplication) -> XCUIElement {
        let menu = app.menus.firstMatch
        if menu.exists { return menu }
        return app.descendants(matching: .any).matching(NSPredicate(
            format: "identifier == %@ OR label == %@", "Context Menu", "Context Menu")).firstMatch
    }

    func choose(menuItem: String, in app: XCUIApplication,
                opensSubmenu: Bool = false, timeout: TimeInterval = 30,
                file: StaticString = #filePath, line: UInt = #line,
                effect: @escaping () -> Bool) {
        var previousFrame: CGRect?
        var previousMenuFrame: CGRect?
        let stable = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            let menu = self.presentedMenu(in: app)
            let items = menu.buttons.matching(NSPredicate(
                format: "identifier == %@ OR label == %@", menuItem, menuItem))
            guard menu.exists, items.count == 1 else {
                previousFrame = nil
                previousMenuFrame = nil
                return false
            }
            let item = items.element
            guard item.isHittable, item.isEnabled else {
                previousFrame = nil
                previousMenuFrame = nil
                return false
            }
            let frame = item.frame
            let menuFrame = menu.frame
            defer {
                previousFrame = frame
                previousMenuFrame = menuFrame
            }
            return !frame.isEmpty && frame == previousFrame && menuFrame == previousMenuFrame
        }, object: nil)
        let ready = XCTWaiter.wait(for: [stable], timeout: timeout)
        guard ready == .completed else {
            attachUIReadinessDiagnostics(in: app, named: "Menu non stabile - \(menuItem)")
            XCTFail("La voce del menu deve essere univoca, raggiungibile e stabile: \(menuItem)", file: file, line: line)
            return
        }
        let menu = presentedMenu(in: app)
        menu.buttons.matching(NSPredicate(
            format: "identifier == %@ OR label == %@", menuItem, menuItem)).element.tap()
        let selected = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            let currentMenu = self.presentedMenu(in: app)
            if opensSubmenu {
                let previousItem = currentMenu.buttons.matching(NSPredicate(
                    format: "identifier == %@ OR label == %@", menuItem, menuItem)).firstMatch
                return currentMenu.exists && !previousItem.isHittable && effect()
            }
            return !currentMenu.exists && effect()
        }, object: nil)
        let result = XCTWaiter.wait(for: [selected], timeout: timeout)
        if result != .completed {
            attachUIReadinessDiagnostics(in: app, named: "Effetto assente dopo il tap - \(menuItem)")
        }
        XCTAssertEqual(result, .completed, "La scelta deve produrre lo stato atteso: \(menuItem)",
                       file: file, line: line)
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
