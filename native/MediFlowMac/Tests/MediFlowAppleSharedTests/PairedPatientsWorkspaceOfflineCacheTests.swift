// @Codex
import CryptoKit
import Foundation
import XCTest
@testable import MediFlowAppleShared

/* @Codex */
final class PairedPatientsWorkspaceOfflineCacheTests: XCTestCase {
    @MainActor func testOnlineReadPersistsOnlyProfileAndNetworkLossRestoresReadOnlyWithoutRequests() async throws {
        let (model, store, transport, context, _) = try harness()
        await model.loadPatients()
        await model.loadPatient(OfflineCacheFixture.summary())
        XCTAssertEqual(model.selectedPatient?.id, "p1")
        XCTAssertNotNil(try store.loadPatientDetail(patientID: "p1", context: context)?.patient)
        transport.setMode(.unreachable)
        await model.loadPatients()
        XCTAssertEqual(model.connectionState, .pairedOfflineDegraded)
        XCTAssertNotNil(model.cacheMetadata)
        XCTAssertNil(model.errorMessage)
        let before = transport.requestCount
        await model.loadPatient(OfflineCacheFixture.summary())
        await model.savePatient()
        model.newPatientFirstName = "Paziente"
        model.newPatientLastName = "Sintetico"
        model.newPatientTaxCode = "SYNTHETIC-P2"
        XCTAssertFalse(model.canCreatePatient)
        await model.createPatient()
        XCTAssertEqual(transport.requestCount, before)
        XCTAssertEqual(model.cachedPatientProfile?.notes, "Nota solo sintetica")
        XCTAssertNil(model.cachedPatientProfile?.aiSummary)
        XCTAssertNil(model.selectedPatient)
        XCTAssertFalse(model.canArchivePatient)
        XCTAssertFalse(model.canCreateEntry)
        XCTAssertFalse(model.canLoadAttachments)
        XCTAssertTrue(model.entries.isEmpty && model.therapies.isEmpty && model.attachments.isEmpty)
    }

    @MainActor func testExpiryRemovesVisiblePHIButRetainsReasonAndTimestamp() async throws {
        let (model, store, transport, context, clock) = try harness()
        try seed(store, context: context)
        transport.setMode(.unreachable)
        await model.loadPatients()
        await model.loadPatient(OfflineCacheFixture.summary())
        XCTAssertNotNil(model.cachedPatientProfile)
        clock.advance(61)
        model.refreshOfflineCacheIfNeeded()
        XCTAssertTrue(model.cacheIsStale)
        XCTAssertEqual(model.cacheMetadata?.expiryReason, .ttlExceeded)
        XCTAssertEqual(model.cacheMetadata?.patientCount, 1)
        XCTAssertTrue(model.patients.isEmpty)
        XCTAssertNil(model.cachedPatientProfile)
        XCTAssertNil(model.selectedPatientID)
        XCTAssertFalse(model.canArchivePatient)
        XCTAssertTrue(model.reconciliationLine.contains("scaduta"))
    }

    @MainActor func testUnauthorizedReadCannotBeMaskedByCacheOrReviveOnLaterNetworkLoss() async throws {
        for status in [401, 403] {
            let (model, store, transport, context, _) = try harness()
            try seed(store, context: context)
            transport.setMode(.status(status))
            await model.loadPatients()
            XCTAssertNil(model.cacheMetadata)
            XCTAssertNil(model.cachedPatientProfile)
            XCTAssertNotNil(model.errorMessage)
            XCTAssertNil(try store.loadPatientList(context: context))
            transport.setMode(.unreachable)
            await model.loadPatients()
            XCTAssertNil(model.cacheMetadata)
            XCTAssertTrue(model.patients.isEmpty)
        }
    }

    @MainActor func testFailedDiskInvalidationCannotReviveDeniedCacheUntilSuccessfulOnlineRefresh() async throws {
        let (model, store, transport, context, _) = try harness(fileManager: OfflineCacheDeleteFailureFileManager())
        try seed(store, context: context)
        transport.setMode(.status(403))
        await model.loadPatients()
        XCTAssertNotNil(try store.loadPatientList(context: context)) // Simulated delete failure leaves bytes behind.
        transport.setMode(.unreachable)
        await model.loadPatients()
        XCTAssertNil(model.cacheMetadata)
        XCTAssertTrue(model.patients.isEmpty)
        transport.setMode(.online)
        await model.loadPatients()
        transport.setMode(.unreachable)
        await model.loadPatients()
        XCTAssertNotNil(model.cacheMetadata) // Only a newly authorized read and successful save removes the fence.
    }

    @MainActor func testRevocationDuringScopeReadCannotCreateOrRetainOfflineSnapshot() async throws {
        for status in [401, 403] {
            let (model, store, transport, context, _) = try harness()
            try seed(store, context: context)
            transport.setMode(.scopeDenied(status))
            await model.loadPatients()
            XCTAssertNil(try store.loadPatientList(context: context))
            XCTAssertTrue(model.patients.isEmpty)
            XCTAssertNil(model.cacheMetadata)
            XCTAssertNotNil(model.errorMessage)
        }
    }

    @MainActor func testContextChangesAndLockImmediatelyRemoveCachedPresentation() async throws {
        let changes: [(PairedPatientsWorkspaceModel) -> Void] = [
            { $0.ambulatoryId = "scope-b" }, { $0.tlsPin = String(repeating: "b", count: 64) },
            { $0.serverURL = "https://127.0.0.1:3443" }, { $0.pairedClientToken = "rotated" },
            { $0.pairedClientId = "another-device" },
            { $0.configurePairedOnlineForTests(operatorId: "another-operator", masterKey: OfflineCacheFixture.key) }
        ]
        for change in changes {
            let (model, store, transport, context, _) = try harness()
            try seed(store, context: context)
            transport.setMode(.unreachable)
            await model.loadPatients()
            await model.loadPatient(OfflineCacheFixture.summary())
            XCTAssertNotNil(model.cachedPatientProfile)
            change(model)
            XCTAssertNil(model.cachedPatientProfile)
            XCTAssertNil(model.cacheMetadata)
            XCTAssertTrue(model.patients.isEmpty)
        }
        let (model, store, transport, context, _) = try harness()
        try seed(store, context: context)
        transport.setMode(.unreachable)
        await model.loadPatients()
        await model.loadPatient(OfflineCacheFixture.summary())
        await model.lockSessionNow()
        XCTAssertNil(model.cacheMetadata)
        XCTAssertNil(model.cachedPatientProfile)
        XCTAssertTrue(model.patients.isEmpty)
        XCTAssertEqual(model.connectionState, .sessionExpired)
    }

    @MainActor func testNoFallbackWithoutUnlockedOperatorAndNoColdStartRestore() async throws {
        let (model, _, transport, _, _) = try harness(authenticate: false, seedBeforeInit: true)
        XCTAssertTrue(model.patients.isEmpty)
        XCTAssertNil(model.cacheMetadata)
        model.configurePairedOnlineForTests(operatorId: "operator-fixture", masterKey: nil)
        transport.setMode(.unreachable)
        await model.loadPatients()
        XCTAssertNil(model.cacheMetadata)
        XCTAssertTrue(model.patients.isEmpty)
        XCTAssertEqual(model.connectionState, .pairedOfflineDegraded)
    }

    @MainActor func testMissingProfileIsExplicitAndDoesNotIssueOfflineDetailRequests() async throws {
        let (model, store, transport, context, _) = try harness()
        try store.savePatientList([OfflineCacheFixture.summary()], context: context)
        transport.setMode(.unreachable)
        await model.loadPatients()
        let count = transport.requestCount
        await model.loadPatient(OfflineCacheFixture.summary())
        XCTAssertEqual(transport.requestCount, count)
        XCTAssertNil(model.selectedPatient)
        XCTAssertNil(model.cachedPatientProfile)
        XCTAssertTrue(model.statusMessage?.contains("non disponibile nella cache") == true)
    }

    @MainActor func testLockedFieldIsDistinctFromAbsentField() async throws {
        let (model, store, transport, context, _) = try harness()
        let otherKey = SymmetricKey(data: Data(repeating: 3, count: 32))
        let notes = try XCTUnwrap(CryptoService.encryptField("Nota solo sintetica", masterKey: otherKey))
        try store.savePatientList([OfflineCacheFixture.summary()], context: context)
        try store.savePatientDetail(OfflineCacheFixture.detail(notes: notes), context: context)
        transport.setMode(.unreachable)
        await model.loadPatients()
        await model.loadPatient(OfflineCacheFixture.summary())
        XCTAssertNil(model.cachedPatientProfile?.notes)
        XCTAssertEqual(model.cachedProfileLockedFields, ["Note"])
    }

    @MainActor func testLateListAfterScopeChangesAndReturnsCannotPublishOrSave() async throws {
        let (model, store, transport, context, _) = try harness()
        let started = expectation(description: "synthetic list held")
        transport.holdNextList(started)
        let load = Task { await model.loadPatients() }
        await fulfillment(of: [started], timeout: 5)
        model.ambulatoryId = "scope-b"
        model.ambulatoryId = "scope-a"
        transport.releaseList()
        await load.value
        XCTAssertTrue(model.patients.isEmpty)
        XCTAssertNil(try store.loadPatientList(context: context))
        XCTAssertFalse(model.isWorking)
    }

    @MainActor func testFallbackAllowlistExcludesTrustContractAndHTTPFailures() {
        XCTAssertTrue(PairedPatientsWorkspaceModel.permitsCacheFallback(for: HomeBaseClientError.transport(.timeout)))
        XCTAssertTrue(PairedPatientsWorkspaceModel.permitsCacheFallback(for: HomeBaseClientError.transport(.unreachable)))
        for error in [HomeBaseClientError.transport(.tlsHandshakeFailed), .transport(.other(-1)),
                      .httpStatus(401, nil), .httpStatus(403, nil), .httpStatus(404, nil),
                      .httpStatus(500, nil), .contract, .insecureTransport, .missingSessionCookie] {
            XCTAssertFalse(PairedPatientsWorkspaceModel.permitsCacheFallback(for: error))
        }
    }

    private func seed(_ store: HomeBasePatientCacheStore, context: HomeBasePatientCacheContext) throws {
        try store.savePatientList([OfflineCacheFixture.summary()], context: context)
        try store.savePatientDetail(OfflineCacheFixture.detail(), context: context)
    }

    @MainActor private func harness(authenticate: Bool = true, seedBeforeInit: Bool = false, fileManager: FileManager = .default) throws ->
        (PairedPatientsWorkspaceModel, HomeBasePatientCacheStore, OfflineCacheTransport, HomeBasePatientCacheContext, OfflineCacheClock) {
        let id = UUID().uuidString
        let fixtureID = id.lowercased()
        let context = OfflineCacheFixture.context(server: "https://localhost/" + fixtureID)
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("OfflineModel-\(id)")
        let clock = OfflineCacheClock()
        let store = HomeBasePatientCacheStore(fileManager: fileManager, cacheDirectory: directory, keyProvider: { OfflineCacheFixture.key },
            now: { clock.now }, maxCacheAge: 60)
        if seedBeforeInit { try seed(store, context: context) }
        let transport = OfflineCacheTransport()
        OfflineCacheURLProtocol.register(transport, fixtureID: fixtureID)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = false
        configuration.protocolClasses = [OfflineCacheURLProtocol.self]
        let session = URLSession(configuration: configuration)
        let source = HomeBasePatientsClient(configuration: HomeBaseConnectionConfiguration(serverURLString: context.serverURL), session: session)
        let defaults = UserDefaults(suiteName: id)!
        let pairedStore = HomeBasePairedStore(userDefaults: defaults,
            keychainReader: { _, _ in .success(nil) }, keychainWriter: { _, _, _ in .success(()) },
            keychainDeleter: { _, _ in .success(()) })
        let model = PairedPatientsWorkspaceModel(pairedStore: pairedStore, cacheStore: store, dataSourceFactory: { _ in source })
        model.serverURL = context.serverURL
        model.tlsPin = context.tlsPin
        model.ambulatoryId = "scope-a"
        if authenticate {
            model.configurePairedOnlineForTests(
                credentials: HomeBasePairedCredentials(clientId: "paired-fixture", clientToken: "paired-token-fixture"),
                sessionCookie: "sid=fixture", operatorId: "operator-fixture", masterKey: OfflineCacheFixture.key)
        }
        addTeardownBlock {
            session.invalidateAndCancel()
            OfflineCacheURLProtocol.remove(fixtureID: fixtureID)
            defaults.removePersistentDomain(forName: id)
            if FileManager.default.fileExists(atPath: directory.path) { try FileManager.default.removeItem(at: directory) }
        }
        return (model, store, transport, context, clock)
    }
}

/* @Codex */
private final class OfflineCacheClock: @unchecked Sendable {
    private let lock = NSLock()
    private var date = Date()
    var now: Date { lock.withLock { date } }
    func advance(_ seconds: TimeInterval) { lock.withLock { date = date.addingTimeInterval(seconds) } }
}

/* @Codex */
private final class OfflineCacheTransport: @unchecked Sendable {
    enum Mode { case online, unreachable, status(Int), scopeDenied(Int) }
    private let lock = NSLock()
    private var mode: Mode = .online
    private var count = 0
    private var held: OfflineCacheURLProtocol?
    private var started: XCTestExpectation?
    var requestCount: Int { lock.withLock { count } }
    func setMode(_ value: Mode) { lock.withLock { mode = value } }
    func holdNextList(_ expectation: XCTestExpectation) { lock.withLock { started = expectation } }
    func releaseList() {
        let request = lock.withLock { let value = held; held = nil; return value }
        if let request { respond(request) }
    }
    func start(_ request: OfflineCacheURLProtocol) {
        let shouldHold = lock.withLock {
            count += 1
            if request.request.url?.path.hasSuffix("/patients") == true, let started {
                held = request
                self.started = nil
                started.fulfill()
                return true
            }
            return false
        }
        if !shouldHold { respond(request) }
    }
    private func respond(_ request: OfflineCacheURLProtocol) {
        let mode = lock.withLock { self.mode } // @Codex: Explicit property avoids initializer shadowing.
        switch mode {
        case .unreachable: request.client?.urlProtocol(request, didFailWithError: URLError(.notConnectedToInternet))
        case .status(let status): request.complete(status: status, data: Data())
        case .online, .scopeDenied:
            if case .scopeDenied(let status) = mode, request.request.url?.path.hasSuffix("/ambulatories") == true {
                request.complete(status: status, data: Data())
                return
            }
            do {
                let encoder = JSONEncoder()
                encoder.dateEncodingStrategy = .iso8601
                let path = request.request.url!.path
                let data: Data
                if path.hasSuffix("/patients") {
                    data = try encoder.encode([OfflineCacheFixture.summary()])
                } else if path.hasSuffix("/patients/p1") {
                    let notes = try XCTUnwrap(CryptoService.encryptField("Nota solo sintetica", masterKey: OfflineCacheFixture.key))
                    data = try encoder.encode(OfflineCacheFixture.detail(notes: notes))
                } else { data = Data("[]".utf8) }
                request.complete(status: 200, data: data)
            } catch { request.client?.urlProtocol(request, didFailWithError: error) }
        }
    }
}

/* @Codex */
private final class OfflineCacheURLProtocol: URLProtocol {
    private static let registryLock = NSLock()
    private static var transports: [String: OfflineCacheTransport] = [:]
    static func register(_ transport: OfflineCacheTransport, fixtureID: String) { registryLock.withLock { transports[fixtureID] = transport } }
    static func remove(fixtureID: String) { _ = registryLock.withLock { transports.removeValue(forKey: fixtureID) } }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let transport = Self.registryLock.withLock { Self.transports[request.url?.pathComponents.dropFirst().first ?? ""] }
        guard let transport else { client?.urlProtocol(self, didFailWithError: URLError(.unsupportedURL)); return }
        transport.start(self)
    }
    override func stopLoading() {}
    func complete(status: Int, data: Data) {
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }
}

/* @Codex */
private final class OfflineCacheDeleteFailureFileManager: FileManager, @unchecked Sendable {
    override func removeItem(at URL: URL) throws { throw CocoaError(.fileWriteNoPermission) }
}
