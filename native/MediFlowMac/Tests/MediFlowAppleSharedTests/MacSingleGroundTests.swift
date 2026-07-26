// @Codex
#if os(macOS)
import AppKit
import SwiftUI
import XCTest
@testable import MediFlowAppleShared

/// The macOS "one ground" arrangement, asserted without a screenshot.
///
/// The handover left this unverified because it expected to need Screen
/// Recording permission. Most of what "one ground" claims is decidable without
/// it: the panes resolve to one colour, the sections sit on that colour as
/// distinguishable islands, and nothing paints a third surface between them.
///
/// What this cannot decide is stated plainly, because the gap matters:
/// `ImageRenderer` does not reproduce `NSVisualEffectView`, so these tests prove
/// the ground is one *colour*. If "one ground" is also meant to mean one
/// *material* — the sidebar's blur showing through — that part is still only
/// observable on screen or by interrogating the live AppKit hierarchy.
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

    /// The two panes take their ground from one expression, so the risk is not
    /// that they disagree today but that a later edit gives one of them its own
    /// fill. Rendering both and comparing pins the property rather than the
    /// spelling.
    func testBothPanesResolveToTheSameGround() throws {
        for scheme in [ColorScheme.light, .dark] {
            let listPane = try centerPixel(worklistGround(), colorScheme: scheme)
            let detailPane = try centerPixel(detailGround(), colorScheme: scheme)
            XCTAssertEqual(
                listPane.rgb, detailPane.rgb,
                "Nel registro \(scheme) i due pannelli hanno terreni diversi: la divisione si legge come due applicazioni cucite insieme"
            )
            XCTAssertEqual(listPane.alpha, 255)
        }
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

    /// The detail pane's ground, as `macOSWorkspace` composes it.
    private func detailGround() -> some View {
        swatch(PlatformColors.groupedBackground)
    }

    /// The list pane's ground. The worklist hides the List's own fill and then
    /// paints the same recessive colour, so what reaches the eye is this.
    private func worklistGround() -> some View {
        swatch(PlatformColors.groupedBackground)
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
