import CryptoKit
import Foundation
import MediFlowCore
import XCTest
@testable import MediFlowAppleShared

/* @Codex */
final class PairedPatientsNavigationTests: XCTestCase {
    @MainActor
    func testExistingPatientUsesScopedOrdinaryReadsBeforeReplacingTheChart() async throws {
        let (model, transport) = try harness()
        let started = transport.holdNextPatient()
        let read = Task { await model.openNavigationPatient(id: "patient-b", section: .documents, isCurrent: { true }) }
        await fulfillment(of: [started], timeout: 3)
        assertOriginalChart(model)
        XCTAssertFalse(model.isWorking, "The current draft remains editable during this optional read.")
        transport.releasePatient()
        let outcome = await read.value
        XCTAssertEqual(outcome, .opened)
        XCTAssertEqual(model.selectedPatient?.id, "patient-b")
        XCTAssertEqual(model.selectedPatient?.notes, "Profilo sintetico patient-b")
        XCTAssertEqual(model.activePatientSection, .documents)
        XCTAssertEqual(model.entries.map(\.patientId), ["patient-b"])
        let requests = transport.requests
        XCTAssertEqual(requests.count, 8)
        XCTAssertTrue(requests.allSatisfy { $0.httpMethod == "GET" })
        XCTAssertEqual(Set(requests.compactMap { request -> String? in
            guard let url = request.url else { return nil }
            return url.path + (url.query.map { "?" + $0 } ?? "")
        }), Set([
            "/api/v1/network/patients/patient-b",
            "/api/v1/network/patients/patient-b/entries?limit=100",
            "/api/v1/network/patients/patient-b/therapies?limit=100",
            "/api/v1/network/patients/patient-b/checkups?limit=100",
            "/api/v1/network/patients/patient-b/observations?limit=100",
            "/api/v1/network/service-prescriptions?patientId=patient-b",
            "/api/v1/network/service-prescription-items?patientId=patient-b",
            "/api/v1/network/prosthetic-prescriptions?patientId=patient-b"
        ]))
        XCTAssertTrue(requests.allSatisfy { $0.value(forHTTPHeaderField: "Cookie") == "mediflow_session=nav-synthetic; ambulatory_id=scope-a" })
        XCTAssertTrue(requests.allSatisfy { $0.value(forHTTPHeaderField: "x-mediflow-paired-client-id") == "nav-fixture" })
        XCTAssertTrue(requests.allSatisfy { $0.value(forHTTPHeaderField: "x-mediflow-paired-client-token") == "nav-fixture-token" })
        XCTAssertEqual(model.patients.map(\.id), ["patient-a"], "Routing never refreshes/resets the worklist.")
    }

    @MainActor
    func testDraftTypedWhileReadIsPendingKeepsItsContentAndStopsSubresourceReads() async throws {
        let (model, transport) = try harness()
        let started = transport.holdNextPatient()
        let read = Task { await model.openNavigationPatient(id: "patient-b", section: .diary, isCurrent: { true }) }
        await fulfillment(of: [started], timeout: 3)
        model.newEntryTitle = "Bozza sintetica iniziata durante la lettura"
        model.newEntryEditorDocument = .load(html: "<p>Contenuto sintetico da conservare</p>")
        let draft = model.newEntryEditorDocument
        transport.releasePatient()
        let outcome = await read.value
        XCTAssertEqual(outcome, .superseded)
        assertOriginalChart(model)
        XCTAssertEqual(model.newEntryTitle, "Bozza sintetica iniziata durante la lettura")
        XCTAssertEqual(model.newEntryEditorDocument, draft)
        XCTAssertEqual(transport.requests.count, 1)
    }

    @MainActor
    func testDraftChangedAndUndoneStillSupersedesTheOriginalIntent() async throws {
        let (model, transport) = try harness()
        let started = transport.holdNextPatient()
        let read = Task { await model.openNavigationPatient(id: "patient-b", section: .therapies, isCurrent: { true }) }
        await fulfillment(of: [started], timeout: 3)
        model.newCheckupTitle = "Modifica sintetica"
        model.newCheckupTitle = ""
        XCTAssertEqual(model.navigationAvailability, .ready)
        transport.releasePatient()
        let outcome = await read.value
        XCTAssertEqual(outcome, .superseded)
        assertOriginalChart(model)
    }

    @MainActor
    func testExistingDraftsIncludingDateOnlyAndChoiceOnlyBlockBeforeAnyRead() async throws {
        let changes: [(PairedPatientsWorkspaceModel) -> Void] = [
            { $0.newEntryEditorDocument = .load(html: "<p>Bozza sintetica</p>") },
            { $0.newEntryAttachmentIds = ["attachment-synthetic"] },
            { $0.startCreatingPatient(); $0.newPatientBirthDate = Date(timeIntervalSince1970: 1) },
            { $0.newTherapyStartDate = Date(timeIntervalSince1970: 1) },
            { $0.newCheckupDate = Date(timeIntervalSince1970: 1) },
            { $0.newObservationObservedAt = Date(timeIntervalSince1970: 1) },
            { $0.newServicePrescribedAt = Date(timeIntervalSince1970: 1) },
            { $0.newProstheticPrescribedAt = Date(timeIntervalSince1970: 1) },
            { $0.newServiceHasReportReceivedAt = true },
            { $0.newEntryType = .visit },
            { $0.newProstheticNotes = "Nota sintetica" },
            { $0.isCreatingPatient = true }
        ]
        for change in changes {
            let (model, transport) = try harness()
            XCTAssertEqual(model.navigationAvailability, .ready)
            change(model)
            let result = await model.openNavigationPatient(id: "patient-b", section: .overview, isCurrent: { true })
            XCTAssertEqual(result, .blocked)
            XCTAssertTrue(transport.requests.isEmpty)
            assertOriginalChart(model)
        }
    }

    @MainActor
    func testClosedPatientCreationDoesNotLeaveNavigationPermanentlyBusy() async throws {
        for save in [false, true] {
            let (model, transport) = try harness()
            model.updateAvailableCapabilities(["network.replica.write-patient-lifecycle"])
            model.startCreatingPatient()
            model.newPatientFirstName = "Paziente"
            model.newPatientLastName = "Sintetico"
            model.newPatientTaxCode = "SYNTHETIC-CREATE"
            model.newPatientHasBirthDate = true
            model.newPatientBirthDate = Date(timeIntervalSince1970: 1)
            model.newPatientAddress = "Indirizzo sintetico"
            XCTAssertEqual(model.navigationAvailability, .busy)
            let blocked = await model.openNavigationPatient(id: "patient-b", section: .diary, isCurrent: { true })
            XCTAssertEqual(blocked, .blocked)
            XCTAssertTrue(transport.requests.isEmpty)
            if save {
                XCTAssertTrue(model.canCreatePatient)
                await model.createPatient()
                XCTAssertNil(model.errorMessage)
                XCTAssertEqual(transport.requests.filter { $0.httpMethod == "POST" }.count, 1)
            } else {
                model.cancelCreatingPatient()
                XCTAssertTrue(transport.requests.isEmpty)
            }
            XCTAssertFalse(model.isCreatingPatient)
            XCTAssertEqual(model.newPatientTaxCode, "SYNTHETIC-CREATE", "The ordinary form lifecycle retains its values.")
            XCTAssertEqual(model.navigationAvailability, .ready)
            let before = transport.requests.count
            let result = await model.openNavigationPatient(id: "patient-b", section: .diary, isCurrent: { true })
            XCTAssertEqual(result, .opened)
            XCTAssertEqual(model.selectedPatient?.id, "patient-b")
            XCTAssertEqual(transport.requests.count - before, 8)
            XCTAssertTrue(transport.requests.dropFirst(before).allSatisfy { $0.httpMethod == "GET" })
        }
    }

    @MainActor
    func testPatientCreationStartsWithAnEmptyFormButSavingStillRequiresFieldsAndAnIdleCapability() async throws {
        let (model, transport) = try harness()

        XCTAssertFalse(model.canStartCreatingPatient)

        model.updateAvailableCapabilities(["network.replica.write-patient-lifecycle"])
        XCTAssertTrue(model.canStartCreatingPatient)
        XCTAssertFalse(model.canCreatePatient)
        model.startCreatingPatient()
        XCTAssertTrue(model.isCreatingPatient)
        XCTAssertFalse(model.canCreatePatient)

        model.newPatientFirstName = "Paziente"
        model.newPatientLastName = "Sintetico"
        model.newPatientTaxCode = "SYNTHETIC-CREATE"
        XCTAssertTrue(model.canCreatePatient)

        model.cancelCreatingPatient()
        let started = transport.holdNextPatient(pathSuffix: "/patients/patient-a/attachments")
        let attachmentRead = Task { await model.loadSelectedPatientAttachments() }
        await fulfillment(of: [started], timeout: 3)
        XCTAssertTrue(model.isWorking)
        XCTAssertFalse(model.canStartCreatingPatient)
        transport.releasePatient()
        await attachmentRead.value
    }

    @MainActor
    func testCancelledProfileEditorDoesNotTreatItsRetainedInputAsAnActiveDraft() async throws {
        let (model, transport) = try harness()
        model.startEditingPatient()
        model.newDiagnosisCode = "SYNTHETIC"
        model.newDiagnosisDescription = "Descrizione sintetica"
        model.newExemptionCode = "SYNTHETIC"
        XCTAssertEqual(model.navigationAvailability, .busy)
        model.cancelEditingPatient()
        XCTAssertEqual(model.navigationAvailability, .ready)
        let result = await model.openNavigationPatient(id: "patient-b", section: .overview, isCurrent: { true })
        XCTAssertEqual(result, .opened)
        XCTAssertTrue(transport.requests.allSatisfy { $0.httpMethod == "GET" })
    }

    @MainActor
    func test404AndNetworkFailureKeepTheOldChartAndSection() async throws {
        for mode in [NavigationTransport.Mode.status(404), .unreachable] {
            let (model, transport) = try harness()
            transport.mode = mode
            let result = await model.openNavigationPatient(id: "missing-patient", section: .diary, isCurrent: { true })
            XCTAssertEqual(result, mode == .unreachable ? .failed : .notFound)
            assertOriginalChart(model)
            XCTAssertEqual(transport.requests.count, 1)
            XCTAssertNil(model.cachedPatientProfile, "A failed link never substitutes an offline profile.")
        }
    }

    @MainActor
    func testLockWhilePendingDoesNotReopenTheTarget() async throws {
        let (model, transport) = try harness()
        let started = transport.holdNextPatient()
        let read = Task { await model.openNavigationPatient(id: "patient-b", section: .clinical, isCurrent: { true }) }
        await fulfillment(of: [started], timeout: 3)
        await model.lockSessionNow()
        XCTAssertEqual(model.navigationAvailability, .locked)
        transport.releasePatient()
        let outcome = await read.value
        XCTAssertEqual(outcome, .superseded)
        XCTAssertNil(model.selectedPatient)
        XCTAssertTrue(model.entries.isEmpty)
        XCTAssertEqual(model.connectionState, .sessionExpired)
        XCTAssertEqual(transport.requests.filter { $0.httpMethod == "GET" }.count, 1)
    }

    @MainActor
    func testScopeChangeKeepsTheOrdinaryInvalidationAndDoesNotReviveAPreviousChart() async throws {
        let (model, transport) = try harness()
        let started = transport.holdNextPatient()
        let read = Task { await model.openNavigationPatient(id: "patient-b", section: .scales, isCurrent: { true }) }
        await fulfillment(of: [started], timeout: 3)
        model.ambulatoryId = "scope-b"
        XCTAssertNil(model.selectedPatient)
        transport.releasePatient()
        let outcome = await read.value
        XCTAssertEqual(outcome, .superseded)
        XCTAssertNil(model.selectedPatient, "Scope changes keep their existing privacy invalidation.")
        XCTAssertTrue(model.entries.isEmpty)
        XCTAssertEqual(model.ambulatoryId, "scope-b")
        XCTAssertEqual(transport.requests.count, 1)
    }

    @MainActor
    func testSupersededRouterAndManualSectionChangeKeepCurrentWork() async throws {
        for manual in [false, true] {
            let (model, transport) = try harness()
            var current = true
            let started = transport.holdNextPatient()
            let read = Task { await model.openNavigationPatient(id: "patient-b", section: .documents, isCurrent: { current }) }
            await fulfillment(of: [started], timeout: 3)
            if manual { model.activePatientSection = .diary } else { current = false }
            transport.releasePatient()
            let outcome = await read.value
            XCTAssertEqual(outcome, .superseded)
            XCTAssertEqual(model.selectedPatient?.id, "patient-a")
            XCTAssertEqual(model.activePatientSection, manual ? .diary : .overview)
            XCTAssertEqual(model.entries.map(\.id), ["entry-patient-a"])
            XCTAssertEqual(transport.requests.count, 1)
        }
    }

    @MainActor
    func testUnauthorizedReadRetainsTheOrdinarySessionLock() async throws {
        let (model, transport) = try harness()
        transport.mode = .status(401)
        let result = await model.openNavigationPatient(id: "patient-b", section: .documents, isCurrent: { true })
        XCTAssertEqual(result, .failed)
        XCTAssertEqual(model.navigationAvailability, .locked)
        XCTAssertEqual(model.connectionState, .sessionExpired)
        XCTAssertNil(model.selectedPatient)
        XCTAssertTrue(model.entries.isEmpty)
        let count = transport.requests.count
        let retry = await model.openNavigationPatient(id: "patient-b", section: .documents, isCurrent: { true })
        XCTAssertEqual(retry, .blocked)
        XCTAssertEqual(transport.requests.count, count)
    }

    @MainActor
    func testAnExistingOperationBlocksNavigationWithoutReplacingItsRead() async throws {
        let (model, transport) = try harness()
        let started = transport.holdNextPatient(pathSuffix: "/patients/patient-a/attachments")
        let attachmentRead = Task { await model.loadSelectedPatientAttachments() }
        await fulfillment(of: [started], timeout: 3)
        XCTAssertTrue(model.isWorking)
        let result = await model.openNavigationPatient(id: "patient-b", section: .documents, isCurrent: { true })
        XCTAssertEqual(result, .blocked)
        assertOriginalChart(model)
        XCTAssertEqual(transport.requests.count, 1)
        transport.releasePatient()
        await attachmentRead.value
        XCTAssertFalse(model.isWorking)
        XCTAssertEqual(model.attachmentsLoadState, .loaded)
    }

    @MainActor
    func testUnresolvedConflictBlocksNavigationAfterTheEditorHasClosed() async throws {
        let (model, transport) = try harness()
        model.startEditingEntry(NavigationFixture.entry("patient-a"))
        XCTAssertTrue(model.isEditingEntry)
        model.editEntryTitle = "Revisione sintetica"
        transport.mode = .conflict
        await model.updateEditingEntry()
        XCTAssertNotNil(model.pendingConflict)
        model.cancelEditingEntry()
        XCTAssertFalse(model.isEditingEntry)
        let before = transport.requests.count
        let result = await model.openNavigationPatient(id: "patient-b", section: .documents, isCurrent: { true })
        XCTAssertEqual(result, .blocked)
        XCTAssertNotNil(model.pendingConflict)
        XCTAssertEqual(transport.requests.count, before)
        assertOriginalChart(model)
    }

    @MainActor
    private func assertOriginalChart(_ model: PairedPatientsWorkspaceModel, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertEqual(model.selectedPatient?.id, "patient-a", file: file, line: line)
        XCTAssertEqual(model.selectedPatient?.notes, "Profilo sintetico patient-a", file: file, line: line)
        XCTAssertEqual(model.activePatientSection, .overview, file: file, line: line)
        XCTAssertEqual(model.entries.map(\.id), ["entry-patient-a"], file: file, line: line)
    }

    @MainActor
    private func harness() throws -> (PairedPatientsWorkspaceModel, NavigationTransport) {
        let id = UUID().uuidString.lowercased()
        let transport = NavigationTransport()
        let endpoint = NavigationURLProtocol.register(transport)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = false
        configuration.protocolClasses = [NavigationURLProtocol.self]
        let session = URLSession(configuration: configuration)
        let source = HomeBasePatientsClient(
            configuration: HomeBaseConnectionConfiguration(serverURLString: endpoint.absoluteString), session: session)
        let defaults = try XCTUnwrap(UserDefaults(suiteName: "NavigationTests.\(id)"))
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("NavigationTests-\(id)")
        let store = HomeBasePairedStore(userDefaults: defaults,
            keychainReader: { _, _ in .success(nil) }, keychainWriter: { _, _, _ in .success(()) },
            keychainDeleter: { _, _ in .success(()) })
        let cache = HomeBasePatientCacheStore(cacheDirectory: directory, keyProvider: { NavigationFixture.key })
        let model = PairedPatientsWorkspaceModel(pairedStore: store, cacheStore: cache, dataSourceFactory: { _ in source })
        model.serverURL = endpoint.absoluteString
        model.ambulatoryId = "scope-a"
        model.configurePairedOnlineForTests(
            credentials: HomeBasePairedCredentials(clientId: "nav-fixture", clientToken: "nav-fixture-token"),
            sessionCookie: "mediflow_session=nav-synthetic", operatorId: "operator-synthetic",
            masterKey: NavigationFixture.key, patients: [NavigationFixture.summary()],
            selectedPatient: NavigationFixture.detail("patient-a"), entries: [NavigationFixture.entry("patient-a")]
        )
        model.updateAvailableCapabilities(["network.replica.write-clinical-diary", "network.replica.readonly-documents"])
        addTeardownBlock {
            session.invalidateAndCancel()
            NavigationURLProtocol.remove(endpoint: endpoint)
            defaults.removePersistentDomain(forName: "NavigationTests.\(id)")
            if FileManager.default.fileExists(atPath: directory.path) { try FileManager.default.removeItem(at: directory) }
        }
        return (model, transport)
    }
}

/* @Codex */
private enum NavigationFixture {
    static let key = SymmetricKey(data: Data(repeating: 7, count: 32))
    static func summary() -> HomeBasePatientSummary {
        HomeBasePatientSummary(id: "patient-a", firstName: "Paziente", lastName: "Sintetico", birthDate: nil,
            taxCode: "SYNTHETIC-A", isAdi: false, isArchived: false, version: 1,
            updatedAt: Date(timeIntervalSince1970: 1), deletedAt: nil, deletionReason: nil)
    }
    static func detail(_ id: String) -> HomeBasePatientDetail {
        HomeBasePatientDetail(id: id, firstName: "Paziente", lastName: "Sintetico", birthDate: nil,
            taxCode: "SYNTHETIC", address: nil, phone: nil, caregiver: nil, exemptions: nil,
            diagnoses: nil, monitoringProfile: nil, statusReason: nil, notes: "Profilo sintetico \(id)",
            aiSummary: nil, documentInsights: nil, isAdi: false, isArchived: false,
            version: 1, ambulatoryId: "scope-a", createdAt: nil, updatedAt: nil)
    }
    static func entry(_ id: String) -> HomeBaseEntrySummary {
        HomeBaseEntrySummary(id: "entry-\(id)", patientId: id, type: "note", title: "Nota sintetica",
            date: Date(timeIntervalSince1970: 1), content: "Contenuto sintetico", setting: nil,
            metadata: nil, attachments: nil, deletedAt: nil, deletionReason: nil,
            version: 1, createdAt: nil, updatedAt: nil)
    }
}

private final class NavigationTransport: @unchecked Sendable {
    enum Mode: Equatable { case online, status(Int), unreachable, conflict }
    private let lock = NSLock()
    private var currentMode: Mode = .online
    var mode: Mode {
        get { lock.withLock { currentMode } }
        set { lock.withLock { currentMode = newValue } }
    }
    private var captured: [URLRequest] = []
    var requests: [URLRequest] { lock.withLock { captured } }
    private var expectation: XCTestExpectation?
    private var held: NavigationURLProtocol?
    private var heldPathSuffix = "/patients/patient-b"
    func holdNextPatient(pathSuffix: String = "/patients/patient-b") -> XCTestExpectation {
        lock.withLock {
            let expectation = XCTestExpectation(description: "Ordinary synthetic patient read held")
            self.expectation = expectation
            heldPathSuffix = pathSuffix
            return expectation
        }
    }
    func releasePatient() {
        let request = lock.withLock { let value = held; held = nil; return value }
        if let request { respond(request) }
    }
    func start(_ request: NavigationURLProtocol) {
        let hold = lock.withLock {
            captured.append(request.request)
            if request.request.url?.path.hasSuffix(heldPathSuffix) == true, let expectation {
                held = request
                self.expectation = nil
                expectation.fulfill()
                return true
            }
            return false
        }
        if !hold { respond(request) }
    }
    private func respond(_ request: NavigationURLProtocol) {
        if request.request.url?.path.hasSuffix("/logout") == true {
            request.complete(status: 200, data: Data(#"{"success":true}"#.utf8))
            return
        }
        switch mode {
        case .conflict:
            request.complete(status: 409, data: Data(#"""
            {"error":"Conflict","code":"VERSION_CONFLICT","entity":"entry","recordId":"entry-patient-a",
             "expectedVersion":1,"currentVersion":2,"currentUpdatedAt":"2026-09-01T12:00:00.000Z",
             "currentState":"present","currentSnapshot":{"id":"entry-patient-a","patientId":"patient-a",
             "version":2,"updatedAt":"2026-09-01T12:00:00.000Z","deletedAt":null}}
            """#.utf8))
        case .status(let code): request.complete(status: code, data: Data())
        case .unreachable: request.client?.urlProtocol(request, didFailWithError: URLError(.notConnectedToInternet))
        case .online:
            do {
                let encoder = JSONEncoder()
                encoder.dateEncodingStrategy = .iso8601
                let path = request.request.url?.path ?? ""
                let data: Data
                if path.hasSuffix("/patients"), request.request.httpMethod == "POST" {
                    data = Data(#"{"id":"patient-created-synthetic","version":1}"#.utf8)
                }
                else if path.hasSuffix("/patients/patient-b") { data = try encoder.encode(NavigationFixture.detail("patient-b")) }
                else if path.hasSuffix("/entries") { data = try encoder.encode([NavigationFixture.entry("patient-b")]) }
                else { data = Data("[]".utf8) }
                request.complete(status: 200, data: data)
            } catch { request.client?.urlProtocol(request, didFailWithError: error) }
        }
    }
}

private final class NavigationURLProtocol: URLProtocol, @unchecked Sendable {
    private static let lock = NSLock()
    private static var transports: [Int: NavigationTransport] = [:]
    private static var nextPort = 46000
    /* @Codex */
    static func register(_ transport: NavigationTransport) -> URL {
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
    // @Codex Every request stays in this protocol, including unknown fixture endpoints; no socket is opened.
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let transport = Self.lock.withLock {
            guard request.url?.scheme == "https", request.url?.host == "127.0.0.1",
                  let port = request.url?.port else { return nil as NavigationTransport? }
            return Self.transports[port]
        }
        guard let transport else {
            client?.urlProtocol(self, didFailWithError: URLError(.unsupportedURL))
            return
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
