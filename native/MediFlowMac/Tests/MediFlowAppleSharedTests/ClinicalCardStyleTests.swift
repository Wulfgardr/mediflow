// @Codex
#if os(macOS)
import AppKit
import SwiftUI
import XCTest
@testable import MediFlowAppleShared

/* @Codex */
@MainActor
final class ClinicalCardStyleTests: XCTestCase {
    func testClinicalCardSurfacesRenderOpaqueInLightAndDark() throws {
        let clinicalCard = Color.clear
            .frame(width: 48, height: 24)
            .clinicalCardStyle()

        let clinicalLight = try centerPixel(clinicalCard, colorScheme: .light)
        let clinicalDark = try centerPixel(clinicalCard, colorScheme: .dark)

        XCTAssertEqual(clinicalLight.alpha, 255)
        XCTAssertEqual(clinicalDark.alpha, 255)
        XCTAssertNotEqual(clinicalLight.rgb, clinicalDark.rgb)
    }

    func testOpacityAssertionRejectsAKnownTranslucentSurface() throws {
        let translucentSurface = Color.clear
            .frame(width: 48, height: 24)
            .background(Color.red.opacity(0.5))

        let center = try centerPixel(translucentSurface, colorScheme: .light)
        XCTAssertLessThan(center.alpha, 255)
    }

    private func centerPixel<Content: View>(
        _ content: Content,
        colorScheme: ColorScheme,
        file: StaticString = #filePath,
        line: UInt = #line
    ) throws -> (rgb: [UInt8], alpha: UInt8) {
        let renderer = ImageRenderer(
            content: content.environment(\.colorScheme, colorScheme)
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
