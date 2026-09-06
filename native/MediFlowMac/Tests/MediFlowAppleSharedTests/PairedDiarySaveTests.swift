import CryptoKit
import Foundation
import XCTest
@testable import MediFlowCore
@testable import MediFlowAppleShared

/* @Codex: Actual model/client/sealing, substituted transport; no host or UI. */
final class PairedDiarySaveTests: XCTestCase {
    @MainActor
    func testCreateAcknowledgementDoesNotEraseChangesAfterTheSubmittedSnapshot() async throws {
        let (model, transport) = try harness()
        model.newEntryTitle = "Titolo inviato"
        model.newEntryEditorDocument = .load(html: "<p>Prima <strong>versione sintetica</strong></p>")
        let sentHTML = model.newEntryEditorDocument.renderedHTML
        let started = transport.holdNext(method: "POST")
        let save = Task { await model.createEntryForSelectedPatient() }
        await fulfillment(of: [started], timeout: 3)
        defer { transport.release() }
        XCTAssertTrue(model.isWorking)
        XCTAssertFalse(model.canCreateEntry)
        // Simulate a delayed native-input callback despite the disabled UI.
        model.newEntryTitle = "Correzione successiva"
        model.newEntryEditorDocument = .load(html: "<p>Bozza <em>successiva</em> non inviata</p>")
        let retained = model.newEntryEditorDocument
        await model.createEntryForSelectedPatient()
        XCTAssertEqual(transport.writes.count, 1, "A second Save while pending is a no-op.")
        transport.release()
        await save.value
        XCTAssertEqual(model.newEntryTitle, "Correzione successiva")
        XCTAssertEqual(model.newEntryEditorDocument, retained)
        XCTAssertTrue(model.canCreateEntry)
        XCTAssertEqual(transport.writes.count, 1, "Preservation must not auto-submit the new draft.")
        XCTAssertEqual(try decrypted(transport.writes[0], "content"), sentHTML)
        XCTAssertEqual(try decrypted(transport.writes[0], "title"), "Titolo inviato")
        XCTAssertEqual(model.entries.count, 1)
        XCTAssertEqual(model.entries.first?.content, sentHTML)
        XCTAssertTrue(model.statusMessage?.contains("non salvata") == true)
        XCTAssertEqual(transport.writes[0].request.value(forHTTPHeaderField: "Cookie"),
                       "mediflow_session=diary-synthetic; ambulatory_id=scope-a")
    }

    @MainActor
    func testUnchangedCreateClearsOnlyAfterSuccessAndFailedRetryKeepsItsStableID() async throws {
        let (model, transport) = try harness()
        model.newEntryTitle = "Bozza sintetica"
        model.newEntryEditorDocument = .load(html: "<p>Da conservare se la risposta manca</p>")
        let draft = model.newEntryEditorDocument
        transport.writeStatus = 503
        await model.createEntryForSelectedPatient()
        XCTAssertEqual(model.newEntryEditorDocument, draft)
        XCTAssertEqual(model.newEntryTitle, "Bozza sintetica")
        XCTAssertEqual(model.entries.count, 1)
        transport.writeStatus = nil
        await model.createEntryForSelectedPatient()
        XCTAssertEqual(transport.writes.count, 2)
        XCTAssertEqual(try json(transport.writes[0])["id"] as? String, try json(transport.writes[1])["id"] as? String)
        XCTAssertTrue(model.newEntryEditorDocument.blocks.isEmpty)
        XCTAssertEqual(model.newEntryTitle, "")
        XCTAssertFalse(model.isWorking)
    }

    @MainActor
    func testUpdateAcknowledgementPreservesLaterEditsAndRequiresExplicitVersionReview() async throws {
        let (model, transport) = try harness()
        model.startEditingEntry(DiaryFixture.entry())
        model.editEntryTitle = "Titolo inviato"
        model.editEntryEditorDocument = .load(html: "<p>Snapshot <strong>inviato</strong></p>")
        let sentHTML = model.editEntryEditorDocument.renderedHTML
        let started = transport.holdNext(method: "PUT")
        let save = Task { await model.updateEditingEntry() }
        await fulfillment(of: [started], timeout: 3)
        defer { transport.release() }
        XCTAssertTrue(model.isWorking)
        XCTAssertFalse(model.canUpdateEditingEntry)
        model.editEntryTitle = "Correzione dopo Save"
        model.editEntryEditorDocument = .load(html: "<p>Correzione <em>successiva</em></p>")
        let retained = model.editEntryEditorDocument
        await model.updateEditingEntry()
        transport.release()
        await save.value
        XCTAssertEqual(transport.writes.count, 1)
        XCTAssertEqual(try decrypted(transport.writes[0], "content"), sentHTML)
        XCTAssertEqual(model.editEntryTitle, "Correzione dopo Save")
        XCTAssertEqual(model.editEntryEditorDocument, retained)
        XCTAssertEqual(model.editingEntryVersion, 1, "The boolean ACK cannot supply a guessed version.")
        XCTAssertTrue(model.editingEntryRequiresReconciliation)
        XCTAssertFalse(model.canUpdateEditingEntry)
        XCTAssertEqual(model.editingEntryRemoteReview?.version, 2)
        model.confirmEditingEntryReconciliation()
        XCTAssertEqual(model.editingEntryVersion, 2)
        XCTAssertEqual(model.editEntryEditorDocument, retained)
        XCTAssertEqual(transport.writes.count, 1, "Review confirmation performs no write.")
        await model.updateEditingEntry()
        XCTAssertEqual(transport.writes.count, 2)
        XCTAssertEqual(try json(transport.writes[1])["version"] as? Int, 2)
        XCTAssertEqual(try decrypted(transport.writes[1], "content"), retained.renderedHTML)
        XCTAssertFalse(model.isEditingEntry)
    }

    @MainActor
    func testConflictReloadPreservesDraftAndRebasesOnlyAfterManualComparison() async throws {
        let (model, transport) = try harness()
        let original = DiaryFixture.entry()
        model.startEditingEntry(original)
        model.editEntryTitle = "Titolo locale corretto"
        let localDocument = model.editEntryEditorDocument
        transport.entries = [DiaryFixture.entry(version: 2, content: "<p>Correzione da altro client</p>")]
        transport.writeStatus = 409
        await model.updateEditingEntry()
        XCTAssertNotNil(model.pendingConflict)
        XCTAssertTrue(model.editingEntryRequiresReconciliation)
        XCTAssertEqual(model.editEntryEditorDocument, localDocument)
        model.dismissConflict()
        await model.updateEditingEntry()
        XCTAssertEqual(transport.writes.count, 1, "Ignoring the banner cannot bypass reconciliation.")
        let started = transport.holdNext(method: "GET", suffix: "/patients/patient-a")
        let reload = Task { await model.reloadAfterConflict() }
        await fulfillment(of: [started], timeout: 3)
        defer { transport.release() }
        model.editEntryTitle = "Bozza ritoccata durante la rilettura"
        transport.release()
        await reload.value
        XCTAssertNil(model.pendingConflict)
        XCTAssertEqual(model.editingEntryVersion, 1)
        XCTAssertEqual(model.editEntryEditorDocument, localDocument)
        XCTAssertEqual(model.editEntryTitle, "Bozza ritoccata durante la rilettura")
        XCTAssertFalse(model.canUpdateEditingEntry)
        XCTAssertEqual(model.editingEntryRemoteReview?.content, "<p>Correzione da altro client</p>")
        model.startEditingEntry(try XCTUnwrap(model.entries.first))
        XCTAssertEqual(model.editEntryEditorDocument, localDocument, "Reopening the same row must not discard the draft.")
        model.confirmEditingEntryReconciliation()
        XCTAssertEqual(model.editingEntryVersion, 2)
        XCTAssertEqual(model.editEntryEditorDocument, localDocument)
        XCTAssertEqual(transport.writes.count, 1)
        transport.writeStatus = nil
        await model.updateEditingEntry()
        XCTAssertEqual(transport.writes.count, 2)
        XCTAssertEqual(try json(transport.writes[1])["version"] as? Int, 2)
        // The retained original HTML now differs from the refreshed server copy;
        // it must be included, not omitted as if the pre-conflict baseline held.
        XCTAssertEqual(try decrypted(transport.writes[1], "content"), original.content)
        XCTAssertFalse(model.isEditingEntry)
    }

    @MainActor
    func testAnotherConflictAfterReviewNeedsANewExplicitReconciliation() async throws {
        let (model, transport) = try harness()
        model.startEditingEntry(DiaryFixture.entry())
        model.editEntryTitle = "Bozza locale"
        transport.writeStatus = 409
        transport.entries = [DiaryFixture.entry(version: 2)]
        await model.updateEditingEntry()
        await model.reloadAfterConflict()
        model.confirmEditingEntryReconciliation()
        transport.entries = [DiaryFixture.entry(version: 3)]
        await model.updateEditingEntry()
        XCTAssertEqual(model.editingEntryVersion, 2)
        XCTAssertTrue(model.editingEntryRequiresReconciliation)
        XCTAssertNil(model.editingEntryRemoteReview)
        XCTAssertEqual(model.editEntryTitle, "Bozza locale")
        XCTAssertEqual(transport.writes.count, 2)
        XCTAssertEqual(try json(transport.writes[1])["version"] as? Int, 2)
    }

    @MainActor
    func testMissingDeletedOrUnreadableRefreshedEntryCannotAuthorizeSave() async throws {
        for state in 0..<3 {
            let (model, transport) = try harness()
            model.startEditingEntry(DiaryFixture.entry())
            model.editEntryTitle = "Bozza da non perdere"
            let document = model.editEntryEditorDocument
            transport.writeStatus = 409
            await model.updateEditingEntry()
            transport.entries = state == 0 ? [] : [DiaryFixture.entry(
                version: 2, content: state == 2 ? "ENC:unreadable-synthetic" : "<p>Voce eliminata</p>",
                deletedAt: state == 1 ? Date(timeIntervalSince1970: 2) : nil)]
            await model.reloadAfterConflict()
            model.confirmEditingEntryReconciliation()
            XCTAssertFalse(model.canConfirmEditingEntryReconciliation)
            XCTAssertFalse(model.canUpdateEditingEntry)
            XCTAssertEqual(model.editingEntryVersion, 1)
            XCTAssertEqual(model.editEntryTitle, "Bozza da non perdere")
            XCTAssertEqual(model.editEntryEditorDocument, document)
            XCTAssertEqual(transport.writes.count, 1)
        }
    }

    @MainActor
    func testFailedReconciliationReadKeepsDraftAndCannotAdoptAConflictPayloadVersion() async throws {
        let (model, transport) = try harness()
        model.startEditingEntry(DiaryFixture.entry())
        model.editEntryTitle = "Bozza sintetica intatta"
        transport.writeStatus = 409
        await model.updateEditingEntry()
        transport.readStatus = 503
        await model.reloadAfterConflict()
        model.confirmEditingEntryReconciliation()
        XCTAssertEqual(model.editingEntryVersion, 1)
        XCTAssertNil(model.editingEntryRemoteReview)
        XCTAssertTrue(model.editingEntryRequiresReconciliation)
        XCTAssertEqual(model.editEntryTitle, "Bozza sintetica intatta")
        XCTAssertEqual(transport.writes.count, 1)
    }

    @MainActor
    func testLateWriteAfterScopeChangeCannotResetNewDraftOrPublishOldEntries() async throws {
        for edit in [false, true] {
            let (model, transport) = try harness()
            if edit {
                model.startEditingEntry(DiaryFixture.entry())
                model.editEntryTitle = "Snapshot in invio"
            } else {
                model.newEntryEditorDocument = .load(html: "<p>Snapshot in invio</p>")
            }
            let started = transport.holdNext(method: edit ? "PUT" : "POST")
            let save = Task {
                if edit { await model.updateEditingEntry() } else { await model.createEntryForSelectedPatient() }
            }
            await fulfillment(of: [started], timeout: 3)
            defer { transport.release() }
            model.ambulatoryId = "scope-b"
            model.newEntryTitle = "Bozza del contesto successivo"
            transport.release()
            await save.value
            XCTAssertNil(model.selectedPatient)
            XCTAssertTrue(model.entries.isEmpty)
            XCTAssertEqual(model.newEntryTitle, "Bozza del contesto successivo")
            XCTAssertFalse(model.editingEntryRequiresReconciliation)
            XCTAssertNil(model.editingEntryRemoteReview)
            XCTAssertEqual(transport.requests.count, 1, "No post-ACK refresh may use the replacement scope.")
        }
    }

    @MainActor
    func testRefreshFailureAfterAcknowledgedUpdateDoesNotPretendTheWriteFailed() async throws {
        let (model, transport) = try harness()
        model.startEditingEntry(DiaryFixture.entry())
        model.editEntryTitle = "Titolo salvato"
        transport.readStatus = 503
        await model.updateEditingEntry()
        XCTAssertFalse(model.isEditingEntry)
        XCTAssertEqual(transport.writes.count, 1)
        XCTAssertTrue(model.statusMessage?.contains("aggiornata") == true)
        XCTAssertTrue(model.errorMessage?.contains("rilettura") == true)
    }

    @MainActor
    func testUnauthorizedPostSaveReadStillUsesTheOrdinarySessionExpiry() async throws {
        for edit in [false, true] {
            let (model, transport) = try harness()
            if edit {
                model.startEditingEntry(DiaryFixture.entry())
                model.editEntryTitle = "Aggiornamento sintetico"
            } else {
                model.newEntryEditorDocument = .load(html: "<p>Nuova voce sintetica</p>")
            }
            transport.readStatus = 401
            if edit { await model.updateEditingEntry() } else { await model.createEntryForSelectedPatient() }
            XCTAssertEqual(transport.writes.count, 1, "The save was acknowledged before the unauthorized read.")
            XCTAssertEqual(model.connectionState, .sessionExpired)
            XCTAssertEqual(model.navigationAvailability, .locked)
            XCTAssertFalse(model.canCreateEntry)
            XCTAssertFalse(model.canUpdateEditingEntry)
            let count = transport.requests.count
            if edit { await model.updateEditingEntry() } else { await model.createEntryForSelectedPatient() }
            XCTAssertEqual(transport.requests.count, count, "An expired session must not dispatch another write.")
        }
    }

    @MainActor
    private func harness() throws -> (PairedPatientsWorkspaceModel, DiarySaveTransport) {
        let id = UUID().uuidString.lowercased()
        let transport = DiarySaveTransport()
        let endpoint = DiarySaveURLProtocol.register(transport)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = false
        configuration.protocolClasses = [DiarySaveURLProtocol.self]
        let session = URLSession(configuration: configuration)
        let source = HomeBasePatientsClient(configuration: .init(serverURLString: endpoint.absoluteString), session: session)
        let defaults = try XCTUnwrap(UserDefaults(suiteName: "DiarySaveTests.\(id)"))
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("DiarySaveTests-\(id)")
        let store = HomeBasePairedStore(userDefaults: defaults,
            keychainReader: { _, _ in .success(nil) }, keychainWriter: { _, _, _ in .success(()) },
            keychainDeleter: { _, _ in .success(()) })
        let cache = HomeBasePatientCacheStore(cacheDirectory: directory, keyProvider: { DiaryFixture.key })
        let model = PairedPatientsWorkspaceModel(pairedStore: store, cacheStore: cache, dataSourceFactory: { _ in source })
        model.serverURL = endpoint.absoluteString
        model.ambulatoryId = "scope-a"
        model.configurePairedOnlineForTests(
            credentials: .init(clientId: "diary-synthetic", clientToken: "diary-synthetic-token"),
            sessionCookie: "mediflow_session=diary-synthetic", operatorId: "operator-synthetic",
            masterKey: DiaryFixture.key, selectedPatient: DiaryFixture.patient, entries: [DiaryFixture.entry()])
        model.updateAvailableCapabilities(["network.replica.write-clinical-diary"])
        addTeardownBlock {
            transport.release()
            session.invalidateAndCancel()
            DiarySaveURLProtocol.remove(endpoint: endpoint)
            defaults.removePersistentDomain(forName: "DiarySaveTests.\(id)")
            if FileManager.default.fileExists(atPath: directory.path) { try FileManager.default.removeItem(at: directory) }
        }
        return (model, transport)
    }

    private func json(_ captured: DiaryCapturedRequest) throws -> [String: Any] {
        try XCTUnwrap(JSONSerialization.jsonObject(with: captured.body) as? [String: Any])
    }

    private func decrypted(_ captured: DiaryCapturedRequest, _ field: String) throws -> String {
        let sealed = try XCTUnwrap(try json(captured)[field] as? String)
        XCTAssertTrue(sealed.hasPrefix("ENC:"))
        return try XCTUnwrap(CryptoService.jsonDecodeString(try XCTUnwrap(CryptoService.decryptField(sealed, masterKey: DiaryFixture.key))))
    }
}

/* @Codex */
private enum DiaryFixture {
    static let key = SymmetricKey(data: Data(repeating: 19, count: 32))
    static let patient = HomeBasePatientDetail(
        id: "patient-a", firstName: "Paziente", lastName: "Sintetico", birthDate: nil, taxCode: "SYNTHETIC",
        address: nil, phone: nil, caregiver: nil, exemptions: nil, diagnoses: nil, monitoringProfile: nil,
        statusReason: nil, notes: nil, aiSummary: nil, documentInsights: nil, isAdi: false, isArchived: false,
        version: 1, ambulatoryId: "scope-a", createdAt: nil, updatedAt: nil)
    static func entry(id: String = "entry-a", version: Int = 1,
                      content: String = "<p>Voce <strong>sintetica</strong> iniziale</p>",
                      title: String = "Titolo sintetico", type: String = "note", attachments: String? = nil,
                      deletedAt: Date? = nil) -> HomeBaseEntrySummary {
        .init(id: id, patientId: "patient-a", type: type, title: title,
              date: Date(timeIntervalSince1970: 1), content: content, setting: nil, metadata: nil,
              attachments: attachments, deletedAt: deletedAt, deletionReason: nil, version: version, createdAt: nil, updatedAt: nil)
    }
}

private struct DiaryCapturedRequest {
    let request: URLRequest
    let body: Data
}

private final class DiarySaveTransport: @unchecked Sendable {
    private let lock = NSLock()
    private var captured: [DiaryCapturedRequest] = []
    var requests: [DiaryCapturedRequest] { lock.withLock { captured } }
    var writes: [DiaryCapturedRequest] { requests.filter { ["POST", "PUT"].contains($0.request.httpMethod ?? "") } }
    private var rows = [DiaryFixture.entry()]
    var entries: [HomeBaseEntrySummary] {
        get { lock.withLock { rows } }
        set { lock.withLock { rows = newValue } }
    }
    private var writeCode: Int?
    private var readCode: Int?
    var writeStatus: Int? {
        get { lock.withLock { writeCode } }
        set { lock.withLock { writeCode = newValue } }
    }
    var readStatus: Int? {
        get { lock.withLock { readCode } }
        set { lock.withLock { readCode = newValue } }
    }
    private var gate: (String, String?, XCTestExpectation)?
    private var held: DiarySaveURLProtocol?
    func holdNext(method: String, suffix: String? = nil) -> XCTestExpectation {
        lock.withLock {
            let started = XCTestExpectation(description: "Synthetic diary transport held")
            gate = (method, suffix, started)
            return started
        }
    }
    func release() {
        let pending = lock.withLock { let value = held; held = nil; return value }
        if let pending { respond(pending) }
    }
    func start(_ request: DiarySaveURLProtocol) {
        let shouldHold = lock.withLock {
            captured.append(.init(request: request.request, body: request.body))
            if let gate, request.request.httpMethod == gate.0,
               gate.1 == nil || request.request.url?.path.hasSuffix(gate.1!) == true {
                held = request
                self.gate = nil
                gate.2.fulfill()
                return true
            }
            return false
        }
        if !shouldHold { respond(request) }
    }
    private func respond(_ request: DiarySaveURLProtocol) {
        let method = request.request.httpMethod ?? "GET"
        let isWrite = method != "GET"
        if let status = isWrite ? writeStatus : readStatus {
            let data = status == 409 ? Data(#"{"error":"Conflict","code":"VERSION_CONFLICT","entity":"entry","recordId":"entry-a","expectedVersion":1,"currentVersion":2,"currentUpdatedAt":null,"currentState":"present","currentSnapshot":{"id":"entry-a","patientId":"patient-a","version":2,"updatedAt":null,"deletedAt":null}}"#.utf8) : Data()
            request.complete(status: status, data: data)
            return
        }
        do {
            let encoder = JSONEncoder()
            encoder.dateEncodingStrategy = .iso8601
            let path = request.request.url?.path ?? ""
            let data: Data
            if isWrite {
                let body = try JSONSerialization.jsonObject(with: request.body) as! [String: Any]
                let existing = entries.first ?? DiaryFixture.entry()
                let id = method == "POST" ? (body["id"] as! String) : existing.id
                entries = [DiaryFixture.entry(id: id, version: method == "POST" ? 1 : existing.version + 1,
                    content: body["content"] as? String ?? existing.content,
                    title: body["title"] as? String ?? existing.title,
                    type: body["type"] as? String ?? existing.type,
                    attachments: body["attachments"] as? String ?? existing.attachments)]
                let acknowledgement: [String: Any] = method == "POST" ? ["id": id, "version": 1] : ["success": true]
                data = try JSONSerialization.data(withJSONObject: acknowledgement)
            } else if path.hasSuffix("/patients/patient-a") {
                data = try encoder.encode(DiaryFixture.patient)
            } else if path.hasSuffix("/entries") {
                data = try encoder.encode(entries)
            } else { data = Data("[]".utf8) }
            request.complete(status: 200, data: data)
        } catch { request.client?.urlProtocol(request, didFailWithError: error) }
    }
}

private final class DiarySaveURLProtocol: URLProtocol, @unchecked Sendable {
    private static let lock = NSLock()
    private static var transports: [Int: DiarySaveTransport] = [:]
    private static var nextPort = 47000
    private(set) var body = Data()
    /* @Codex */
    static func register(_ transport: DiarySaveTransport) -> URL {
        lock.withLock {
            let port = nextPort
            nextPort += 1
            transports[port] = transport
            var endpoint = URLComponents()
            endpoint.scheme = "https"
            endpoint.host = "127.0.0.1"
            endpoint.port = port
            return endpoint.url!
        }
    }
    static func remove(endpoint: URL) { _ = lock.withLock { transports.removeValue(forKey: endpoint.port!) } }
    // @Codex Fail closed in URLProtocol even for unregistered requests; no network fallback.
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let transport = Self.lock.withLock {
            guard request.url?.scheme == "https", request.url?.host == "127.0.0.1",
                  let port = request.url?.port else { return nil as DiarySaveTransport? }
            return Self.transports[port]
        }
        guard let transport else { client?.urlProtocol(self, didFailWithError: URLError(.unsupportedURL)); return }
        if let data = request.httpBody { body = data }
        else if let stream = request.httpBodyStream {
            stream.open()
            defer { stream.close() }
            var buffer = [UInt8](repeating: 0, count: 4096)
            while true {
                let count = stream.read(&buffer, maxLength: buffer.count)
                guard count > 0 else { break }
                body.append(contentsOf: buffer.prefix(count))
            }
        }
        transport.start(self)
    }
    override func stopLoading() {}
    func complete(status: Int, data: Data) {
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil,
                                      headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }
}
