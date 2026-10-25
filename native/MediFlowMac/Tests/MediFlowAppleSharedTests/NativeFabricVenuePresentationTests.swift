#if os(macOS)
import AppKit
import SwiftUI
import XCTest
@testable import MediFlowAppleShared

@MainActor
final class NativeFabricVenuePresentationTests: XCTestCase {
    @MainActor
    private final class Capture {
        var workspace: PairedPatientsWorkspaceModel?
        var document: Binding<String>?
        var venue: Binding<Bool>?
        var local: NativeFabricModel? { locals.last }
        var ordinary: NativeOrdinaryModel? { ordinaries.last }
        var locals: [NativeFabricModel] = []
        var ordinaries: [NativeOrdinaryModel] = []
    }
    private func settle(_ host: NSView) async throws {
        try await Task.sleep(nanoseconds: 80_000_000)
        host.layoutSubtreeIfNeeded(); host.displayIfNeeded()
    }
    private func withMountedDocument(workspaceConsumer: Bool = false, local: NativeFabricModel.Services? = nil,
                                     ordinary: NativeOrdinaryModel.Services? = nil,
                                     _ action: (NSView, Capture) async throws -> Void) async throws {
        let suite = "FabricVenue.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(suite)
        defer { defaults.removePersistentDomain(forName: suite); try? FileManager.default.removeItem(at: directory) }
        let store = HomeBasePairedStore(userDefaults: defaults, keychainReader: { _, _ in .success(nil) },
            keychainWriter: { _, _, _ in .success(()) }, keychainDeleter: { _, _ in .success(()) })
        let workspace = PairedPatientsWorkspaceModel(pairedStore: store,
            cacheStore: HomeBasePatientCacheStore(cacheDirectory: directory, keyProvider: { throw NativeOrdinaryContractError.invalid }),
            dataSourceFactory: { _ in S6MockDataSource(details: [:], capabilities: [
                NetworkCapability(key: "network.replica.readonly-documents", status: "available", requiresPairing: true, description: "Synthetic documents")
            ]) })
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
        let capture = Capture()
        capture.workspace = workspace
        NativeFabricPresentationProbe.documentPicker = { capture.document = $0 }
        NativeFabricPresentationProbe.venuePicker = { capture.venue = $0 }
        NativeFabricPresentationProbe.localModel = { capture.locals.append($0) }
        NativeFabricPresentationProbe.ordinaryModel = { capture.ordinaries.append($0) }
        NativeFabricPresentationProbe.localServices = local
        NativeFabricPresentationProbe.ordinaryServices = ordinary
        defer {
            capture.locals.forEach { $0.invalidate() }
            capture.ordinaries.forEach { $0.invalidate() }
            NativeFabricPresentationProbe.documentPicker = nil
            NativeFabricPresentationProbe.venuePicker = nil
            NativeFabricPresentationProbe.localModel = nil
            NativeFabricPresentationProbe.ordinaryModel = nil
            NativeFabricPresentationProbe.localServices = nil
            NativeFabricPresentationProbe.ordinaryServices = nil
        }
        _ = NSApplication.shared
        workspace.activePatientSection = .documents
        let capabilities = ClinicalWorkspaceCapabilitiesStore()
        await capabilities.loadIfNeeded(using: workspace.clinicalWorkspaceConnection)
        let root = workspaceConsumer
            ? AnyView(PairedPatientsWorkspaceView(model: workspace, capabilities: capabilities))
            : AnyView(NativeDocumentSynthesisView(workspaceModel: workspace).padding(20))
        let host = NSHostingView(rootView: root)
        host.frame = NSRect(x: 0, y: 0, width: 800, height: 1000)
        try await settle(host)
        try await action(host, capture)
    }
    private func select(_ document: String, _ host: NSView, _ capture: Capture) async throws {
        try XCTUnwrap(capture.document).wrappedValue = "synthetic-document-" + document
        try await settle(host)
    }
    private func attachment(_ preparation: NativeOrdinaryPreparation) -> String {
        if case .documentSynthesis(let id) = preparation.input { return id }
        XCTFail("The mounted document consumer must prepare document synthesis")
        return ""
    }
    private func response(_ phase: String) throws -> NativeFabricResponse {
        var value: [String: Any] = ["schema": "mediflow.native-fabric.v1", "phase": phase]
        if phase == "closed" { value["cleanupConfirmed"] = true }
        else {
            value["attemptId"] = "12345678-1234-4234-8234-123456789abc"
            value["functionId"] = NativeOrdinaryFunction.documentSynthesis.rawValue
            value["expiresAt"] = Date().timeIntervalSince1970 * 1000 + 60_000
            value["selection"] = ["modelOptionId": "model_option_" + String(repeating: "a", count: 32),
                "catalogRevision": "sha256_" + String(repeating: "b", count: 64),
                "preferenceRevision": "sha256_" + String(repeating: "c", count: 64), "source": "host_configuration",
                "provider": "ollama", "model": "synthetic-local:1", "venue": "local", "fallback": "none"]
        }
        return try JSONDecoder().decode(NativeFabricResponse.self, from: JSONSerialization.data(withJSONObject: value))
    }
    func testDocumentChangeKeepsExplicitChatGPTLaneInMountedSwiftUIView() async throws {
        try await withMountedDocument { host, capture in
            let venue = try XCTUnwrap(capture.venue)
            XCTAssertFalse(venue.wrappedValue)
            venue.wrappedValue = true; try await self.settle(host)
            for name in ["A", "B"] {
                try await self.select(name, host, capture)
                XCTAssertEqual(capture.venue?.wrappedValue, true)
            }
        }
    }
    func testDocumentChangeRetainsLocalOwnerThroughSuspendedAndFailedClosure() async throws {
        var requests: [String] = [], mayClose = false, firstClose = true
        var pending: CheckedContinuation<NativeFabricResponse, Error>?
        defer { pending?.resume(throwing: NativeOrdinaryContractError.invalid) }
        let services = NativeFabricModel.Services(prepare: { preparation, _ in
            requests.append(self.attachment(preparation)); return try self.response("ready")
        }, command: { command, _ in
            XCTAssertEqual(command.path, "cancel")
            if firstClose {
                firstClose = false
                return try await withCheckedThrowingContinuation { pending = $0 }
            }
            guard mayClose else { throw HomeBaseClientError.transport(.unreachable) }
            return try self.response("closed")
        }, status: { id, _ in try self.response(id == nil ? "closed" : "current") })
        try await withMountedDocument(local: services) { host, capture in
            try await self.select("A", host, capture)
            let owner = try XCTUnwrap(capture.local)
            owner.prepare(); try await self.settle(host)
            XCTAssertEqual(owner.phase, .ready)
            try await self.select("B", host, capture)
            XCTAssertTrue(capture.local === owner, "The operation owner must outlive document identity")
            XCTAssertEqual(capture.local?.phase, .closing)
            try XCTUnwrap(capture.venue).wrappedValue = true
            XCTAssertEqual(capture.venue?.wrappedValue, false, "A pending closure must prevent changing execution lane")
            capture.local?.prepare(); try await self.settle(host)
            XCTAssertEqual(requests, ["synthetic-document-A"])
            let close = try XCTUnwrap(pending); pending = nil
            close.resume(throwing: HomeBaseClientError.transport(.unreachable))
            try await self.settle(host)
            XCTAssertEqual(capture.local?.phase, .blocked, "The closure recovery action must remain in the mounted view")
            for document in ["A", "B"] { try await self.select(document, host, capture) }
            XCTAssertTrue(capture.local === owner)
            XCTAssertEqual(capture.local?.phase, .blocked)
            mayClose = true
            capture.local?.verifyClosure(); try await self.settle(host)
            XCTAssertEqual(capture.local?.phase, .idle)
            capture.local?.prepare(); try await self.settle(host)
            XCTAssertEqual(requests, ["synthetic-document-A", "synthetic-document-B"])
        }
    }
    func testDocumentChangeRetainsLatePreparationAndItsFailedCleanup() async throws {
        var requests: [String] = [], mayClose = false
        var pending: CheckedContinuation<NativeFabricResponse, Error>?
        defer { pending?.resume(throwing: NativeOrdinaryContractError.invalid) }
        let services = NativeFabricModel.Services(prepare: { preparation, _ in
            requests.append(self.attachment(preparation))
            if requests.count == 1 { return try await withCheckedThrowingContinuation { pending = $0 } }
            return try self.response("ready")
        }, command: { _, _ in
            guard mayClose else { throw HomeBaseClientError.transport(.unreachable) }
            return try self.response("closed")
        }, status: { id, _ in try self.response(id == nil ? "closed" : "current") })
        try await withMountedDocument(local: services) { host, capture in
            try await self.select("A", host, capture)
            let owner = try XCTUnwrap(capture.local)
            owner.prepare(); try await self.settle(host)
            try await self.select("B", host, capture)
            XCTAssertTrue(capture.local === owner)
            try XCTUnwrap(capture.venue).wrappedValue = true
            XCTAssertEqual(capture.venue?.wrappedValue, false, "A late preparation must retain its execution lane")
            capture.local?.prepare(); try await self.settle(host)
            XCTAssertEqual(requests, ["synthetic-document-A"], "A pending preparation may still return authority")
            let prepare = try XCTUnwrap(pending); pending = nil
            prepare.resume(returning: try self.response("ready")); try await self.settle(host)
            XCTAssertEqual(capture.local?.phase, .blocked)
            XCTAssertNil(capture.local?.proposal)
            mayClose = true
            capture.local?.verifyClosure(); try await self.settle(host)
            capture.local?.prepare(); try await self.settle(host)
            XCTAssertEqual(requests, ["synthetic-document-A", "synthetic-document-B"])
        }
    }
    func testDocumentABAInvalidatesWithoutWaitingForAnotherViewUpdate() async throws {
        var requests: [String] = [], cancellations = 0
        let services = NativeFabricModel.Services(prepare: { preparation, _ in
            requests.append(self.attachment(preparation)); return try self.response("ready")
        }, command: { command, _ in
            XCTAssertEqual(command.path, "cancel")
            cancellations += 1
            throw HomeBaseClientError.transport(.unreachable)
        }, status: { id, _ in try self.response(id == nil ? "closed" : "current") })
        try await withMountedDocument(local: services) { host, capture in
            try await self.select("A", host, capture)
            let owner = try XCTUnwrap(capture.local)
            owner.prepare(); try await self.settle(host)
            XCTAssertEqual(owner.phase, .ready)
            let document = try XCTUnwrap(capture.document)
            document.wrappedValue = "synthetic-document-B"
            document.wrappedValue = "synthetic-document-A"
            XCTAssertEqual(owner.phase, .closing)
            owner.prepare()
            try await self.settle(host)
            XCTAssertTrue(capture.local === owner)
            XCTAssertEqual(capture.local?.phase, .blocked)
            XCTAssertEqual(cancellations, 1)
            XCTAssertEqual(requests, ["synthetic-document-A"])
        }
    }
    func testDocumentChangeRetainsOrdinaryOwnerUntilClosureIsConfirmed() async throws {
        var requests: [String] = [], mayClose = false
        func response(_ phase: String) throws -> NativeOrdinaryResponse {
            try NativeOrdinaryTestFixtures.decode(NativeOrdinaryResponse.self,
                NativeOrdinaryTestFixtures.response(.documentSynthesis, phase))
        }
        let services = NativeOrdinaryModel.Services(prepare: { preparation, _ in
            requests.append(self.attachment(preparation)); return try response("needs_consent")
        }, command: { command, _ in
            XCTAssertEqual(command.path, "cancel")
            guard mayClose else { throw HomeBaseClientError.transport(.unreachable) }
            return try response("closed")
        }, status: { _ in try response("closed") })
        try await withMountedDocument(ordinary: services) { host, capture in
            try XCTUnwrap(capture.venue).wrappedValue = true; try await self.settle(host)
            try await self.select("A", host, capture)
            let owner = try XCTUnwrap(capture.ordinary)
            owner.prepare(); try await self.settle(host)
            XCTAssertEqual(owner.phase, .needsConsent)
            try await self.select("B", host, capture)
            XCTAssertTrue(capture.ordinary === owner)
            XCTAssertEqual(capture.ordinary?.phase, .blocked)
            try XCTUnwrap(capture.venue).wrappedValue = false
            XCTAssertEqual(capture.venue?.wrappedValue, true, "Failed ordinary cleanup must remain reachable")
            capture.ordinary?.prepare(); try await self.settle(host)
            XCTAssertEqual(requests, ["synthetic-document-A"])
            XCTAssertEqual(capture.venue?.wrappedValue, true)
            mayClose = true
            capture.ordinary?.verifyClosure(); try await self.settle(host)
            capture.ordinary?.prepare(); try await self.settle(host)
            XCTAssertEqual(requests, ["synthetic-document-A", "synthetic-document-B"])
        }
    }
    func testClinicalSectionRemountRetainsLocalClosureAndRecovery() async throws {
        var requests = 0, mayClose = false, firstClose = true
        var pending: CheckedContinuation<NativeFabricResponse, Error>?
        defer { pending?.resume(throwing: NativeOrdinaryContractError.invalid) }
        let services = NativeFabricModel.Services(prepare: { _, _ in
            requests += 1; return try self.response("ready")
        }, command: { _, _ in
            if firstClose {
                firstClose = false
                return try await withCheckedThrowingContinuation { pending = $0 }
            }
            guard mayClose else { throw HomeBaseClientError.transport(.unreachable) }
            return try self.response("closed")
        }, status: { id, _ in try self.response(id == nil ? "closed" : "current") })
        try await withMountedDocument(workspaceConsumer: true, local: services) { host, capture in
            try await self.select("A", host, capture)
            let owner = try XCTUnwrap(capture.local)
            owner.prepare(); try await self.settle(host)
            XCTAssertEqual(owner.phase, .ready)
            capture.workspace?.activePatientSection = .scales; try await self.settle(host)
            XCTAssertEqual(owner.phase, .closing)
            capture.workspace?.activePatientSection = .documents; try await self.settle(host)
            XCTAssertTrue(capture.local === owner)
            XCTAssertEqual(capture.local?.phase, .closing)
            capture.local?.prepare(); try await self.settle(host)
            XCTAssertEqual(requests, 1)
            let close = try XCTUnwrap(pending); pending = nil
            close.resume(throwing: HomeBaseClientError.transport(.unreachable)); try await self.settle(host)
            XCTAssertEqual(capture.local?.phase, .blocked)
            capture.workspace?.activePatientSection = .scales; try await self.settle(host)
            capture.workspace?.activePatientSection = .documents; try await self.settle(host)
            XCTAssertTrue(capture.local === owner)
            XCTAssertEqual(capture.local?.phase, .blocked)
            XCTAssertEqual(capture.document?.wrappedValue, "synthetic-document-A")
            mayClose = true
            capture.local?.verifyClosure(); try await self.settle(host)
            XCTAssertEqual(capture.local?.phase, .idle)
            capture.local?.prepare(); try await self.settle(host)
            XCTAssertEqual(requests, 2)
        }
    }

    func testClinicalSectionRemountRetainsOrdinaryClosureAndExplicitLane() async throws {
        var requests = 0, mayClose = false
        func response(_ phase: String) throws -> NativeOrdinaryResponse {
            try NativeOrdinaryTestFixtures.decode(NativeOrdinaryResponse.self,
                NativeOrdinaryTestFixtures.response(.documentSynthesis, phase))
        }
        let services = NativeOrdinaryModel.Services(prepare: { _, _ in
            requests += 1; return try response("needs_consent")
        }, command: { _, _ in
            guard mayClose else { throw HomeBaseClientError.transport(.unreachable) }
            return try response("closed")
        }, status: { _ in try response("closed") })
        try await withMountedDocument(workspaceConsumer: true, ordinary: services) { host, capture in
            try await self.select("A", host, capture)
            try XCTUnwrap(capture.venue).wrappedValue = true; try await self.settle(host)
            let owner = try XCTUnwrap(capture.ordinary)
            owner.prepare(); try await self.settle(host)
            XCTAssertEqual(owner.phase, .needsConsent)
            capture.workspace?.activePatientSection = .scales; try await self.settle(host)
            XCTAssertEqual(owner.phase, .blocked)
            capture.workspace?.activePatientSection = .documents; try await self.settle(host)
            XCTAssertEqual(capture.venue?.wrappedValue, true)
            try XCTUnwrap(capture.venue).wrappedValue = true; try await self.settle(host)
            XCTAssertTrue(capture.ordinary === owner)
            XCTAssertEqual(capture.ordinary?.phase, .blocked)
            capture.ordinary?.prepare(); try await self.settle(host)
            XCTAssertEqual(requests, 1)
            mayClose = true
            capture.ordinary?.verifyClosure(); try await self.settle(host)
            XCTAssertEqual(capture.ordinary?.phase, .idle)
            capture.ordinary?.prepare(); try await self.settle(host)
            XCTAssertEqual(requests, 2)
        }
    }

}
#endif
