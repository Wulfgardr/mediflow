#!/usr/bin/env swift
/* @Codex */
import AppKit
import Foundation
import Vision

struct PageOCR {
    let text: String
    let confidence: Double
}

enum OCRError: Error, CustomStringConvertible {
    case missingFile(String)
    case unsupported(String)
    case imageLoadFailed(String)

    var description: String {
        switch self {
        case .missingFile(let path): return "file not found: \(path)"
        case .unsupported(let ext): return "unsupported extension: \(ext)"
        case .imageLoadFailed(let path): return "cannot load image: \(path)"
        }
    }
}

func recognize(cgImage: CGImage) throws -> PageOCR {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    if #available(macOS 11.0, *) {
        request.recognitionLanguages = ["it-IT", "en-US"]
    }

    let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
    try handler.perform([request])

    var lines: [String] = []
    var confidences: [Double] = []
    for observation in request.results ?? [] {
        guard let candidate = observation.topCandidates(1).first else { continue }
        lines.append(candidate.string)
        confidences.append(Double(candidate.confidence))
    }

    let confidence = confidences.isEmpty ? 0.0 : confidences.reduce(0.0, +) / Double(confidences.count)
    return PageOCR(text: lines.joined(separator: "\n"), confidence: confidence)
}

func imageCGImage(url: URL) throws -> CGImage {
    guard let image = NSImage(contentsOf: url) else {
        throw OCRError.imageLoadFailed(url.path)
    }
    var rect = NSRect(origin: .zero, size: image.size)
    guard let cgImage = image.cgImage(forProposedRect: &rect, context: nil, hints: nil) else {
        throw OCRError.imageLoadFailed(url.path)
    }
    return cgImage
}

func printJSON(_ object: Any) {
    if let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]),
       let text = String(data: data, encoding: .utf8) {
        print(text)
    }
}

let args = Array(CommandLine.arguments.dropFirst())
if args.isEmpty || args.contains("--help") {
    print("usage: apple-vision-ocr.swift <image-file>")
    exit(args.isEmpty ? 1 : 0)
}

let inputPath = args[0]
let url = URL(fileURLWithPath: inputPath)
guard FileManager.default.fileExists(atPath: url.path) else {
    printJSON(["ok": false, "engine": "apple_vision", "error": "\(OCRError.missingFile(inputPath))"])
    exit(1)
}

let ext = url.pathExtension.lowercased()
guard ["png", "jpg", "jpeg", "tif", "tiff", "bmp", "heic", "heif", "webp"].contains(ext) else {
    printJSON(["ok": false, "engine": "apple_vision", "error": "\(OCRError.unsupported(ext))"])
    exit(1)
}

do {
    let result = try recognize(cgImage: imageCGImage(url: url))
    printJSON([
        "ok": true,
        "engine": "apple_vision",
        "avg_confidence": result.confidence,
        "text": result.text,
    ])
    exit(0)
} catch {
    printJSON(["ok": false, "engine": "apple_vision", "error": "\(error)"])
    exit(2)
}
