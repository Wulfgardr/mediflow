import CryptoKit
import Foundation
import XCTest
@testable import MediFlowAppleShared
/* @Codex */
final class PairedPatientsWorkspaceSelectionTests: XCTestCase {
    // @Codex: Real model + HTTP decoder, synthetic transport held until explicitly released.
    @MainActor func testAttachmentReadPublishesSuccessAfterExclusiveOperationBegins() async throws {
        let (model, gate) = makeAttachmentModel()
        model.configurePairedOnlineForTests(selectedPatient: detail(id: "patient-a", version: 1))
        let load = Task { await model.loadSelectedPatientAttachments() }
        await fulfillment(of: [gate.started], timeout: 5)
        XCTAssertEqual(model.attachmentsLoadState, .loading)
        try gate.respond(data: JSONEncoder().encode([attachment(patientID: "patient-a")]))
        await load.value
        XCTAssertEqual(model.attachmentsLoadState, .loaded)
        XCTAssertEqual(model.attachments.map(\.id), ["attachment-a"])
        XCTAssertEqual(model.attachmentsPatientId, "patient-a")
        XCTAssertFalse(model.isWorking)
        XCTAssertNil(model.errorMessage)
    }

    @MainActor func testLateAttachmentResponseCannotPublishAfterSelectionChangesAndReturns() async throws {
        let (model, gate) = makeAttachmentModel()
        model.configurePairedOnlineForTests(selectedPatient: detail(id: "patient-a", version: 1))
        let load = Task { await model.loadSelectedPatientAttachments() }
        await fulfillment(of: [gate.started], timeout: 5)
        // An A → B → A transition is stricter than comparing just the final patient ID.
        model.configurePairedOnlineForTests(selectedPatient: detail(id: "patient-b", version: 1))
        model.configurePairedOnlineForTests(selectedPatient: detail(id: "patient-a", version: 2))
        try gate.respond(data: JSONEncoder().encode([attachment(patientID: "patient-a")]))
        await load.value
        XCTAssertEqual(model.selectedPatient?.version, 2)
        XCTAssertTrue(model.attachments.isEmpty)
        XCTAssertNil(model.attachmentsPatientId)
        XCTAssertEqual(model.attachmentsLoadState, .idle)
        XCTAssertNil(model.errorMessage)
        XCTAssertFalse(model.isWorking)
    }

    @MainActor func testAttachmentReadFailureDoesNotBecomeLoadedEmptyArchive() async throws {
        let (model, gate) = makeAttachmentModel()
        model.configurePairedOnlineForTests(selectedPatient: detail(id: "patient-a", version: 1))
        let load = Task { await model.loadSelectedPatientAttachments() }
        await fulfillment(of: [gate.started], timeout: 5)
        try gate.respond(data: Data(), status: 503)
        await load.value
        guard case .failed = model.attachmentsLoadState else {
            return XCTFail("A failed read must remain distinct from an empty loaded archive")
        }
        XCTAssertNil(model.attachmentsPatientId)
        XCTAssertNotNil(model.errorMessage)
        XCTAssertFalse(model.isWorking)
    }

    @MainActor func testSelectionSurvivesSameVersionRefreshWhileWorkspaceIsInvalidated() {
        let model = makeModel()
        model.ambulatoryId = "scope-a"
        model.configurePairedOnlineForTests(
            patients: [summary(id: "patient-a", version: 1), summary(id: "patient-b", version: 1)],
            selectedPatient: detail(id: "patient-a", version: 1), entries: [entry(patientID: "patient-a")])
        model.activePatientSection = .diary // @Codex
        model.ambulatoryId = " scope-a "
        model.applyPatientRefreshForSelectionTests([summary(id: "patient-b", version: 2), summary(id: "patient-a", version: 1)])
        XCTAssertEqual(model.selectedPatientID, "patient-a")
        XCTAssertNil(model.selectedPatient)
        XCTAssertTrue(model.entries.isEmpty)
        XCTAssertEqual(model.activePatientSection, .diary) // @Codex: same chart refresh keeps orientation.
    }
    @MainActor func testRevisionIdentityRefreshKeepsWorkspaceUntilReloadCommits() {
        let model = makeModel()
        model.configurePairedOnlineForTests(
            patients: [summary(id: "patient-a", version: 1)],
            selectedPatient: detail(id: "patient-a", version: 1), entries: [entry(patientID: "patient-a")])
        model.applyPatientRevisionRefreshForSelectionTests([summary(id: "patient-a", version: 1)])
        XCTAssertEqual(model.selectedPatientID, "patient-a")
        XCTAssertEqual(model.selectedPatient?.id, "patient-a")
        XCTAssertEqual(model.entries.map(\.id), ["entry-a"])
    }
    @MainActor func testFilteringDoesNotMutateStableSelection() {
        let patients = [summary(id: "patient-a", version: 1, lastName: "Rossi"), summary(id: "patient-b", version: 1, lastName: "Bianchi")]
        let model = makeModel()
        model.configurePairedOnlineForTests(patients: patients, selectedPatient: detail(id: "patient-a", version: 1))
        let filtered = PatientsFiltering.apply(patients: patients, query: "Bianchi", viewMode: .active, sortMode: .alpha)
        XCTAssertEqual(filtered.map(\.id), ["patient-b"])
        XCTAssertEqual(model.selectedPatientID, "patient-a")
    }
    @MainActor func testVersionChangeInvalidatesDetailButRetainsStableSelectionID() {
        let model = makeModel()
        model.configurePairedOnlineForTests(patients: [summary(id: "patient-a", version: 1)],
            selectedPatient: detail(id: "patient-a", version: 1), entries: [entry(patientID: "patient-a")])
        model.applyPatientRefreshForSelectionTests([summary(id: "patient-a", version: 2)])
        XCTAssertEqual(model.selectedPatientID, "patient-a")
        XCTAssertNil(model.selectedPatient)
        XCTAssertTrue(model.entries.isEmpty)
    }
    @MainActor func testClearPairingDropsRetainedSelectionIDInGlobalScope() async {
        let model = makeModel()
        model.configurePairedOnlineForTests(patients: [summary(id: "patient-a", version: 1)],
            selectedPatient: detail(id: "patient-a", version: 1))
        model.applyPatientRefreshForSelectionTests([summary(id: "patient-a", version: 2)])
        XCTAssertEqual(model.ambulatoryId, "")
        XCTAssertEqual(model.selectedPatientID, "patient-a")
        await model.clearPairing()
        XCTAssertNil(model.selectedPatientID)
    }
    @MainActor func testRefreshClearsSelectionWhenPatientDisappears() {
        let model = makeModel()
        model.configurePairedOnlineForTests(patients: [summary(id: "patient-a", version: 1)],
            selectedPatient: detail(id: "patient-a", version: 1))
        model.applyPatientRefreshForSelectionTests([summary(id: "patient-b", version: 1)])
        XCTAssertNil(model.selectedPatientID)
        XCTAssertNil(model.selectedPatient)
    }
    @MainActor func testTrashTransitionClearsSelectionDespiteActiveSummaryRemaining() {
        let model = makeModel()
        model.configurePairedOnlineForTests(
            patients: [summary(id: "patient-a", version: 1)],
            selectedPatient: detail(id: "patient-a", version: 1), entries: [entry(patientID: "patient-a")])
        model.applyPatientTrashRefreshForSelectionTests([summary(id: "patient-a", version: 1), summary(id: "patient-deleted", version: 2, deleted: true)])
        XCTAssertEqual(model.patients.map(\.id), ["patient-a", "patient-deleted"])
        XCTAssertNil(model.selectedPatientID)
        XCTAssertNil(model.selectedPatient)
        XCTAssertTrue(model.entries.isEmpty)
    }
    @MainActor func testDirectAmbulatoryScopeMutationClearsStateBeforeSamePatientVersionRefresh() {
        let patient = summary(id: "patient-a", version: 1)
        let model = makeModel()
        model.ambulatoryId = "scope-a"
        model.configurePairedOnlineForTests(
            patients: [patient], selectedPatient: detail(id: patient.id, version: 1, ambulatoryID: "scope-a"),
            entries: [entry(patientID: patient.id)], therapies: [therapy(patientID: patient.id)],
            attachments: [attachment(patientID: patient.id)])
        model.newEntryTitle = "Bozza sintetica"
        model.activePatientSection = .diary // @Codex
        model.newEntryVisitTranscript = "Trascrizione sintetica"
        model.newEntryVisitDraftReviewed = true
        model.newEntryAttachmentIds = ["attachment-a"]
        XCTAssertTrue(model.selectedPatient != nil && !model.entries.isEmpty && !model.therapies.isEmpty && !model.attachments.isEmpty && model.newEntryVisitDraftReviewed)
        model.ambulatoryId = "scope-b"
        model.applyPatientRefreshForSelectionTests([patient])
        XCTAssertEqual(model.ambulatoryId, "scope-b")
        XCTAssertEqual(model.patients.first?.version, 1)
        XCTAssertNil(model.selectedPatientID)
        XCTAssertNil(model.selectedPatient)
        XCTAssertTrue(model.entries.isEmpty && model.therapies.isEmpty)
        XCTAssertTrue(model.attachments.isEmpty && model.newEntryAttachmentIds.isEmpty)
        XCTAssertNil(model.attachmentsPatientId)
        XCTAssertEqual(model.newEntryTitle, "")
        XCTAssertEqual(model.newEntryVisitTranscript, "")
        XCTAssertFalse(model.newEntryVisitDraftReviewed)
        XCTAssertEqual(model.activePatientSection, .overview) // @Codex
        XCTAssertEqual(model.attachmentsLoadState, .idle) // @Codex
    }

    /* @Codex */
    @MainActor private func makeAttachmentModel() -> (PairedPatientsWorkspaceModel, SelectionAttachmentResponseGate) {
        let host = "selection-\(UUID().uuidString.lowercased()).invalid"
        let gate = SelectionAttachmentResponseGate()
        SelectionAttachmentURLProtocol.register(gate, host: host)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = false
        configuration.protocolClasses = [SelectionAttachmentURLProtocol.self]
        let session = URLSession(configuration: configuration)
        addTeardownBlock {
            session.invalidateAndCancel()
            SelectionAttachmentURLProtocol.remove(host: host)
        }
        let source = HomeBasePatientsClient(
            configuration: HomeBaseConnectionConfiguration(serverURLString: "https://\(host)"),
            session: session)
        return (makeModel(source: source), gate)
    }

    @MainActor private func makeModel(source: (any HomeBasePatientsDataSource)? = nil) -> PairedPatientsWorkspaceModel {
        let defaults = UserDefaults(suiteName: "PairedPatientsWorkspaceSelectionTests.\(UUID().uuidString)")!
        let pairedStore = HomeBasePairedStore(
            userDefaults: defaults, keychainReader: { _, _ in .success(nil) },
            keychainWriter: { _, _, _ in .success(()) }, keychainDeleter: { _, _ in .success(()) })
        let cacheStore = HomeBasePatientCacheStore(
            cacheDirectory: FileManager.default.temporaryDirectory.appendingPathComponent("PairedPatientsWorkspaceSelectionTests-\(UUID().uuidString)"), keyProvider: { SymmetricKey(data: Data(repeating: 9, count: 32)) })
        if let source {
            return PairedPatientsWorkspaceModel(pairedStore: pairedStore, cacheStore: cacheStore,
                dataSourceFactory: { _ in source })
        }
        return PairedPatientsWorkspaceModel(pairedStore: pairedStore, cacheStore: cacheStore)
    }
    private func summary(id: String, version: Int, lastName: String = "Rossi", deleted: Bool = false) -> HomeBasePatientSummary {
        HomeBasePatientSummary(
            id: id, firstName: "Mario", lastName: lastName, birthDate: nil,
            taxCode: "SYNTHETIC-\(id)", isAdi: false, isArchived: false,
            version: version, updatedAt: Date(timeIntervalSince1970: TimeInterval(version)),
            deletedAt: deleted ? Date(timeIntervalSince1970: 10) : nil, deletionReason: deleted ? "fixture sintetica" : nil)
    }
    private func entry(patientID: String) -> HomeBaseEntrySummary {
        HomeBaseEntrySummary(
            id: "entry-a", patientId: patientID, type: "note", title: "Nota sintetica",
            date: Date(timeIntervalSince1970: 1), content: "Contenuto sintetico", setting: nil, metadata: nil, attachments: nil, deletedAt: nil,
            deletionReason: nil, version: 1, createdAt: nil, updatedAt: nil)
    }
    private func therapy(patientID: String) -> HomeBaseTherapySummary {
        HomeBaseTherapySummary(
            id: "therapy-a", patientId: patientID, drugName: "Sintetico", aic: nil, atc: nil,
            activePrinciple: nil, dosage: "1", motivation: nil, diagnosisCode: nil, diagnosisName: nil,
            status: "active", startDate: Date(timeIntervalSince1970: 1), endDate: nil, version: 1, createdAt: nil, updatedAt: nil, deletedAt: nil, deletionReason: nil)
    }
    private func attachment(patientID: String) -> HomeBaseAttachmentSummary {
        HomeBaseAttachmentSummary(
            id: "attachment-a", patientId: patientID, name: "Sintetico", type: "text/plain", size: 1,
            path: "synthetic", summarySnapshot: nil, parseEvidenceArtifactSnapshot: nil, ocrQueueState: nil, ocrQueueReason: nil, ocrQueueUpdatedAt: nil,
            ocrReplayArtifactSnapshot: nil, createdAt: nil)
    }
    private func detail(id: String, version: Int, ambulatoryID: String = "synthetic") -> HomeBasePatientDetail {
        HomeBasePatientDetail(
            id: id, firstName: "Mario", lastName: "Rossi", birthDate: nil,
            taxCode: "SYNTHETIC-\(id)", address: nil, phone: nil, caregiver: nil,
            exemptions: nil, diagnoses: nil, monitoringProfile: nil, statusReason: nil, notes: nil, aiSummary: nil, documentInsights: nil, isAdi: false,
            isArchived: false, version: version, ambulatoryId: ambulatoryID,
            createdAt: nil, updatedAt: nil)
    }
}

/* @Codex */
private final class SelectionAttachmentResponseGate: @unchecked Sendable {
    let started = XCTestExpectation(description: "Synthetic attachment request started")
    private let lock = NSLock()
    private var pending: SelectionAttachmentURLProtocol?

    func receive(_ request: SelectionAttachmentURLProtocol) {
        lock.lock()
        pending = request
        lock.unlock()
        started.fulfill()
    }

    func respond(data: Data, status: Int = 200) throws {
        lock.lock()
        let request = pending
        pending = nil
        lock.unlock()
        let transport = try XCTUnwrap(request)
        XCTAssertEqual(transport.request.url?.path, "/api/v1/network/patients/patient-a/attachments")
        transport.respond(data: data, status: status)
    }
}

/* @Codex */
private final class SelectionAttachmentURLProtocol: URLProtocol, @unchecked Sendable {
    private static let lock = NSLock()
    private static var gates: [String: SelectionAttachmentResponseGate] = [:]

    static func register(_ gate: SelectionAttachmentResponseGate, host: String) {
        lock.lock()
        defer { lock.unlock() }
        gates[host] = gate
    }

    static func remove(host: String) {
        lock.lock()
        defer { lock.unlock() }
        gates.removeValue(forKey: host)
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.lock.lock()
        let gate = Self.gates[request.url?.host ?? ""]
        Self.lock.unlock()
        guard let gate else {
            // Every request is intercepted: an unexpected route cannot reach the network.
            client?.urlProtocol(self, didFailWithError: URLError(.unsupportedURL))
            return
        }
        gate.receive(self)
    }
    override func stopLoading() {}

    func respond(data: Data, status: Int) {
        guard let url = request.url,
              let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: nil,
                  headerFields: ["Content-Type": "application/json"]) else { return }
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }
}
