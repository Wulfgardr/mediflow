/* @Codex */
import Foundation

public struct VisitRecordingSelectionReference: Equatable, Sendable {
    public let binding: VisitRecordingBinding
    public let generation: UInt64

    public init(binding: VisitRecordingBinding, generation: UInt64) {
        self.binding = binding
        self.generation = generation
    }
}

final class VisitRecordingAudioReservation: @unchecked Sendable {
    fileprivate let byteCount: Int
    fileprivate let durationSeconds: Double
    private weak var budget: VisitRecordingAudioBudget?
    private let lock = NSLock()
    private var released = false

    fileprivate init(
        budget: VisitRecordingAudioBudget,
        byteCount: Int,
        durationSeconds: Double
    ) {
        self.budget = budget
        self.byteCount = byteCount
        self.durationSeconds = durationSeconds
    }

    func release() {
        lock.lock()
        guard !released else { lock.unlock(); return }
        released = true
        let budget = self.budget
        lock.unlock()
        budget?.release(byteCount: byteCount, durationSeconds: durationSeconds)
    }

    func releaseOffAudioThread() {
        Task.detached(priority: .high) { [self] in release() }
    }
}

enum VisitRecordingAudioReserveResult {
    case reserved(VisitRecordingAudioReservation)
    case denied(VisitRecordingDenial)

    var reservation: VisitRecordingAudioReservation? {
        guard case let .reserved(value) = self else { return nil }
        return value
    }

    var denial: VisitRecordingDenial? {
        guard case let .denied(value) = self else { return nil }
        return value
    }
}

struct VisitRecordingAudioBudgetSnapshot: Equatable, Sendable {
    let bytes: Int
    let seconds: Double
    let peakBytes: Int
}

final class VisitRecordingAudioBudget: @unchecked Sendable {
    private let lock = NSLock()
    private let limits: VisitRecordingLimits
    private var bytes = 0
    private var seconds = 0.0
    private var peakBytes = 0

    init(limits: VisitRecordingLimits) {
        self.limits = limits
    }

    func tryReserveSource(durationSeconds: Double, byteCount: Int) -> VisitRecordingAudioReserveResult {
        guard durationSeconds.isFinite, durationSeconds >= 0, byteCount >= 0 else {
            return .denied(.invalidUsage)
        }
        guard lock.try() else { return .denied(.bufferExceeded) }
        defer { lock.unlock() }
        return reserveLocked(durationSeconds: durationSeconds, byteCount: byteCount)
    }

    func reserveConversion(byteCount: Int) -> VisitRecordingAudioReserveResult {
        guard byteCount >= 0 else { return .denied(.invalidUsage) }
        lock.lock()
        defer { lock.unlock() }
        return reserveLocked(durationSeconds: 0, byteCount: byteCount)
    }

    var maximumBufferedAudioSeconds: Double { limits.maxBufferedAudioSeconds }

    func maximumConversionOutputAttempts(bytesPerBuffer: Int) -> Int {
        guard bytesPerBuffer > 0 else { return 1 }
        let buffersWithinBudget = limits.maxBufferedAudioBytes / bytesPerBuffer
        guard buffersWithinBudget < Int.max else { return Int.max }
        return max(1, buffersWithinBudget + 1)
    }

    var snapshot: VisitRecordingAudioBudgetSnapshot {
        lock.lock()
        defer { lock.unlock() }
        return .init(bytes: bytes, seconds: seconds, peakBytes: peakBytes)
    }

    fileprivate func release(byteCount: Int, durationSeconds: Double) {
        lock.lock()
        bytes = max(0, bytes - byteCount)
        seconds = max(0, seconds - durationSeconds)
        lock.unlock()
    }

    private func reserveLocked(
        durationSeconds: Double,
        byteCount: Int
    ) -> VisitRecordingAudioReserveResult {
        guard byteCount <= limits.maxBufferedAudioBytes - bytes,
              durationSeconds <= limits.maxBufferedAudioSeconds - seconds else {
            return .denied(.bufferExceeded)
        }
        bytes += byteCount
        seconds += durationSeconds
        peakBytes = max(peakBytes, bytes)
        return .reserved(
            VisitRecordingAudioReservation(
                budget: self,
                byteCount: byteCount,
                durationSeconds: durationSeconds
            )
        )
    }
}

final class VisitRecordingPCMFrame: @unchecked Sendable {
    let durationSeconds: Double
    let byteCount: Int
    let nativeBuffer: AnyObject?
    private let reservation: VisitRecordingAudioReservation?

    init(
        durationSeconds: Double,
        byteCount: Int,
        nativeBuffer: AnyObject? = nil,
        reservation: VisitRecordingAudioReservation? = nil
    ) {
        self.durationSeconds = durationSeconds
        self.byteCount = byteCount
        self.nativeBuffer = nativeBuffer
        self.reservation = reservation
    }

    static func synthetic(durationSeconds: Double, byteCount: Int) -> VisitRecordingPCMFrame {
        VisitRecordingPCMFrame(durationSeconds: durationSeconds, byteCount: byteCount)
    }

    var hasReservation: Bool { reservation != nil }

    func withReservation(_ reservation: VisitRecordingAudioReservation) -> VisitRecordingPCMFrame {
        VisitRecordingPCMFrame(
            durationSeconds: durationSeconds,
            byteCount: byteCount,
            nativeBuffer: nativeBuffer,
            reservation: reservation
        )
    }

    func releaseReservation() { reservation?.release() }
    func releaseReservationOffAudioThread() { reservation?.releaseOffAudioThread() }
}

struct VisitRecordingTranscriptResult: Sendable {
    let text: String
    let isFinal: Bool
}

@MainActor
protocol VisitRecordingRuntimePort: AnyObject {
    func prepare(
        audioBudget: VisitRecordingAudioBudget,
        onFrame: @escaping @Sendable (VisitRecordingPCMFrame) -> Void,
        onResult: @escaping @MainActor @Sendable (VisitRecordingTranscriptResult) -> Void,
        onInterruption: @escaping @Sendable () -> Void,
        onFailure: @escaping @Sendable (VisitRecordingDenial) -> Void
    ) async throws
    func startCapture() throws
    func consume(_ frame: VisitRecordingPCMFrame) async throws
    func stopCapture()
    func finishAndFinalize() async throws
    func cancelAndFinishNow() async
}

struct VisitRecordingRuntimeDenialError: Error {
    let denial: VisitRecordingDenial
}

protocol VisitRecordingQueueLock: AnyObject {
    func lock()
    func unlock()
    func tryLock() -> Bool
}

final class VisitRecordingNSLock: VisitRecordingQueueLock, @unchecked Sendable {
    private let value = NSLock()
    func lock() { value.lock() }
    func unlock() { value.unlock() }
    func tryLock() -> Bool { value.try() }
}

final class VisitRecordingPCMQueue: @unchecked Sendable {
    enum Offer: Equatable { case accepted, invalid, closed, busy }

    private let lock: any VisitRecordingQueueLock
    private var frames: [VisitRecordingPCMFrame] = []
    private var waiter: CheckedContinuation<VisitRecordingPCMFrame?, Never>?
    private var accepting = true

    init(lock: any VisitRecordingQueueLock = VisitRecordingNSLock()) {
        self.lock = lock
    }

    func offer(_ frame: VisitRecordingPCMFrame) -> Offer {
        guard lock.tryLock() else { return .busy }
        guard accepting else { lock.unlock(); return .closed }
        guard frame.durationSeconds.isFinite, frame.durationSeconds >= 0,
              frame.byteCount >= 0, frame.hasReservation else {
            accepting = false
            lock.unlock()
            return .invalid
        }
        let waiting = waiter
        waiter = nil
        if waiting == nil { frames.append(frame) }
        lock.unlock()
        waiting?.resume(returning: frame)
        return .accepted
    }

    func next() async -> VisitRecordingPCMFrame? {
        await withCheckedContinuation { continuation in
            lock.lock()
            if !frames.isEmpty {
                let frame = frames.removeFirst()
                lock.unlock()
                continuation.resume(returning: frame)
            } else if accepting {
                waiter = continuation
                lock.unlock()
            } else {
                lock.unlock()
                continuation.resume(returning: nil)
            }
        }
    }

    func acknowledge(_ frame: VisitRecordingPCMFrame) {
        frame.releaseReservation()
    }

    func finish() {
        lock.lock()
        accepting = false
        let waiter = self.waiter
        self.waiter = nil
        lock.unlock()
        waiter?.resume(returning: nil)
    }

    func cancel() {
        lock.lock()
        accepting = false
        let abandoned = frames
        frames.removeAll(keepingCapacity: false)
        let waiter = self.waiter
        self.waiter = nil
        lock.unlock()
        abandoned.forEach { $0.releaseReservation() }
        waiter?.resume(returning: nil)
    }
}

@MainActor
private final class VisitRecordingFailureLatch {
    private(set) var value: VisitRecordingDenial?

    func record(_ denial: VisitRecordingDenial) {
        if value == nil { value = denial }
    }
}

private enum VisitRecordingDeadlineOutcome {
    case completed
    case denied(VisitRecordingDenial)
    case timedOut
    case cancelled
}

@MainActor
private final class VisitRecordingDeadlineRace {
    private var continuation: CheckedContinuation<VisitRecordingDeadlineOutcome, Never>?
    private var operationTask: Task<Void, Never>?
    private var timerTask: Task<Void, Never>?
    private var pendingCancellation = false
    private var resolved = false

    func start(
        continuation: CheckedContinuation<VisitRecordingDeadlineOutcome, Never>,
        timeoutNanoseconds: UInt64,
        operation: @escaping @MainActor @Sendable () async throws -> Void
    ) {
        guard !resolved else {
            continuation.resume(returning: .cancelled)
            return
        }
        self.continuation = continuation
        if pendingCancellation {
            resolve(.cancelled)
            return
        }
        operationTask = Task { @MainActor [weak self] in
            do {
                try await operation()
                self?.resolve(.completed)
            } catch is CancellationError {
                self?.resolve(.cancelled)
            } catch let error as VisitRecordingRuntimeDenialError {
                self?.resolve(.denied(error.denial))
            } catch {
                self?.resolve(.denied(.failed))
            }
        }
        timerTask = Task { @MainActor [weak self] in
            do { try await Task.sleep(nanoseconds: timeoutNanoseconds) }
            catch { return }
            guard !Task.isCancelled else { return }
            self?.resolve(.timedOut)
        }
    }

    func cancel() {
        guard continuation != nil else { pendingCancellation = true; return }
        resolve(.cancelled)
    }

    private func resolve(_ outcome: VisitRecordingDeadlineOutcome) {
        guard !resolved, let continuation else { return }
        resolved = true
        operationTask?.cancel()
        timerTask?.cancel()
        self.continuation = nil
        operationTask = nil
        timerTask = nil
        continuation.resume(returning: outcome)
    }
}

private enum VisitRecordingCaptureConfigurationError: Error {
    case invalidConfiguration
}

@MainActor
public final class VisitRecordingCaptureController {
    public private(set) var session: VisitRecordingSession

    private let selectionReference: VisitRecordingSelectionReference
    private let runtime: any VisitRecordingRuntimePort
    private let limits: VisitRecordingLimits
    private let currentSelectionReference: @MainActor () -> VisitRecordingSelectionReference?
    private let durationNanoseconds: UInt64
    private let processingDeadlineNanoseconds: UInt64
    private let currentnessPollNanoseconds: UInt64
    private var releaseReservation: (@MainActor () async -> Bool)?
    private var reservationReleaseInProgress = false
    private var queue: VisitRecordingPCMQueue?
    private var audioBudget: VisitRecordingAudioBudget?
    private var consumerTask: Task<Void, Never>?
    private var durationTask: Task<Void, Never>?
    private var currentnessTask: Task<Void, Never>?
    private var finalizationDeadlineTask: Task<Void, Never>?
    private var failureLatch: VisitRecordingFailureLatch?
    private var finalTranscript = ""
    private var finalTranscriptBytes = 0
    private var transcriptOverflowed = false
    private var consumerFailed = false
    private var closed = false
    private var captureStopped = false
    private var retainedPreflight: VisitRecordingPreflight?

    init(
        selectionReference: VisitRecordingSelectionReference,
        runtime: any VisitRecordingRuntimePort,
        limits: VisitRecordingLimits = .standard,
        durationNanoseconds: UInt64? = nil,
        processingDeadlineNanoseconds: UInt64 = 15_000_000_000,
        currentnessPollNanoseconds: UInt64 = 25_000_000,
        currentSelectionReference: @escaping @MainActor () -> VisitRecordingSelectionReference?,
        releaseReservation: (@MainActor () async -> Bool)? = nil
    ) throws {
        guard selectionReference.generation > 0,
              limits.maxBufferedAudioSeconds.isFinite,
              limits.maxBufferedAudioSeconds > 0,
              limits.maxBufferedAudioBytes > 0,
              limits.maxDurationSeconds.isFinite,
              limits.maxDurationSeconds > 0,
              limits.maxTranscriptUTF8Bytes > 0,
              processingDeadlineNanoseconds > 0,
              currentnessPollNanoseconds > 0 else {
            throw VisitRecordingCaptureConfigurationError.invalidConfiguration
        }
        let resolvedDuration: UInt64
        if let durationNanoseconds {
            guard durationNanoseconds > 0 else {
                throw VisitRecordingCaptureConfigurationError.invalidConfiguration
            }
            resolvedDuration = durationNanoseconds
        } else {
            let nanoseconds = limits.maxDurationSeconds * 1_000_000_000
            guard nanoseconds.isFinite, nanoseconds <= Double(UInt64.max) else {
                throw VisitRecordingCaptureConfigurationError.invalidConfiguration
            }
            resolvedDuration = UInt64(nanoseconds)
        }
        self.selectionReference = selectionReference
        self.session = VisitRecordingSession(binding: selectionReference.binding)
        self.runtime = runtime
        self.limits = limits
        self.currentSelectionReference = currentSelectionReference
        self.durationNanoseconds = resolvedDuration
        self.processingDeadlineNanoseconds = processingDeadlineNanoseconds
        self.currentnessPollNanoseconds = currentnessPollNanoseconds
        self.releaseReservation = releaseReservation
        for event in [
            VisitRecordingEvent.presentDisclosure, .acceptDisclosure, .permissionGranted, .assetsReady,
        ] { try session.apply(event) }
    }

    public static func liveIfAvailable(
        selectionReference: VisitRecordingSelectionReference,
        preflight: VisitRecordingPreflight,
        currentSelectionReference: @escaping @MainActor () -> VisitRecordingSelectionReference?
    ) -> VisitRecordingCaptureController? {
#if os(macOS)
        if #available(macOS 26.0, *), preflight.state == .ready,
           let localeID = preflight.resolvedLocaleIdentifier,
           let controller = try? VisitRecordingCaptureController(
               selectionReference: selectionReference,
               runtime: AppleVisitRecordingRuntime(locale: Locale(identifier: localeID)),
               currentSelectionReference: currentSelectionReference,
               releaseReservation: { [weak preflight] in
                   guard let preflight else { return true }
                   await preflight.releaseReservation()
                   return preflight.state == .released
               }
           ) {
            controller.retainedPreflight = preflight
            return controller
        }
#endif
        return nil
    }

    public func start() async {
        guard session.phase == .ready, !closed else { return }
        guard isCurrentSelection else {
            finishDenied(.staleBinding)
            await releaseReservationIfNeeded()
            return
        }
        let budget = VisitRecordingAudioBudget(limits: limits)
        let queue = VisitRecordingPCMQueue()
        let failures = VisitRecordingFailureLatch()
        self.audioBudget = budget
        self.queue = queue
        self.failureLatch = failures
        do {
            try await runtime.prepare(
                audioBudget: budget,
                onFrame: { [weak self] frame in
                    switch queue.offer(frame) {
                    case .accepted:
                        self?.requestCurrentnessCheck()
                    case .closed:
                        frame.releaseReservationOffAudioThread()
                    case .busy:
                        frame.releaseReservationOffAudioThread()
                        self?.requestFailure(.bufferExceeded)
                    case .invalid:
                        frame.releaseReservationOffAudioThread()
                        self?.requestFailure(.invalidUsage)
                    }
                },
                onResult: { [weak self] result in self?.accept(result) },
                onInterruption: { [weak self] in self?.requestFailure(.interrupted) },
                onFailure: { [weak self] denial in self?.requestFailure(denial) }
            )
            guard !closed else { return }
            guard isCurrentSelection else { await fail(.staleBinding); return }
            try session.apply(.start)
            consumerTask = Task { @MainActor [weak self] in
                while let frame = await queue.next() {
                    guard let self else {
                        queue.acknowledge(frame)
                        queue.cancel()
                        return
                    }
                    let outcome = await self.runWithProcessingDeadline {
                        try await self.runtime.consume(frame)
                    }
                    queue.acknowledge(frame)
                    switch outcome {
                    case .completed:
                        continue
                    case .cancelled where Task.isCancelled:
                        return
                    case let .denied(denial):
                        self.consumerFailed = true
                        self.failureLatch?.record(denial)
                        self.requestFailure(denial)
                        return
                    case .timedOut, .cancelled:
                        self.consumerFailed = true
                        self.failureLatch?.record(.failed)
                        self.requestFailure(.failed)
                        return
                    }
                }
            }
            try runtime.startCapture()
            guard !closed else { return }
            guard isCurrentSelection else { await fail(.staleBinding); return }
            let durationNanoseconds = self.durationNanoseconds
            durationTask = Task { @MainActor [weak self] in
                do { try await Task.sleep(nanoseconds: durationNanoseconds) }
                catch { return }
                guard !Task.isCancelled else { return }
                guard let self else { return }
                await self.fail(.sessionDurationExceeded)
            }
            let currentnessPollNanoseconds = self.currentnessPollNanoseconds
            currentnessTask = Task { @MainActor [weak self] in
                while !Task.isCancelled {
                    do { try await Task.sleep(nanoseconds: currentnessPollNanoseconds) }
                    catch { return }
                    guard !Task.isCancelled else { return }
                    if let owner = self {
                        if !owner.isCurrentSelection {
                            await owner.fail(.staleBinding)
                            return
                        }
                    } else {
                        return
                    }
                }
            }
        } catch {
            await fail(.failed)
        }
    }

    public func selectionDidChange() async {
        guard !closed, !isCurrentSelection else { return }
        await fail(.staleBinding)
    }

    public func stop() async {
        guard session.phase == .recording, !closed, let queue else { return }
        guard isCurrentSelection else { await fail(.staleBinding); return }
        do { try session.apply(.stop) }
        catch { await fail(.failed); return }
        let processingDeadlineNanoseconds = self.processingDeadlineNanoseconds
        finalizationDeadlineTask = Task { @MainActor [weak self] in
            do { try await Task.sleep(nanoseconds: processingDeadlineNanoseconds) }
            catch { return }
            guard !Task.isCancelled, let self else { return }
            await self.fail(.failed)
        }
        stopRuntimeCaptureIfNeeded()
        durationTask?.cancel()
        queue.finish()
        await consumerTask?.value
        guard !closed else { return }
        if consumerFailed { await fail(.failed); return }
        if let denial = failureLatch?.value { await fail(denial); return }
        guard session.phase == .finalizing, isCurrentSelection else {
            await fail(.staleBinding)
            return
        }
        let finalizeOutcome = await runWithProcessingDeadline {
            try await self.runtime.finishAndFinalize()
        }
        switch finalizeOutcome {
        case .completed:
            break
        case let .denied(denial):
            await fail(denial)
            return
        case .timedOut, .cancelled:
            await fail(.failed)
            return
        }
        guard !closed else { return }
        if let denial = failureLatch?.value { await fail(denial); return }
        guard !transcriptOverflowed else { await fail(.transcriptExceeded); return }
        guard !finalTranscript.isEmpty else { await fail(.failed); return }
        guard isCurrentSelection else { await fail(.staleBinding); return }
        do {
            try session.apply(
                .publishTranscript(
                    text: finalTranscript,
                    isFinal: true,
                    currentBinding: selectionReference.binding
                )
            )
        } catch {
            await fail(.failed)
            return
        }
        closed = true
        currentnessTask?.cancel()
        finalizationDeadlineTask?.cancel()
        queue.cancel()
        clearTranscriptAccumulator()
        consumerTask = nil
        durationTask = nil
        currentnessTask = nil
        finalizationDeadlineTask = nil
        await releaseReservationIfNeeded()
    }

    public func cancel() async {
        if closed {
            switch session.phase {
            case .transcriptReview, .draftReview:
                session.cleanup(as: .cancelled)
            default:
                break
            }
            await releaseReservationIfNeeded()
            return
        }
        await fail(.cancelled)
    }

    public func dispose() async {
        await cancel()
        await releaseReservationIfNeeded()
    }

    private var isCurrentSelection: Bool {
        currentSelectionReference() == selectionReference
    }

    private func accept(_ result: VisitRecordingTranscriptResult) {
        guard isCurrentSelection else { requestFailure(.staleBinding); return }
        guard result.isFinal, !closed, !transcriptOverflowed else { return }
        let segment = result.text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !segment.isEmpty else { return }
        let separator = finalTranscript.isEmpty ? 0 : 1
        let bytes = segment.utf8.count
        guard separator <= limits.maxTranscriptUTF8Bytes - finalTranscriptBytes,
              bytes <= limits.maxTranscriptUTF8Bytes - finalTranscriptBytes - separator else {
            transcriptOverflowed = true
            requestFailure(.transcriptExceeded)
            return
        }
        if separator == 1 { finalTranscript.append(" ") }
        finalTranscript.append(segment)
        finalTranscriptBytes += separator + bytes
    }

    private func runWithProcessingDeadline(
        _ operation: @escaping @MainActor @Sendable () async throws -> Void
    ) async -> VisitRecordingDeadlineOutcome {
        let race = VisitRecordingDeadlineRace()
        return await withTaskCancellationHandler {
            await withCheckedContinuation { continuation in
                race.start(
                    continuation: continuation,
                    timeoutNanoseconds: processingDeadlineNanoseconds,
                    operation: operation
                )
            }
        } onCancel: {
            Task { @MainActor in race.cancel() }
        }
    }

    private nonisolated func requestFailure(_ denial: VisitRecordingDenial) {
        Task { @MainActor [weak self] in await self?.fail(denial) }
    }

    private nonisolated func requestCurrentnessCheck() {
        Task { @MainActor [weak self] in await self?.selectionDidChange() }
    }

    private func fail(_ denial: VisitRecordingDenial) async {
        guard !closed else { return }
        failureLatch?.record(denial)
        closed = true
        durationTask?.cancel()
        currentnessTask?.cancel()
        finalizationDeadlineTask?.cancel()
        stopRuntimeCaptureIfNeeded()
        queue?.cancel()
        clearTranscriptAccumulator()
        let consumer = consumerTask
        consumer?.cancel()
        await runtime.cancelAndFinishNow()
        await consumer?.value
        session.cleanup(as: failureLatch?.value ?? denial)
        consumerTask = nil
        durationTask = nil
        currentnessTask = nil
        finalizationDeadlineTask = nil
        await releaseReservationIfNeeded()
    }

    private func finishDenied(_ denial: VisitRecordingDenial) {
        closed = true
        durationTask?.cancel()
        currentnessTask?.cancel()
        finalizationDeadlineTask?.cancel()
        queue?.cancel()
        clearTranscriptAccumulator()
        session.cleanup(as: denial)
        consumerTask = nil
        durationTask = nil
        currentnessTask = nil
        finalizationDeadlineTask = nil
    }

    private func clearTranscriptAccumulator() {
        finalTranscript.removeAll(keepingCapacity: false)
        finalTranscriptBytes = 0
    }

    private func stopRuntimeCaptureIfNeeded() {
        guard !captureStopped else { return }
        captureStopped = true
        runtime.stopCapture()
    }

    private func releaseReservationIfNeeded() async {
        guard !reservationReleaseInProgress, let releaseReservation else { return }
        reservationReleaseInProgress = true
        let released = await releaseReservation()
        reservationReleaseInProgress = false
        if released {
            self.releaseReservation = nil
            retainedPreflight = nil
        }
    }
}
