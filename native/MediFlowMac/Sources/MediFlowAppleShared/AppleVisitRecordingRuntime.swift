/* @Codex */
#if os(macOS)
import AVFAudio
import Foundation
import Speech

@available(macOS 26.0, *)
final class VisitRecordingConvertedPCM {
    let buffer: AVAudioPCMBuffer
    private let reservation: VisitRecordingAudioReservation?

    init(buffer: AVAudioPCMBuffer, reservation: VisitRecordingAudioReservation?) {
        self.buffer = buffer
        self.reservation = reservation
    }

    func releaseReservation() { reservation?.release() }
}

@available(macOS 26.0, *)
private enum VisitRecordingPCMConverterError: Error {
    case invalidFormat
    case allocationFailed
    case budgetExceeded(VisitRecordingDenial)
    case conversionFailed
    case outputLimitExceeded
}

@available(macOS 26.0, *)
final class VisitRecordingPCMConverter {
    private static let outputCountSlack = 32.0

    private let sourceFormat: AVAudioFormat
    private let targetFormat: AVAudioFormat
    private let audioBudget: VisitRecordingAudioBudget
    private let outputFrameCapacity: AVAudioFrameCount
    private let converter: AVAudioConverter?
    private(set) var isFinished = false

    init(
        sourceFormat: AVAudioFormat,
        targetFormat: AVAudioFormat,
        audioBudget: VisitRecordingAudioBudget,
        outputFrameCapacity: AVAudioFrameCount = 1_024
    ) throws {
        guard sourceFormat.sampleRate > 0,
              targetFormat.sampleRate > 0,
              sourceFormat.channelCount > 0,
              targetFormat.channelCount > 0,
              outputFrameCapacity > 0 else {
            throw VisitRecordingPCMConverterError.invalidFormat
        }
        self.sourceFormat = sourceFormat
        self.targetFormat = targetFormat
        self.audioBudget = audioBudget
        self.outputFrameCapacity = outputFrameCapacity
        if sourceFormat.isEqual(targetFormat) {
            converter = nil
        } else {
            guard let converter = AVAudioConverter(from: sourceFormat, to: targetFormat) else {
                throw VisitRecordingPCMConverterError.invalidFormat
            }
            self.converter = converter
        }
    }

    func convert(_ frame: VisitRecordingPCMFrame) throws -> [VisitRecordingConvertedPCM] {
        guard !isFinished,
              let source = frame.nativeBuffer as? AVAudioPCMBuffer,
              source.format.isEqual(sourceFormat) else {
            throw VisitRecordingPCMConverterError.invalidFormat
        }
        guard converter != nil else {
            return [VisitRecordingConvertedPCM(buffer: source, reservation: nil)]
        }
        return try drain(source: source, endOfStream: false)
    }

    func flush() throws -> [VisitRecordingConvertedPCM] {
        guard !isFinished else { return [] }
        guard converter != nil else {
            isFinished = true
            return []
        }
        let outputs = try drain(source: nil, endOfStream: true)
        isFinished = true
        return outputs
    }

    func cancel() {
        converter?.reset()
        isFinished = true
    }

    private func drain(
        source: AVAudioPCMBuffer?,
        endOfStream: Bool
    ) throws -> [VisitRecordingConvertedPCM] {
        guard let converter else { return [] }
        var providedSource = false
        var outputs: [VisitRecordingConvertedPCM] = []
        do {
            let allocationBytes = try outputAllocationBytes()
            let maximumOutputs = try maximumOutputAttempts(
                source: source,
                allocationBytes: allocationBytes
            )
            for _ in 0..<maximumOutputs {
                let output = try makeOutputBuffer(allocationBytes: allocationBytes)
                var conversionError: NSError?
                let status = converter.convert(to: output.buffer, error: &conversionError) {
                    _, inputStatus in
                    if let source, !providedSource {
                        providedSource = true
                        inputStatus.pointee = .haveData
                        return source
                    }
                    inputStatus.pointee = endOfStream ? .endOfStream : .noDataNow
                    return nil
                }
                if output.buffer.frameLength > 0 {
                    outputs.append(output)
                } else {
                    output.releaseReservation()
                }
                switch status {
                case .haveData:
                    guard output.buffer.frameLength > 0 else {
                        throw VisitRecordingPCMConverterError.conversionFailed
                    }
                    continue
                case .inputRanDry:
                    return outputs
                case .endOfStream:
                    return outputs
                case .error:
                    _ = conversionError
                    throw VisitRecordingPCMConverterError.conversionFailed
                @unknown default:
                    throw VisitRecordingPCMConverterError.conversionFailed
                }
            }
            throw VisitRecordingPCMConverterError.outputLimitExceeded
        } catch {
            outputs.forEach { $0.releaseReservation() }
            throw error
        }
    }

    private func makeOutputBuffer(
        allocationBytes: Int
    ) throws -> VisitRecordingConvertedPCM {
        let reservation: VisitRecordingAudioReservation
        switch audioBudget.reserveConversion(byteCount: allocationBytes) {
        case let .reserved(value):
            reservation = value
        case let .denied(denial):
            throw VisitRecordingPCMConverterError.budgetExceeded(denial)
        }
        guard let buffer = AVAudioPCMBuffer(
            pcmFormat: targetFormat,
            frameCapacity: outputFrameCapacity
        ) else {
            reservation.release()
            throw VisitRecordingPCMConverterError.allocationFailed
        }
        return VisitRecordingConvertedPCM(buffer: buffer, reservation: reservation)
    }

    private func maximumOutputAttempts(
        source: AVAudioPCMBuffer?,
        allocationBytes: Int
    ) throws -> Int {
        let boundedSeconds = source.map {
            Double($0.frameLength) / sourceFormat.sampleRate
        } ?? audioBudget.maximumBufferedAudioSeconds
        let expectedOutputs = ceil(
            boundedSeconds * targetFormat.sampleRate / Double(outputFrameCapacity)
        )
        let durationBound = expectedOutputs + Self.outputCountSlack
        guard durationBound.isFinite,
              durationBound > 0,
              durationBound <= Double(Int.max) else {
            throw VisitRecordingPCMConverterError.invalidFormat
        }
        return min(
            Int(durationBound),
            audioBudget.maximumConversionOutputAttempts(bytesPerBuffer: allocationBytes)
        )
    }

    private func outputAllocationBytes() throws -> Int {
        let descriptor = targetFormat.streamDescription.pointee
        let bytesPerFrame = Int(descriptor.mBytesPerFrame)
        let bufferCount = targetFormat.isInterleaved ? 1 : Int(targetFormat.channelCount)
        guard bytesPerFrame > 0, bufferCount > 0 else {
            throw VisitRecordingPCMConverterError.invalidFormat
        }
        let (perBuffer, firstOverflow) = Int(outputFrameCapacity)
            .multipliedReportingOverflow(by: bytesPerFrame)
        let (total, secondOverflow) = perBuffer.multipliedReportingOverflow(by: bufferCount)
        guard !firstOverflow, !secondOverflow, total > 0 else {
            throw VisitRecordingPCMConverterError.invalidFormat
        }
        return total
    }
}

@available(macOS 26.0, *)
@MainActor
final class AppleVisitRecordingRuntime: VisitRecordingRuntimePort {
    private let engine = AVAudioEngine()
    private let transcriber: SpeechTranscriber
    private let analyzer: SpeechAnalyzer
    private var pcmConverter: VisitRecordingPCMConverter?
    private var resultTask: Task<Void, Error>?
    private var tapInstalled = false
    private var observer: NSObjectProtocol?
    private var audioBudget: VisitRecordingAudioBudget?
    private var onFrame: (@Sendable (VisitRecordingPCMFrame) -> Void)?
    private var onInterruption: (@Sendable () -> Void)?
    private var onFailure: (@Sendable (VisitRecordingDenial) -> Void)?

    init(locale: Locale) {
        transcriber = SpeechTranscriber(locale: locale, preset: .transcription)
        analyzer = SpeechAnalyzer(modules: [transcriber])
    }

    func prepare(
        audioBudget: VisitRecordingAudioBudget,
        onFrame: @escaping @Sendable (VisitRecordingPCMFrame) -> Void,
        onResult: @escaping @MainActor @Sendable (VisitRecordingTranscriptResult) -> Void,
        onInterruption: @escaping @Sendable () -> Void,
        onFailure: @escaping @Sendable (VisitRecordingDenial) -> Void
    ) async throws {
        self.audioBudget = audioBudget
        self.onFrame = onFrame
        self.onInterruption = onInterruption
        self.onFailure = onFailure
        let natural = engine.inputNode.inputFormat(forBus: 0)
        guard natural.sampleRate > 0,
              let target = await SpeechAnalyzer.bestAvailableAudioFormat(
                  compatibleWith: [transcriber], considering: natural
              ) else { throw CocoaError(.featureUnsupported) }
        pcmConverter = try VisitRecordingPCMConverter(
            sourceFormat: natural,
            targetFormat: target,
            audioBudget: audioBudget
        )
        try await analyzer.prepareToAnalyze(in: target)
        resultTask = Task {
            do {
                for try await result in transcriber.results {
                    onResult(.init(text: String(result.text.characters), isFinal: result.isFinal))
                }
            } catch {
                if !Task.isCancelled { onFailure(.failed) }
                throw error
            }
        }
    }

    func startCapture() throws {
        guard let audioBudget else { throw CocoaError(.coderInvalidValue) }
        let input = engine.inputNode
        let format = input.inputFormat(forBus: 0)
        let frameHandler = onFrame
        let failureHandler = onFailure
        input.installTap(onBus: 0, bufferSize: 1_024, format: format) { buffer, _ in
            guard let metrics = Self.frameMetrics(buffer) else {
                failureHandler?(.invalidUsage)
                return
            }
            let reservation: VisitRecordingAudioReservation
            switch audioBudget.tryReserveSource(
                durationSeconds: metrics.durationSeconds,
                byteCount: metrics.byteCount
            ) {
            case let .reserved(value):
                reservation = value
            case let .denied(denial):
                failureHandler?(denial)
                return
            }
            guard let frame = Self.copyFrame(
                buffer,
                durationSeconds: metrics.durationSeconds,
                byteCount: metrics.byteCount,
                reservation: reservation
            ) else {
                reservation.releaseOffAudioThread()
                failureHandler?(.failed)
                return
            }
            frameHandler?(frame)
        }
        tapInstalled = true
        let interruption = onInterruption
        observer = NotificationCenter.default.addObserver(
            forName: .AVAudioEngineConfigurationChange,
            object: engine,
            queue: nil
        ) { _ in interruption?() }
        engine.prepare()
        do { try engine.start() }
        catch { stopCapture(); throw error }
    }

    func consume(_ frame: VisitRecordingPCMFrame) async throws {
        guard let pcmConverter else { throw CocoaError(.coderInvalidValue) }
        let outputs: [VisitRecordingConvertedPCM]
        do {
            outputs = try pcmConverter.convert(frame)
        } catch let VisitRecordingPCMConverterError.budgetExceeded(denial) {
            throw VisitRecordingRuntimeDenialError(denial: denial)
        }
        defer { outputs.forEach { $0.releaseReservation() } }
        for output in outputs {
            try await analyze(output.buffer)
        }
    }

    func stopCapture() {
        if let observer {
            NotificationCenter.default.removeObserver(observer)
            self.observer = nil
        }
        if tapInstalled {
            engine.inputNode.removeTap(onBus: 0)
            tapInstalled = false
        }
        engine.stop()
    }

    func finishAndFinalize() async throws {
        guard let pcmConverter else { throw CocoaError(.coderInvalidValue) }
        let outputs: [VisitRecordingConvertedPCM]
        do {
            outputs = try pcmConverter.flush()
        } catch let VisitRecordingPCMConverterError.budgetExceeded(denial) {
            throw VisitRecordingRuntimeDenialError(denial: denial)
        }
        defer { outputs.forEach { $0.releaseReservation() } }
        for output in outputs {
            try await analyze(output.buffer)
        }
        try await analyzer.finalizeAndFinishThroughEndOfInput()
        try await resultTask?.value
    }

    func cancelAndFinishNow() async {
        pcmConverter?.cancel()
        await analyzer.cancelAndFinishNow()
        resultTask?.cancel()
        _ = try? await resultTask?.value
    }

    private func analyze(_ buffer: AVAudioPCMBuffer) async throws {
        let input = AnalyzerInput(buffer: buffer)
        let stream = AsyncStream<AnalyzerInput> { continuation in
            continuation.yield(input)
            continuation.finish()
        }
        _ = try await analyzer.analyzeSequence(stream)
    }

    private nonisolated static func frameMetrics(
        _ source: AVAudioPCMBuffer
    ) -> (durationSeconds: Double, byteCount: Int)? {
        guard source.frameLength > 0, source.format.sampleRate > 0 else { return nil }
        let buffers = UnsafeMutableAudioBufferListPointer(source.mutableAudioBufferList)
        var bytes = 0
        for buffer in buffers {
            let (next, overflow) = bytes.addingReportingOverflow(Int(buffer.mDataByteSize))
            guard !overflow, buffer.mData != nil else { return nil }
            bytes = next
        }
        guard bytes > 0 else { return nil }
        return (
            Double(source.frameLength) / source.format.sampleRate,
            bytes
        )
    }

    private nonisolated static func copyFrame(
        _ source: AVAudioPCMBuffer,
        durationSeconds: Double,
        byteCount: Int,
        reservation: VisitRecordingAudioReservation
    ) -> VisitRecordingPCMFrame? {
        guard let copy = AVAudioPCMBuffer(
            pcmFormat: source.format,
            frameCapacity: source.frameLength
        ) else { return nil }
        copy.frameLength = source.frameLength
        let sourceBuffers = UnsafeMutableAudioBufferListPointer(source.mutableAudioBufferList)
        let copyBuffers = UnsafeMutableAudioBufferListPointer(copy.mutableAudioBufferList)
        guard sourceBuffers.count == copyBuffers.count else { return nil }
        for index in sourceBuffers.indices {
            let count = Int(sourceBuffers[index].mDataByteSize)
            guard let sourceData = sourceBuffers[index].mData,
                  let copyData = copyBuffers[index].mData,
                  count <= Int(copyBuffers[index].mDataByteSize) else { return nil }
            memcpy(copyData, sourceData, count)
            copyBuffers[index].mDataByteSize = sourceBuffers[index].mDataByteSize
        }
        return VisitRecordingPCMFrame(
            durationSeconds: durationSeconds,
            byteCount: byteCount,
            nativeBuffer: copy,
            reservation: reservation
        )
    }
}
#endif
