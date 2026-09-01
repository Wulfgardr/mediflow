/* @Codex */
#if os(macOS)
import AVFAudio
import Foundation
import Speech

@available(macOS 26.0, *)
@MainActor
final class AppleVisitRecordingRuntime: VisitRecordingRuntimePort {
    private let engine = AVAudioEngine()
    private let transcriber: SpeechTranscriber
    private let analyzer: SpeechAnalyzer
    private var converter: AVAudioConverter?
    private var targetFormat: AVAudioFormat?
    private var resultTask: Task<Void, Error>?
    private var tapInstalled = false
    private var observer: NSObjectProtocol?
    private var onFrame: (@Sendable (VisitRecordingPCMFrame) -> Void)?
    private var onInterruption: (@Sendable () -> Void)?
    private var onFailure: (@Sendable () -> Void)?

    init(locale: Locale) {
        transcriber = SpeechTranscriber(locale: locale, preset: .transcription)
        analyzer = SpeechAnalyzer(modules: [transcriber])
    }

    func prepare(
        onFrame: @escaping @Sendable (VisitRecordingPCMFrame) -> Void,
        onResult: @escaping @MainActor @Sendable (VisitRecordingTranscriptResult) -> Void,
        onInterruption: @escaping @Sendable () -> Void,
        onFailure: @escaping @Sendable () -> Void
    ) async throws {
        self.onFrame = onFrame
        self.onInterruption = onInterruption
        self.onFailure = onFailure
        let natural = engine.inputNode.inputFormat(forBus: 0)
        guard natural.sampleRate > 0,
              let target = await SpeechAnalyzer.bestAvailableAudioFormat(
                  compatibleWith: [transcriber], considering: natural
              ) else { throw CocoaError(.featureUnsupported) }
        targetFormat = target
        converter = natural.isEqual(target) ? nil : AVAudioConverter(from: natural, to: target)
        if !natural.isEqual(target), converter == nil { throw CocoaError(.coderInvalidValue) }
        try await analyzer.prepareToAnalyze(in: target)
        resultTask = Task {
            do {
                for try await result in transcriber.results {
                    onResult(.init(text: String(result.text.characters), isFinal: result.isFinal))
                }
            } catch {
                if !Task.isCancelled { onFailure() }
                throw error
            }
        }
    }

    func startCapture() throws {
        let input = engine.inputNode
        let format = input.inputFormat(forBus: 0)
        let frameHandler = onFrame
        let failureHandler = onFailure
        input.installTap(onBus: 0, bufferSize: 1_024, format: format) { buffer, _ in
            guard let frame = Self.copyFrame(buffer) else { failureHandler?(); return }
            frameHandler?(frame)
        }
        tapInstalled = true
        let interruption = onInterruption
        observer = NotificationCenter.default.addObserver(
            forName: .AVAudioEngineConfigurationChange, object: engine, queue: nil
        ) { _ in interruption?() }
        engine.prepare()
        do { try engine.start() }
        catch { stopCapture(); throw error }
    }

    func consume(_ frame: VisitRecordingPCMFrame) async throws {
        guard let source = frame.nativeBuffer as? AVAudioPCMBuffer, let targetFormat else {
            throw CocoaError(.coderInvalidValue)
        }
        let input: AnalyzerInput
        if let converter {
            let ratio = targetFormat.sampleRate / source.format.sampleRate
            let capacity = AVAudioFrameCount(ceil(Double(source.frameLength) * ratio)) + 1
            guard let output = AVAudioPCMBuffer(pcmFormat: targetFormat, frameCapacity: capacity) else {
                throw CocoaError(.coderInvalidValue)
            }
            try converter.convert(to: output, from: source)
            input = AnalyzerInput(buffer: output)
        } else {
            input = AnalyzerInput(buffer: source)
        }
        let stream = AsyncStream<AnalyzerInput> { continuation in
            continuation.yield(input)
            continuation.finish()
        }
        _ = try await analyzer.analyzeSequence(stream)
    }

    func stopCapture() {
        if let observer { NotificationCenter.default.removeObserver(observer); self.observer = nil }
        if tapInstalled { engine.inputNode.removeTap(onBus: 0); tapInstalled = false }
        engine.stop()
    }

    func finishAndFinalize() async throws {
        try await analyzer.finalizeAndFinishThroughEndOfInput()
        try await resultTask?.value
    }

    func cancelAndFinishNow() async {
        await analyzer.cancelAndFinishNow()
        resultTask?.cancel()
        _ = try? await resultTask?.value
    }

    private nonisolated static func copyFrame(_ source: AVAudioPCMBuffer) -> VisitRecordingPCMFrame? {
        guard source.frameLength > 0, source.format.sampleRate > 0,
              let copy = AVAudioPCMBuffer(pcmFormat: source.format, frameCapacity: source.frameLength)
        else { return nil }
        copy.frameLength = source.frameLength
        let sourceBuffers = UnsafeMutableAudioBufferListPointer(source.mutableAudioBufferList)
        let copyBuffers = UnsafeMutableAudioBufferListPointer(copy.mutableAudioBufferList)
        guard sourceBuffers.count == copyBuffers.count else { return nil }
        var bytes = 0
        for index in sourceBuffers.indices {
            let count = Int(sourceBuffers[index].mDataByteSize)
            guard let sourceData = sourceBuffers[index].mData,
                  let copyData = copyBuffers[index].mData else { return nil }
            memcpy(copyData, sourceData, count)
            copyBuffers[index].mDataByteSize = sourceBuffers[index].mDataByteSize
            bytes += count
        }
        return VisitRecordingPCMFrame(
            durationSeconds: Double(copy.frameLength) / copy.format.sampleRate,
            byteCount: bytes,
            nativeBuffer: copy
        )
    }
}
#endif
