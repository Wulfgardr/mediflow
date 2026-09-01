/* @Codex */
import Foundation

final class VisitRecordingPCMFrame: @unchecked Sendable {
    let durationSeconds: Double
    let byteCount: Int
    let nativeBuffer: AnyObject?

    init(durationSeconds: Double, byteCount: Int, nativeBuffer: AnyObject? = nil) {
        self.durationSeconds = durationSeconds
        self.byteCount = byteCount
        self.nativeBuffer = nativeBuffer
    }

    static func synthetic(durationSeconds: Double, byteCount: Int) -> VisitRecordingPCMFrame {
        VisitRecordingPCMFrame(durationSeconds: durationSeconds, byteCount: byteCount)
    }
}

struct VisitRecordingTranscriptResult: Sendable {
    let text: String
    let isFinal: Bool
}

@MainActor
protocol VisitRecordingRuntimePort: AnyObject {
    func prepare(
        onFrame: @escaping @Sendable (VisitRecordingPCMFrame) -> Void,
        onResult: @escaping @MainActor @Sendable (VisitRecordingTranscriptResult) -> Void,
        onInterruption: @escaping @Sendable () -> Void,
        onFailure: @escaping @Sendable () -> Void
    ) async throws
    func startCapture() throws
    func consume(_ frame: VisitRecordingPCMFrame) async throws
    func stopCapture()
    func finishAndFinalize() async throws
    func cancelAndFinishNow() async
}

private final class VisitRecordingPCMQueue: @unchecked Sendable {
    enum Offer { case accepted, overflow, invalid, closed }
    private let lock = NSLock()
    private let limits: VisitRecordingLimits
    private var frames: [VisitRecordingPCMFrame] = []
    private var waiter: CheckedContinuation<VisitRecordingPCMFrame?, Never>?
    private var bytes = 0
    private var seconds = 0.0
    private var accepting = true

    init(limits: VisitRecordingLimits) { self.limits = limits }

    func offer(_ frame: VisitRecordingPCMFrame) -> Offer {
        lock.lock()
        guard accepting else { lock.unlock(); return .closed }
        guard frame.durationSeconds.isFinite, frame.durationSeconds >= 0, frame.byteCount >= 0 else {
            accepting = false
            lock.unlock()
            return .invalid
        }
        guard frame.byteCount <= limits.maxBufferedAudioBytes - bytes,
              frame.durationSeconds <= limits.maxBufferedAudioSeconds - seconds else {
            accepting = false
            lock.unlock()
            return .overflow
        }
        bytes += frame.byteCount
        seconds += frame.durationSeconds
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
        lock.lock()
        bytes = max(0, bytes - frame.byteCount)
        seconds = max(0, seconds - frame.durationSeconds)
        lock.unlock()
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
        frames.removeAll(keepingCapacity: false)
        bytes = 0
        seconds = 0
        let waiter = self.waiter
        self.waiter = nil
        lock.unlock()
        waiter?.resume(returning: nil)
    }
}

private final class VisitRecordingFailureLatch: @unchecked Sendable {
    private let lock = NSLock()
    private var denial: VisitRecordingDenial?

    func record(_ value: VisitRecordingDenial) {
        lock.lock()
        if denial == nil { denial = value }
        lock.unlock()
    }

    var value: VisitRecordingDenial? {
        lock.lock()
        defer { lock.unlock() }
        return denial
    }
}

@MainActor
public final class VisitRecordingCaptureController {
    public private(set) var session: VisitRecordingSession

    private let runtime: any VisitRecordingRuntimePort
    private let limits: VisitRecordingLimits
    private let currentBinding: @MainActor () -> VisitRecordingBinding?
    private let durationNanoseconds: UInt64
    private var queue: VisitRecordingPCMQueue?
    private var consumerTask: Task<Void, Never>?
    private var durationTask: Task<Void, Never>?
    private var failureLatch: VisitRecordingFailureLatch?
    private var finalTranscript = ""
    private var finalTranscriptBytes = 0
    private var transcriptOverflowed = false
    private var consumerFailed = false
    private var closed = false
    private var retainedPreflight: VisitRecordingPreflight?

    init(
        binding: VisitRecordingBinding,
        runtime: any VisitRecordingRuntimePort,
        limits: VisitRecordingLimits = .standard,
        durationNanoseconds: UInt64? = nil,
        currentBinding: @escaping @MainActor () -> VisitRecordingBinding?
    ) throws {
        self.session = VisitRecordingSession(binding: binding)
        self.runtime = runtime
        self.limits = limits
        self.currentBinding = currentBinding
        self.durationNanoseconds = durationNanoseconds
            ?? UInt64(limits.maxDurationSeconds * 1_000_000_000)
        for event in [
            VisitRecordingEvent.presentDisclosure, .acceptDisclosure, .permissionGranted, .assetsReady,
        ] { try session.apply(event) }
    }

    public static func liveIfAvailable(
        binding: VisitRecordingBinding,
        preflight: VisitRecordingPreflight,
        currentBinding: @escaping @MainActor () -> VisitRecordingBinding?
    ) -> VisitRecordingCaptureController? {
#if os(macOS)
        if #available(macOS 26.0, *), preflight.state == .ready,
           let localeID = preflight.resolvedLocaleIdentifier,
           let controller = try? VisitRecordingCaptureController(
               binding: binding,
               runtime: AppleVisitRecordingRuntime(locale: Locale(identifier: localeID)),
               currentBinding: currentBinding
           ) {
            controller.retainedPreflight = preflight
            return controller
        }
#endif
        return nil
    }

    public func start() async {
        guard session.phase == .ready, !closed else { return }
        guard currentBinding() == session.binding else { finishDenied(.staleBinding); return }
        let queue = VisitRecordingPCMQueue(limits: limits)
        let failures = VisitRecordingFailureLatch()
        self.queue = queue
        self.failureLatch = failures
        do {
            try await runtime.prepare(
                onFrame: { [weak self] frame in
                    switch queue.offer(frame) {
                    case .accepted, .closed: break
                    case .overflow:
                        failures.record(.bufferExceeded); self?.requestFailure(.bufferExceeded)
                    case .invalid:
                        failures.record(.invalidUsage); self?.requestFailure(.invalidUsage)
                    }
                },
                onResult: { [weak self] result in self?.accept(result) },
                onInterruption: { [weak self] in
                    failures.record(.interrupted); self?.requestFailure(.interrupted)
                },
                onFailure: { [weak self] in
                    failures.record(.failed); self?.requestFailure(.failed)
                }
            )
            if let denial = failures.value { await fail(denial); return }
            try session.apply(.start)
            consumerTask = Task { [weak self] in
                while let frame = await queue.next() {
                    do {
                        try await self?.runtime.consume(frame)
                        queue.acknowledge(frame)
                    } catch {
                        queue.acknowledge(frame)
                        self?.consumerFailed = true
                        failures.record(.failed)
                        self?.requestFailure(.failed)
                        return
                    }
                }
            }
            try runtime.startCapture()
            if let denial = failures.value { await fail(denial); return }
            durationTask = Task { [weak self] in
                try? await Task.sleep(nanoseconds: self?.durationNanoseconds ?? 0)
                guard !Task.isCancelled else { return }
                await self?.fail(.sessionDurationExceeded)
            }
        } catch {
            await fail(.failed)
        }
    }

    public func stop() async {
        guard session.phase == .recording, !closed, let queue else { return }
        do { try session.apply(.stop) } catch { await fail(.failed); return }
        runtime.stopCapture()
        durationTask?.cancel()
        queue.finish()
        await consumerTask?.value
        if consumerFailed { await fail(.failed); return }
        if let denial = failureLatch?.value { await fail(denial); return }
        guard session.phase == .finalizing, !closed else { return }
        do { try await runtime.finishAndFinalize() }
        catch { await fail(.failed); return }
        if let denial = failureLatch?.value { await fail(denial); return }
        guard session.phase == .finalizing, !closed else { return }
        guard !transcriptOverflowed else { await fail(.transcriptExceeded); return }
        guard !finalTranscript.isEmpty else { await fail(.failed); return }
        guard let binding = currentBinding(), binding == session.binding else {
            finishDenied(.staleBinding)
            return
        }
        do { try session.apply(.publishTranscript(text: finalTranscript, isFinal: true, currentBinding: binding)) }
        catch { await fail(.failed); return }
        closed = true
        queue.cancel()
        finalTranscript.removeAll(keepingCapacity: false)
        finalTranscriptBytes = 0
        consumerTask = nil
        durationTask = nil
    }

    public func cancel() async {
        if closed {
            switch session.phase {
            case .transcriptReview, .draftReview: session.cleanup(as: .cancelled)
            default: break
            }
            return
        }
        await fail(.cancelled)
    }

    private func accept(_ result: VisitRecordingTranscriptResult) {
        guard result.isFinal, !closed, !transcriptOverflowed else { return }
        let segment = result.text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !segment.isEmpty else { return }
        let separator = finalTranscript.isEmpty ? 0 : 1
        let bytes = segment.utf8.count
        guard separator <= limits.maxTranscriptUTF8Bytes - finalTranscriptBytes,
              bytes <= limits.maxTranscriptUTF8Bytes - finalTranscriptBytes - separator else {
            transcriptOverflowed = true
            failureLatch?.record(.transcriptExceeded)
            requestFailure(.transcriptExceeded)
            return
        }
        if separator == 1 { finalTranscript.append(" ") }
        finalTranscript.append(segment)
        finalTranscriptBytes += separator + bytes
    }

    private nonisolated func requestFailure(_ denial: VisitRecordingDenial) {
        Task { @MainActor [weak self] in await self?.fail(denial) }
    }

    private func fail(_ denial: VisitRecordingDenial) async {
        guard !closed else { return }
        closed = true
        durationTask?.cancel()
        runtime.stopCapture()
        queue?.cancel()
        finalTranscript.removeAll(keepingCapacity: false)
        finalTranscriptBytes = 0
        let consumer = consumerTask
        consumer?.cancel()
        await runtime.cancelAndFinishNow()
        await consumer?.value
        session.cleanup(as: failureLatch?.value ?? denial)
        consumerTask = nil
        durationTask = nil
    }

    private func finishDenied(_ denial: VisitRecordingDenial) {
        closed = true
        queue?.cancel()
        finalTranscript.removeAll(keepingCapacity: false)
        finalTranscriptBytes = 0
        session.cleanup(as: denial)
        consumerTask = nil
        durationTask = nil
    }
}
