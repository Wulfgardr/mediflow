import XCTest
import SwiftUI
@testable import MediFlowAppleShared

/// Contrast, asserted rather than remembered.
///
/// A code pill went out that was invisible on a selected row: the system
/// repainted its text to the selected-content colour while the pill kept its own
/// near-white fill, so an ICD code rendered white on white — a measured 1.09:1,
/// which is no contrast at all. It survived a build, a launch and a screenshot,
/// because at a glance an empty rounded box looks like an empty field rather
/// than like a defect.
///
/// Nothing about "paying attention to contrast" catches that reliably. A number
/// does. These tests pin the ratios for the two chips that carry clinical tokens,
/// against every background they are actually drawn on.
final class ClinicalContrastTests: XCTestCase {
    /// WCAG 2.1 AA for normal-size text.
    private let normalTextMinimum = 4.5
    /// WCAG 2.1 AA for large or bold small text, which is what these chips set.
    private let boldSmallTextMinimum = 3.0

    // Ink and surfaces as the palettes declare them.
    private let dayInk = RGB(0x1a, 0x1c, 0x1e)          // giorno.inkPrimary
    private let dayField = RGB(0xf5, 0xf5, 0xf4)        // giorno.field
    private let infoTone = RGB(0x33, 0x50, 0x6b)        // tone .info (minerale)

    /// The two fills a selected row can put behind a chip on macOS: the accent
    /// tint when the list has focus, and the grey when it does not.
    private let focusedSelection = RGB(0x0a, 0x63, 0xce)
    private let unfocusedSelection = RGB(0xd9, 0xd9, 0xd9)

    /// The opacity `ClinicalCodePill` and `PairedPatientFlagChip` use on a
    /// prominent background. Kept here as the value under test: lowering it is
    /// exactly the change that would quietly reintroduce the defect.
    private let prominentChipOpacity = 0.94

    func testCodePillStaysLegibleOnEverySelectionBackground() {
        for (name, background) in [
            ("focused accent selection", focusedSelection),
            ("unfocused grey selection", unfocusedSelection),
        ] {
            let chip = RGB.white.composited(over: background, alpha: prominentChipOpacity)
            let ratio = dayInk.contrastRatio(against: chip)
            XCTAssertGreaterThan(
                ratio, normalTextMinimum,
                "an ICD code on a \(name) must stay readable, got \(String(format: "%.2f", ratio)):1"
            )
        }
    }

    func testFlagChipStaysLegibleOnEverySelectionBackground() {
        for (name, background) in [
            ("focused accent selection", focusedSelection),
            ("unfocused grey selection", unfocusedSelection),
        ] {
            let chip = RGB.white.composited(over: background, alpha: prominentChipOpacity)
            let ratio = infoTone.contrastRatio(against: chip)
            XCTAssertGreaterThan(
                ratio, boldSmallTextMinimum,
                "the ADI flag on a \(name) must stay readable, got \(String(format: "%.2f", ratio)):1"
            )
        }
    }

    /// The chip must not change character between states. Selecting a patient
    /// should not make their codes read as a different kind of object.
    func testSelectedAndUnselectedChipsCarryComparableContrast() {
        let resting = dayInk.contrastRatio(against: dayField)
        let selected = dayInk.contrastRatio(
            against: RGB.white.composited(over: focusedSelection, alpha: prominentChipOpacity)
        )
        XCTAssertEqual(
            resting, selected, accuracy: 1.5,
            "the pill should look like the same object selected or not"
        )
    }

    /// The regression itself, stated as a fact so nobody restores it by accident:
    /// the system's selected-content colour over the chip's own resting fill is
    /// not a legible combination.
    func testUntreatedChipOnSelectionWouldBeIllegible() {
        let ratio = RGB.white.contrastRatio(against: dayField)
        XCTAssertLessThan(
            ratio, 1.5,
            "white on the resting chip fill is the defect this treatment exists to prevent"
        )
    }

    /// The assertions above verify that the colours *chosen* are a legible pair.
    /// They cannot see which colours the view actually asks for — and the defect
    /// was precisely that: the fill was fine and the text was `.primary`, which
    /// the selection style then repainted white. So this one reads the source and
    /// requires the chips to state their ink outright.
    ///
    /// A source assertion is a blunt instrument. It is here because the
    /// alternative that would catch this properly is pixel snapshots, and until
    /// those exist a blunt guard beats the honour system.
    func testChipsStateTheirInkExplicitlyRatherThanDeferringToPrimary() throws {
        let source = try String(
            contentsOf: URL(fileURLWithPath: #filePath)
                .deletingLastPathComponent()   // MediFlowAppleSharedTests
                .deletingLastPathComponent()   // Tests
                .deletingLastPathComponent()   // MediFlowMac
                .appendingPathComponent("Sources/MediFlowAppleShared/AppleFoundation")
                .appendingPathComponent("PairedPatientsWorkspaceSupport.swift"),
            encoding: .utf8
        )

        let pill = try XCTUnwrap(
            declaration(named: "ClinicalCodePill", in: source),
            "ClinicalCodePill must stay in this file for the guard to see it"
        )
        XCTAssertTrue(
            pill.contains("foregroundStyle(palette.inkPrimary)"),
            """
            ClinicalCodePill must name its ink. `.primary` is resolved by the \
            environment, and on a selected row the environment resolves it to \
            white — over the chip's own light fill that measured 1.09:1.
            """
        )

        let chip = try XCTUnwrap(declaration(named: "PairedPatientFlagChip", in: source))
        XCTAssertTrue(
            chip.contains("foregroundStyle(toneColor)"),
            "PairedPatientFlagChip must name its tone colour for the same reason"
        )
    }

    /// The body of `struct <name>`, up to the start of the next top-level
    /// declaration. Crude on purpose: it only has to isolate one type.
    private func declaration(named name: String, in source: String) -> String? {
        guard let start = source.range(of: "struct \(name)") else { return nil }
        let rest = source[start.upperBound...]
        if let next = rest.range(of: "\nstruct ") ?? rest.range(of: "\n/// ") {
            return String(rest[..<next.lowerBound])
        }
        return String(rest)
    }
}

/// Minimal sRGB helper: WCAG relative luminance and compositing, so the
/// assertions above do not depend on rendering anything.
private struct RGB {
    let red: Double
    let green: Double
    let blue: Double

    static let white = RGB(255, 255, 255)

    init(_ red: Double, _ green: Double, _ blue: Double) {
        self.red = red
        self.green = green
        self.blue = blue
    }

    init(_ red: Int, _ green: Int, _ blue: Int) {
        self.init(Double(red), Double(green), Double(blue))
    }

    func composited(over background: RGB, alpha: Double) -> RGB {
        RGB(
            red * alpha + background.red * (1 - alpha),
            green * alpha + background.green * (1 - alpha),
            blue * alpha + background.blue * (1 - alpha)
        )
    }

    private var relativeLuminance: Double {
        func channel(_ value: Double) -> Double {
            let normalized = value / 255
            return normalized <= 0.03928
                ? normalized / 12.92
                : pow((normalized + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue)
    }

    func contrastRatio(against other: RGB) -> Double {
        let a = relativeLuminance
        let b = other.relativeLuminance
        return (max(a, b) + 0.05) / (min(a, b) + 0.05)
    }
}
