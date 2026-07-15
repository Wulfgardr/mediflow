// @Codex
import Foundation
import SwiftUI
import XCTest
@testable import MediFlowAppleShared

#if os(macOS)
import AppKit
#endif

final class LumeToneMappingTests: XCTestCase {
    private let registers: [(name: String, palette: LumeRegisterPalette)] = [
        ("giorno", LumePalette.giorno), ("grafite", LumePalette.grafite),
        ("guardia", LumePalette.guardia),
    ]
    private let signalTones: [LumeTone] = [.positive, .attention, .critical]

    func testEveryToneMapsToItsCanonicalDTCGTokenInEveryRegister() throws {
        let canonical = try canonicalHexTokens()
        let expectedTones: Set<LumeTone> = [.neutral, .info, .positive, .attention, .critical]
        XCTAssertEqual(Set(LumeTone.allCases), expectedTones)

        for register in registers {
            for tone in LumeTone.allCases {
                let tokenPath = expectedTokenPath(for: tone, registerName: register.name)
                let expected = try XCTUnwrap(canonical[tokenPath], "Missing DTCG token: \(tokenPath)")
                XCTAssertEqual(LumePalette.hex(for: tone, using: register.palette).lowercased(),
                               expected.lowercased(),
                               "\(register.name).\(tone) must resolve to \(tokenPath)")
            }
        }
    }

    func testPlumIsNotUsedByAnyClinicalTone() throws {
        let plum = try XCTUnwrap(canonicalHexTokens()["signal.plum"]).lowercased()
        for register in registers {
            for tone in LumeTone.allCases {
                XCTAssertNotEqual(LumePalette.hex(for: tone, using: register.palette).lowercased(),
                                  plum,
                                  "signal.plum requires a structured state; it cannot back \(tone)")
            }
        }
    }

    func testRenderedSignalsUseSixtyFortySRGBAndMeetFieldContrast() throws {
        for register in registers {
            for tone in signalTones {
                let seed = LumePalette.hex(for: tone, using: register.palette)
                let expected = mixedHex(seed: seed, ink: register.palette.inkPrimaryHex)
                let actual = LumePalette.resolvedHex(for: tone, using: register.palette)
                XCTAssertEqual(actual, expected, "\(register.name).\(tone) must use the 60/40 sRGB mix")
                XCTAssertGreaterThanOrEqual(contrastRatio(actual, register.palette.fieldHex), 4.5,
                                            "\(register.name).\(tone) must remain readable on field")
                #if os(macOS)
                XCTAssertEqual(try renderedHex(LumePalette.tint(for: tone, using: register.palette)),
                               expected,
                               "\(register.name).\(tone) tint must render the resolved sRGB value")
                #endif
            }
        }
    }

    #if os(macOS)
    @MainActor
    func testSyntheticToneMatrixRendersAcrossAllRegisters() throws {
        let content = LumeToneEvidenceMatrix().frame(width: 960, height: 360)
            .dynamicTypeSize(.accessibility1)
        let renderer = ImageRenderer(content: content)
        renderer.scale = 2
        let image = try XCTUnwrap(renderer.cgImage)
        XCTAssertEqual(image.width, 1_920)
        XCTAssertEqual(image.height, 720)

        guard let path = ProcessInfo.processInfo.environment["LUME_TONE_EVIDENCE_PATH"] else { return }
        let outputURL = URL(fileURLWithPath: path)
        try FileManager.default.createDirectory(at: outputURL.deletingLastPathComponent(),
                                                withIntermediateDirectories: true)
        let png = try XCTUnwrap(NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]))
        try png.write(to: outputURL, options: .atomic)
    }
    #endif

    private func expectedTokenPath(for tone: LumeTone, registerName: String) -> String {
        switch tone {
        case .neutral: return "register.\(registerName).ink.muted"
        case .info: return "register.\(registerName).accent.minerale"
        case .positive: return "signal.success"
        case .attention: return "signal.warning"
        case .critical: return "signal.critical"
        }
    }

    private func canonicalHexTokens() throws -> [String: String] {
        let data = try Data(contentsOf: canonicalTokenURL())
        let root = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        var canonical: [String: String] = [:]
        collectHexTokens(in: root, path: [], into: &canonical)
        return canonical
    }

    private func canonicalTokenURL() throws -> URL {
        var directory = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        while directory.path != "/" {
            let candidate = directory.appendingPathComponent("docs/design/lume/tokens/lume.tokens.json")
            if FileManager.default.fileExists(atPath: candidate.path) { return candidate }
            directory.deleteLastPathComponent()
        }
        throw NSError(domain: "LumeToneMappingTests", code: 1,
                      userInfo: [NSLocalizedDescriptionKey: "Canonical Lume token JSON not found from #filePath"])
    }

    private func collectHexTokens(in node: [String: Any], path: [String],
                                  into tokens: inout [String: String]) {
        if let value = node["$value"] as? String {
            tokens[path.joined(separator: ".")] = value
            return
        }
        for key in node.keys.sorted() where !key.hasPrefix("$") {
            guard let child = node[key] as? [String: Any] else { continue }
            collectHexTokens(in: child, path: path + [key], into: &tokens)
        }
    }

    private func channels(_ hex: String) -> [Double] {
        guard hex.count == 7, let value = UInt64(hex.dropFirst(), radix: 16) else {
            XCTFail("Invalid test hex: \(hex)")
            return [0, 0, 0]
        }
        return [16, 8, 0].map { Double((value >> $0) & 0xff) }
    }

    private func mixedHex(seed: String, ink: String) -> String {
        let mixed = zip(channels(seed), channels(ink)).map { Int(($0 * 0.6 + $1 * 0.4).rounded()) }
        return String(format: "#%02x%02x%02x", mixed[0], mixed[1], mixed[2])
    }

    private func contrastRatio(_ foreground: String, _ background: String) -> Double {
        let values = [foreground, background].map(relativeLuminance)
        return (max(values[0], values[1]) + 0.05) / (min(values[0], values[1]) + 0.05)
    }

    private func relativeLuminance(_ hex: String) -> Double {
        let linear = channels(hex).map { channel -> Double in
            let value = channel / 255
            return value <= 0.04045 ? value / 12.92 : pow((value + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
    }

    #if os(macOS)
    private func renderedHex(_ color: Color) throws -> String {
        let value = try XCTUnwrap(NSColor(color).usingColorSpace(.sRGB))
        let channels = [value.redComponent, value.greenComponent, value.blueComponent].map { Int(($0 * 255).rounded()) }
        return String(format: "#%02x%02x%02x", channels[0], channels[1], channels[2])
    }
    #endif
}

#if os(macOS)
private struct LumeToneEvidenceMatrix: View {
    var body: some View {
        HStack(spacing: 16) {
            register("Giorno", colorScheme: .light, isGuardia: false)
            register("Grafite", colorScheme: .dark, isGuardia: false)
            register("Guardia", colorScheme: .dark, isGuardia: true)
        }
        .padding(20)
        .background(Color.black.opacity(0.08))
    }

    private func register(_ title: String, colorScheme: ColorScheme, isGuardia: Bool) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(.headline)
            StatusBadge("Neutro", tone: .neutral)
            StatusBadge("Informativo", tone: .info)
            StatusBadge("Positivo", tone: .positive)
            StatusBadge("Attenzione", tone: .attention)
            StatusBadge("Critico", tone: .critical)
        }
        .padding(14)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .lumeSurface(zone: .field)
        .environment(\.colorScheme, colorScheme)
        .lumeGuardia(isGuardia)
    }
}
#endif
