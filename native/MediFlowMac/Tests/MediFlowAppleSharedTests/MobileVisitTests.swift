import CryptoKit
import Foundation
import XCTest
@testable import MediFlowAppleShared

@MainActor
final class MobileVisitTests: XCTestCase {
    private var directory: URL!
    private let key = SymmetricKey(size: .bits256)
    private let instant = Date(timeIntervalSince1970: 1_800_000_000)

    override func setUp() async throws {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    }

    override func tearDown() async throws {
        if FileManager.default.fileExists(atPath: directory.path) { try FileManager.default.removeItem(at: directory) }
    }

    private var store: MobileVisitStore { MobileVisitStore(directory: directory) }
    private func context(patient: String = "synthetic-patient", archive: String = "archive-a", operatorID: String = "operator-a",
                         scope: String = "scope-a", server: String = "https://localhost:3443/api/v1",
                         tlsFingerprint: String = "pin-a", client: String = "device-a", token: UInt8 = 1) -> MobileVisitContext {
        MobileVisitContext(serverURL: server, tlsPin: tlsFingerprint, pairedClientID: client, pairedTokenDigest: Data(repeating: token, count: 32),
            archiveGeneration: archive, operatorID: operatorID, scopeID: scope, patientID: patient)
    }
    private func dossier(context: MobileVisitContext? = nil, version: Int = 1, at: Date? = nil) -> MobileVisitDossier {
        let time = at ?? instant
        return MobileVisitDossier(id: UUID(), context: context ?? self.context(), patientName: "Paziente Sintetico",
            acquiredAt: time, expiresAt: time.addingTimeInterval(86_400), sections: [
                MobileVisitSection(id: "profile", source: "canonical/profile", rows: [
                    .init(id: "synthetic-patient", version: version, text: "Profilo sintetico")], limitation: nil)
            ], omissions: ["Documenti"])
    }
    private func model(now: @escaping () -> Date) -> MobileVisitModel {
        MobileVisitModel(store: store, unlocker: VisitTestUnlock(key: key), now: now)
    }
    private func prepared() async throws -> (MobileVisitModel, UUID) {
        let model = model(now: { self.instant })
        let reader = VisitTestReader(dossier: dossier())
        await model.prepare(patientID: "synthetic-patient", online: reader, consent: true)
        return (model, try XCTUnwrap(model.selected?.id))
    }

    func testRestartOfflineRestoresEncryptedNoteWithoutHostSession() async throws {
        let (first, id) = try await prepared()
        first.saveNote("Appunto sanitario solo sintetico")
        first.lock()
        XCTAssertTrue(first.dossiers.isEmpty)
        XCTAssertEqual(first.noteText, "")
        let restarted = model(now: { self.instant.addingTimeInterval(60) })
        await restarted.unlock()
        restarted.open(id)
        XCTAssertEqual(restarted.noteText, "Appunto sanitario solo sintetico")
        XCTAssertEqual(restarted.selected?.context, context())
        XCTAssertEqual(try store.read(key: key).first?.note.revision, 1)
        let bytes = try Data(contentsOf: store.fileURL)
        for value in ["Paziente", "Appunto", "synthetic-patient", "operator-a", "archive-a"] {
            XCTAssertNil(bytes.range(of: Data(value.utf8)))
        }
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: directory.path), ["visit-vault.v1"])
        XCTAssertEqual(try store.fileURL.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup, true)
    }

    func testTamperAndWrongKeyDenyWithoutReplacingCiphertext() async throws {
        _ = try await prepared()
        XCTAssertThrowsError(try store.read(key: SymmetricKey(size: .bits256)))
        var bytes = try Data(contentsOf: store.fileURL)
        bytes[bytes.count / 2] ^= 1
        try bytes.write(to: store.fileURL)
        XCTAssertThrowsError(try store.read(key: key))
        XCTAssertEqual(try Data(contentsOf: store.fileURL), bytes)
    }

    func testConsentAndAuthenticationDenialNeverCreateVault() async throws {
        let denied = MobileVisitModel(store: store, unlocker: VisitTestUnlock(key: nil), now: { self.instant })
        let reader = VisitTestReader(dossier: dossier())
        await denied.prepare(patientID: "synthetic-patient", online: reader, consent: false)
        XCTAssertEqual(reader.calls, 0)
        await denied.prepare(patientID: "synthetic-patient", online: reader, consent: true)
        XCTAssertFalse(store.exists)
        XCTAssertFalse(denied.isUnlocked)
        XCTAssertNil(denied.selected)
        XCTAssertNotNil(denied.errorMessage)
    }

    func testMissingKeyAfterRestartNeverRequestsReplacement() async throws {
        _ = try await prepared()
        let bytes = try Data(contentsOf: store.fileURL)
        let unlock = VisitTestUnlock(key: nil)
        let restarted = MobileVisitModel(store: store, unlocker: unlock, now: { self.instant })
        await restarted.unlock()
        XCTAssertEqual(unlock.creationRequests, [false])
        await restarted.prepare(patientID: "synthetic-patient", online: VisitTestReader(dossier: dossier()), consent: true)
        XCTAssertEqual(unlock.creationRequests, [false, false])
        XCTAssertEqual(try Data(contentsOf: store.fileURL), bytes)
    }

    func testExactExpiryAndRollbackHideDossierButAllowOwnNoteOffline() async throws {
        let (first, id) = try await prepared()
        first.saveNote("Conservare anche dopo scadenza")
        first.lock()
        for time in [instant.addingTimeInterval(86_400), instant.addingTimeInterval(-1)] {
            let closed = model(now: { time })
            await closed.unlock()
            XCTAssertTrue(closed.dossiers.isEmpty)
            closed.open(id)
            XCTAssertNil(closed.selected)
            XCTAssertEqual(closed.noteText, "Conservare anche dopo scadenza")
            XCTAssertEqual(closed.selectedNote?.context, context())
            XCTAssertEqual(try store.read(key: key).first?.note.text, "Conservare anche dopo scadenza")
        }
        let recovered = model(now: { self.instant.addingTimeInterval(90_000) })
        await recovered.unlock()
        let online = VisitTestReader(dossier: dossier(at: instant.addingTimeInterval(90_000)), login: 2)
        await recovered.reviewOnline(id: id, freshLogin: { _ in online })
        XCTAssertEqual(recovered.noteText, "Conservare anche dopo scadenza")
        XCTAssertNotNil(recovered.onlineReview)
    }

    func testOpenedDossierExpiresWithoutHidingOrBlockingOwnNote() async throws {
        var time = instant
        let mobile = model(now: { time })
        await mobile.prepare(patientID: "synthetic-patient", online: VisitTestReader(dossier: dossier()), consent: true)
        mobile.saveNote("Prima della scadenza")
        time = instant.addingTimeInterval(86_400)
        mobile.checkExpiry()
        XCTAssertNil(mobile.selected)
        XCTAssertEqual(mobile.noteText, "Prima della scadenza")
        mobile.saveNote("Dopo scadenza")
        XCTAssertEqual(try store.read(key: key).first?.note.text, "Dopo scadenza")
    }

    func testLastOpeningWatermarkRejectsClockRollbackAfterRestart() async throws {
        let (_, id) = try await prepared()
        let later = model(now: { self.instant.addingTimeInterval(3600) })
        await later.unlock()
        later.open(id)
        later.lock()
        let rollback = model(now: { self.instant.addingTimeInterval(1800) })
        await rollback.unlock()
        rollback.open(id)
        XCTAssertNil(rollback.selected)
    }

    func testEveryContextDimensionRejectsImportAndPreservesNote() async throws {
        let (mobile, id) = try await prepared()
        mobile.saveNote("Non riassegnare")
        for changed in [context(patient: "other"), context(archive: "other"), context(operatorID: "other"), context(scope: "other"),
                        context(server: "https://127.0.0.1:3444"), context(tlsFingerprint: "other"), context(client: "other"), context(token: 2)] {
            await mobile.reviewOnline(id: id, freshLogin: { _ in VisitTestReader(dossier: self.dossier(context: changed), login: 2) })
            XCTAssertNil(mobile.onlineReview)
            XCTAssertEqual(try store.read(key: key).first?.note.text, "Non riassegnare")
        }
    }

    func testFreshLoginRequiredEvenAfterRestartAndReconnectionDoesNotWrite() async throws {
        let (mobile, id) = try await prepared()
        mobile.saveNote("Nessun invio automatico")
        mobile.lock()
        let restarted = model(now: { self.instant })
        await restarted.unlock()
        let sameLogin = VisitTestReader(dossier: dossier())
        await restarted.reviewOnline(id: id, freshLogin: { _ in sameLogin })
        XCTAssertEqual(sameLogin.calls, 0)
        XCTAssertNil(restarted.onlineReview)
        let fresh = VisitTestReader(dossier: dossier(), login: 2)
        await restarted.reviewOnline(id: id, freshLogin: { _ in fresh })
        var inserts = 0
        await restarted.importReviewedNote(confirmed: false, freshLogin: { _ in fresh }, insertIntoOrdinaryComposer: { _ in inserts += 1 })
        XCTAssertEqual(inserts, 0)
        XCTAssertEqual(fresh.calls, 1)
        XCTAssertEqual(try store.read(key: key).first?.note.text, "Nessun invio automatico")
    }

    func testChangedVersionsRequireReviewAndASecondReadBeforeImport() async throws {
        let (mobile, id) = try await prepared()
        mobile.saveNote("Proposta clinica sintetica")
        let changed = VisitTestReader(dossier: dossier(version: 2), login: 2)
        await mobile.reviewOnline(id: id, freshLogin: { _ in changed })
        XCTAssertTrue(mobile.statusMessage?.contains("Fonti cambiate") == true)
        var inserted = false
        await mobile.importReviewedNote(confirmed: true, freshLogin: { _ in VisitTestReader(dossier: self.dossier(version: 3), login: 3) },
            insertIntoOrdinaryComposer: { _ in inserted = true })
        XCTAssertFalse(inserted)
        await mobile.reviewOnline(id: id, freshLogin: { _ in changed })
        await mobile.importReviewedNote(confirmed: true, freshLogin: { _ in changed }, insertIntoOrdinaryComposer: { request in
            XCTAssertEqual(request.context, self.context())
            XCTAssertEqual(request.text, "Proposta clinica sintetica")
            inserted = true
        })
        XCTAssertTrue(inserted)
        XCTAssertEqual(try store.read(key: key).first?.note.text, "Proposta clinica sintetica")
    }

    func testDeniedOnlineAndUncertainComposerOutcomeNeverDeleteOrRetry() async throws {
        let (mobile, id) = try await prepared()
        mobile.saveNote("Persistente")
        let reader = VisitTestReader(dossier: dossier(), login: 2)
        await mobile.reviewOnline(id: id, freshLogin: { _ in throw MobileVisitError.denied })
        XCTAssertNil(mobile.onlineReview)
        await mobile.reviewOnline(id: id, freshLogin: { _ in reader })
        var calls = 0
        await mobile.importReviewedNote(confirmed: true, freshLogin: { _ in reader }, insertIntoOrdinaryComposer: { _ in
            calls += 1
            throw URLError(.timedOut)
        })
        XCTAssertEqual(calls, 1)
        XCTAssertEqual(try store.read(key: key).first?.note.text, "Persistente")
        mobile.checkExpiry()
        XCTAssertEqual(calls, 1)
    }

    func testLateLocalUnlockAfterLockCannotRecoverPresentation() async throws {
        let (first, _) = try await prepared()
        first.saveNote("Conservato e coperto")
        first.lock()
        let unlocker = VisitTestUnlock(key: key)
        unlocker.suspend = true
        let mobile = MobileVisitModel(store: store, unlocker: unlocker, now: { self.instant })
        let task = Task { await mobile.unlock() }
        while unlocker.continuation == nil { await Task.yield() }
        mobile.lock()
        unlocker.continuation?.resume()
        await task.value
        XCTAssertFalse(mobile.isUnlocked)
        XCTAssertTrue(mobile.dossiers.isEmpty)
        XCTAssertEqual(mobile.noteText, "")
        XCTAssertEqual(try store.read(key: key).first?.note.text, "Conservato e coperto")
    }

    func testLateAcquisitionAfterBackgroundCannotPublishOrPersist() async throws {
        let mobile = model(now: { self.instant })
        let reader = VisitTestReader(dossier: dossier())
        reader.suspend = true
        let task = Task { await mobile.prepare(patientID: "synthetic-patient", online: reader, consent: true) }
        while reader.continuation == nil { await Task.yield() }
        mobile.lock()
        reader.resume()
        await task.value
        XCTAssertNil(mobile.selected)
        XCTAssertFalse(mobile.isUnlocked)
        XCTAssertFalse(store.exists)
    }

    func testLateReviewAndImportAfterLogoutCannotPublishOrInsert() async throws {
        let (mobile, id) = try await prepared()
        mobile.saveNote("Conservato prima del logout")
        let reader = VisitTestReader(dossier: dossier(), login: 2)
        reader.suspend = true
        let review = Task { await mobile.reviewOnline(id: id, freshLogin: { _ in reader }) }
        while reader.continuation == nil { await Task.yield() }
        mobile.lock()
        reader.resume()
        await review.value
        XCTAssertNil(mobile.onlineReview)
        XCTAssertEqual(mobile.noteText, "")
        await mobile.unlock()
        await mobile.reviewOnline(id: id, freshLogin: { _ in reader })
        reader.suspend = true
        var inserts = 0
        let importing = Task {
            await mobile.importReviewedNote(confirmed: true, freshLogin: { _ in reader },
                insertIntoOrdinaryComposer: { _ in inserts += 1 })
        }
        while reader.continuation == nil { await Task.yield() }
        mobile.lock()
        reader.resume()
        await importing.value
        XCTAssertEqual(inserts, 0)
        XCTAssertEqual(try store.read(key: key).first?.note.text, "Conservato prima del logout")
    }

    func testPatientSwitchAndRepreparationNeverLoseOrRebaseSavedNote() async throws {
        let (mobile, id) = try await prepared()
        mobile.saveNote("Primo paziente")
        let second = VisitTestReader(dossier: dossier(context: context(patient: "patient-b")))
        await mobile.prepare(patientID: "patient-b", online: second, consent: true)
        mobile.saveNote("Secondo paziente")
        mobile.open(id)
        XCTAssertEqual(mobile.noteText, "Primo paziente")
        await mobile.prepare(patientID: "synthetic-patient", online: VisitTestReader(dossier: dossier(version: 2)), consent: true)
        XCTAssertEqual(try store.read(key: key).first?.dossier.revisions["profile"]?["synthetic-patient"], 1)
        XCTAssertEqual(try store.read(key: key).first?.note.text, "Primo paziente")
    }
}

@MainActor
private final class VisitTestUnlock: MobileVisitUnlocking {
    let key: SymmetricKey?
    var creationRequests: [Bool] = []
    var suspend = false
    var continuation: CheckedContinuation<Void, Never>?
    init(key: SymmetricKey?) { self.key = key }
    func unlock(createIfMissing: Bool) async throws -> SymmetricKey {
        creationRequests.append(createIfMissing)
        if suspend { await withCheckedContinuation { continuation = $0 } }
        guard let key else { throw MobileVisitError.denied }
        return key
    }
    func invalidate() {}
}

@MainActor
private final class VisitTestReader: MobileVisitOnlineReading {
    let dossier: MobileVisitDossier
    let loginDigest: Data
    var calls = 0
    var suspend = false
    var continuation: CheckedContinuation<Void, Never>?
    init(dossier: MobileVisitDossier, login: UInt8 = 1) {
        self.dossier = dossier
        self.loginDigest = Data(repeating: login, count: 32)
    }
    func acquire(patientID: String, forImport: Bool) async throws -> MobileVisitDossier {
        calls += 1
        if suspend { await withCheckedContinuation { continuation = $0 } }
        return dossier
    }
    func resume() { suspend = false; continuation?.resume(); continuation = nil }
}

extension MobileVisitTests {
    private func wireAdapter(_ fixture: VisitWireFixture) -> MobileVisitOnlineAdapter {
        VisitWireProtocol.fixture = fixture
        let config = HomeBaseConnectionConfiguration(serverURLString: "https://localhost:3443", tlsPin: "aa")
        return MobileVisitOnlineAdapter(configuration: config,
            credentials: .init(clientId: "device-a", clientToken: "synthetic-pairing-token"),
            sessionCookie: "mediflow_session=synthetic-session", operatorID: "operator-a", scopeID: "scope-a",
            masterKey: key, isCurrent: { fixture.isValid }, now: { self.instant }, clientFactory: {
                let session = URLSessionConfiguration.ephemeral
                session.protocolClasses = [VisitWireProtocol.self]
                session.urlCache = nil
                return HomeBasePatientsClient(configuration: config, session: URLSession(configuration: session))
            })
    }

    func testCanonicalAdapterAcquiresRealProfileTherapyAndDiaryWithVersionsAndNoWrites() async throws {
        let wire = VisitWireFixture()
        let adapter = wireAdapter(wire)
        let acquired = try await adapter.acquire(patientID: "synthetic-patient", forImport: true)
        XCTAssertEqual(acquired.context.archiveGeneration, "archive-a")
        XCTAssertEqual(acquired.sections.map(\.id), ["profile", "therapies", "diary"])
        XCTAssertEqual(acquired.revisions["therapies"]?["therapy-a"], 7)
        XCTAssertEqual(acquired.revisions["diary"]?["entry-a"], 3)
        XCTAssertTrue(acquired.sections[2].rows[0].text.contains("campo non decifrabile"))
        XCTAssertEqual(acquired.expiresAt.timeIntervalSince(acquired.acquiredAt), 86_400)
        XCTAssertFalse(acquired.omissions.isEmpty)
        XCTAssertEqual(wire.requests.count, 10)
        XCTAssertTrue(wire.requests.allSatisfy { $0.httpMethod == "GET" })
        XCTAssertTrue(wire.requests.allSatisfy { $0.value(forHTTPHeaderField: "x-mediflow-paired-client-id") == "device-a" })
        let clinical = wire.requests.filter { $0.url?.path.contains("/patients/") == true }
        XCTAssertTrue(clinical.allSatisfy { $0.value(forHTTPHeaderField: "Cache-Control") == "no-store" })
        XCTAssertTrue(clinical.allSatisfy { $0.cachePolicy == .reloadIgnoringLocalAndRemoteCacheData })
        XCTAssertTrue(clinical.allSatisfy { $0.value(forHTTPHeaderField: "Cookie")?.contains("ambulatory_id=scope-a") == true })
    }

    func testCanonicalAdapterFailsOnRevokedPairingMissingSectionOrArchiveReplacement() async throws {
        for mode in ["revoked", "missing-therapy", "replaced", "wrong-patient", "wrong-scope", "no-write-permission"] {
            let wire = VisitWireFixture(mode: mode)
            let adapter = wireAdapter(wire)
            do {
                _ = try await adapter.acquire(patientID: "synthetic-patient", forImport: true)
                XCTFail("Expected denial for \(mode)")
            } catch { }
            XCTAssertTrue(wire.requests.allSatisfy { $0.httpMethod == "GET" })
        }
    }

    func testCanonicalAdapterStopsAfterAuthorityInvalidationInsteadOfReadingAnotherSection() async throws {
        let wire = VisitWireFixture(mode: "invalidate-after-entry")
        let adapter = wireAdapter(wire)
        do {
            _ = try await adapter.acquire(patientID: "synthetic-patient", forImport: false)
            XCTFail("Expected invalidation")
        } catch { XCTAssertEqual(error as? MobileVisitError, .locked) }
        XCTAssertFalse(wire.requests.contains { $0.url?.path.hasSuffix("/therapies") == true })
    }
}

private final class VisitWireFixture: @unchecked Sendable {
    private let lock = NSLock()
    private var recorded: [URLRequest] = []
    private var valid = true
    private var profileReads = 0
    let mode: String
    init(mode: String = "normal") { self.mode = mode }
    var requests: [URLRequest] { lock.lock(); defer { lock.unlock() }; return recorded }
    var isValid: Bool { lock.lock(); defer { lock.unlock() }; return valid }

    func response(_ request: URLRequest) throws -> (HTTPURLResponse, Data) {
        lock.lock()
        defer { lock.unlock() }
        recorded.append(request)
        let path = request.url!.path
        let status = mode == "revoked" ? 403 : (mode == "missing-therapy" && path.hasSuffix("/therapies") ? 503 : 200)
        var object: Any = ["error": "synthetic denial"]
        if path == "/api/auth/profile" {
            profileReads += 1
            object = ["operation": "account-profile.read.v1", "contractVersion": 1, "userId": "operator-a", "username": "synthetic",
                      "displayName": NSNull(), "ambulatoryName": NSNull(), "profileVersion": "v1",
                      "archiveGeneration": mode == "replaced" && profileReads > 1 ? "archive-b" : "archive-a"] as [String: Any]
        } else if path.hasSuffix("/identity") {
            object = ["identityModel": "paired-device-plus-node-credentials", "pairingBoundary": "separate", "credentialState": "session-bound",
                      "loginMode": "explicit", "operator": ["userId": "operator-a", "role": "admin", "authChannel": "paired-native"],
                      "scope": ["policy": "session-context", "effectiveAmbulatoryId": mode == "wrong-scope" ? "scope-b" : "scope-a", "source": "session-context"],
                      "audit": ["actorType": "user", "actorBinding": "session-user"], "limitations": []] as [String: Any]
        } else if path.hasSuffix("/capabilities") {
            object = ["nodeId": "node-a", "operatingMode": "network-home-base", "protocolVersion": "1",
                      "capabilities": ["network.replica.readonly-patients", "network.replica.write-clinical-diary"].map {
                          ["key": $0, "status": mode == "no-write-permission" && $0.contains("write") ? "unavailable" : "available",
                           "requiresPairing": true, "description": "synthetic"] as [String: Any]
                      }] as [String: Any]
        } else if path.hasSuffix("/entries") {
            if mode == "invalidate-after-entry" { valid = false }
            object = [["id": "entry-a", "patientId": "synthetic-patient", "type": "note", "title": "Diario sintetico",
                       "content": "ENC:invalid:unreadable", "date": "2026-10-25T09:00:00.000Z", "version": 3]] as [[String: Any]]
        } else if path.hasSuffix("/therapies") {
            object = [["id": "therapy-a", "patientId": "synthetic-patient", "drugName": "Farmaco sintetico", "dosage": "Dose sintetica",
                       "status": "active", "startDate": "2026-10-25T09:00:00.000Z", "version": 7]] as [[String: Any]]
        } else if path.hasSuffix("/synthetic-patient") {
            object = ["id": mode == "wrong-patient" ? "patient-b" : "synthetic-patient", "firstName": "Paziente", "lastName": "Sintetico",
                      "taxCode": "SYNTHETIC", "version": 2, "ambulatoryId": "scope-a"] as [String: Any]
        }
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
        return (response, try JSONSerialization.data(withJSONObject: object))
    }
}

private final class VisitWireProtocol: URLProtocol {
    static var fixture: VisitWireFixture?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            guard let fixture = Self.fixture else { throw MobileVisitError.denied }
            let (response, data) = try fixture.response(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}
