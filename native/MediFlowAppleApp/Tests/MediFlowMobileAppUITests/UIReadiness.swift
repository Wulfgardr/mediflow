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

    private func resolvePresentedMenu(in app: XCUIApplication) -> (element: XCUIElement?, reason: String, isAbsent: Bool) {
        let nativeMenus = app.menus
        if nativeMenus.count > 0 {
            return nativeMenus.count == 1
                ? (nativeMenus.element, "Menu", false)
                : (nil, "Contenitore ambiguo: \(nativeMenus.count) elementi Menu", false)
        }
        let contextMenus = app.descendants(matching: .other).matching(NSPredicate(
            format: "identifier == %@ OR label == %@", "Context Menu", "Context Menu"))
        if contextMenus.count > 0 {
            return contextMenus.count == 1
                ? (contextMenus.element, "Context Menu", false)
                : (nil, "Contenitore ambiguo: \(contextMenus.count) elementi Context Menu", false)
        }
        // Run 40910143577: Picker e Menu espongono l'overlay come
        // Window > Other > Other > Other > Other > Other > CollectionView.
        let collections = app.windows.children(matching: .other)
            .children(matching: .other).children(matching: .other)
            .children(matching: .other).children(matching: .other)
            .children(matching: .collectionView)
        guard collections.count == 1 else {
            return (nil, "Overlay non distinguibile: attesa una CollectionView nel ramo presentato, trovate \(collections.count)", collections.count == 0)
        }
        return (collections.element, "CollectionView dell'overlay", false)
    }

    func presentedMenu(in app: XCUIApplication) -> XCUIElement {
        resolvePresentedMenu(in: app).element
            ?? app.menus.matching(NSPredicate(value: false)).firstMatch
    }

    func choose(menuItem: String, in app: XCUIApplication,
                opensSubmenu: Bool = false, timeout: TimeInterval = 30,
                file: StaticString = #filePath, line: UInt = #line,
                effect: @escaping () -> Bool) {
        var previousFrame: CGRect?
        var previousMenuFrame: CGRect?
        var previousContainer: String?
        var failureReason = "Menu non ancora presentato"
        let stable = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            let resolved = self.resolvePresentedMenu(in: app)
            guard let menu = resolved.element else {
                failureReason = resolved.reason
                previousFrame = nil
                previousMenuFrame = nil
                previousContainer = nil
                return false
            }
            let items = menu.buttons.matching(NSPredicate(
                format: "identifier == %@ OR label == %@", menuItem, menuItem))
            guard menu.exists, items.count == 1 else {
                failureReason = "\(resolved.reason): attesa una voce \(menuItem), trovate \(items.count)"
                previousFrame = nil
                previousMenuFrame = nil
                return false
            }
            let item = items.element
            guard item.isHittable, item.isEnabled else {
                failureReason = "\(resolved.reason): voce \(menuItem) non raggiungibile o disabilitata"
                previousFrame = nil
                previousMenuFrame = nil
                return false
            }
            let frame = item.frame
            let menuFrame = menu.frame
            defer {
                previousFrame = frame
                previousMenuFrame = menuFrame
                previousContainer = resolved.reason
            }
            failureReason = "\(resolved.reason): voce o contenitore ancora in movimento"
            return !frame.isEmpty && !menuFrame.isEmpty && frame == previousFrame
                && menuFrame == previousMenuFrame && resolved.reason == previousContainer
        }, object: nil)
        let ready = XCTWaiter.wait(for: [stable], timeout: timeout)
        guard ready == .completed else {
            attachUIReadinessDiagnostics(in: app, named: "Menu non stabile - \(menuItem)")
            XCTFail("Menu non pronto per \(menuItem): \(failureReason)", file: file, line: line)
            return
        }
        let resolved = resolvePresentedMenu(in: app)
        guard let menu = resolved.element, resolved.reason == previousContainer else {
            attachUIReadinessDiagnostics(in: app, named: "Menu cambiato prima del tap - \(menuItem)")
            XCTFail("Contenitore cambiato prima del tap: \(resolved.reason)", file: file, line: line)
            return
        }
        let items = menu.buttons.matching(NSPredicate(
            format: "identifier == %@ OR label == %@", menuItem, menuItem))
        guard items.count == 1, items.element.isHittable, items.element.isEnabled,
              items.element.frame == previousFrame, menu.frame == previousMenuFrame else {
            attachUIReadinessDiagnostics(in: app, named: "Menu cambiato prima del tap - \(menuItem)")
            XCTFail("Voce o frame cambiati prima del tap: \(menuItem)", file: file, line: line)
            return
        }
        items.element.tap()
        let selected = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            let current = self.resolvePresentedMenu(in: app)
            if opensSubmenu {
                guard let currentMenu = current.element else { return false }
                let previousItem = currentMenu.buttons.matching(NSPredicate(
                    format: "identifier == %@ OR label == %@", menuItem, menuItem)).firstMatch
                return currentMenu.exists && !previousItem.isHittable && effect()
            }
            return !menu.exists && current.isAbsent && effect()
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
