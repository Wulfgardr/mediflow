#!/usr/bin/env swift
/* @Codex */
import CoreGraphics
import Foundation
import ImageIO
import Vision

private let schemaVersion = "mediflow.apple_vision_ocr.v1"
private let maximumInputBytes = 16 * 1024 * 1024
private let maximumOutputBytes = 8 * 1024 * 1024
private let maximumDimensionPixels = 4096
private let maximumPixelCount = 12_000_000

private func emit(_ value: [String: Any], exitCode: Int32) -> Never {
    guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]) else { exit(70) }
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([0x0a]))
    exit(exitCode)
}

private func deny(_ reason: String, exitCode: Int32 = 1) -> Never {
    emit([
        "engine": "apple_vision",
        "error": reason,
        "ok": false,
        "schemaVersion": schemaVersion,
    ], exitCode: exitCode)
}

private func boundedStandardInput() -> Data? {
    var input = Data()
    do {
        while let chunk = try FileHandle.standardInput.read(upToCount: 64 * 1024), !chunk.isEmpty {
            guard input.count + chunk.count <= maximumInputBytes else { return nil }
            input.append(chunk)
        }
        return input
    } catch {
        return nil
    }
}

private func rasterImage(_ data: Data) -> CGImage? {
    guard let source = CGImageSourceCreateWithData(data as CFData, [
        kCGImageSourceShouldCache: false,
    ] as CFDictionary), CGImageSourceGetCount(source) == 1,
    let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
    let width = (properties[kCGImagePropertyPixelWidth] as? NSNumber)?.intValue,
    let height = (properties[kCGImagePropertyPixelHeight] as? NSNumber)?.intValue,
    width > 0, height > 0, width <= maximumDimensionPixels, height <= maximumDimensionPixels,
    width.multipliedReportingOverflow(by: height).overflow == false,
    width * height <= maximumPixelCount else { return nil }
    return CGImageSourceCreateImageAtIndex(source, 0, [
        kCGImageSourceShouldCacheImmediately: true,
    ] as CFDictionary)
}

private func recognize(_ image: CGImage) throws -> (text: String, confidence: Double) {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    request.recognitionLanguages = ["it-IT", "en-US"]
    try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])

    let observations = (request.results ?? []).sorted { left, right in
        let verticalDistance = abs(left.boundingBox.midY - right.boundingBox.midY)
        return verticalDistance > 0.01
            ? left.boundingBox.midY > right.boundingBox.midY
            : left.boundingBox.minX < right.boundingBox.minX
    }
    var lines: [String] = []
    var confidenceTotal = 0.0
    for observation in observations {
        guard let candidate = observation.topCandidates(1).first else { continue }
        let line = candidate.string.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !line.isEmpty else { continue }
        lines.append(line)
        confidenceTotal += Double(candidate.confidence)
    }
    let text = lines.joined(separator: "\n")
    return (text, lines.isEmpty ? 0 : confidenceTotal / Double(lines.count))
}

guard CommandLine.arguments.count == 1 else { deny("invalid_arguments", exitCode: 64) }
guard let input = boundedStandardInput(), !input.isEmpty else { deny("invalid_or_oversized_input") }
guard let image = rasterImage(input) else { deny("unsupported_or_oversized_image") }

do {
    let result = try recognize(image)
    guard !result.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { deny("empty_output", exitCode: 2) }
    guard result.text.lengthOfBytes(using: .utf8) <= maximumOutputBytes else { deny("output_limit", exitCode: 3) }
    emit([
        "avgConfidence": result.confidence,
        "engine": "apple_vision",
        "ok": true,
        "schemaVersion": schemaVersion,
        "text": result.text,
    ], exitCode: 0)
} catch {
    deny("recognition_failed", exitCode: 4)
}
