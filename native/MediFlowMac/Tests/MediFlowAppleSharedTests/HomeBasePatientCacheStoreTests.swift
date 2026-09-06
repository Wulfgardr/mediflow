// @Codex
import CryptoKit
import Foundation
import XCTest
@testable import MediFlowAppleShared

/* @Codex */
final class HomeBasePatientCacheStoreTests: XCTestCase {
    private var directory: URL!
    private let instant = Date(timeIntervalSince1970: 1_775_000_000)

    override func setUpWithError() throws {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent("OfflineCacheTests-\(UUID())")
    }
    override func tearDownWithError() throws {
        if FileManager.default.fileExists(atPath: directory.path) { try FileManager.default.removeItem(at: directory) }
    }

    func testEncryptedRoundTripKeepsHostFieldEnvelopeAndExcludesArtifactsAndSecrets() throws {
        let store = makeStore()
        let context = OfflineCacheFixture.context()
        let notes = try XCTUnwrap(CryptoService.encryptField("Nota solo sintetica", masterKey: OfflineCacheFixture.key))
        let patient = OfflineCacheFixture.detail(notes: notes)
        try store.savePatientList([OfflineCacheFixture.summary()], context: context)
        try store.savePatientDetail(patient, context: context)
        let snapshot = try XCTUnwrap(store.loadPatientDetail(patientID: patient.id, context: context))
        XCTAssertEqual(snapshot.patient?.notes, notes)
        XCTAssertNil(snapshot.patient?.aiSummary)
        XCTAssertNil(snapshot.patient?.documentInsights)
        XCTAssertEqual(try store.loadPatientList(context: context)?.patients, [OfflineCacheFixture.summary()])
        let url = try XCTUnwrap(FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil).first)
        let data = try Data(contentsOf: url)
        let envelope = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let box = try AES.GCM.SealedBox(
            nonce: AES.GCM.Nonce(data: Data(base64Encoded: envelope["nonce"] as! String)!),
            ciphertext: Data(base64Encoded: envelope["ciphertext"] as! String)!,
            tag: Data(base64Encoded: envelope["tag"] as! String)!)
        let plaintext = try AES.GCM.open(box, using: OfflineCacheFixture.key)
        let persisted = String(decoding: data, as: UTF8.self)
        let payload = String(decoding: plaintext, as: UTF8.self)
        for sensitive in ["Paziente", "SYNTHETIC-P1", "Nota solo sintetica", "paired-token-fixture", "sid=fixture"] {
            XCTAssertFalse(persisted.contains(sensitive))
        }
        for excluded in ["artifact-fixture", "ai-fixture", "Nota solo sintetica", "paired-token-fixture", "sid=fixture"] {
            XCTAssertFalse(payload.contains(excluded))
        }
    }

    func testExpiryRetainsOnlyNonIdentifyingMetadataAtExactTTL() throws {
        let context = OfflineCacheFixture.context()
        try makeStore().savePatientList([OfflineCacheFixture.summary()], context: context)
        let fresh = try XCTUnwrap(makeStore(offset: 59).loadPatientList(context: context))
        XCTAssertFalse(fresh.metadata.isStale)
        let expired = try XCTUnwrap(makeStore(offset: 60).loadPatientList(context: context))
        XCTAssertTrue(expired.patients.isEmpty)
        XCTAssertEqual(expired.metadata.cachedAt, instant)
        XCTAssertEqual(expired.metadata.expiresAt, instant.addingTimeInterval(60))
        XCTAssertEqual(expired.metadata.patientCount, 1)
        XCTAssertEqual(expired.metadata.expiryReason, .ttlExceeded)
        XCTAssertTrue(expired.metadata.reviewLine.contains("scaduta"))
        XCTAssertFalse(expired.metadata.reviewLine.contains("SYNTHETIC"))
    }

    func testClockRollbackCannotMakeHistoricalDataFresh() throws {
        let context = OfflineCacheFixture.context()
        try makeStore().savePatientList([OfflineCacheFixture.summary()], context: context)
        let snapshot = try XCTUnwrap(makeStore(offset: -1).loadPatientList(context: context))
        XCTAssertTrue(snapshot.patients.isEmpty)
        XCTAssertEqual(snapshot.metadata.expiryReason, .clockMovedBackwards)
    }

    func testEveryProvenanceDimensionIsRequiredForListAndDetail() throws {
        let store = makeStore()
        try store.savePatientList([OfflineCacheFixture.summary()], context: OfflineCacheFixture.context())
        try store.savePatientDetail(OfflineCacheFixture.detail(), context: OfflineCacheFixture.context())
        let contexts = [
            OfflineCacheFixture.context(server: "https://127.0.0.1:3443"),
            OfflineCacheFixture.context(scope: "scope-b"), OfflineCacheFixture.context(scope: nil),
            OfflineCacheFixture.context(pin: String(repeating: "b", count: 64)),
            OfflineCacheFixture.context(client: "other-device"), OfflineCacheFixture.context(token: "rotated-token"),
            OfflineCacheFixture.context(operatorId: "other-operator"), OfflineCacheFixture.context(session: "sid=other")
        ]
        for context in contexts {
            XCTAssertNil(try store.loadPatientList(context: context))
            XCTAssertNil(try store.loadPatientDetail(patientID: "p1", context: context))
        }
    }

    func testWrongKeyAndTamperFailClosed() throws {
        let context = OfflineCacheFixture.context()
        try makeStore().savePatientList([OfflineCacheFixture.summary()], context: context)
        let wrongKey = HomeBasePatientCacheStore(cacheDirectory: directory,
            keyProvider: { SymmetricKey(data: Data(repeating: 2, count: 32)) })
        XCTAssertThrowsError(try wrongKey.loadPatientList(context: context))
        let url = try XCTUnwrap(FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil).first)
        var envelope = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
        envelope["tag"] = Data(repeating: 0, count: 16).base64EncodedString()
        try JSONSerialization.data(withJSONObject: envelope).write(to: url)
        XCTAssertThrowsError(try makeStore().loadPatientList(context: context))
    }

    func testLegacyUnboundCacheIsNotRestored() throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let legacy = #"{"version":1,"nonce":"","ciphertext":"","tag":""}"#
        try Data(legacy.utf8).write(to: directory.appendingPathComponent("home-base-patient-list-cache.v1"))
        XCTAssertNil(try makeStore().loadPatientList(context: OfflineCacheFixture.context()))
    }

    func testListRefreshDoesNotExtendProfileLifetime() throws {
        let context = OfflineCacheFixture.context()
        try makeStore().savePatientList([OfflineCacheFixture.summary()], context: context)
        try makeStore().savePatientDetail(OfflineCacheFixture.detail(), context: context)
        try makeStore(offset: 30).savePatientList([OfflineCacheFixture.summary()], context: context)
        let later = makeStore(offset: 61)
        XCTAssertFalse(try XCTUnwrap(later.loadPatientList(context: context)).metadata.isStale)
        let profile = try XCTUnwrap(later.loadPatientDetail(patientID: "p1", context: context))
        XCTAssertNil(profile.patient)
        XCTAssertEqual(profile.metadata.expiryReason, .ttlExceeded)
    }

    func testSubsecondHostRevisionSurvivesEncryptedRoundTripAndDifferentRevisionIsRejected() throws {
        let context = OfflineCacheFixture.context()
        let store = makeStore()
        let stamp = instant.addingTimeInterval(0.123)
        try store.savePatientList([OfflineCacheFixture.summary(updatedAt: stamp)], context: context)
        try store.savePatientDetail(OfflineCacheFixture.detail(updatedAt: stamp), context: context)
        XCTAssertNotNil(try store.loadPatientDetail(patientID: "p1", context: context)?.patient)
        try store.savePatientList([OfflineCacheFixture.summary(updatedAt: stamp.addingTimeInterval(0.001))], context: context)
        XCTAssertNil(try store.loadPatientDetail(patientID: "p1", context: context))
    }

    func testProfilePreservesItsOwnAcquisitionAndDetectsClockRollback() throws {
        let context = OfflineCacheFixture.context()
        try makeStore().savePatientList([OfflineCacheFixture.summary()], context: context)
        try makeStore(offset: 30).savePatientDetail(OfflineCacheFixture.detail(), context: context)
        let profile = try XCTUnwrap(makeStore(offset: 31).loadPatientDetail(patientID: "p1", context: context))
        XCTAssertEqual(profile.metadata.cachedAt, instant.addingTimeInterval(30))
        XCTAssertEqual(profile.metadata.expiresAt, instant.addingTimeInterval(60))
        let rollback = try XCTUnwrap(makeStore(offset: 20).loadPatientDetail(patientID: "p1", context: context))
        XCTAssertNil(rollback.patient)
        XCTAssertEqual(rollback.metadata.expiryReason, .clockMovedBackwards)
    }

    func testChangedRemovedOrDeletedPatientDropsRetainedProfile() throws {
        let context = OfflineCacheFixture.context()
        for refreshed in [[OfflineCacheFixture.summary(version: 2)], [], [OfflineCacheFixture.summary(deleted: true)]] {
            let store = makeStore()
            try store.savePatientList([OfflineCacheFixture.summary()], context: context)
            try store.savePatientDetail(OfflineCacheFixture.detail(), context: context)
            try store.savePatientList(refreshed, context: context)
            XCTAssertNil(try store.loadPatientDetail(patientID: "p1", context: context))
        }
    }

    func testDetailRequiresFreshMatchingMembershipAndOnlyLastProfileIsRetained() throws {
        let context = OfflineCacheFixture.context()
        let store = makeStore()
        try store.savePatientDetail(OfflineCacheFixture.detail(), context: context)
        XCTAssertNil(try store.loadPatientList(context: context))
        try store.savePatientList([OfflineCacheFixture.summary(), OfflineCacheFixture.summary(id: "p2")], context: context)
        try store.savePatientDetail(OfflineCacheFixture.detail(version: 2), context: context)
        XCTAssertNil(try store.loadPatientDetail(patientID: "p1", context: context))
        try store.savePatientDetail(OfflineCacheFixture.detail(scope: "scope-b"), context: context)
        XCTAssertNil(try store.loadPatientDetail(patientID: "p1", context: context))
        try store.savePatientDetail(OfflineCacheFixture.detail(), context: context)
        try store.savePatientDetail(OfflineCacheFixture.detail(id: "p2"), context: context)
        XCTAssertNil(try store.loadPatientDetail(patientID: "p1", context: context))
        XCTAssertNotNil(try store.loadPatientDetail(patientID: "p2", context: context)?.patient)
        try makeStore(offset: 61).savePatientDetail(OfflineCacheFixture.detail(), context: context)
        XCTAssertNil(try makeStore(offset: 61).loadPatientDetail(patientID: "p1", context: context))
    }

    private func makeStore(offset: TimeInterval = 0) -> HomeBasePatientCacheStore {
        let date = instant.addingTimeInterval(offset)
        return HomeBasePatientCacheStore(cacheDirectory: directory, keyProvider: { OfflineCacheFixture.key },
            now: { date }, maxCacheAge: 60)
    }
}

/* @Codex */
enum OfflineCacheFixture {
    static let key = SymmetricKey(data: Data(repeating: 7, count: 32))
    static func context(server: String = "https://localhost:3443", scope: String? = "scope-a",
                        pin: String = String(repeating: "a", count: 64), client: String = "paired-fixture",
                        token: String = "paired-token-fixture", operatorId: String = "operator-fixture",
                        session: String = "sid=fixture") -> HomeBasePatientCacheContext {
        HomeBasePatientCacheContext(serverURL: server, ambulatoryId: scope, tlsPin: pin,
            credentials: HomeBasePairedCredentials(clientId: client, clientToken: token),
            operatorId: operatorId, sessionCookie: session)!
    }
    static func summary(id: String = "p1", version: Int = 1, deleted: Bool = false, updatedAt: Date? = nil) -> HomeBasePatientSummary {
        HomeBasePatientSummary(id: id, firstName: "Paziente", lastName: "Sintetico", birthDate: nil,
            taxCode: "SYNTHETIC-P1", isAdi: false, isArchived: false, version: version, updatedAt: updatedAt,
            deletedAt: deleted ? Date(timeIntervalSince1970: 1) : nil)
    }
    static func detail(id: String = "p1", version: Int = 1, scope: String? = "scope-a", notes: String? = nil, updatedAt: Date? = nil) -> HomeBasePatientDetail {
        HomeBasePatientDetail(id: id, firstName: "Paziente", lastName: "Sintetico", birthDate: nil,
            taxCode: "SYNTHETIC-P1", address: nil, phone: nil, caregiver: nil, exemptions: nil,
            diagnoses: nil, monitoringProfile: nil, statusReason: nil, notes: notes,
            aiSummary: "ai-fixture", documentInsights: "artifact-fixture", isAdi: false, isArchived: false,
            version: version, ambulatoryId: scope, createdAt: nil, updatedAt: updatedAt)
    }
}
