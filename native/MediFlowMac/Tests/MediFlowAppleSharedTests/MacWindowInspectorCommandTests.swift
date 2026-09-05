// @Codex
#if os(macOS)
import XCTest
@testable import MediFlowAppleShared

@MainActor
final class MacWindowInspectorCommandTests: XCTestCase {
    func testWindowSceneModelsDoNotShareSelection() {
        let firstWindow = MediFlowMacSceneModel()
        let secondWindow = MediFlowMacSceneModel()

        firstWindow.select(.agenda)

        XCTAssertEqual(firstWindow.section, .agenda)
        XCTAssertEqual(secondWindow.section, .patients)
    }

    func testFocusedInspectorActionChangesOnlyItsWindow() {
        var firstWindowPresented = false
        var secondWindowPresented = false
        let firstWindow = ClinicalWorkspaceInspectorAction(
            isEnabled: true,
            isPresented: firstWindowPresented,
            toggle: { firstWindowPresented.toggle() }
        )
        let secondWindow = ClinicalWorkspaceInspectorAction(
            isEnabled: true,
            isPresented: secondWindowPresented,
            toggle: { secondWindowPresented.toggle() }
        )

        firstWindow.toggle()

        XCTAssertTrue(firstWindowPresented)
        XCTAssertFalse(secondWindowPresented)
        XCTAssertFalse(secondWindow.isPresented)
    }

}
#endif
