/* @Codex */
import Foundation
import XCTest
@testable import MediFlowAppleShared

@MainActor
final class VisitRecordingCaptureTests: XCTestCase {
    private let binding = VisitRecordingBinding(patientRef: "synthetic-patient", revision: 7)

    func testBoundedPCMIsConsumedWithoutDropAndOnlyFinalResultsReachReview() async throws {
        let runtime = FakeVisitRecordingRuntime()
        runtime.finishResults = [
            .init(text: "Bozza parziale da ignorare.", isFinal: false),
            .init(text: "Colloquio sintetico", isFinal: true),
            .init(text: "finale.", isFinal: true),
        ]
        let controller = try makeController(runtime: runtime)

        await controller.start()
        runtime.emit(.synthetic(durationSeconds: 4, byteCount: 8 * 1_024 * 1_024))
        await waitUntil { runtime.consumedFrames.count == 1 }
        await controller.stop()

        XCTAssertEqual(runtime.consumedFrames.count, 1)
        XCTAssertEqual(runtime.finishCount, 1)
        XCTAssertEqual(controller.session.phase, .transcriptReview)
        XCTAssertEqual(controller.session.transcript, "Colloquio sintetico finale.")
    }

    func testPCMFramesAreConsumedInOrderWithoutSilentDrop() async throws {
        let runtime = FakeVisitRecordingRuntime()
        runtime.finishResults = [.init(text: "Testo sintetico finale.", isFinal: true)]
        let controller = try makeController(runtime: runtime)
        let frames = [
            VisitRecordingPCMFrame.synthetic(durationSeconds: 0.1, byteCount: 1_600),
            .synthetic(durationSeconds: 0.2, byteCount: 3_200),
            .synthetic(durationSeconds: 0.3, byteCount: 4_800),
        ]

        await controller.start()
        frames.forEach(runtime.emit)
        await waitUntil { runtime.consumedFrames.count == frames.count }
        await controller.stop()

        XCTAssertTrue(zip(runtime.consumedFrames, frames).allSatisfy { $0.0 === $0.1 })
        XCTAssertEqual(controller.session.phase, .transcriptReview)
    }

    func testOverflowFailsClosedInsteadOfDroppingAFrame() async throws {
        let runtime = FakeVisitRecordingRuntime()
        runtime.suspendConsumption = true
        let controller = try makeController(runtime: runtime)

        await controller.start()
        runtime.emit(.synthetic(durationSeconds: 4, byteCount: 8 * 1_024 * 1_024))
        await waitUntil { runtime.consumedFrames.count == 1 }
        runtime.emit(.synthetic(durationSeconds: 0.001, byteCount: 1))
        await waitUntil { controller.session.phase == .denied(.bufferExceeded) }

        XCTAssertEqual(runtime.consumedFrames.count, 1)
        XCTAssertEqual(runtime.cancelCount, 1)
        XCTAssertNil(controller.session.transcript)
    }

    func testCancelIsIdempotentClearsWorkAndNeverFinalizes() async throws {
        let runtime = FakeVisitRecordingRuntime()
        runtime.suspendConsumption = true
        let controller = try makeController(runtime: runtime)

        await controller.start()
        runtime.emit(.synthetic(durationSeconds: 1, byteCount: 16_000))
        await waitUntil { runtime.consumedFrames.count == 1 }
        await controller.cancel()
        await controller.cancel()
        runtime.emitResult(.init(text: "Risultato tardivo.", isFinal: true))

        XCTAssertEqual(controller.session.phase, .denied(.cancelled))
        XCTAssertEqual(runtime.stopCount, 1)
        XCTAssertEqual(runtime.cancelCount, 1)
        XCTAssertEqual(runtime.activeConsumptionCount, 0)
        XCTAssertEqual(runtime.finishCount, 0)
        XCTAssertNil(controller.session.transcript)
    }

    func testInvalidPCMUsageFailsClosed() async throws {
        let runtime = FakeVisitRecordingRuntime()
        let controller = try makeController(runtime: runtime)

        await controller.start()
        runtime.emit(.synthetic(durationSeconds: .nan, byteCount: 1))
        await waitUntil { controller.session.phase == .denied(.invalidUsage) }

        XCTAssertEqual(runtime.cancelCount, 1)
        XCTAssertNil(controller.session.transcript)
    }

    func testAnalyzerFailureDuringConsumptionCancelsWithoutFinalizing() async throws {
        let runtime = FakeVisitRecordingRuntime()
        runtime.consumeError = SyntheticCaptureError.failure
        let controller = try makeController(runtime: runtime)

        await controller.start()
        runtime.emit(.synthetic(durationSeconds: 1, byteCount: 16_000))
        await waitUntil { runtime.consumedFrames.count == 1 }
        await controller.stop()

        XCTAssertEqual(controller.session.phase, .denied(.failed))
        XCTAssertEqual(runtime.cancelCount, 1)
        XCTAssertEqual(runtime.finishCount, 0)
    }

    func testCaptureStartFailureCleansPreparedAnalyzer() async throws {
        let runtime = FakeVisitRecordingRuntime()
        runtime.startError = SyntheticCaptureError.failure
        let controller = try makeController(runtime: runtime)

        await controller.start()

        XCTAssertEqual(controller.session.phase, .denied(.failed))
        XCTAssertEqual(runtime.startCount, 1)
        XCTAssertEqual(runtime.stopCount, 1)
        XCTAssertEqual(runtime.cancelCount, 1)
    }

    func testStaleBindingDiscardsFinalTranscript() async throws {
        let runtime = FakeVisitRecordingRuntime()
        runtime.finishResults = [.init(text: "Testo sintetico finale.", isFinal: true)]
        var currentBinding: VisitRecordingBinding? = binding
        let controller = try makeController(runtime: runtime) { currentBinding }

        await controller.start()
        currentBinding = .init(patientRef: "synthetic-patient", revision: 8)
        await controller.stop()

        XCTAssertEqual(controller.session.phase, .denied(.staleBinding))
        XCTAssertNil(controller.session.transcript)
    }

    func testStaleBindingBeforeStartNeverOpensTheMicrophoneRuntime() async throws {
        let runtime = FakeVisitRecordingRuntime()
        let stale = VisitRecordingBinding(patientRef: "synthetic-patient", revision: 8)
        let controller = try makeController(runtime: runtime) { stale }

        await controller.start()

        XCTAssertEqual(controller.session.phase, .denied(.staleBinding))
        XCTAssertEqual(runtime.prepareCount, 0)
        XCTAssertEqual(runtime.startCount, 0)
    }

    func testCancellationFromTranscriptReviewClearsClinicalText() async throws {
        let runtime = FakeVisitRecordingRuntime()
        runtime.finishResults = [.init(text: "Testo sintetico finale.", isFinal: true)]
        let controller = try makeController(runtime: runtime)

        await controller.start()
        await controller.stop()
        XCTAssertEqual(controller.session.phase, .transcriptReview)

        await controller.cancel()

        XCTAssertEqual(controller.session.phase, .denied(.cancelled))
        XCTAssertNil(controller.session.transcript)
        XCTAssertEqual(runtime.cancelCount, 0)
    }

    func testTranscriptOverflowFailsClosed() async throws {
        let runtime = FakeVisitRecordingRuntime()
        runtime.finishResults = [
            .init(text: String(repeating: "a", count: 256 * 1_024 + 1), isFinal: true),
        ]
        let controller = try makeController(runtime: runtime)

        await controller.start()
        await controller.stop()

        XCTAssertEqual(controller.session.phase, .denied(.transcriptExceeded))
        XCTAssertNil(controller.session.transcript)
    }

    func testFinalResultStreamFailureCannotPublishEarlierFinalText() async throws {
        let runtime = FakeVisitRecordingRuntime()
        runtime.finishResults = [.init(text: "Risultato sintetico incompleto.", isFinal: true)]
        runtime.finishError = SyntheticCaptureError.failure
        let controller = try makeController(runtime: runtime)

        await controller.start()
        await controller.stop()

        XCTAssertEqual(controller.session.phase, .denied(.failed))
        XCTAssertNil(controller.session.transcript)
        XCTAssertEqual(runtime.cancelCount, 1)
    }

    func testInterruptionFailsClosedAndCleansUpOnce() async throws {
        let runtime = FakeVisitRecordingRuntime()
        let controller = try makeController(runtime: runtime)

        await controller.start()
        runtime.triggerInterruption()
        await waitUntil { controller.session.phase == .denied(.interrupted) }
        runtime.triggerInterruption()
        await Task.yield()

        XCTAssertEqual(runtime.stopCount, 1)
        XCTAssertEqual(runtime.cancelCount, 1)
    }

    func testDurationLimitTerminatesTheSession() async throws {
        let runtime = FakeVisitRecordingRuntime()
        let controller = try makeController(runtime: runtime, durationNanoseconds: 10_000_000)

        await controller.start()
        try await Task.sleep(nanoseconds: 50_000_000)

        XCTAssertEqual(controller.session.phase, .denied(.sessionDurationExceeded))
        XCTAssertEqual(runtime.cancelCount, 1)
    }

    func testRuntimeSourceCannotPersistOrTransmitAudio() throws {
        var root = URL(fileURLWithPath: #filePath)
        for _ in 0..<5 { root.deleteLastPathComponent() }
        let sourceNames = ["VisitRecordingCapture.swift", "AppleVisitRecordingRuntime.swift"]
        let source = try sourceNames.map { name in
            try String(
                contentsOf: root.appendingPathComponent(
                    "native/MediFlowMac/Sources/MediFlowAppleShared/\(name)"
                ),
                encoding: .utf8
            )
        }.joined(separator: "\n")
        for forbidden in ["AVAudioFile", "FileManager", "URLSession", "SFSpeech", "Fluid", "MediaRecorder"] {
            XCTAssertFalse(source.contains(forbidden), "forbidden recording boundary: \(forbidden)")
        }
    }

    private func makeController(
        runtime: FakeVisitRecordingRuntime,
        limits: VisitRecordingLimits = .standard,
        durationNanoseconds: UInt64? = nil,
        currentBinding: (@MainActor () -> VisitRecordingBinding?)? = nil
    ) throws -> VisitRecordingCaptureController {
        let resolvedBinding: @MainActor () -> VisitRecordingBinding? = currentBinding ?? { self.binding }
        return try VisitRecordingCaptureController(
            binding: binding,
            runtime: runtime,
            limits: limits,
            durationNanoseconds: durationNanoseconds,
            currentBinding: resolvedBinding
        )
    }

    private func waitUntil(
        _ predicate: @escaping @MainActor () -> Bool,
        file: StaticString = #filePath,
        line: UInt = #line
    ) async {
        for _ in 0..<1_000 {
            if predicate() { return }
            await Task.yield()
        }
        XCTFail("condition not reached", file: file, line: line)
    }
}

@MainActor
private final class FakeVisitRecordingRuntime: VisitRecordingRuntimePort {
    var finishResults: [VisitRecordingTranscriptResult] = []
    var suspendConsumption = false
    var consumeError: Error?
    var finishError: Error?
    var startError: Error?
    private(set) var consumedFrames: [VisitRecordingPCMFrame] = []
    private(set) var stopCount = 0
    private(set) var prepareCount = 0
    private(set) var startCount = 0
    private(set) var finishCount = 0
    private(set) var cancelCount = 0
    private(set) var activeConsumptionCount = 0

    private var frameHandler: (@Sendable (VisitRecordingPCMFrame) -> Void)?
    private var resultHandler: (@MainActor @Sendable (VisitRecordingTranscriptResult) -> Void)?
    private var interruptionHandler: (@Sendable () -> Void)?
    private var consumptionContinuations: [CheckedContinuation<Void, Never>] = []

    func prepare(
        onFrame: @escaping @Sendable (VisitRecordingPCMFrame) -> Void,
        onResult: @escaping @MainActor @Sendable (VisitRecordingTranscriptResult) -> Void,
        onInterruption: @escaping @Sendable () -> Void,
        onFailure: @escaping @Sendable () -> Void
    ) async throws {
        prepareCount += 1
        frameHandler = onFrame
        resultHandler = onResult
        interruptionHandler = onInterruption
    }

    func startCapture() throws {
        startCount += 1
        if let startError { throw startError }
    }

    func consume(_ frame: VisitRecordingPCMFrame) async throws {
        consumedFrames.append(frame)
        activeConsumptionCount += 1
        defer { activeConsumptionCount -= 1 }
        if let consumeError { throw consumeError }
        if suspendConsumption {
            await withCheckedContinuation { consumptionContinuations.append($0) }
        }
    }

    func stopCapture() { stopCount += 1 }

    func finishAndFinalize() async throws {
        finishCount += 1
        finishResults.forEach { resultHandler?($0) }
        if let finishError { throw finishError }
    }

    func cancelAndFinishNow() async {
        cancelCount += 1
        let continuations = consumptionContinuations
        consumptionContinuations.removeAll()
        continuations.forEach { $0.resume() }
    }

    func emit(_ frame: VisitRecordingPCMFrame) { frameHandler?(frame) }
    func emitResult(_ result: VisitRecordingTranscriptResult) { resultHandler?(result) }
    func triggerInterruption() { interruptionHandler?() }
}

private enum SyntheticCaptureError: Error { case failure }
