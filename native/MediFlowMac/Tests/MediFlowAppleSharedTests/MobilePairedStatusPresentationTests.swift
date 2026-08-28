import XCTest
@testable import MediFlowAppleShared

/* @Codex */
final class MobilePairedStatusPresentationTests: XCTestCase {
    func testLoadingAndErrorTakePrecedenceOverConnectionState() {
        let loading = MobilePairedStatusPresentation.make(
            connectionState: .pairedOnline,
            isWorking: true,
            errorMessage: "errore sintetico",
            reconciliationLine: "online"
        )
        XCTAssertEqual(loading.phase, .loading)

        let error = MobilePairedStatusPresentation.make(
            connectionState: .pairedOnline,
            isWorking: false,
            errorMessage: "errore sintetico",
            reconciliationLine: "online"
        )
        XCTAssertEqual(error.phase, .error)
        XCTAssertEqual(error.actionTitle, "Riprova")
    }

    func testOfflineIsExplicitlyReadOnly() {
        let presentation = MobilePairedStatusPresentation.make(
            connectionState: .pairedOfflineDegraded,
            isWorking: false,
            errorMessage: nil,
            reconciliationLine: "Nessuna scrittura mobile disponibile."
        )
        XCTAssertEqual(presentation.phase, .offline)
        XCTAssertTrue(presentation.title.contains("sola lettura"))
        XCTAssertTrue(presentation.detail.contains("Nessuna scrittura"))
    }

    func testStaleCacheOverridesGenericCachedState() {
        let presentation = MobilePairedStatusPresentation.make(
            connectionState: .cached,
            isWorking: false,
            errorMessage: nil,
            reconciliationLine: "Snapshot locale.",
            cacheIsStale: true
        )
        XCTAssertEqual(presentation.phase, .stale)
        XCTAssertEqual(presentation.actionTitle, "Ricollega")
    }
}
