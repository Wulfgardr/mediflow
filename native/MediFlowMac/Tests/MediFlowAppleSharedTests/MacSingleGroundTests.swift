// @Codex
#if os(macOS)
import AppKit
import SwiftUI
import XCTest
@testable import MediFlowAppleShared

/// Palette and surface rendering checks. These swatches do not mount the
/// macOS workspace and cannot prove its current layout, spacing or materials.
/// The 0.8.6 document pane is verified in the running app separately.
@MainActor
final class MacSingleGroundTests: XCTestCase {
    /// The proposition the whole arrangement rests on: a section has to be
    /// visible against the ground it sits on.
    ///
    /// This is not decorative. `groupedBackground` is `windowBackgroundColor`
    /// and the card surface is `textBackgroundColor`; the two are separate
    /// system colours that the system is free to move, and in a register where
    /// they resolved alike every clinical section would dissolve into the
    /// ground and the chart would read as one undivided sheet.
    func testSectionsAreDistinguishableFromTheGroundInBothRegisters() throws {
        for scheme in [ColorScheme.light, .dark] {
            let ground = try centerPixel(swatch(PlatformColors.groupedBackground), colorScheme: scheme)
            let section = try centerPixel(swatch(PlatformColors.chartCardSurface), colorScheme: scheme)

            XCTAssertEqual(ground.alpha, 255, "Il terreno deve essere opaco nel registro \(scheme)")
            XCTAssertEqual(section.alpha, 255, "La sezione deve essere opaca nel registro \(scheme)")
            XCTAssertNotEqual(
                ground.rgb, section.rgb,
                "Nel registro \(scheme) la sezione coincide col terreno: le isole perdono il bordo"
            )
        }
    }

    /// Punto d’inchiostro uses one opaque plane and one recessive ground.
    func testContentZonesShareThePlaneAndChromeSharesTheGround() throws {
        for scheme in [ColorScheme.light, .dark] {
            let rendered = try LumeZone.allCases.map { zone in
                try centerPixel(Color.clear.frame(width: 48, height: 24).lumeSurface(zone: zone), colorScheme: scheme).rgb
            }
            XCTAssertEqual(rendered[0], rendered[3], "Canvas and chrome use penombra")
            XCTAssertEqual(rendered[1], rendered[2], "Field and focal use piano")
            XCTAssertNotEqual(rendered[0], rendered[1], "Piano must remain distinct from penombra")
        }
    }

    /// The guardia register has to reach the surface, or it is a declared
    /// register that changes nothing.
    func testGuardiaIsADistinctRegisterFromGrafite() throws {
        let grafite = try centerPixel(swatch(LumePalette.grafite.field), colorScheme: .dark).rgb
        let guardia = try centerPixel(swatch(LumePalette.guardia.field), colorScheme: .dark).rgb
        XCTAssertNotEqual(grafite, guardia, "Il registro guardia non si distingue dal grafite")
    }

    private func zoneSurface(_ zone: LumeZone, scheme: ColorScheme) -> Color {
        LumePalette.palette(for: scheme, isGuardia: false).surface(for: zone)
    }

    /// The ground must actually differ between light and dark, which is the
    /// cheapest way to catch a hard-coded colour smuggled in behind the token.
    func testTheGroundFollowsTheRegister() throws {
        let light = try centerPixel(swatch(PlatformColors.groupedBackground), colorScheme: .light)
        let dark = try centerPixel(swatch(PlatformColors.groupedBackground), colorScheme: .dark)
        XCTAssertNotEqual(light.rgb, dark.rgb, "Il terreno non segue il registro: probabile colore fisso")
    }

    /// The twin assertion. Without it the three tests above could all be passing
    /// because the comparison is blind rather than because the surfaces differ.
    func testTheComparisonRejectsTwoSurfacesThatAreTrulyIdentical() throws {
        let first = try centerPixel(swatch(PlatformColors.groupedBackground), colorScheme: .light)
        let second = try centerPixel(swatch(PlatformColors.groupedBackground), colorScheme: .light)
        XCTAssertEqual(first.rgb, second.rgb, "Due rese dello stesso colore devono coincidere")
    }

    // MARK: - Composizione

    private func swatch(_ color: Color) -> some View {
        Color.clear.frame(width: 48, height: 24).background(color)
    }

    private func centerPixel<Content: View>(
        _ content: Content,
        colorScheme: ColorScheme,
        file: StaticString = #filePath,
        line: UInt = #line
    ) throws -> (rgb: [UInt8], alpha: UInt8) {
        let renderer = ImageRenderer(content: content.environment(\.colorScheme, colorScheme))
        renderer.scale = 1

        let image = try XCTUnwrap(renderer.nsImage, file: file, line: line)
        var rect = CGRect(origin: .zero, size: image.size)
        let cgImage = try XCTUnwrap(image.cgImage(forProposedRect: &rect, context: nil, hints: nil), file: file, line: line)
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
        return (rgb: Array(pixels[center..<(center + 3)]), alpha: pixels[center + 3])
    }
}
#endif
