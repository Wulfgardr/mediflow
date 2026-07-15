// @Codex
#if os(macOS)
import AppKit
import SwiftUI
import XCTest
@testable import MediFlowAppleShared

@MainActor
final class LumeKitTests: XCTestCase {
    func testRegisterResolutionFollowsSystemAndGuardiaOnlyRefinesDark() {
        XCTAssertEqual(LumePalette.palette(for: .light, isGuardia: false), LumePalette.giorno)
        XCTAssertEqual(LumePalette.palette(for: .dark, isGuardia: false), LumePalette.grafite)
        XCTAssertEqual(LumePalette.palette(for: .dark, isGuardia: true), LumePalette.guardia)
        XCTAssertEqual(LumePalette.palette(for: .light, isGuardia: true), LumePalette.giorno)
    }

    func testCompatibilityAliasesPreserveClinicalToneCases() {
        let legacyTone: VetroTone = .critical
        XCTAssertEqual(legacyTone, LumeTone.critical)
    }

    func testLumePrimitivesRenderOpaqueInAllRegisters() throws {
        let surface = Color.clear
            .frame(width: 64, height: 32)
            .lumeSurface(zone: .field)

        let giorno = try centerPixel(surface, colorScheme: .light, isGuardia: false)
        let grafite = try centerPixel(surface, colorScheme: .dark, isGuardia: false)
        let guardia = try centerPixel(surface, colorScheme: .dark, isGuardia: true)

        XCTAssertEqual(giorno.alpha, 255)
        XCTAssertEqual(grafite.alpha, 255)
        XCTAssertEqual(guardia.alpha, 255)
        XCTAssertNotEqual(giorno.rgb, grafite.rgb)
        XCTAssertNotEqual(grafite.rgb, guardia.rgb)
    }

    private func centerPixel<Content: View>(
        _ content: Content,
        colorScheme: ColorScheme,
        isGuardia: Bool,
        file: StaticString = #filePath,
        line: UInt = #line
    ) throws -> (rgb: [UInt8], alpha: UInt8) {
        let renderer = ImageRenderer(
            content: content
                .environment(\.colorScheme, colorScheme)
                .environment(\.lumeGuardia, isGuardia)
        )
        renderer.scale = 1

        let image = try XCTUnwrap(renderer.nsImage, file: file, line: line)
        var rect = CGRect(origin: .zero, size: image.size)
        let cgImage = try XCTUnwrap(
            image.cgImage(forProposedRect: &rect, context: nil, hints: nil),
            file: file,
            line: line
        )
        let width = cgImage.width
        let height = cgImage.height
        var pixels = [UInt8](repeating: 0, count: width * height * 4)
        let context = try XCTUnwrap(
            CGContext(
                data: &pixels,
                width: width,
                height: height,
                bitsPerComponent: 8,
                bytesPerRow: width * 4,
                space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
            ),
            file: file,
            line: line
        )
        context.draw(cgImage, in: CGRect(x: 0, y: 0, width: width, height: height))

        let center = ((height / 2) * width + (width / 2)) * 4
        return (
            rgb: Array(pixels[center..<(center + 3)]),
            alpha: pixels[center + 3]
        )
    }
}
#endif
