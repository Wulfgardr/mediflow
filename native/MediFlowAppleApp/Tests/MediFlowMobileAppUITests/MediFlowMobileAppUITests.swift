import XCTest

/// Interaction tests for the universal app shell on a compact (iPhone) layout:
/// the app launches into the overview and the Liquid Glass tab bar drives the
/// sections. These exercise the real navigation, not just that it compiles.
final class MediFlowMobileAppUITests: XCTestCase {
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
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
        XCTAssertTrue(
            sectionView("apple-foundation-overview-view").waitForExistence(timeout: 20),
            "Overview section should render on launch"
        )
    }

    func testTabBarNavigatesBetweenSections() {
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
        tab("Pazienti").tap()
        XCTAssertTrue(sectionView("apple-foundation-modules-view").waitForExistence(timeout: 10))
        XCTAssertTrue(
            sectionView("homebase-connection-state").waitForExistence(timeout: 10),
            "The clinical workspace should show the home-base connection state"
        )
    }
}
