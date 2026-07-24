// Codex: created 2026-05-02
// @Codex
import CryptoKit
import Foundation
import XCTest
@testable import MediFlowAppleShared

/* @Codex */
final class HomeBasePatientCacheStoreTests: XCTestCase {
    private var temporaryDirectory: URL!

    override func setUpWithError() throws {
        try super.setUpWithError()
        temporaryDirectory = FileManager.default.temporaryDirectory
            .appendingPathComponent("HomeBasePatientCacheStoreTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: temporaryDirectory, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        if let temporaryDirectory {
            try? FileManager.default.removeItem(at: temporaryDirectory)
        }
        temporaryDirectory = nil
        try super.tearDownWithError()
    }

    func testSaveAndLoadPatientListUsesEncryptedFile() throws {
        let store = makeStore(now: Date(timeIntervalSince1970: 1_775_000_000))
        /* @Codex */
        let diagnoses = #"[{"code":"E11.9","description":"Diabete tipo 2"},{"code":"I10","description":"Ipertensione"}]"#
        let patient = makePatient(
            id: "patient-1", firstName: "Mario", lastName: "Rossi",
            taxCode: "RSSMRA70A01H501U", diagnoses: diagnoses)

        try store.savePatientList(
            [patient],
            serverURL: " https://localhost:3443 ",
            ambulatoryId: " amb-42 "
        )

        let cacheFile = try XCTUnwrap(FileManager.default.contentsOfDirectory(at: temporaryDirectory, includingPropertiesForKeys: nil).first)
        let raw = try Data(contentsOf: cacheFile)
        XCTAssertNil(String(data: raw, encoding: .utf8)?.range(of: "RSSMRA70A01H501U"))
        XCTAssertNil(String(data: raw, encoding: .utf8)?.range(of: "Diabete tipo 2"))

        let snapshot = try XCTUnwrap(store.loadPatientList(serverURL: "https://localhost:3443", ambulatoryId: "amb-42"))
        XCTAssertEqual(snapshot.patients, [patient])
        XCTAssertEqual(snapshot.ambulatoryId, "amb-42")
        XCTAssertEqual(snapshot.cachedAt, Date(timeIntervalSince1970: 1_775_000_000))
        XCTAssertEqual(snapshot.patients.first?.diagnoses, diagnoses)
    }

    func testLoadPatientListIgnoresDifferentScope() throws {
        let store = makeStore()
        try store.savePatientList(
            [makePatient(id: "patient-1", firstName: "Mario", lastName: "Rossi", taxCode: "RSSMRA70A01H501U")],
            serverURL: "https://localhost:3443",
            ambulatoryId: "amb-42"
        )

        XCTAssertNil(try store.loadPatientList(serverURL: "https://localhost:3443", ambulatoryId: "amb-99"))
        XCTAssertNil(try store.loadPatientList(serverURL: "https://127.0.0.1:3443", ambulatoryId: "amb-42"))
    }

    func testLoadPatientListIgnoresExpiredCache() throws {
        let store = makeStore(now: Date(timeIntervalSince1970: 1_775_000_000), maxCacheAge: 60)
        try store.savePatientList(
            [makePatient(id: "patient-1", firstName: "Mario", lastName: "Rossi", taxCode: "RSSMRA70A01H501U")],
            serverURL: "https://localhost:3443",
            ambulatoryId: nil
        )

        let laterStore = makeStore(now: Date(timeIntervalSince1970: 1_775_000_061), maxCacheAge: 60)

        XCTAssertNil(try laterStore.loadPatientList(serverURL: "https://localhost:3443", ambulatoryId: nil))
    }

    func testLoadPatientListFailsWithWrongKey() throws {
        let store = makeStore(key: SymmetricKey(data: Data(repeating: 1, count: 32)))
        try store.savePatientList(
            [makePatient(id: "patient-1", firstName: "Mario", lastName: "Rossi", taxCode: "RSSMRA70A01H501U")],
            serverURL: "https://localhost:3443",
            ambulatoryId: nil
        )

        let wrongKeyStore = makeStore(key: SymmetricKey(data: Data(repeating: 2, count: 32)))
        XCTAssertThrowsError(try wrongKeyStore.loadPatientList(serverURL: "https://localhost:3443", ambulatoryId: nil)) { error in
            XCTAssertEqual(error as? HomeBasePatientCacheStoreError, .decryptionFailed)
        }
    }

    private func makeStore(
        key: SymmetricKey = SymmetricKey(data: Data(repeating: 7, count: 32)),
        now: Date = Date(timeIntervalSince1970: 1_775_000_100),
        maxCacheAge: TimeInterval = 24 * 60 * 60
    ) -> HomeBasePatientCacheStore {
        HomeBasePatientCacheStore(
            cacheDirectory: temporaryDirectory,
            keyProvider: { key },
            now: { now },
            maxCacheAge: maxCacheAge
        )
    }

    private func makePatient(
        id: String,
        firstName: String,
        lastName: String,
        taxCode: String,
        diagnoses: String? = nil
    ) -> HomeBasePatientSummary {
        HomeBasePatientSummary(
            id: id,
            firstName: firstName,
            lastName: lastName,
            birthDate: Date(timeIntervalSince1970: 0),
            taxCode: taxCode,
            isAdi: false,
            isArchived: false,
            version: 3,
            updatedAt: Date(timeIntervalSince1970: 1_775_000_000),
            diagnoses: diagnoses
        )
    }
}
