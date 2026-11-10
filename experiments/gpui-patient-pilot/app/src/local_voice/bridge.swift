import AVFAudio
import Foundation

@MainActor
final class ChatLocalVoice {
    enum State: Int32 {
        case disclosure, preparing, recording, finalizing, permissionDenied, unavailable, cancelled, review
    }
    private(set) var state = State.disclosure
    private static weak var lease: ChatLocalVoice?
    private var closed = false
    private var preflight: VisitRecordingPreflight?
    private var capture: VisitRecordingCaptureController?
    private let makePreflight: @MainActor () -> VisitRecordingPreflight?
    private let makeCapture: @MainActor (VisitRecordingSelectionReference, VisitRecordingPreflight,
                              @escaping @MainActor () -> VisitRecordingSelectionReference?) -> VisitRecordingCaptureController?
    private let reference = VisitRecordingSelectionReference(
        binding: VisitRecordingBinding(patientRef: "native-local", revision: 1), generation: 1
    )

    init(
        makePreflight: @escaping @MainActor () -> VisitRecordingPreflight? = {
            guard let usage = Bundle.main.object(forInfoDictionaryKey: "NSMicrophoneUsageDescription") as? String,
                  !usage.isEmpty else { return nil }
            return VisitRecordingPreflight.liveIfAvailable()
        },
        makeCapture: @escaping @MainActor (VisitRecordingSelectionReference, VisitRecordingPreflight,
                               @escaping @MainActor () -> VisitRecordingSelectionReference?) -> VisitRecordingCaptureController? = {
            VisitRecordingCaptureController.liveIfAvailable(selectionReference: $0, preflight: $1, currentSelectionReference: $2)
        }
    ) {
        self.makePreflight = makePreflight
        self.makeCapture = makeCapture
    }

    func denyUnavailableRuntime() { state = .unavailable }

    func start() async {
        guard state == .disclosure, !closed else { return }
        guard Self.lease == nil else { state = .unavailable; return }
        Self.lease = self
        state = .preparing
        guard let preflight = makePreflight() else { state = .unavailable; return }
        self.preflight = preflight
        await preflight.acceptDisclosureAndPrepare()
        guard !closed else { await preflight.releaseReservation(); return }
        guard preflight.state == .ready,
              let locale = preflight.resolvedLocaleIdentifier,
              preflight.installedLocaleIdentifiers.contains(locale) else {
            state = preflight.state == .permissionDenied ? .permissionDenied : .unavailable
            await preflight.releaseReservation()
            return
        }
        guard let capture = makeCapture(reference, preflight, { [weak self] in
            guard let self, !self.closed else { return nil }
            return self.reference
        }) else {
            state = .unavailable
            await preflight.releaseReservation()
            return
        }
        self.capture = capture
        await capture.start()
        guard !closed else { await capture.dispose(); return }
        state = capture.session.phase == .recording ? .recording : .unavailable
    }

    func stop() async {
        guard state == .recording, !closed, let capture else { return }
        state = .finalizing
        await capture.stop()
        guard !closed else { return }
        state = capture.session.phase == .transcriptReview ? .review : .unavailable
    }

    func poll() -> State {
        if state == .recording, let capture, capture.session.phase != .recording {
            state = .unavailable
        }
        return state
    }

    var transcript: String? {
        guard state == .review, !closed, let text = capture?.session.transcript,
              text.count <= 12_000, text.utf8.count <= VisitRecordingLimits.standard.maxTranscriptUTF8Bytes else { return nil }
        return text
    }

    func invalidate() {
        closed = true
        state = .cancelled
    }

    func cancel() async {
        invalidate()
        let capture = self.capture
        self.capture = nil
        await capture?.dispose()
        await preflight?.releaseReservation()
        preflight = nil
        if Self.lease === self { Self.lease = nil }
    }
}

@_cdecl("MFVoiceCreate")
@MainActor
func voiceCreate() -> UnsafeMutableRawPointer {
    Unmanaged.passRetained(ChatLocalVoice()).toOpaque()
}

@_cdecl("MFVoiceCommand")
@MainActor
func voiceCommand(_ pointer: UnsafeMutableRawPointer, _ command: Int32) {
    let voice = Unmanaged<ChatLocalVoice>.fromOpaque(pointer).takeUnretainedValue()
    guard #available(macOS 26.0, *) else { voice.denyUnavailableRuntime(); return }
    Task { @MainActor in
        switch command {
        case 1: await voice.start()
        case 2: await voice.stop()
        default: await voice.cancel()
        }
    }
}

@_cdecl("MFVoicePoll")
@MainActor
func voicePoll(_ pointer: UnsafeMutableRawPointer) -> Int32 {
    Unmanaged<ChatLocalVoice>.fromOpaque(pointer).takeUnretainedValue().poll().rawValue
}

@_cdecl("MFVoiceCopyText")
@MainActor
func voiceCopyText(_ pointer: UnsafeMutableRawPointer, _ output: UnsafeMutablePointer<UInt8>, _ capacity: Int) -> Int {
    guard let text = Unmanaged<ChatLocalVoice>.fromOpaque(pointer).takeUnretainedValue().transcript,
          text.utf8.count <= capacity else { return 0 }
    return Array(text.utf8).withUnsafeBufferPointer { bytes in
        output.update(from: bytes.baseAddress!, count: bytes.count)
        return bytes.count
    }
}

@_cdecl("MFVoiceRelease")
@MainActor
func voiceRelease(_ pointer: UnsafeMutableRawPointer) {
    let voice = Unmanaged<ChatLocalVoice>.fromOpaque(pointer).takeRetainedValue()
    voice.invalidate()
    if #available(macOS 26.0, *) {
        Task { @MainActor in await voice.cancel() }
    }
}

// Cattura per il motore whisper: microfono, conversione a 16 kHz mono Float32,
// campioni consegnati a Rust con MFVoiceCaptureRead. Nessun file audio; il
// buffer è preallocato e azzerato quando i campioni escono o la cattura finisce.
// Il permesso usa la stessa richiesta del motore Apple.

final class WhisperVoiceCapture: @unchecked Sendable {
    enum Phase: Int32 { case starting = 0, running, permissionDenied, failed, stopped }
    static let backlog = 16_000 * 30
    private let lock = NSLock()
    private var samples = [Float](repeating: 0, count: WhisperVoiceCapture.backlog)
    private var count = 0
    private var phase = Phase.starting
    private var started = false
    private var engine: AVAudioEngine?
    private var observer: NSObjectProtocol?
    private let target = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16_000, channels: 1, interleaved: false)

    private func set(_ next: Phase) {
        lock.lock(); if phase != .stopped { phase = next }; lock.unlock()
    }

    func start() {
        lock.lock()
        let first = !started
        started = true
        lock.unlock()
        guard first else { return }
        guard #available(macOS 14.0, *),
              let usage = Bundle.main.object(forInfoDictionaryKey: "NSMicrophoneUsageDescription") as? String,
              !usage.isEmpty else { set(.failed); return }
        AVAudioApplication.requestRecordPermission { [weak self] granted in
            guard let self else { return }
            if granted { self.begin() } else { self.set(.permissionDenied) }
        }
    }

    private func begin() {
        let engine = AVAudioEngine()
        let input = engine.inputNode
        let format = input.inputFormat(forBus: 0)
        guard format.sampleRate > 0, let target,
              let converter = AVAudioConverter(from: format, to: target) else { set(.failed); return }
        input.installTap(onBus: 0, bufferSize: 4_096, format: format) { [weak self] buffer, _ in
            self?.convert(buffer, converter, target)
        }
        observer = NotificationCenter.default.addObserver(
            forName: .AVAudioEngineConfigurationChange, object: engine, queue: nil
        ) { [weak self] _ in self?.set(.failed) }
        engine.prepare()
        do {
            try engine.start()
            lock.lock()
            self.engine = engine
            let stopped = phase == .stopped
            if !stopped { phase = .running }
            lock.unlock()
            if stopped { input.removeTap(onBus: 0); engine.stop() }
        } catch {
            input.removeTap(onBus: 0)
            set(.failed)
        }
    }

    private func convert(_ buffer: AVAudioPCMBuffer, _ converter: AVAudioConverter, _ target: AVAudioFormat) {
        let ratio = target.sampleRate / buffer.format.sampleRate
        let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio + 32)
        guard let output = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: capacity) else { set(.failed); return }
        var fed = false
        var error: NSError?
        let status = converter.convert(to: output, error: &error) { _, inputStatus in
            if fed { inputStatus.pointee = .noDataNow; return nil }
            fed = true
            inputStatus.pointee = .haveData
            return buffer
        }
        guard status != .error, let channel = output.floatChannelData?[0] else { set(.failed); return }
        let frames = Int(output.frameLength)
        lock.lock()
        if phase == .running {
            if count + frames > samples.count {
                phase = .failed
            } else {
                samples.withUnsafeMutableBufferPointer { destination in
                    destination.baseAddress!.advanced(by: count).update(from: channel, count: frames)
                }
                count += frames
            }
        }
        lock.unlock()
        channel.update(repeating: 0, count: frames)
    }

    func poll() -> Phase {
        lock.lock(); defer { lock.unlock() }
        return phase
    }

    func read(_ output: UnsafeMutablePointer<Float>, _ capacity: Int) -> Int {
        lock.lock(); defer { lock.unlock() }
        let n = min(capacity, count)
        guard n > 0 else { return 0 }
        samples.withUnsafeMutableBufferPointer { buffer in
            let base = buffer.baseAddress!
            output.update(from: base, count: n)
            base.update(from: base.advanced(by: n), count: count - n)
            base.advanced(by: count - n).update(repeating: 0, count: n)
        }
        count -= n
        return n
    }

    func stop() {
        lock.lock()
        let engine = self.engine
        self.engine = nil
        if phase == .starting || phase == .running { phase = .stopped }
        lock.unlock()
        if let observer { NotificationCenter.default.removeObserver(observer); self.observer = nil }
        engine?.inputNode.removeTap(onBus: 0)
        engine?.stop()
    }

    func wipe() {
        lock.lock()
        samples.withUnsafeMutableBufferPointer { $0.update(repeating: 0) }
        count = 0
        lock.unlock()
    }
}

@_cdecl("MFVoiceCaptureCreate")
func voiceCaptureCreate() -> UnsafeMutableRawPointer {
    Unmanaged.passRetained(WhisperVoiceCapture()).toOpaque()
}

@_cdecl("MFVoiceCaptureStart")
func voiceCaptureStart(_ pointer: UnsafeMutableRawPointer) {
    Unmanaged<WhisperVoiceCapture>.fromOpaque(pointer).takeUnretainedValue().start()
}

@_cdecl("MFVoiceCapturePoll")
func voiceCapturePoll(_ pointer: UnsafeMutableRawPointer) -> Int32 {
    Unmanaged<WhisperVoiceCapture>.fromOpaque(pointer).takeUnretainedValue().poll().rawValue
}

@_cdecl("MFVoiceCaptureRead")
func voiceCaptureRead(_ pointer: UnsafeMutableRawPointer, _ output: UnsafeMutablePointer<Float>, _ capacity: Int) -> Int {
    Unmanaged<WhisperVoiceCapture>.fromOpaque(pointer).takeUnretainedValue().read(output, capacity)
}

@_cdecl("MFVoiceCaptureStop")
func voiceCaptureStop(_ pointer: UnsafeMutableRawPointer) {
    Unmanaged<WhisperVoiceCapture>.fromOpaque(pointer).takeUnretainedValue().stop()
}

@_cdecl("MFVoiceCaptureRelease")
func voiceCaptureRelease(_ pointer: UnsafeMutableRawPointer) {
    let capture = Unmanaged<WhisperVoiceCapture>.fromOpaque(pointer).takeRetainedValue()
    capture.stop()
    capture.wipe()
}
