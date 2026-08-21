// @Codex
#if os(macOS)
import AppKit
import SwiftUI
import XCTest
@testable import MediFlowAppleShared

@MainActor
final class MacPatientContextInspectorTests: XCTestCase {
    func testSnapshotExposesOnlyBoundedContext() {
        let snapshot = MacPatientInspectorSnapshot(
            patient: syntheticPatient(isArchived: true),
            connectionState: .cached
        )

        XCTAssertEqual(snapshot.displayName, "Paziente Esempio")
        XCTAssertEqual(snapshot.taxCode, "…CF-001")
        XCTAssertEqual(snapshot.birthYear, "1972")
        XCTAssertEqual(snapshot.recordState, "Archiviata")
        XCTAssertEqual(snapshot.connectionState, "Cache locale")
    }

    func testMissingBirthDateIsReportedInsteadOfInferred() {
        let snapshot = MacPatientInspectorSnapshot(
            patient: syntheticPatient(birthDate: nil),
            connectionState: .pairedOfflineDegraded
        )
        XCTAssertEqual(snapshot.birthYear, "Non disponibile")
        XCTAssertEqual(snapshot.connectionState, "Offline degradato")
    }

    func testSheetWorkaroundIsLimitedToOperatingSystemMajorVersion27() {
        XCTAssertEqual(MacInspectorPresentationMode.resolve(forMajorVersion: 26), .nativeInspector)
        XCTAssertEqual(MacInspectorPresentationMode.resolve(forMajorVersion: 27), .sheetFallback)
        XCTAssertEqual(MacInspectorPresentationMode.resolve(forMajorVersion: 28), .nativeInspector)
    }

    func testNeutralSurfaceAndSyntheticRenderInLightAndDark() throws {
        for (name, scheme, appearanceName) in [
            ("light", ColorScheme.light, NSAppearance.Name.aqua),
            ("dark", ColorScheme.dark, NSAppearance.Name.darkAqua)
        ] {
            let appearance = try XCTUnwrap(NSAppearance(named: appearanceName))
            var background: NSColor?
            appearance.performAsCurrentDrawingAppearance {
                background = MacClinicalContentSurfaceStyle.backgroundColor.usingColorSpace(.sRGB)
            }
            let color = try XCTUnwrap(background)
            XCTAssertEqual(color.redComponent, color.greenComponent, accuracy: 0.001)
            XCTAssertEqual(color.greenComponent, color.blueComponent, accuracy: 0.001)

            let content = MacPatientInspectorContent(snapshot: MacPatientInspectorSnapshot(
                patient: syntheticPatient(), connectionState: .cached
            ))
            .frame(width: 320, height: 520)
            .background(Color(nsColor: .windowBackgroundColor))
            .environment(\.colorScheme, scheme)
            let renderer = ImageRenderer(content: content)
            renderer.scale = 2
            let image = try XCTUnwrap(renderer.cgImage)
            XCTAssertEqual(image.width, 640)
            XCTAssertEqual(image.height, 1_040)
            try writeEvidence(image, name: name)
        }
    }

    private func syntheticPatient(birthDate: Date? = Calendar(identifier: .gregorian).date(
        from: DateComponents(year: 1972, month: 4, day: 12)
    ), isArchived: Bool = false) -> HomeBasePatientDetail {
        HomeBasePatientDetail(
            id: "synthetic-patient-001", firstName: "Esempio", lastName: "Paziente",
            birthDate: birthDate, taxCode: "SYNTHETIC-CF-001",
            address: nil, phone: nil, caregiver: nil, exemptions: nil, diagnoses: nil,
            monitoringProfile: nil, statusReason: nil, notes: nil, aiSummary: nil,
            documentInsights: nil, isAdi: false, isArchived: isArchived, version: 1,
            ambulatoryId: "synthetic-ambulatory", createdAt: nil, updatedAt: nil
        )
    }

    private func writeEvidence(_ image: CGImage, name: String) throws {
        guard let directory = ProcessInfo.processInfo.environment["MEDIFLOW_MAC_INSPECTOR_EVIDENCE_DIR"] else { return }
        let output = URL(fileURLWithPath: directory).appendingPathComponent("mac-patient-inspector-\(name).png")
        try FileManager.default.createDirectory(at: output.deletingLastPathComponent(), withIntermediateDirectories: true)
        let png = try XCTUnwrap(NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]))
        try png.write(to: output, options: .atomic)
    }
}
#endif
