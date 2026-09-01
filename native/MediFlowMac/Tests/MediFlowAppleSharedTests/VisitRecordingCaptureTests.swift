/* @Codex */
import Foundation
import XCTest
@testable import MediFlowAppleShared

#if os(macOS)
import AVFAudio
#endif

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

        XCTAssertEqual(runtime.consumedFrames.map(\.durationSeconds), frames.map(\.durationSeconds))
        XCTAssertEqual(runtime.consumedFrames.map(\.byteCount), frames.map(\.byteCount))
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
        let initial = VisitRecordingSelectionReference(binding: binding, generation: 1)
        var current: VisitRecordingSelectionReference? = initial
        let controller = try makeController(
            runtime: runtime,
            selectionReference: initial,
            currentSelectionReference: { current }
        )

        await controller.start()
        current = .init(
            binding: .init(patientRef: "synthetic-patient", revision: 8),
            generation: 2
        )
        await controller.stop()

        XCTAssertEqual(controller.session.phase, .denied(.staleBinding))
        XCTAssertNil(controller.session.transcript)
    }

    func testStaleBindingBeforeStartNeverOpensTheMicrophoneRuntime() async throws {
        let runtime = FakeVisitRecordingRuntime()
        let initial = VisitRecordingSelectionReference(binding: binding, generation: 1)
        let stale = VisitRecordingSelectionReference(
            binding: .init(patientRef: "synthetic-patient", revision: 8),
            generation: 2
        )
        let controller = try makeController(
            runtime: runtime,
            selectionReference: initial,
            currentSelectionReference: { stale }
        )

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

    func testSelectionGenerationABAFailsClosedBeforeAnyLateResultCanPublish() async throws {
        let runtime = FakeVisitRecordingRuntime()
        runtime.suspendConsumption = true
        var current = VisitRecordingSelectionReference(binding: binding, generation: 41)
        let controller = try makeController(
            runtime: runtime,
            selectionReference: current,
            currentSelectionReference: { current }
        )

        await controller.start()
        runtime.emit(.synthetic(durationSeconds: 0.1, byteCount: 1_600))
        await waitUntil { runtime.consumedFrames.count == 1 }
        current = VisitRecordingSelectionReference(
            binding: .init(patientRef: "synthetic-other-patient", revision: 1),
            generation: 42
        )
        await controller.selectionDidChange()
        current = VisitRecordingSelectionReference(binding: binding, generation: 43)
        runtime.emitResult(.init(text: "Risultato tardivo.", isFinal: true))

        XCTAssertEqual(controller.session.phase, .denied(.staleBinding))
        XCTAssertNil(controller.session.transcript)
        XCTAssertEqual(runtime.stopCount, 1)
        XCTAssertEqual(runtime.cancelCount, 1)
        XCTAssertEqual(runtime.activeConsumptionCount, 0)
    }

    func testCurrentnessPollStopsCaptureWithoutWaitingForAnotherAudioFrame() async throws {
        let runtime = FakeVisitRecordingRuntime()
        let initial = VisitRecordingSelectionReference(binding: binding, generation: 51)
        var current: VisitRecordingSelectionReference? = initial
        let controller = try makeController(
            runtime: runtime,
            selectionReference: initial,
            currentSelectionReference: { current },
            currentnessPollNanoseconds: 1
        )

        await controller.start()
        current = .init(
            binding: .init(patientRef: "synthetic-other-patient", revision: 1),
            generation: 52
        )
        await waitUntil { controller.session.phase == .denied(.staleBinding) }

        XCTAssertEqual(runtime.stopCount, 1)
        XCTAssertEqual(runtime.cancelCount, 1)
        XCTAssertNil(controller.session.transcript)
    }

    func testConsumeDeadlineFailsClosedAndReleasesEveryAudioReservation() async throws {
        let runtime = FakeVisitRecordingRuntime()
        runtime.suspendConsumption = true
        let controller = try makeController(
            runtime: runtime,
            processingDeadlineNanoseconds: 10_000_000
        )

        await controller.start()
        runtime.emit(.synthetic(durationSeconds: 0.1, byteCount: 1_600))
        await waitUntil { runtime.consumedFrames.count == 1 }
        await controller.stop()

        XCTAssertEqual(controller.session.phase, .denied(.failed))
        XCTAssertEqual(runtime.cancelCount, 1)
        XCTAssertEqual(runtime.audioBudgetSnapshot?.bytes, 0)
        XCTAssertEqual(runtime.audioBudgetSnapshot?.seconds, 0)
    }

    func testFinalizeDeadlineFailsClosedAndRejectsLateCompletion() async throws {
        let runtime = FakeVisitRecordingRuntime()
        runtime.suspendFinalization = true
        let controller = try makeController(
            runtime: runtime,
            processingDeadlineNanoseconds: 10_000_000
        )

        await controller.start()
        await controller.stop()
        runtime.emitResult(.init(text: "Risultato tardivo.", isFinal: true))

        XCTAssertEqual(controller.session.phase, .denied(.failed))
        XCTAssertEqual(runtime.cancelCount, 1)
        XCTAssertNil(controller.session.transcript)
    }

    func testConversionReservationCannotPushInFlightPCMAboveEightMiB() async throws {
        let runtime = FakeVisitRecordingRuntime()
        runtime.conversionReservationBytes = 1
        let controller = try makeController(runtime: runtime)

        await controller.start()
        runtime.emit(.synthetic(durationSeconds: 4, byteCount: 8 * 1_024 * 1_024))
        await waitUntil { controller.session.phase == .denied(.bufferExceeded) }

        XCTAssertEqual(runtime.peakAudioBudgetBytes, 8 * 1_024 * 1_024)
        XCTAssertEqual(runtime.audioBudgetSnapshot?.bytes, 0)
        XCTAssertEqual(runtime.cancelCount, 1)
    }

    func testDisposeReleasesTheSpeechReservationExactlyOnce() async throws {
        let runtime = FakeVisitRecordingRuntime()
        var releaseCount = 0
        let controller = try makeController(
            runtime: runtime,
            releaseReservation: {
                releaseCount += 1
                return true
            }
        )

        await controller.start()
        await controller.dispose()
        await controller.dispose()

        XCTAssertEqual(controller.session.phase, .denied(.cancelled))
        XCTAssertEqual(releaseCount, 1)
        XCTAssertEqual(runtime.stopCount, 1)
        XCTAssertEqual(runtime.cancelCount, 1)
    }

    func testAudioProducerUsesFailClosedTryLockInsteadOfWaiting() throws {
        let budget = VisitRecordingAudioBudget(limits: .standard)
        let reservation = try XCTUnwrap(
            budget.tryReserveSource(durationSeconds: 0.1, byteCount: 1_600).reservation
        )
        let queue = VisitRecordingPCMQueue(lock: AlwaysContendedVisitRecordingLock())
        let frame = VisitRecordingPCMFrame(
            durationSeconds: 0.1,
            byteCount: 1_600,
            reservation: reservation
        )

        XCTAssertEqual(queue.offer(frame), .busy)
        frame.releaseReservation()
        XCTAssertEqual(budget.snapshot.bytes, 0)
    }

#if os(macOS)
    func testBlockPCMConverterHandlesBidirectionalSampleRatesMultipleOutputsAndFlush() throws {
        guard #available(macOS 26.0, *) else { throw XCTSkip("requires macOS 26") }
        try assertConversion(sourceRate: 48_000, targetRate: 16_000, expectedRatio: 1.0 / 3.0)
        try assertConversion(sourceRate: 16_000, targetRate: 48_000, expectedRatio: 3.0)
        try assertConversion(
            sourceRate: 16_000,
            targetRate: 48_000,
            expectedRatio: 3.0,
            sourceFrameCount: 64_000,
            outputFrameCapacity: 1_024
        )
    }
#endif

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
        processingDeadlineNanoseconds: UInt64 = 15_000_000_000,
        selectionReference: VisitRecordingSelectionReference? = nil,
        currentSelectionReference: (@MainActor () -> VisitRecordingSelectionReference?)? = nil,
        currentnessPollNanoseconds: UInt64 = 25_000_000,
        releaseReservation: (@MainActor () async -> Bool)? = nil
    ) throws -> VisitRecordingCaptureController {
        let resolvedReference = selectionReference
            ?? VisitRecordingSelectionReference(binding: binding, generation: 1)
        let resolvedCurrent: @MainActor () -> VisitRecordingSelectionReference? =
            currentSelectionReference ?? { resolvedReference }
        return try VisitRecordingCaptureController(
            selectionReference: resolvedReference,
            runtime: runtime,
            limits: limits,
            durationNanoseconds: durationNanoseconds,
            processingDeadlineNanoseconds: processingDeadlineNanoseconds,
            currentnessPollNanoseconds: currentnessPollNanoseconds,
            currentSelectionReference: resolvedCurrent,
            releaseReservation: releaseReservation
        )
    }

#if os(macOS)
    @available(macOS 26.0, *)
    private func assertConversion(
        sourceRate: Double,
        targetRate: Double,
        expectedRatio: Double,
        sourceFrameCount: AVAudioFrameCount = 1_024,
        outputFrameCapacity: AVAudioFrameCount = 128
    ) throws {
        let sourceFormat = try XCTUnwrap(
            AVAudioFormat(
                commonFormat: .pcmFormatFloat32,
                sampleRate: sourceRate,
                channels: 1,
                interleaved: false
            )
        )
        let targetFormat = try XCTUnwrap(
            AVAudioFormat(
                commonFormat: .pcmFormatFloat32,
                sampleRate: targetRate,
                channels: 1,
                interleaved: false
            )
        )
        let source = try XCTUnwrap(
            AVAudioPCMBuffer(pcmFormat: sourceFormat, frameCapacity: sourceFrameCount)
        )
        source.frameLength = sourceFrameCount
        let budget = VisitRecordingAudioBudget(limits: .standard)
        let sourceBytes = Int(source.audioBufferList.pointee.mBuffers.mDataByteSize)
        let reservation = try XCTUnwrap(
            budget.tryReserveSource(
                durationSeconds: Double(source.frameLength) / sourceRate,
                byteCount: sourceBytes
            ).reservation
        )
        let frame = VisitRecordingPCMFrame(
            durationSeconds: Double(source.frameLength) / sourceRate,
            byteCount: sourceBytes,
            nativeBuffer: source,
            reservation: reservation
        )
        let converter = try VisitRecordingPCMConverter(
            sourceFormat: sourceFormat,
            targetFormat: targetFormat,
            audioBudget: budget,
            outputFrameCapacity: outputFrameCapacity
        )

        let converted = try converter.convert(frame)
        let flushed = try converter.flush()
        let outputs = converted + flushed
        let totalFrames = outputs.reduce(0) { $0 + Int($1.buffer.frameLength) }
        let expectedFrames = Double(source.frameLength) * expectedRatio

        XCTAssertGreaterThan(outputs.count, 1)
        XCTAssertEqual(Double(totalFrames), expectedFrames, accuracy: 64)
        XCTAssertTrue(converter.isFinished)
        outputs.forEach { $0.releaseReservation() }
        frame.releaseReservation()
        XCTAssertLessThanOrEqual(budget.snapshot.peakBytes, 8 * 1_024 * 1_024)
        XCTAssertEqual(budget.snapshot.bytes, 0)
        XCTAssertEqual(budget.snapshot.seconds, 0)
    }
#endif

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
    var suspendFinalization = false
    var conversionReservationBytes = 0
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
    private var failureHandler: (@Sendable (VisitRecordingDenial) -> Void)?
    private var audioBudget: VisitRecordingAudioBudget?
    private var consumptionContinuations: [CheckedContinuation<Void, Never>] = []
    private var finalizationContinuations: [CheckedContinuation<Void, Never>] = []

    var audioBudgetSnapshot: VisitRecordingAudioBudgetSnapshot? { audioBudget?.snapshot }
    var peakAudioBudgetBytes: Int { audioBudget?.snapshot.peakBytes ?? 0 }

    func prepare(
        audioBudget: VisitRecordingAudioBudget,
        onFrame: @escaping @Sendable (VisitRecordingPCMFrame) -> Void,
        onResult: @escaping @MainActor @Sendable (VisitRecordingTranscriptResult) -> Void,
        onInterruption: @escaping @Sendable () -> Void,
        onFailure: @escaping @Sendable (VisitRecordingDenial) -> Void
    ) async throws {
        prepareCount += 1
        self.audioBudget = audioBudget
        frameHandler = onFrame
        resultHandler = onResult
        interruptionHandler = onInterruption
        failureHandler = onFailure
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
        if conversionReservationBytes > 0 {
            guard let audioBudget else { throw SyntheticCaptureError.failure }
            switch audioBudget.reserveConversion(byteCount: conversionReservationBytes) {
            case let .reserved(reservation):
                reservation.release()
            case let .denied(denial):
                throw VisitRecordingRuntimeDenialError(denial: denial)
            }
        }
        if suspendConsumption {
            await withCheckedContinuation { consumptionContinuations.append($0) }
        }
    }

    func stopCapture() { stopCount += 1 }

    func finishAndFinalize() async throws {
        finishCount += 1
        if suspendFinalization {
            await withCheckedContinuation { finalizationContinuations.append($0) }
        }
        finishResults.forEach { resultHandler?($0) }
        if let finishError { throw finishError }
    }

    func cancelAndFinishNow() async {
        cancelCount += 1
        let continuations = consumptionContinuations
        consumptionContinuations.removeAll()
        continuations.forEach { $0.resume() }
        let finalizations = finalizationContinuations
        finalizationContinuations.removeAll()
        finalizations.forEach { $0.resume() }
    }

    func emit(_ frame: VisitRecordingPCMFrame) {
        guard let audioBudget else {
            failureHandler?(.failed)
            return
        }
        switch audioBudget.tryReserveSource(
            durationSeconds: frame.durationSeconds,
            byteCount: frame.byteCount
        ) {
        case let .reserved(reservation):
            frameHandler?(frame.withReservation(reservation))
        case let .denied(denial):
            failureHandler?(denial)
        }
    }
    func emitResult(_ result: VisitRecordingTranscriptResult) { resultHandler?(result) }
    func triggerInterruption() { interruptionHandler?() }
}

private enum SyntheticCaptureError: Error { case failure }

private final class AlwaysContendedVisitRecordingLock: VisitRecordingQueueLock {
    func lock() {}
    func unlock() {}
    func tryLock() -> Bool { false }
}
