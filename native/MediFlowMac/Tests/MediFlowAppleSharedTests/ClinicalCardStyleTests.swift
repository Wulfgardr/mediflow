// @Codex
#if os(macOS)
import AppKit
import SwiftUI
import XCTest
@testable import MediFlowAppleShared

/* @Codex */
@MainActor
final class ClinicalCardStyleTests: XCTestCase {
    private func appleSource(_ path: String) throws -> String {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
        let sourceRoot = ProcessInfo.processInfo.environment["MEDIFLOW_IDENTITY_SOURCE_ROOT"].map { URL(fileURLWithPath: $0) }
            ?? root.appendingPathComponent("Sources/MediFlowAppleShared")
        let file = sourceRoot.appendingPathComponent(path)
        return FileManager.default.fileExists(atPath: file.path) ? try String(contentsOf: file, encoding: .utf8) : ""
    }

    func testPINErrorUsesCriticalInkWithoutSecondaryAttenuation() throws {
        let source = try appleSource("AppleFoundation/PairedPatientsWorkspaceView.swift")
        let error = source.components(separatedBy: "if let error = model.errorMessage {").last!
            .components(separatedBy: "} else if let status").first!
        XCTAssertTrue(error.contains("xmark.circle.fill"))
        XCTAssertFalse(error.contains(".chartMetadata()"))
        XCTAssertTrue(error.contains(".foregroundStyle(LumePalette.critical)"))
        XCTAssertEqual(LumePalette.resolvedHex(for: .critical, using: LumePalette.giorno), "#a33a2f")
    }

    func testSettingsSelectionUsesInkAndSelectionSurface() throws {
        let source = try appleSource("AppleFoundation/SettingsWorkspaceView.swift")
        XCTAssertTrue(source.contains(".background(selectedArea == area ? PlatformColors.selection : .clear)"))
        XCTAssertTrue(source.contains(".fontWeight(selectedArea == area ? .semibold : .regular)"))
        XCTAssertFalse(source.contains("List(selection: Binding<SettingsArea?>"))
        XCTAssertEqual(LumePalette.giorno.selectionHex, "#eef2fb")
        XCTAssertEqual(LumePalette.grafite.selectionHex, "#232a3d")
    }

    func testMobileWorklistUsesCanonicalCanvas() throws {
        let source = try appleSource("AppleFoundation/PairedPatientsWorkspaceView.swift")
        XCTAssertTrue(source.contains(".background(PlatformColors.groupedBackground)"))
        XCTAssertFalse(source.contains("LumePalette.guardia.canvas"))
        XCTAssertEqual(LumePalette.giorno.canvasHex, "#e8eaee")
        XCTAssertEqual(LumePalette.grafite.canvasHex, "#101216")
    }

    func testPrimaryActionUsesControlRadiusAndFreshInk() throws {
        let source = try appleSource("Lume.swift")
        XCTAssertTrue(source.contains("struct LumePrimaryButtonStyle: ButtonStyle"))
        XCTAssertTrue(source.contains(".foregroundStyle(palette.field)"))
        XCTAssertTrue(source.contains(".background(palette.minerale, in: RoundedRectangle(cornerRadius: LumeGeometry.controlRadius"))
        let workspace = try appleSource("AppleFoundation/PairedPatientsWorkspaceView.swift")
        XCTAssertTrue(workspace.contains(".buttonStyle(LumePrimaryButtonStyle())"))
        XCTAssertTrue(workspace.contains(".safeAreaInset(edge: .bottom, spacing: 0)"))
    }

    func testTabletRowsUseSingleLineAndTouchRowHeight() throws {
        let source = try appleSource("AppleFoundation/PairedPatientsWorklistView.swift")
        XCTAssertTrue(source.contains("isTabletList && !dynamicTypeSize.isAccessibilitySize"))
        XCTAssertTrue(source.contains(".frame(height: LumeGeometry.rowHeight)"))
        XCTAssertTrue(source.contains(".lineLimit(1)"))
        XCTAssertTrue(source.contains(".padding(.vertical, usesDenseRows ? 0 : 14)"))
    }

    func testWritingThresholdStaysOutsideTheScrollingComposer() throws {
        let workspace = try appleSource("AppleFoundation/PairedPatientsWorkspaceView.swift")
        let composer = try appleSource("AppleFoundation/PairedDiaryComposerView.swift")
        XCTAssertTrue(workspace.contains(".safeAreaInset(edge: .bottom, spacing: 0)"))
        XCTAssertTrue(workspace.contains("diary-writing-threshold"))
        XCTAssertTrue(composer.contains("@Binding var isCreatingEntry: Bool"))
        XCTAssertTrue(workspace.contains(".disabled(!model.canCreateEntry)"))
    }

    func testDetailOpenStatusDoesNotBecomeVisibleCopy() throws {
        let source = try appleSource("AppleFoundation/PairedPatientsWorkspaceView.swift")
        XCTAssertTrue(source.contains("!status.hasPrefix(\"Dettaglio \""))
    }

    func testAllergyHeaderRequiresExplicitData() throws {
        let component = try appleSource("Lume.swift")
        let header = try appleSource("AppleFoundation/PairedPatientDetailSection.swift")
        XCTAssertTrue(component.contains("var allergies: [String] = []"))
        XCTAssertTrue(component.contains("exclamationmark.triangle.fill"))
        XCTAssertTrue(header.contains("PatientAllergyPill(allergies: allergies)"))
    }

    func testOverviewPresentsFourTablesAndAdaptiveColumns() throws {
        let overview = try appleSource("AppleFoundation/PatientClinicalOverview.swift")
        for title in ["Problemi", "Terapie attive", "Misure recenti", "Controlli aperti"] {
            XCTAssertTrue(overview.contains("table(\"" + title + "\""))
        }
        XCTAssertTrue(overview.contains("ClinicalSignalCount.fromLoadedList"))
        let workspace = try appleSource("AppleFoundation/PairedPatientsWorkspaceView.swift")
        XCTAssertTrue(workspace.contains("patient-chart-columns"))
        XCTAssertTrue(workspace.contains("AnyLayout(HStackLayout(alignment: .top, spacing: 28))"))
    }

    func testRegularNavigationContainsSixAreasAndLock() throws {
        let source = try appleSource("AppleFoundationViews.swift")
        XCTAssertTrue(source.contains("mobileClinicalSidebar.frame(width: 192)"))
        XCTAssertTrue(source.contains(".patients, .agenda, .diary, .repertori, .analytics, .scales"))
        XCTAssertTrue(source.contains("clinical-workspace-lock-button"))
        XCTAssertTrue(source.contains("await workspaceModel.lockSessionNow()"))
    }

    func testDiaryUsesChronologyMarginSettingAndRegistration() throws {
        let source = try appleSource("AppleFoundation/PairedPatientDiarySection.swift")
        XCTAssertTrue(source.contains(".frame(width: usesDiaryMargin ? 84 : nil"))
        XCTAssertTrue(source.contains("Text(setting).font(.caption).foregroundStyle(.secondary)"))
        XCTAssertTrue(source.contains("Text(type.title).inkRegister(weight: .semibold)"))
        XCTAssertTrue(source.contains("Label(\"Registrata\", systemImage: \"circle.fill\")"))
        XCTAssertTrue(source.contains(".frame(minWidth: 0, maxWidth: proseWidth, alignment: .leading)"))
    }

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

    /// Ogni raggio delle viste Apple viene dalla scala di `LumeGeometry`
    /// (Punto d'inchiostro: righe 0, controlli, piano, voce in scrittura). Un
    /// numero scritto a mano accanto alla scala è come le due bande d'avviso a
    /// 12 su macOS, dove 12 è il raggio del piano e non quello dei controlli.
    func testViewRadiiComeFromTheLumeScale() throws {
        let nativeDirectory = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
        let roots = [
            nativeDirectory.appendingPathComponent("MediFlowMac/Sources"),
            nativeDirectory.appendingPathComponent("MediFlowAppleApp/Sources"),
        ]
        let literal = try NSRegularExpression(
            pattern: #"cornerRadius:\s*[0-9]|\.cornerRadius\(\s*[0-9]|Radius\s*:\s*CGFloat\s*=\s*[0-9]"#
        )
        var offenders: [String] = []
        var scanned = 0
        for root in roots {
            let files = FileManager.default.enumerator(at: root, includingPropertiesForKeys: nil)
            while let url = files?.nextObject() as? URL {
                guard url.pathExtension == "swift" else { continue }
                scanned += 1
                let lines = try String(contentsOf: url, encoding: .utf8).components(separatedBy: .newlines)
                var insideScale = false
                for (index, line) in lines.enumerated() {
                    if line.contains("public enum LumeGeometry") { insideScale = true }
                    if insideScale, line == "}" { insideScale = false; continue }
                    let range = NSRange(line.startIndex..., in: line)
                    guard !insideScale, literal.firstMatch(in: line, range: range) != nil else { continue }
                    /* A modifier's default of 0 means "no rounding", not a radius. */
                    if line.contains("cornerRadius: CGFloat = 0") { continue }
                    offenders.append("\(url.lastPathComponent):\(index + 1): \(line.trimmingCharacters(in: .whitespaces))")
                }
            }
        }
        XCTAssertGreaterThan(scanned, 50, "La guardia deve leggere davvero i sorgenti Apple")
        XCTAssertEqual(offenders, [], "Raggi scritti a mano fuori da LumeGeometry")
    }

    func testRadiusScaleMatchesThePuntoInchiostroSpecification() {
        XCTAssertEqual(LumeGeometry.rowRadius, 0)
        XCTAssertEqual(LumeGeometry.writingRadius, 12)
        #if os(macOS)
        XCTAssertEqual(LumeGeometry.controlRadius, 8)
        XCTAssertEqual(LumeGeometry.planeRadius, 12)
        #else
        XCTAssertEqual(LumeGeometry.controlRadius, 12)
        XCTAssertEqual(LumeGeometry.planeRadius, 18)
        #endif
    }

}
#endif
