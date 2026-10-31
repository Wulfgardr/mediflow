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
