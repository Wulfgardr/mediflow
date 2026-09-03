/* @Codex */
import Foundation
import XCTest
@testable import MediFlowAppleShared

@MainActor
final class VisitRecordingLumeCoordinatorTests: XCTestCase {
    private let binding = VisitRecordingOwnerBinding(
        patientID: "synthetic-patient",
        patientVersion: 7,
        ambulatoryID: "synthetic-ambulatory"
    )

    func testDisclosureMustBeAcceptedBeforePermissionOrAssetsAreTouched() async {
        let permission = LumePermissionSpy(granted: true)
        let assets = LumeAssetSpy()
        let preflight = VisitRecordingPreflight(permission: permission, assets: assets)
        let coordinator = VisitRecordingLumeCoordinator(
            generation: 41,
            makePreflight: { preflight },
            makeCapture: { _, _, _ in nil }
        )

        XCTAssertEqual(coordinator.state, .disclosure)
        XCTAssertEqual(permission.requestCount, 0)
        XCTAssertEqual(assets.resolveCount, 0)

        await coordinator.acceptDisclosure(for: binding, currentBinding: { self.binding })

        XCTAssertEqual(permission.requestCount, 1)
        XCTAssertEqual(assets.resolveCount, 1)
        XCTAssertEqual(coordinator.state, .ready)
    }

    func testAssetInstallationRequiresASecondExplicitAction() async {
        let permission = LumePermissionSpy(granted: true)
        let assets = LumeAssetSpy()
        assets.currentStatus = .supported
        assets.installationRequestExists = true
        let preflight = VisitRecordingPreflight(permission: permission, assets: assets)
        let coordinator = makeCoordinator(preflight: preflight, runtime: LumeRuntimeSpy())

        await coordinator.acceptDisclosure(for: binding, currentBinding: { self.binding })

        XCTAssertEqual(coordinator.state, .installationRequired)
        XCTAssertEqual(assets.installationRequestCount, 0)

        await coordinator.installAssets()

        XCTAssertEqual(assets.installationRequestCount, 1)
        XCTAssertEqual(coordinator.state, .ready)
    }

    func testFinalTranscriptNeedsManualTransferAndNeverDraftsOrWrites() async {
        let assets = LumeAssetSpy()
        let preflight = VisitRecordingPreflight(
            permission: LumePermissionSpy(granted: true),
            assets: assets
        )
        let runtime = LumeRuntimeSpy()
        runtime.finalResults = [
            VisitRecordingTranscriptResult(text: "Trascrizione sintetica finale.", isFinal: true),
        ]
        let coordinator = makeCoordinator(preflight: preflight, runtime: runtime)

        await coordinator.acceptDisclosure(for: binding, currentBinding: { self.binding })
        await coordinator.start()
        XCTAssertEqual(coordinator.state, .recording)

        await coordinator.stop()
        XCTAssertEqual(coordinator.state, .transcriptReview)
        XCTAssertEqual(coordinator.reviewText, "Trascrizione sintetica finale.")

        var destination = ""
        await coordinator.transferTranscript(maxCharacters: 12_000) { destination = $0 }

        XCTAssertEqual(destination, "Trascrizione sintetica finale.")
        XCTAssertEqual(coordinator.state, .completed)
        XCTAssertEqual(coordinator.reviewText, "")
        XCTAssertEqual(assets.releaseCount, 1)
    }

    func testPatientVersionAndAmbulatoryBindingChangesRetireTheConsumer() async {
        for changedBinding in [
            VisitRecordingOwnerBinding(
                patientID: "other-synthetic-patient",
                patientVersion: 7,
                ambulatoryID: "synthetic-ambulatory"
            ),
            VisitRecordingOwnerBinding(
                patientID: "synthetic-patient",
                patientVersion: 8,
                ambulatoryID: "synthetic-ambulatory"
            ),
            VisitRecordingOwnerBinding(
                patientID: "synthetic-patient",
                patientVersion: 7,
                ambulatoryID: "other-synthetic-ambulatory"
            ),
        ] {
            let preflight = VisitRecordingPreflight(
                permission: LumePermissionSpy(granted: true),
                assets: LumeAssetSpy()
            )
            let runtime = LumeRuntimeSpy()
            var current = binding
            let coordinator = makeCoordinator(preflight: preflight, runtime: runtime)
            await coordinator.acceptDisclosure(for: binding, currentBinding: { current })
            await coordinator.start()

            current = changedBinding
            await coordinator.ownerDidChange(to: changedBinding)

            XCTAssertEqual(coordinator.state, .denied(.staleBinding))
            XCTAssertEqual(runtime.cancelCount, 1)
        }
    }

    func testCaptureCurrentnessReaderIncludesAmbulatoryBindingWithoutViewNotification() async {
        let preflight = VisitRecordingPreflight(
            permission: LumePermissionSpy(granted: true),
            assets: LumeAssetSpy()
        )
        let runtime = LumeRuntimeSpy()
        runtime.finalResults = [
            VisitRecordingTranscriptResult(text: "Testo sintetico da scartare.", isFinal: true),
        ]
        var current = binding
        let coordinator = makeCoordinator(preflight: preflight, runtime: runtime)
        await coordinator.acceptDisclosure(for: binding, currentBinding: { current })
        await coordinator.start()

        current = VisitRecordingOwnerBinding(
            patientID: binding.patientID,
            patientVersion: binding.patientVersion,
            ambulatoryID: "other-synthetic-ambulatory"
        )
        await coordinator.stop()

        XCTAssertEqual(coordinator.state, .denied(.staleBinding))
        XCTAssertEqual(coordinator.reviewText, "")
    }

    func testNonFinalSpeechResultNeverReachesReviewOrTransfer() async {
        let preflight = VisitRecordingPreflight(
            permission: LumePermissionSpy(granted: true),
            assets: LumeAssetSpy()
        )
        let runtime = LumeRuntimeSpy()
        runtime.finalResults = [
            VisitRecordingTranscriptResult(text: "Ipotesi sintetica parziale.", isFinal: false),
        ]
        let coordinator = makeCoordinator(preflight: preflight, runtime: runtime)
        await coordinator.acceptDisclosure(for: binding, currentBinding: { self.binding })
        await coordinator.start()
        await coordinator.stop()

        var destination = "unchanged"
        await coordinator.transferTranscript(maxCharacters: 12_000) { destination = $0 }

        XCTAssertEqual(coordinator.state, .denied(.failed))
        XCTAssertEqual(coordinator.reviewText, "")
        XCTAssertEqual(destination, "unchanged")
    }

    func testLifecycleCancellationIsTerminalAndCoalescesRepeatedRequests() async {
        let preflight = VisitRecordingPreflight(
            permission: LumePermissionSpy(granted: true),
            assets: LumeAssetSpy()
        )
        let runtime = LumeRuntimeSpy()
        let coordinator = makeCoordinator(preflight: preflight, runtime: runtime)
        await coordinator.acceptDisclosure(for: binding, currentBinding: { self.binding })
        await coordinator.start()

        await coordinator.cancelForLifecycle()
        await coordinator.cancelForLifecycle()
        await coordinator.start()

        XCTAssertEqual(coordinator.state, .denied(.cancelled))
        XCTAssertEqual(runtime.cancelCount, 1)
        XCTAssertEqual(runtime.startCount, 1)
    }

    func testPermissionDenialIsTerminalWithoutImplicitRetry() async {
        let permission = LumePermissionSpy(granted: false)
        let preflight = VisitRecordingPreflight(permission: permission, assets: LumeAssetSpy())
        let coordinator = makeCoordinator(preflight: preflight, runtime: LumeRuntimeSpy())

        await coordinator.acceptDisclosure(for: binding, currentBinding: { self.binding })
        await coordinator.acceptDisclosure(for: binding, currentBinding: { self.binding })

        XCTAssertEqual(coordinator.state, .permissionDenied)
        XCTAssertEqual(permission.requestCount, 1)
    }

    func testEachCoordinatorOwnsADistinctConsumerGeneration() {
        let first = VisitRecordingLumeCoordinator()
        let second = VisitRecordingLumeCoordinator()

        XCTAssertGreaterThan(first.consumerGeneration, 0)
        XCTAssertGreaterThan(second.consumerGeneration, 0)
        XCTAssertNotEqual(first.consumerGeneration, second.consumerGeneration)
    }

    func testProcessLeaseDeniesASecondRuntimeUntilTheFirstCoordinatorTearsDown() async {
        let firstRuntime = LumeRuntimeSpy()
        let secondRuntime = LumeRuntimeSpy()
        let first = makeCoordinator(
            generation: 51,
            preflight: readyPreflight(),
            runtime: firstRuntime
        )
        let second = makeCoordinator(
            generation: 52,
            preflight: readyPreflight(),
            runtime: secondRuntime
        )

        await first.acceptDisclosure(for: binding, currentBinding: { self.binding })
        await second.acceptDisclosure(for: binding, currentBinding: { self.binding })
        await first.start()
        await second.start()

        XCTAssertEqual(first.state, .recording)
        XCTAssertEqual(second.state, .denied(.failed))
        XCTAssertEqual(firstRuntime.startCount, 1)
        XCTAssertEqual(secondRuntime.prepareCount, 0)
        XCTAssertEqual(secondRuntime.startCount, 0)

        await first.cancelForLifecycle()
        let replacementRuntime = LumeRuntimeSpy()
        let replacement = makeCoordinator(
            generation: 53,
            preflight: readyPreflight(),
            runtime: replacementRuntime
        )
        await replacement.acceptDisclosure(for: binding, currentBinding: { self.binding })
        await replacement.start()

        XCTAssertEqual(replacement.state, .recording)
        XCTAssertEqual(replacementRuntime.startCount, 1)
        await replacement.cancelForLifecycle()
    }

    func testEditedTranscriptOverUTF8LimitCannotTransferEvenBelowCharacterLimit() async {
        let runtime = LumeRuntimeSpy()
        runtime.finalResults = [
            VisitRecordingTranscriptResult(text: "Trascrizione sintetica iniziale.", isFinal: true),
        ]
        let coordinator = makeCoordinator(preflight: readyPreflight(), runtime: runtime)
        await coordinator.acceptDisclosure(for: binding, currentBinding: { self.binding })
        await coordinator.start()
        await coordinator.stop()

        let oversizedSingleGrapheme = "a" + String(repeating: "\u{0301}", count: 140_000)
        XCTAssertLessThanOrEqual(oversizedSingleGrapheme.count, 12_000)
        XCTAssertGreaterThan(
            oversizedSingleGrapheme.utf8.count,
            VisitRecordingLimits.standard.maxTranscriptUTF8Bytes
        )
        coordinator.reviewText = oversizedSingleGrapheme

        var destination = "unchanged"
        XCTAssertFalse(coordinator.canTransferTranscript(maxCharacters: 12_000))
        await coordinator.transferTranscript(maxCharacters: 12_000) { destination = $0 }

        XCTAssertEqual(destination, "unchanged")
        await coordinator.cancelForLifecycle()
    }

    func testShellKeepsLifecycleAccessibilityAndManualReviewBoundariesVisible() throws {
        let sources = try appleFoundationSources(named: [
            "VisitRecordingLumeCoordinator.swift",
            "VisitRecordingLumeShell.swift",
        ])
        let editor = try appleFoundationSources(named: ["ClinicalRichTextEditorView.swift"])

        for required in [
            "Consenti microfono e continua",
            "Installa asset italiano",
            "Registrazione visita in corso",
            "clinical-workspace-visit-recording-stop",
            ".onDisappear",
            "scenePhase != .active",
            "ownerDidChange",
            ".task(id: ownerBinding)",
            "VisitRecordingCaptureController.liveIfAvailable",
        ] {
            XCTAssertTrue(sources.contains(required), "missing shell contract: \(required)")
        }
        XCTAssertTrue(editor.contains("VisitRecordingLumeShell(model: model)"))
        XCTAssertTrue(editor.contains("$model.newEntryVisitTranscript"))
        XCTAssertTrue(editor.contains("computeVisitDraftForNewEntry"))
        XCTAssertTrue(editor.contains("maxTranscriptUTF8Bytes"))
        for forbidden in [
            "computeVisitDraftForNewEntry", "insertVisitDraftIntoNewEntry",
            "createEntryForSelectedPatient", "URLSession", "Logger(", "print(",
        ] {
            XCTAssertFalse(sources.contains(forbidden), "forbidden shell boundary: \(forbidden)")
        }
    }

    private func makeCoordinator(
        generation: UInt64 = 41,
        preflight: VisitRecordingPreflight,
        runtime: LumeRuntimeSpy
    ) -> VisitRecordingLumeCoordinator {
        VisitRecordingLumeCoordinator(
            generation: generation,
            makePreflight: { preflight },
            makeCapture: { reference, preflight, current in
                try? VisitRecordingCaptureController(
                    selectionReference: reference,
                    runtime: runtime,
                    currentSelectionReference: current,
                    releaseReservation: {
                        await preflight.releaseReservation()
                        return preflight.state == .released
                    }
                )
            }
        )
    }

    private func readyPreflight() -> VisitRecordingPreflight {
        VisitRecordingPreflight(
            permission: LumePermissionSpy(granted: true),
            assets: LumeAssetSpy()
        )
    }

    private func appleFoundationSources(named names: [String]) throws -> String {
        var root = URL(fileURLWithPath: #filePath)
        for _ in 0..<3 { root.deleteLastPathComponent() }
        let directory = root.appendingPathComponent("Sources/MediFlowAppleShared/AppleFoundation")
        return try names.map {
            try String(contentsOf: directory.appendingPathComponent($0), encoding: .utf8)
        }.joined(separator: "\n")
    }
}

@MainActor
private final class LumePermissionSpy: VisitRecordingPermissionPort {
    private let granted: Bool
    private(set) var requestCount = 0

    init(granted: Bool) { self.granted = granted }

    func requestRecordPermission(_ completion: @escaping @Sendable (Bool) -> Void) {
        requestCount += 1
        completion(granted)
    }
}

@MainActor
private final class LumeAssetSpy: VisitRecordingAssetPort {
    var isAvailable = true
    var maximumReservedLocales = 4
    var currentStatus = VisitRecordingAssetStatus.installed
    var installationRequestExists = false
    private(set) var resolveCount = 0
    private(set) var installationRequestCount = 0
    private(set) var releaseCount = 0

    func resolveLocale(equivalentTo locale: Locale) async -> Locale? {
        resolveCount += 1
        return Locale(identifier: "it-IT")
    }

    func installedLocales() async -> [Locale] { [Locale(identifier: "it-IT")] }
    func reservedLocales() async -> [Locale] { [] }
    func status() async -> VisitRecordingAssetStatus { currentStatus }

    func installationRequest() async throws -> VisitRecordingAssetInstallation? {
        installationRequestCount += 1
        guard installationRequestExists else { return nil }
        return VisitRecordingAssetInstallation(progress: Progress(totalUnitCount: 1)) { [weak self] in
            self?.currentStatus = .installed
        }
    }

    func reserve(locale: Locale) async throws -> Bool { true }
    func release(locale: Locale) async -> Bool {
        releaseCount += 1
        return true
    }
}

@MainActor
private final class LumeRuntimeSpy: VisitRecordingRuntimePort {
    var finalResults: [VisitRecordingTranscriptResult] = []
    private(set) var prepareCount = 0
    private(set) var startCount = 0
    private(set) var cancelCount = 0
    private var resultHandler: (@MainActor @Sendable (VisitRecordingTranscriptResult) -> Void)?

    func prepare(
        audioBudget: VisitRecordingAudioBudget,
        onFrame: @escaping @Sendable (VisitRecordingPCMFrame) -> Void,
        onResult: @escaping @MainActor @Sendable (VisitRecordingTranscriptResult) -> Void,
        onInterruption: @escaping @Sendable () -> Void,
        onFailure: @escaping @Sendable (VisitRecordingDenial) -> Void
    ) async throws {
        prepareCount += 1
        resultHandler = onResult
    }

    func startCapture() throws { startCount += 1 }
    func consume(_ frame: VisitRecordingPCMFrame) async throws {}
    func stopCapture() {}

    func finishAndFinalize() async throws {
        finalResults.forEach { resultHandler?($0) }
    }

    func cancelAndFinishNow() async { cancelCount += 1 }
}
