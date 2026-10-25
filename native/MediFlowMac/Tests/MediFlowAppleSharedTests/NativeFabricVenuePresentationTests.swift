#if os(macOS)
import AppKit
import SwiftUI
import XCTest
@testable import MediFlowAppleShared

@MainActor
final class NativeFabricVenuePresentationTests: XCTestCase {
    private func settle(_ host: NSView) async throws {
        try await Task.sleep(nanoseconds: 80_000_000)
        host.layoutSubtreeIfNeeded(); host.displayIfNeeded()
    }
    func testDocumentChangeKeepsExplicitChatGPTLaneInMountedSwiftUIView() async throws {
        let suite = "FabricVenue.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(suite)
        defer { defaults.removePersistentDomain(forName: suite); try? FileManager.default.removeItem(at: directory) }
        let store = HomeBasePairedStore(userDefaults: defaults, keychainReader: { _, _ in .success(nil) },
            keychainWriter: { _, _, _ in .success(()) }, keychainDeleter: { _, _ in .success(()) })
        let workspace = PairedPatientsWorkspaceModel(pairedStore: store,
            cacheStore: HomeBasePatientCacheStore(cacheDirectory: directory, keyProvider: { throw NativeOrdinaryContractError.invalid }),
            dataSourceFactory: { _ in S6MockDataSource(details: [:]) })
        let patient = HomeBasePatientDetail(id: "synthetic-patient", firstName: "Ada", lastName: "Sintetica", birthDate: nil,
            taxCode: "SYNTHETIC", address: nil, phone: nil, caregiver: nil, exemptions: nil, diagnoses: nil,
            monitoringProfile: nil, statusReason: nil, notes: nil, aiSummary: nil, documentInsights: nil,
            isAdi: false, isArchived: false, version: 1, ambulatoryId: "synthetic-ambulatory", createdAt: nil, updatedAt: nil)
        let documents = ["A", "B"].map { name in HomeBaseAttachmentSummary(id: "synthetic-document-" + name,
            patientId: patient.id, name: "Documento sintetico " + name, type: "text/plain", size: 12, path: "synthetic",
            summarySnapshot: nil, parseEvidenceArtifactSnapshot: nil, ocrQueueState: nil, ocrQueueReason: nil,
            ocrQueueUpdatedAt: nil, ocrReplayArtifactSnapshot: nil, createdAt: nil) }
        workspace.ambulatoryId = "synthetic-ambulatory"
        workspace.configurePairedOnlineForTests(selectedPatient: patient, attachments: documents)
        var documentPicker: Binding<String>?, venuePicker: Binding<Bool>?
        NativeFabricPresentationProbe.documentPicker = { documentPicker = $0 }
        NativeFabricPresentationProbe.venuePicker = { venuePicker = $0 }
        defer { NativeFabricPresentationProbe.documentPicker = nil; NativeFabricPresentationProbe.venuePicker = nil }
        _ = NSApplication.shared
        let host = NSHostingView(rootView: NativeDocumentSynthesisView(workspaceModel: workspace).padding(20))
        let window = NSWindow(contentRect: NSRect(x: -10000, y: -10000, width: 800, height: 1000), styleMask: [.borderless], backing: .buffered, defer: false)
        window.contentView = host; window.orderFront(nil); defer { window.orderOut(nil) }
        try await settle(host)
        let venue = try XCTUnwrap(venuePicker, "Actual mounted venue Picker binding missing")
        XCTAssertFalse(venue.wrappedValue)
        venue.wrappedValue = true; try await settle(host)
        XCTAssertEqual(venuePicker?.wrappedValue, true)
        for name in ["A", "B"] {
            try XCTUnwrap(documentPicker).wrappedValue = "synthetic-document-" + name
            try await settle(host)
            XCTAssertEqual(venuePicker?.wrappedValue, true,
                "Changing the actual document Picker must preserve the explicit ChatGPT lane")
        }
    }
}
#endif
