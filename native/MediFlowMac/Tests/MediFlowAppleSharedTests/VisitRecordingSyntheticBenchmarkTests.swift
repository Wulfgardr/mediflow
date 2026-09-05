/* @Codex */
import AVFAudio
import Darwin
import Foundation
import Speech
import XCTest
@testable import MediFlowAppleShared

#if os(macOS)
@MainActor
final class VisitRecordingSyntheticBenchmarkTests: XCTestCase {
    private struct Manifest: Decodable {
        let schemaVersion, corpusSha256: String
        let clips: [Clip]
    }

    private struct Clip: Decodable {
        let id, audioPath, reference, voice: String
        let rate: Int
    }

    private struct ClipMetrics {
        let referenceWords, edits: Int
        let transcriptEmpty: Bool
        let finalizationMs, realTimeFactor: Double
        let peakQueueBytes: Int
    }

    private struct Receipt: Encodable {
        let schemaVersion, outcome, corpusSha256: String
        let clipCount, referenceWordCount, voiceCount, rateCount: Int
        let wer, p95FinalizationMs, maxRealTimeFactor: Double
        let emptyTranscriptCount, peakQueueBytes: Int
        let peakRssDeltaBytes: UInt64
    }

    func testSyntheticCorpusGate() async throws {
        guard #available(macOS 26.0, *) else { throw XCTSkip("requires macOS 26") }
        let environment = ProcessInfo.processInfo.environment
        guard let manifestPath = environment["MEDIFLOW_VISIT_RECORDING_BENCHMARK_MANIFEST"] else {
            throw XCTSkip("explicit synthetic benchmark manifest required")
        }
        let data = try Data(contentsOf: URL(fileURLWithPath: manifestPath))
        let manifest = try JSONDecoder().decode(Manifest.self, from: data)
        XCTAssertEqual(manifest.schemaVersion, "mediflow.visit-recording.synthetic-benchmark-manifest.v1")
        XCTAssertTrue(manifest.corpusSha256.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil)
        XCTAssertGreaterThanOrEqual(manifest.clips.count, 30)
        XCTAssertGreaterThanOrEqual(Set(manifest.clips.map(\.voice)).count, 5)
        XCTAssertGreaterThanOrEqual(Set(manifest.clips.map(\.rate)).count, 3)

        let requestedLocale = Locale(identifier: "it-IT")
        guard let locale = await SpeechTranscriber.supportedLocale(equivalentTo: requestedLocale) else {
            XCTFail("Italian SpeechTranscriber locale unavailable")
            return
        }
        let installed = await SpeechTranscriber.installedLocales
        XCTAssertTrue(installed.contains { $0.identifier == locale.identifier })
        let alreadyReserved = await AssetInventory.reservedLocales.contains {
            $0.identifier == locale.identifier
        }
        if !alreadyReserved {
            let reserved = try await AssetInventory.reserve(locale: locale)
            XCTAssertTrue(reserved)
        }

        let baselinePeakRss = peakResidentBytes()
        let metrics: [ClipMetrics]
        do {
            metrics = try await manifest.clips.asyncMap { try await self.measure($0, locale: locale) }
        } catch {
            if !alreadyReserved { _ = await AssetInventory.release(reservedLocale: locale) }
            await SpeechModels.endRetention()
            throw error
        }
        let peakRssDelta = peakResidentBytes().saturatingSubtract(baselinePeakRss)
        if !alreadyReserved {
            let released = await AssetInventory.release(reservedLocale: locale)
            XCTAssertTrue(released)
            let remainsReserved = await AssetInventory.reservedLocales.contains {
                $0.identifier == locale.identifier
            }
            XCTAssertFalse(remainsReserved)
        }
        await SpeechModels.endRetention()

        let totalReferenceWords = metrics.reduce(0) { $0 + $1.referenceWords }
        let totalEdits = metrics.reduce(0) { $0 + $1.edits }
        let emptyTranscriptCount = metrics.filter(\.transcriptEmpty).count
        let finalizationValues = metrics.map(\.finalizationMs).sorted()
        let p95Index = max(0, Int(ceil(Double(finalizationValues.count) * 0.95)) - 1)
        let p95FinalizationMs = finalizationValues[p95Index]
        let maximumRtf = metrics.map(\.realTimeFactor).max() ?? .infinity
        let peakQueueBytes = metrics.map(\.peakQueueBytes).max() ?? Int.max
        let wer = totalReferenceWords > 0
            ? Double(totalEdits) / Double(totalReferenceWords) : .infinity
        let passed = manifest.clips.count >= 30 && totalReferenceWords >= 3_000
            && Set(manifest.clips.map(\.voice)).count >= 5
            && Set(manifest.clips.map(\.rate)).count >= 3
            && wer <= 0.20 && emptyTranscriptCount == 0 && p95FinalizationMs <= 3_000
            && maximumRtf <= 1 && peakQueueBytes <= 8 * 1_024 * 1_024
            && peakRssDelta <= 1 * 1_024 * 1_024 * 1_024
        let receipt = Receipt(
            schemaVersion: "mediflow.visit-recording.synthetic-benchmark-receipt.v1",
            outcome: passed ? "passed" : "denied",
            corpusSha256: manifest.corpusSha256,
            clipCount: manifest.clips.count,
            referenceWordCount: totalReferenceWords,
            voiceCount: Set(manifest.clips.map(\.voice)).count,
            rateCount: Set(manifest.clips.map(\.rate)).count,
            wer: wer,
            p95FinalizationMs: p95FinalizationMs,
            maxRealTimeFactor: maximumRtf,
            emptyTranscriptCount: emptyTranscriptCount,
            peakQueueBytes: peakQueueBytes,
            peakRssDeltaBytes: peakRssDelta
        )
        let encoded = try JSONEncoder().encode(receipt)
        print("MEDIFLOW_RECORDING_BENCHMARK_RECEIPT=\(String(decoding: encoded, as: UTF8.self))")

        XCTAssertGreaterThanOrEqual(totalReferenceWords, 3_000)
        XCTAssertLessThanOrEqual(wer, 0.20)
        XCTAssertEqual(emptyTranscriptCount, 0)
        XCTAssertLessThanOrEqual(p95FinalizationMs, 3_000)
        XCTAssertLessThanOrEqual(maximumRtf, 1)
        XCTAssertLessThanOrEqual(peakQueueBytes, 8 * 1_024 * 1_024)
        XCTAssertLessThanOrEqual(peakRssDelta, 1 * 1_024 * 1_024 * 1_024)
    }

    @available(macOS 26.0, *)
    private func measure(_ clip: Clip, locale: Locale) async throws -> ClipMetrics {
        XCTAssertTrue(clip.id.range(of: "^clip-[0-9]{2}$", options: .regularExpression) != nil)
        let file = try AVAudioFile(forReading: URL(fileURLWithPath: clip.audioPath))
        let sourceFormat = file.processingFormat
        let transcriber = SpeechTranscriber(locale: locale, preset: .transcription)
        let analyzer = SpeechAnalyzer(modules: [transcriber])
        guard let targetFormat = await SpeechAnalyzer.bestAvailableAudioFormat(
            compatibleWith: [transcriber],
            considering: sourceFormat
        ) else { throw BenchmarkError.unsupportedFormat }
        let budget = VisitRecordingAudioBudget(limits: .standard)
        let converter = try VisitRecordingPCMConverter(
            sourceFormat: sourceFormat,
            targetFormat: targetFormat,
            audioBudget: budget
        )
        let queue = VisitRecordingPCMQueue()
        try await analyzer.prepareToAnalyze(in: targetFormat)
        let resultTask = Task { () throws -> String in
            var segments: [String] = []
            for try await result in transcriber.results where result.isFinal {
                let segment = String(result.text.characters)
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                if !segment.isEmpty { segments.append(segment) }
            }
            return segments.joined(separator: " ")
        }
        let started = ContinuousClock.now
        do {
            while file.framePosition < file.length {
                let remaining = AVAudioFrameCount(min(Int64(4_096), file.length - file.framePosition))
                guard let buffer = AVAudioPCMBuffer(pcmFormat: sourceFormat, frameCapacity: remaining) else {
                    throw BenchmarkError.bufferAllocation
                }
                try file.read(into: buffer, frameCount: remaining)
                guard buffer.frameLength > 0 else { break }
                let byteCount = try pcmByteCount(buffer)
                guard let reservation = budget.tryReserveSource(
                    durationSeconds: Double(buffer.frameLength) / sourceFormat.sampleRate,
                    byteCount: byteCount
                ).reservation else { throw BenchmarkError.queueExceeded }
                let frame = VisitRecordingPCMFrame(
                    durationSeconds: Double(buffer.frameLength) / sourceFormat.sampleRate,
                    byteCount: byteCount,
                    nativeBuffer: buffer,
                    reservation: reservation
                )
                guard queue.offer(frame) == .accepted, let queued = await queue.next() else {
                    frame.releaseReservation()
                    throw BenchmarkError.queueExceeded
                }
                let converted: [VisitRecordingConvertedPCM]
                do { converted = try converter.convert(queued) }
                catch { queue.acknowledge(queued); throw error }
                defer { queue.acknowledge(queued) }
                try await analyze(converted, with: analyzer)
            }
            queue.finish()
            let stopped = ContinuousClock.now
            let flushed = try converter.flush()
            try await analyze(flushed, with: analyzer)
            try await analyzer.finalizeAndFinishThroughEndOfInput()
            let transcript = try await resultTask.value
            let finished = ContinuousClock.now
            let snapshot = budget.snapshot
            guard snapshot.bytes == 0, snapshot.seconds == 0 else { throw BenchmarkError.queueLeak }
            let durationSeconds = Double(file.length) / sourceFormat.sampleRate
            let referenceWords = normalizedWords(clip.reference)
            let transcriptWords = normalizedWords(transcript)
            return ClipMetrics(
                referenceWords: referenceWords.count,
                edits: editDistance(referenceWords, transcriptWords),
                transcriptEmpty: transcriptWords.isEmpty,
                finalizationMs: milliseconds(stopped.duration(to: finished)),
                realTimeFactor: seconds(started.duration(to: finished)) / durationSeconds,
                peakQueueBytes: snapshot.peakBytes
            )
        } catch {
            queue.cancel()
            converter.cancel()
            await analyzer.cancelAndFinishNow()
            resultTask.cancel()
            _ = try? await resultTask.value
            throw error
        }
    }

    @available(macOS 26.0, *)
    private func analyze(
        _ outputs: [VisitRecordingConvertedPCM],
        with analyzer: SpeechAnalyzer
    ) async throws {
        defer { outputs.forEach { $0.releaseReservation() } }
        for output in outputs {
            let stream = AsyncStream<AnalyzerInput> { continuation in
                continuation.yield(AnalyzerInput(buffer: output.buffer))
                continuation.finish()
            }
            _ = try await analyzer.analyzeSequence(stream)
        }
    }

    private func pcmByteCount(_ buffer: AVAudioPCMBuffer) throws -> Int {
        var total = 0
        for item in UnsafeMutableAudioBufferListPointer(buffer.mutableAudioBufferList) {
            let (next, overflow) = total.addingReportingOverflow(Int(item.mDataByteSize))
            guard !overflow, item.mData != nil else { throw BenchmarkError.invalidBuffer }
            total = next
        }
        guard total > 0 else { throw BenchmarkError.invalidBuffer }
        return total
    }

    private func normalizedWords(_ value: String) -> [String] {
        value.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "it-IT"))
            .components(separatedBy: CharacterSet.alphanumerics.inverted)
            .filter { !$0.isEmpty }
    }

    private func editDistance(_ left: [String], _ right: [String]) -> Int {
        var previous = Array(0...right.count)
        for (leftIndex, leftWord) in left.enumerated() {
            var current = Array(repeating: 0, count: right.count + 1)
            current[0] = leftIndex + 1
            for (rightIndex, rightWord) in right.enumerated() {
                current[rightIndex + 1] = min(
                    current[rightIndex] + 1,
                    previous[rightIndex + 1] + 1,
                    previous[rightIndex] + (leftWord == rightWord ? 0 : 1)
                )
            }
            previous = current
        }
        return previous[right.count]
    }

    private func peakResidentBytes() -> UInt64 {
        var usage = rusage()
        guard getrusage(RUSAGE_SELF, &usage) == 0, usage.ru_maxrss >= 0 else { return 0 }
        return UInt64(usage.ru_maxrss)
    }

    private func seconds(_ duration: Duration) -> Double {
        let components = duration.components
        return Double(components.seconds) + Double(components.attoseconds) / 1e18
    }

    private func milliseconds(_ duration: Duration) -> Double { seconds(duration) * 1_000 }
}

private enum BenchmarkError: Error {
    case unsupportedFormat, bufferAllocation, invalidBuffer, queueExceeded, queueLeak
}

private extension Array {
    func asyncMap<T>(_ transform: (Element) async throws -> T) async rethrows -> [T] {
        var values: [T] = []
        values.reserveCapacity(count)
        for element in self { values.append(try await transform(element)) }
        return values
    }
}

private extension UInt64 {
    func saturatingSubtract(_ value: UInt64) -> UInt64 { self >= value ? self - value : 0 }
}
#endif
