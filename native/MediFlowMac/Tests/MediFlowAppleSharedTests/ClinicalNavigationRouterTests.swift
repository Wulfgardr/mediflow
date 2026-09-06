import XCTest
import MediFlowCore
@testable import MediFlowAppleShared

/* @Codex */
@MainActor
final class ClinicalNavigationRouterTests: XCTestCase {
    func testDestinationVocabularyMatchesTheExistingUI() {
        XCTAssertEqual(Set(ClinicalNavigationArea.allCases.map(\.rawValue)), Set(ClinicalWorkspaceSection.allCases.map(\.rawValue)))
        XCTAssertEqual(Set(ClinicalNavigationPatientSection.allCases.map(\.rawValue)), Set(PatientWorkspaceSection.allCases.map(\.rawValue)))
    }

    func testGlobalNavigationUsesNoPatientReader() async {
        let workspace = NavigationWorkspaceFake()
        let router = ClinicalNavigationRouter()
        var areas: [ClinicalNavigationArea] = []
        await router.open(url("area=agenda"), platform: .mobile, workspace: workspace) { areas.append($0) }.value
        XCTAssertEqual(areas, [.agenda])
        XCTAssertTrue(workspace.calls.isEmpty)
        XCTAssertNil(router.patientPresentation)
    }

    func testLockedOrBusyDoesNotReadNavigateOrResumeAfterBecomingReady() async {
        for availability in [ClinicalNavigationAvailability.locked, .busy] {
            let workspace = NavigationWorkspaceFake()
            workspace.navigationAvailability = availability
            let router = ClinicalNavigationRouter()
            var areas: [ClinicalNavigationArea] = []
            await router.open(url(), platform: .mobile, workspace: workspace) { areas.append($0) }.value
            workspace.navigationAvailability = .ready
            await Task.yield()
            XCTAssertTrue(workspace.calls.isEmpty)
            XCTAssertTrue(areas.isEmpty)
            XCTAssertNil(router.patientPresentation)
            XCTAssertNotNil(router.notice)
        }
    }

    func testInvalidOrUnavailableLinkAndUnpreparedSceneLeaveTheCurrentAreaAlone() async {
        let workspace = NavigationWorkspaceFake()
        for (link, target) in [
            (url("area=agenda&token=synthetic"), Optional(workspace)),
            (url("area=host"), Optional(workspace)),
            (url("area=agenda"), nil)
        ] {
            let router = ClinicalNavigationRouter()
            var navigated = false
            await router.open(link, platform: .mobile, workspace: target) { _ in navigated = true }.value
            XCTAssertFalse(navigated)
            XCTAssertNotNil(router.notice)
        }
        XCTAssertTrue(workspace.calls.isEmpty)
    }

    func testPatientSectionOpensOnlyAfterTheWorkspaceAcceptsAndPresentationIsConsumedOnce() async {
        let workspace = NavigationWorkspaceFake()
        let router = ClinicalNavigationRouter()
        var areas: [ClinicalNavigationArea] = []
        await router.open(url(), platform: .mobile, workspace: workspace) { areas.append($0) }.value
        XCTAssertEqual(workspace.calls.map(\.0), ["patient-synthetic-01"])
        XCTAssertEqual(workspace.calls.map(\.1), [.documents])
        XCTAssertEqual(areas, [.patients])
        let first = router.patientPresentation
        XCTAssertEqual(first?.patientID, "patient-synthetic-01")
        first?.consume()
        XCTAssertNil(router.patientPresentation)
        await router.open(url(), platform: .mobile, workspace: workspace) { areas.append($0) }.value
        first?.consume()
        XCTAssertNotNil(router.patientPresentation, "A stale consumer must not dismiss a newer link.")
        router.patientPresentation?.consume()
        XCTAssertNil(router.patientPresentation)
    }

    func testBlockedMissingOrFailedReadDoesNotPublishSelectionPresentation() async {
        for result in [ClinicalNavigationPatientResult.blocked, .notFound, .failed, .superseded] {
            let workspace = NavigationWorkspaceFake()
            workspace.handler = { _, _, _ in result }
            let router = ClinicalNavigationRouter()
            var navigated = false
            await router.open(url(), platform: .macOS, workspace: workspace) { _ in navigated = true }.value
            XCTAssertFalse(navigated)
            XCTAssertNil(router.patientPresentation)
            XCTAssertFalse(router.notice?.contains("patient-synthetic-01") ?? false)
        }
    }

    func testLatePatientReadCannotReplaceANewerGlobalLink() async {
        let workspace = NavigationWorkspaceFake()
        let gate = NavigationReadGate()
        workspace.handler = { _, _, isCurrent in
            await gate.wait()
            XCTAssertFalse(isCurrent())
            return .opened // Even a callback that ignores cancellation cannot publish a route.
        }
        let router = ClinicalNavigationRouter()
        var areas: [ClinicalNavigationArea] = []
        let first = Task { await router.open(url(), platform: .mobile, workspace: workspace) { areas.append($0) }.value }
        await fulfillment(of: [gate.started], timeout: 2)
        await router.open(url("area=diary"), platform: .mobile, workspace: workspace) { areas.append($0) }.value
        gate.finish()
        await first.value
        XCTAssertEqual(areas, [.diary])
        XCTAssertNil(router.patientPresentation)
        XCTAssertNil(router.notice)
    }

    func testCancelledIntentCannotReviveAfterLockAndUnlock() async {
        let workspace = NavigationWorkspaceFake()
        let gate = NavigationReadGate()
        workspace.handler = { _, _, isCurrent in
            await gate.wait()
            XCTAssertFalse(isCurrent())
            return .opened
        }
        let router = ClinicalNavigationRouter()
        var navigated = false
        let read = Task { await router.open(url(), platform: .macOS, workspace: workspace) { _ in navigated = true }.value }
        await fulfillment(of: [gate.started], timeout: 2)
        workspace.navigationAvailability = .locked
        router.cancel() // The root's session-change subscription also calls this on lock.
        workspace.navigationAvailability = .ready
        gate.finish()
        await read.value
        XCTAssertFalse(navigated)
        XCTAssertNil(router.patientPresentation)
    }

    func testAWorkspaceLockOnCompletionStillPreventsNavigation() async {
        let workspace = NavigationWorkspaceFake()
        workspace.handler = { [weak workspace] _, _, _ in
            workspace?.navigationAvailability = .locked
            return .opened
        }
        let router = ClinicalNavigationRouter()
        var navigated = false
        await router.open(url(), platform: .mobile, workspace: workspace) { _ in navigated = true }.value
        XCTAssertFalse(navigated)
        XCTAssertNil(router.patientPresentation)
        XCTAssertNotNil(router.notice)
    }

    func testIntentAndPresentationAreNotBroadcastBetweenWindows() async {
        let workspace = NavigationWorkspaceFake()
        let first = ClinicalNavigationRouter()
        let second = ClinicalNavigationRouter()
        await first.open(url(), platform: .macOS, workspace: workspace) { _ in }.value
        XCTAssertNotNil(first.patientPresentation)
        XCTAssertNil(second.patientPresentation)
        second.cancel()
        XCTAssertNotNil(first.patientPresentation)
    }

    func testBackToBackReceiptsReserveOnlyTheLatestIntentBeforeTasksStart() async {
        let workspace = NavigationWorkspaceFake()
        let router = ClinicalNavigationRouter()
        var areas: [ClinicalNavigationArea] = []
        let first = router.open(url(), platform: .mobile, workspace: workspace) { areas.append($0) }
        let second = router.open(url("area=agenda"), platform: .mobile, workspace: workspace) { areas.append($0) }
        await first.value
        await second.value
        XCTAssertTrue(workspace.calls.isEmpty)
        XCTAssertEqual(areas, [.agenda])
        XCTAssertNil(router.patientPresentation)
    }

    func testWorkspaceModalBlocksLinksAndIsRecheckedDuringTheRead() async {
        let workspace = NavigationWorkspaceFake()
        let router = ClinicalNavigationRouter()
        var modalIsOpen = true
        let owner = UUID()
        router.interactionScope.register(owner, { modalIsOpen })
        var navigated = false
        await router.open(url(), platform: .mobile, workspace: workspace) { _ in navigated = true }.value
        XCTAssertTrue(workspace.calls.isEmpty)
        XCTAssertFalse(navigated)
        modalIsOpen = false
        let gate = NavigationReadGate()
        workspace.handler = { _, _, isCurrent in
            await gate.wait()
            XCTAssertFalse(isCurrent())
            return .opened
        }
        let read = router.open(url(), platform: .mobile, workspace: workspace) { _ in navigated = true }
        await fulfillment(of: [gate.started], timeout: 2)
        modalIsOpen = true
        gate.finish()
        await read.value
        XCTAssertFalse(navigated)
        router.interactionScope.unregister(owner)
    }

    private func url(_ query: String = "area=patients&paziente=patient-synthetic-01&section=documents") -> URL {
        URL(string: "mediflow://navigate?\(query)")!
    }
}

@MainActor
private final class NavigationWorkspaceFake: ClinicalNavigationWorkspace {
    var navigationAvailability: ClinicalNavigationAvailability = .ready
    var calls: [(String, ClinicalNavigationPatientSection)] = []
    var handler: (String, ClinicalNavigationPatientSection, @escaping @MainActor () -> Bool) async -> ClinicalNavigationPatientResult = {
        _, _, _ in .opened
    }

    func openNavigationPatient(
        id: String, section: ClinicalNavigationPatientSection,
        isCurrent: @escaping @MainActor () -> Bool
    ) async -> ClinicalNavigationPatientResult {
        calls.append((id, section))
        return await handler(id, section, isCurrent)
    }
}

@MainActor
private final class NavigationReadGate {
    let started = XCTestExpectation(description: "Synthetic reader started")
    private var continuation: CheckedContinuation<Void, Never>?

    func wait() async {
        await withCheckedContinuation { continuation in
            self.continuation = continuation
            started.fulfill()
        }
    }

    func finish() {
        continuation?.resume()
        continuation = nil
    }
}
