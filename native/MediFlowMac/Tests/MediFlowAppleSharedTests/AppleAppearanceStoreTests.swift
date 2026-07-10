import XCTest
@testable import MediFlowAppleShared

@MainActor
final class AppleAppearanceStoreTests: XCTestCase {
    private var defaults: UserDefaults!

    override func setUp() {
        super.setUp()
        defaults = UserDefaults(suiteName: "AppleAppearanceStoreTests")!
        defaults.removePersistentDomain(forName: "AppleAppearanceStoreTests")
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: "AppleAppearanceStoreTests")
        defaults = nil
        super.tearDown()
    }

    func testThemeDefaultsToSystem() {
        XCTAssertEqual(AppleAppearanceStore(userDefaults: defaults).theme, .system)
    }

    func testThemePersistsAcrossStoreInstances() {
        let store = AppleAppearanceStore(userDefaults: defaults)
        store.theme = .dark

        XCTAssertEqual(AppleAppearanceStore(userDefaults: defaults).theme, .dark)
    }

    func testReduceMotionUsesSystemOrUserOverride() {
        XCTAssertFalse(AppleAppearanceStore.shouldReduceMotion(systemReduceMotion: false, override: false))
        XCTAssertTrue(AppleAppearanceStore.shouldReduceMotion(systemReduceMotion: true, override: false))
        XCTAssertTrue(AppleAppearanceStore.shouldReduceMotion(systemReduceMotion: false, override: true))
    }
}
