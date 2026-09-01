/* @Codex */
import Foundation
import XCTest
@testable import MediFlowAppleShared

@MainActor
final class VisitRecordingPreflightTests: XCTestCase {
    func testPermissionStartsOnlyAfterAcceptedDisclosureAndReturnsToMainActor() async {
        let permission = PermissionSpy(granted: true, completesOnBackgroundQueue: true)
        let assets = AssetSpy()
        let preflight = VisitRecordingPreflight(permission: permission, assets: assets)

        XCTAssertEqual(permission.requestCount, 0)
        XCTAssertEqual(preflight.state, .awaitingAcceptedDisclosure)

        await preflight.acceptDisclosureAndPrepare()

        XCTAssertEqual(permission.requestCount, 1)
        XCTAssertTrue(assets.resolveLocaleRanOnMainActor)
        XCTAssertEqual(preflight.state, .ready)
    }

    func testPermissionDenialIsTerminalAndDoesNotTouchSpeechAssets() async {
        let permission = PermissionSpy(granted: false)
        let assets = AssetSpy()
        let preflight = VisitRecordingPreflight(permission: permission, assets: assets)

        await preflight.acceptDisclosureAndPrepare()
        await preflight.acceptDisclosureAndPrepare()

        XCTAssertEqual(preflight.state, .permissionDenied)
        XCTAssertEqual(permission.requestCount, 1)
        XCTAssertEqual(assets.resolveCount, 0)
    }

    func testPreflightUsesOnlyItalianLocaleAndCapturesInventoryReceipt() async {
        let assets = AssetSpy()
        assets.installed = [Locale(identifier: "fr-FR"), Locale(identifier: "it-IT")]
        assets.maximumReservedLocales = 3
        let preflight = makePreflight(assets: assets)

        await preflight.acceptDisclosureAndPrepare()

        XCTAssertEqual(assets.requestedLocaleIdentifiers, ["it-IT"])
        XCTAssertEqual(preflight.resolvedLocaleIdentifier, "it-IT")
        XCTAssertEqual(preflight.installedLocaleIdentifiers, ["fr-FR", "it-IT"])
        XCTAssertEqual(preflight.maximumReservedLocales, 3)
        XCTAssertEqual(preflight.state, .ready)
    }

    func testUnavailableSpeechAndUnsupportedLocaleFailClosed() async {
        let unavailableAssets = AssetSpy()
        unavailableAssets.isAvailable = false
        let unavailable = makePreflight(assets: unavailableAssets)
        await unavailable.acceptDisclosureAndPrepare()
        XCTAssertEqual(unavailable.state, .unavailable(.speechUnavailable))

        let unsupportedAssets = AssetSpy()
        unsupportedAssets.resolvedLocale = nil
        let unsupported = makePreflight(assets: unsupportedAssets)
        await unsupported.acceptDisclosureAndPrepare()
        XCTAssertEqual(unsupported.state, .unavailable(.unsupportedItalianLocale))
    }

    func testInstallationRequestIsSeparateAndNilRequestFailsClosed() async {
        let assets = AssetSpy()
        assets.currentStatus = .supported
        let preflight = makePreflight(assets: assets)

        await preflight.acceptDisclosureAndPrepare()

        XCTAssertEqual(preflight.state, .installationRequired)
        XCTAssertEqual(assets.installationRequestCount, 0)

        await preflight.installAssetsAfterExplicitRequest()

        XCTAssertEqual(assets.installationRequestCount, 1)
        XCTAssertEqual(preflight.state, .unavailable(.installationRequestUnavailable))
    }

    func testInstallFailureExposesProgressAndFailsClosed() async {
        let assets = AssetSpy()
        assets.currentStatus = .supported
        assets.installationRequestExists = true
        assets.downloadError = SyntheticError.failure
        let preflight = makePreflight(assets: assets)

        await preflight.acceptDisclosureAndPrepare()
        await preflight.installAssetsAfterExplicitRequest()

        XCTAssertTrue(preflight.installationProgress === assets.progress)
        XCTAssertEqual(assets.downloadCount, 1)
        XCTAssertEqual(preflight.state, .unavailable(.installationFailed))
    }

    func testSuccessfulInstallRefreshesInventoryReservesAndReleasesOnce() async {
        let assets = AssetSpy()
        assets.statuses = [.supported, .installed]
        assets.installed = []
        assets.installationRequestExists = true
        assets.installAddsResolvedLocale = true
        let preflight = makePreflight(assets: assets)

        await preflight.acceptDisclosureAndPrepare()
        await preflight.installAssetsAfterExplicitRequest()

        XCTAssertEqual(preflight.state, .ready)
        XCTAssertEqual(preflight.installedLocaleIdentifiers, ["it-IT"])
        XCTAssertEqual(assets.reserveCalls, ["it-IT"])

        await preflight.releaseReservation()
        await preflight.releaseReservation()

        XCTAssertEqual(preflight.state, .released)
        XCTAssertEqual(assets.releaseCalls, ["it-IT"])
    }

    func testReservationFalseAndMaximumReservedLocalesFailClosed() async {
        let falseAssets = AssetSpy()
        falseAssets.reserveResult = false
        let falseReservation = makePreflight(assets: falseAssets)
        await falseReservation.acceptDisclosureAndPrepare()
        XCTAssertEqual(falseReservation.state, .unavailable(.reservationFailed))

        let fullAssets = AssetSpy()
        fullAssets.maximumReservedLocales = 1
        fullAssets.reserved = [Locale(identifier: "fr-FR")]
        let fullInventory = makePreflight(assets: fullAssets)
        await fullInventory.acceptDisclosureAndPrepare()
        XCTAssertEqual(fullInventory.state, .unavailable(.reservationLimitReached))
        XCTAssertTrue(fullAssets.reserveCalls.isEmpty)
    }

    func testFailedReservationReleaseCanBeRetriedExplicitly() async {
        let assets = AssetSpy()
        assets.releaseResult = false
        let preflight = makePreflight(assets: assets)
        await preflight.acceptDisclosureAndPrepare()

        await preflight.releaseReservation()
        XCTAssertEqual(preflight.state, .unavailable(.reservationReleaseFailed))

        assets.releaseResult = true
        await preflight.releaseReservation()
        XCTAssertEqual(preflight.state, .released)
        XCTAssertEqual(assets.releaseCalls, ["it-IT", "it-IT"])
    }

    func testConcurrentReservationReleaseRemainsSingleFlight() async {
        let assets = AssetSpy()
        assets.suspendRelease = true
        let preflight = makePreflight(assets: assets)
        await preflight.acceptDisclosureAndPrepare()

        let first = Task { await preflight.releaseReservation() }
        while assets.releaseCalls.isEmpty { await Task.yield() }
        let second = Task { await preflight.releaseReservation() }
        await Task.yield()

        XCTAssertEqual(assets.releaseCalls, ["it-IT"])
        assets.resumeSuspendedReleases()
        await first.value
        await second.value
        XCTAssertEqual(preflight.state, .released)
    }

    func testAssetUnsupportedOrAlreadyDownloadingRemainsDisabled() async {
        for (status, failure) in [
            (VisitRecordingAssetStatus.unsupported, VisitRecordingPreflightFailure.assetUnsupported),
            (.downloading, .assetDownloading)
        ] {
            let assets = AssetSpy()
            assets.currentStatus = status
            let preflight = makePreflight(assets: assets)
            await preflight.acceptDisclosureAndPrepare()
            XCTAssertEqual(preflight.state, .unavailable(failure))
        }
    }

    func testLiveFactoryIsGatedByMacOS26() {
        if #available(macOS 26.0, *) {
            XCTAssertNotNil(VisitRecordingPreflight.liveIfAvailable())
        } else {
            XCTAssertNil(VisitRecordingPreflight.liveIfAvailable())
        }
    }

    func testMacAppDeclaresMicrophoneUsageInPlistAndXcodeGenSource() throws {
        var repositoryRoot = URL(fileURLWithPath: #filePath)
        for _ in 0..<5 { repositoryRoot.deleteLastPathComponent() }
        let plistURL = repositoryRoot.appendingPathComponent(
            "native/MediFlowAppleApp/Sources/MediFlowMacApp/Info.plist"
        )
        let plistData = try Data(contentsOf: plistURL)
        let plist = try XCTUnwrap(
            PropertyListSerialization.propertyList(from: plistData, format: nil) as? [String: Any]
        )
        let usage = try XCTUnwrap(plist["NSMicrophoneUsageDescription"] as? String)
        XCTAssertFalse(usage.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

        let projectYAML = try String(
            contentsOf: repositoryRoot.appendingPathComponent("native/MediFlowAppleApp/project.yml"),
            encoding: .utf8
        )
        let macTarget = try XCTUnwrap(projectYAML.split(separator: "  MediFlowMacApp:", maxSplits: 1).last)
            .split(separator: "  MediFlowMobileAppUITests:", maxSplits: 1)[0]
        let mobileTarget = projectYAML.split(separator: "  MediFlowMacApp:", maxSplits: 1)[0]
        XCTAssertTrue(macTarget.contains("NSMicrophoneUsageDescription:"))
        XCTAssertFalse(mobileTarget.contains("NSMicrophoneUsageDescription:"))
    }

    private func makePreflight(assets: AssetSpy) -> VisitRecordingPreflight {
        VisitRecordingPreflight(permission: PermissionSpy(granted: true), assets: assets)
    }
}

private enum SyntheticError: Error { case failure }

@MainActor
private final class PermissionSpy: VisitRecordingPermissionPort {
    private let granted: Bool
    private let completesOnBackgroundQueue: Bool
    private(set) var requestCount = 0

    init(granted: Bool, completesOnBackgroundQueue: Bool = false) {
        self.granted = granted
        self.completesOnBackgroundQueue = completesOnBackgroundQueue
    }

    func requestRecordPermission(_ completion: @escaping @Sendable (Bool) -> Void) {
        requestCount += 1
        if completesOnBackgroundQueue {
            let granted = granted
            DispatchQueue.global().async { completion(granted) }
        } else {
            completion(granted)
        }
    }
}

@MainActor
private final class AssetSpy: VisitRecordingAssetPort {
    var isAvailable = true
    var maximumReservedLocales = 8
    var resolvedLocale: Locale? = Locale(identifier: "it-IT")
    var installed: [Locale] = [Locale(identifier: "it-IT")]
    var reserved: [Locale] = []
    var currentStatus: VisitRecordingAssetStatus = .installed
    var statuses: [VisitRecordingAssetStatus] = []
    var reserveResult = true
    var releaseResult = true
    var suspendRelease = false
    var installationRequestExists = false
    var installAddsResolvedLocale = false
    var downloadError: Error?
    let progress = Progress(totalUnitCount: 100)
    private(set) var resolveLocaleRanOnMainActor = false
    private(set) var resolveCount = 0
    private(set) var requestedLocaleIdentifiers: [String] = []
    private(set) var installationRequestCount = 0
    private(set) var downloadCount = 0
    private(set) var reserveCalls: [String] = []
    private(set) var releaseCalls: [String] = []
    private var releaseContinuations: [CheckedContinuation<Void, Never>] = []

    func resolveLocale(equivalentTo locale: Locale) async -> Locale? {
        MainActor.preconditionIsolated()
        resolveLocaleRanOnMainActor = true
        resolveCount += 1
        requestedLocaleIdentifiers.append(locale.identifier)
        return resolvedLocale
    }

    func installedLocales() async -> [Locale] { installed }
    func reservedLocales() async -> [Locale] { reserved }
    func status() async -> VisitRecordingAssetStatus {
        statuses.isEmpty ? currentStatus : statuses.removeFirst()
    }

    func installationRequest() async throws -> VisitRecordingAssetInstallation? {
        installationRequestCount += 1
        guard installationRequestExists else { return nil }
        return VisitRecordingAssetInstallation(progress: progress) { [weak self] in
            guard let self else { return }
            self.downloadCount += 1
            if let downloadError = self.downloadError { throw downloadError }
            if self.installAddsResolvedLocale, let locale = self.resolvedLocale {
                self.installed.append(locale)
            }
        }
    }

    func reserve(locale: Locale) async throws -> Bool {
        reserveCalls.append(locale.identifier)
        return reserveResult
    }

    func release(locale: Locale) async -> Bool {
        releaseCalls.append(locale.identifier)
        if suspendRelease {
            await withCheckedContinuation { releaseContinuations.append($0) }
        }
        return releaseResult
    }

    func resumeSuspendedReleases() {
        suspendRelease = false
        let continuations = releaseContinuations
        releaseContinuations.removeAll()
        continuations.forEach { $0.resume() }
    }
}
