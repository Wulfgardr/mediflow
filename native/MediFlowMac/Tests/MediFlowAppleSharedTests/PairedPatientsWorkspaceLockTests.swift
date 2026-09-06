// @Codex
import CryptoKit
import Foundation
import XCTest
@testable import MediFlowAppleShared

final class PairedPatientsWorkspaceLockTests: XCTestCase {
    @MainActor func testLockClearsLoadedChartAndDraftsBeforeLogoutResponds() async throws {
        let h = try LockReadHarness(test: self)
        let model = h.model
        model.startEditingEntry(LockReadFixture.entry)
        model.newEntryTitle = "Bozza sintetica"
        model.newEntryEditorDocument = ClinicalRichTextEditorDocument(blocks: [.init(kind: .paragraph, span: ClinicalRichTextTextRun(text: "Testo sintetico"))])
        model.newEntryVisitTranscript = "Trascrizione sintetica"
        model.newEntryVisitDraftReviewed = true
        model.newEntryAttachmentIds = ["attachment-fixture"]
        model.newTherapyDosage = "Dose sintetica"
        model.newCheckupNotes = "Controllo sintetico"
        model.newObservationNotes = "Osservazione sintetica"
        model.newServiceClinicalQuestion = "Quesito sintetico"
        model.newProstheticClinicalReason = "Motivo sintetico"
        model.startEditingPatient()
        model.editPatientNotes = "Modifica sintetica"
        model.password = "1234"
        XCTAssertNotNil(model.clinicalWorkspaceConnection?.masterKey)
        XCTAssertFalse(model.entries.isEmpty)
        XCTAssertFalse(model.editEntryEditorDocument.isEffectivelyEmpty)

        let started = h.transport.hold(LockReadFixture.logout)
        let locking = Task { await model.lockSessionNow() }
        await fulfillment(of: [started], timeout: 5)
        assertLocked(model)
        XCTAssertEqual(model.password, "")
        XCTAssertEqual(model.newTherapyDosage, "")
        XCTAssertEqual(model.newCheckupNotes, "")
        XCTAssertEqual(model.newObservationNotes, "")
        XCTAssertEqual(model.newServiceClinicalQuestion, "")
        XCTAssertEqual(model.newProstheticClinicalReason, "")
        XCTAssertFalse(model.isEditingPatient)
        XCTAssertEqual(model.editPatientNotes, "")
        XCTAssertTrue(model.isWorking, "The HTTP logout is still pending at the clear boundary")
        try h.transport.release(LockReadFixture.logout, status: 204)
        await locking.value
        assertLocked(model)
        XCTAssertFalse(model.isWorking)
        XCTAssertEqual(model.statusMessage, "Sessione bloccata. Accedi di nuovo per continuare.")
    }

    @MainActor func testLogoutFailureDoesNotDelayOrUndoLocalLock() async throws {
        let h = try LockReadHarness(test: self)
        let started = h.transport.hold(LockReadFixture.logout)
        let locking = Task { await h.model.lockSessionNow() }
        await fulfillment(of: [started], timeout: 5)
        assertLocked(h.model)
        try h.transport.release(LockReadFixture.logout, status: 503)
        await locking.value
        assertLocked(h.model)
        XCTAssertNil(h.model.errorMessage)
        XCTAssertTrue(h.model.statusMessage?.contains("Logout remoto non confermato") == true)
    }

    @MainActor func testLockRemovesOfflineProfileAndCannotRestoreItWithoutLogin() async throws {
        let h = try LockReadHarness(test: self)
        try h.cache.savePatientList([OfflineCacheFixture.summary()], context: h.context)
        try h.cache.savePatientDetail(OfflineCacheFixture.detail(notes: "Nota sintetica"), context: h.context)
        h.transport.failPatients = true
        await h.model.loadPatients()
        await h.model.loadPatient(OfflineCacheFixture.summary())
        XCTAssertNotNil(h.model.cachedPatientProfile)
        let started = h.transport.hold(LockReadFixture.logout)
        let locking = Task { await h.model.lockSessionNow() }
        await fulfillment(of: [started], timeout: 5)
        assertLocked(h.model)
        try h.transport.release(LockReadFixture.logout, status: 204)
        await locking.value
        h.model.refreshOfflineCacheIfNeeded()
        await h.model.loadPatients()
        XCTAssertNil(h.model.cachedPatientProfile)
        XCTAssertNil(h.model.cacheMetadata)
        XCTAssertTrue(h.model.patients.isEmpty)
        // Lock revokes presentation, not the independently encrypted disk file.
        XCTAssertNotNil(try h.cache.loadPatientList(context: h.context))
    }

    @MainActor func testOldLogoutCompletionCannotReplaceNewLogin() async throws {
        let h = try LockReadHarness(test: self)
        let started = h.transport.hold(LockReadFixture.logout)
        let locking = Task { await h.model.lockSessionNow() }
        await fulfillment(of: [started], timeout: 5)
        h.model.password = "1234"
        await h.model.login()
        let loginStatus = h.model.statusMessage
        XCTAssertEqual(h.model.operatorIdentity?.userId, "new-operator-fixture")
        try h.transport.release(LockReadFixture.logout, status: 204)
        await locking.value
        XCTAssertEqual(h.model.operatorIdentity?.userId, "new-operator-fixture")
        XCTAssertEqual(h.model.statusMessage, loginStatus)
        await h.model.loadPatients()
        XCTAssertEqual(h.model.connectionState, .pairedOnline)
        XCTAssertNil(h.model.selectedPatient)
        XCTAssertTrue(h.model.newEntryEditorDocument.isEffectivelyEmpty)
    }

    @MainActor func testOldPatientAndListReadsCannotPublishAfterLock() async throws {
        for path in [LockReadFixture.patient, LockReadFixture.patients] {
            let h = try LockReadHarness(test: self)
            let started = h.transport.hold(path)
            let reading = Task {
                if path == LockReadFixture.patient { await h.model.loadPatient(OfflineCacheFixture.summary()) }
                else { await h.model.loadPatients() }
            }
            await fulfillment(of: [started], timeout: 5)
            await h.model.lockSessionNow()
            try h.transport.release(path)
            await reading.value
            assertLocked(h.model)
            XCTAssertNil(try h.cache.loadPatientList(context: h.context))
        }
    }

    @MainActor func testDelayedVisitDraftFailureCannotReplaceLockedStateOrNewLogin() async throws {
        for loginAgain in [false, true] {
            let h = try LockReadHarness(test: self)
            h.model.newEntryVisitTranscript = "Trascrizione solo sintetica"
            let started = h.transport.hold(LockReadFixture.visitDraft)
            let computing = Task { await h.model.computeVisitDraftForNewEntry() }
            await fulfillment(of: [started], timeout: 5)
            await h.model.lockSessionNow()
            if loginAgain {
                h.model.password = "1234"
                await h.model.login()
            }
            let status = h.model.statusMessage
            try h.transport.release(LockReadFixture.visitDraft, status: 401)
            await computing.value
            XCTAssertEqual(h.model.statusMessage, status)
            XCTAssertNil(h.model.errorMessage)
            XCTAssertNil(h.model.newEntryVisitDraftResponse)
            if loginAgain { XCTAssertEqual(h.model.operatorIdentity?.userId, "new-operator-fixture") }
            else { assertLocked(h.model) }
        }
    }

    @MainActor private func assertLocked(_ model: PairedPatientsWorkspaceModel, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertNil(model.clinicalWorkspaceConnection, file: file, line: line)
        XCTAssertNil(model.operatorIdentity, file: file, line: line)
        XCTAssertEqual(model.connectionState, .sessionExpired, file: file, line: line)
        XCTAssertTrue(model.patients.isEmpty && model.availableAmbulatories.isEmpty, file: file, line: line)
        XCTAssertNil(model.selectedPatient, file: file, line: line)
        XCTAssertNil(model.selectedPatientID, file: file, line: line)
        XCTAssertTrue(model.entries.isEmpty && model.therapies.isEmpty && model.checkups.isEmpty && model.observations.isEmpty, file: file, line: line)
        XCTAssertTrue(model.servicePrescriptions.isEmpty && model.servicePrescriptionItems.isEmpty && model.prostheticPrescriptions.isEmpty, file: file, line: line)
        XCTAssertTrue(model.attachments.isEmpty, file: file, line: line)
        XCTAssertNil(model.selectedAttachmentDetail, file: file, line: line)
        XCTAssertNil(model.patientReportURL, file: file, line: line)
        XCTAssertNil(model.patientFHIRExportURL, file: file, line: line)
        XCTAssertNil(model.fseDocumentValidationResult, file: file, line: line)
        XCTAssertNil(model.cachedPatientProfile, file: file, line: line)
        XCTAssertNil(model.cacheMetadata, file: file, line: line)
        XCTAssertNil(model.cachedProfileMetadata, file: file, line: line)
        XCTAssertTrue(model.newEntryEditorDocument.isEffectivelyEmpty && model.editEntryEditorDocument.isEffectivelyEmpty, file: file, line: line)
        XCTAssertEqual(model.newEntryTitle, "", file: file, line: line)
        XCTAssertEqual(model.newEntryVisitTranscript, "", file: file, line: line)
        XCTAssertFalse(model.newEntryVisitDraftReviewed, file: file, line: line)
        XCTAssertNil(model.editingEntryId, file: file, line: line)
        XCTAssertFalse(model.canCreateEntry || model.canUpdateEditingEntry || model.canComputeVisitDraft || model.canCreatePatient, file: file, line: line)
    }
}

// URLProtocol is a unit boundary only. It intercepts every request; no server,
// shared cookies, Keychain contents or real patient data are used by these tests.
@MainActor struct LockReadHarness {
    let model: PairedPatientsWorkspaceModel
    let transport: LockReadTransport
    let cache: HomeBasePatientCacheStore
    let context: HomeBasePatientCacheContext

    init(test: XCTestCase) throws {
        let id = UUID().uuidString
        let host = "lock-\(id.lowercased()).invalid"
        context = OfflineCacheFixture.context(server: "https://\(host)")
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("LockReadTests-\(id)")
        cache = HomeBasePatientCacheStore(cacheDirectory: directory, keyProvider: { OfflineCacheFixture.key })
        transport = LockReadTransport()
        LockReadURLProtocol.register(transport, host: host)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = false
        configuration.protocolClasses = [LockReadURLProtocol.self]
        let session = URLSession(configuration: configuration)
        let source = HomeBasePatientsClient(configuration: HomeBaseConnectionConfiguration(serverURLString: context.serverURL), session: session)
        let defaults = UserDefaults(suiteName: id)!
        let pairedStore = HomeBasePairedStore(userDefaults: defaults,
            keychainReader: { _, _ in .success(nil) }, keychainWriter: { _, _, _ in .success(()) },
            keychainDeleter: { _, _ in .success(()) })
        model = PairedPatientsWorkspaceModel(pairedStore: pairedStore, cacheStore: cache, dataSourceFactory: { _ in source })
        model.serverURL = context.serverURL
        model.tlsPin = context.tlsPin
        model.ambulatoryId = "scope-a"
        model.configurePairedOnlineForTests(
            credentials: HomeBasePairedCredentials(clientId: "paired-fixture", clientToken: "paired-token-fixture"),
            sessionCookie: "sid=fixture", operatorId: "operator-fixture", masterKey: OfflineCacheFixture.key,
            patients: [OfflineCacheFixture.summary()], selectedPatient: OfflineCacheFixture.detail(notes: "Nota sintetica"),
            entries: [LockReadFixture.entry])
        test.addTeardownBlock {
            session.invalidateAndCancel()
            LockReadURLProtocol.remove(host: host)
            defaults.removePersistentDomain(forName: id)
            if FileManager.default.fileExists(atPath: directory.path) { try FileManager.default.removeItem(at: directory) }
        }
    }
}

enum LockReadFixture {
    static let logout = "/api/auth/native/logout"
    static let patients = "/api/v1/network/patients"
    static let patient = patients + "/p1"
    static let visitDraft = "/api/v1/network/visit-draft"
    static var entry: HomeBaseEntrySummary {
        HomeBaseEntrySummary(id: "entry-fixture", patientId: "p1", type: "note", title: "Nota sintetica",
            date: Date(timeIntervalSince1970: 1), content: "<p>Testo sintetico</p>", setting: nil,
            metadata: nil, attachments: nil, deletedAt: nil, deletionReason: nil, version: 1, createdAt: nil, updatedAt: nil)
    }
    static var therapy: HomeBaseTherapySummary {
        HomeBaseTherapySummary(id: "therapy-fixture", patientId: "p1", drugName: "Terapia sintetica", aic: nil, atc: nil,
            activePrinciple: nil, dosage: "Sintetico", motivation: nil, diagnosisCode: nil, diagnosisName: nil,
            status: "active", startDate: Date(timeIntervalSince1970: 1), endDate: nil, version: 1,
            createdAt: nil, updatedAt: nil, deletedAt: nil, deletionReason: nil)
    }
    static func data(for path: String) throws -> Data {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        switch path {
        case "/api/v1/network/fse/validate-document":
            return try encoder.encode(HomeBaseFseDocumentValidationResponse(ok: true, profile: "therapy-medication", errors: [], warnings: []))
        case patient + "/therapies": return try encoder.encode([therapy])
        case patients: return try encoder.encode([OfflineCacheFixture.summary()])
        case patient: return try encoder.encode(OfflineCacheFixture.detail(notes: "Nota sintetica"))
        case patient + "/entries", "/api/v1/network/entries": return try encoder.encode([entry])
        case logout: return Data("{\"success\":true}".utf8)
        case "/api/auth/native/login": return Data("{\"id\":\"new-operator-fixture\"}".utf8)
        case patient + "/checkups", "/api/v1/network/checkups":
            return try encoder.encode([HomeBaseCheckupSummary(id: "checkup-fixture", patientId: "p1", date: Date(), title: "Controllo sintetico", notes: nil, status: "pending", source: "manual", version: 1, createdAt: nil, updatedAt: nil, deletedAt: nil, deletionReason: nil)])
        case "/api/v1/network/ambulatories",
             patient + "/observations", "/api/v1/network/service-prescriptions", "/api/v1/network/service-prescription-items",
             "/api/v1/network/prosthetic-prescriptions", patient + "/attachments":
            return Data("[]".utf8)
        default: throw URLError(.unsupportedURL)
        }
    }
}

final class LockReadTransport: @unchecked Sendable {
    private let lock = NSLock()
    private var held: [String: LockReadURLProtocol] = [:]
    private var expectations: [String: XCTestExpectation] = [:]
    private var patientsFail = false
    var failPatients: Bool {
        get { lock.withLock { patientsFail } }
        set { lock.withLock { patientsFail = newValue } }
    }
    func hold(_ path: String) -> XCTestExpectation {
        let started = XCTestExpectation(description: "Synthetic request held: \(path)")
        lock.withLock { expectations[path] = started }
        return started
    }
    func start(_ request: LockReadURLProtocol) {
        let path = request.request.url!.path
        let started = lock.withLock {
            let value = expectations.removeValue(forKey: path)
            if value != nil { held[path] = request }
            return value
        }
        if let started { started.fulfill(); return }
        if path == LockReadFixture.patients, failPatients {
            request.client?.urlProtocol(request, didFailWithError: URLError(.notConnectedToInternet))
        } else { respond(request) }
    }
    func release(_ path: String, status: Int = 200, data: Data? = nil) throws {
        let request = try XCTUnwrap(lock.withLock { held.removeValue(forKey: path) })
        respond(request, status: status, data: data)
    }
    private func respond(_ request: LockReadURLProtocol, status: Int = 200, data: Data? = nil) {
        do {
            let payload = try data ?? (status == 204 || status >= 400 ? Data() : LockReadFixture.data(for: request.request.url!.path))
            request.respond(data: payload, status: status)
        } catch { request.client?.urlProtocol(request, didFailWithError: error) }
    }
}

final class LockReadURLProtocol: URLProtocol, @unchecked Sendable {
    private static let lock = NSLock()
    private static var transports: [String: LockReadTransport] = [:]
    static func register(_ transport: LockReadTransport, host: String) { lock.withLock { transports[host] = transport } }
    static func remove(host: String) { _ = lock.withLock { transports.removeValue(forKey: host) } }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard let transport = Self.lock.withLock({ Self.transports[request.url?.host ?? ""] }) else {
            client?.urlProtocol(self, didFailWithError: URLError(.unsupportedURL))
            return
        }
        transport.start(self)
    }
    override func stopLoading() {}
    func respond(data: Data, status: Int) {
        guard let url = request.url,
              let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: nil,
                  headerFields: ["Content-Type": "application/json", "Set-Cookie": "mediflow_session=new-synthetic-session; Path=/; HttpOnly"]) else { return }
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }
}
