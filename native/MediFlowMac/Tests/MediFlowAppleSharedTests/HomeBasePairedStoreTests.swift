// Codex: created 2026-04-18
// @Codex
import Security
import XCTest
@testable import MediFlowAppleShared

/* @Codex */
final class HomeBasePairedStoreTests: XCTestCase {
    private var suiteName: String!
    private var defaults: UserDefaults!

    override func setUp() {
        super.setUp()
        suiteName = "HomeBasePairedStoreTests.\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suiteName)
    }

    override func tearDown() {
        if let suiteName {
            defaults.removePersistentDomain(forName: suiteName)
        }
        defaults = nil
        suiteName = nil
        super.tearDown()
    }

    func testSavePersistsSettingsAndWritesTrimmedToken() throws {
        var writtenToken: (service: String, account: String, token: String)?
        let store = HomeBasePairedStore(
            userDefaults: defaults,
            service: "svc",
            account: "acct",
            keychainReader: { _, _ in .success(nil) },
            keychainWriter: { service, account, token in
                writtenToken = (service, account, token)
                return .success(())
            },
            keychainDeleter: { _, _ in .success(()) }
        )

        try store.save(
            settings: HomeBasePairedSettings(
                serverURL: " https://home-base.test ",
                tlsPin: " ABC123 ",
                pairedClientId: " paired-client ",
                username: " doctor ",
                ambulatoryId: " amb-42 "
            ),
            pairedClientToken: " paired-token "
        )

        XCTAssertEqual(
            store.loadSettings(),
            HomeBasePairedSettings(
                serverURL: "https://home-base.test",
                tlsPin: "ABC123",
                pairedClientId: "paired-client",
                username: "doctor",
                ambulatoryId: "amb-42"
            )
        )
        XCTAssertEqual(writtenToken?.service, "svc")
        XCTAssertEqual(writtenToken?.account, "acct")
        XCTAssertEqual(writtenToken?.token, "paired-token")
    }

    func testLoadSnapshotUsesDefaultServerURLWhenConfigIsMissing() throws {
        let store = HomeBasePairedStore(
            userDefaults: defaults,
            keychainReader: { _, _ in .success("paired-token") },
            keychainWriter: { _, _, _ in .success(()) },
            keychainDeleter: { _, _ in .success(()) }
        )

        let snapshot = try store.loadSnapshot()

        XCTAssertEqual(snapshot.settings.serverURL, HomeBasePairedSettings.defaultServerURL)
        XCTAssertEqual(snapshot.pairedClientToken, "paired-token")
    }

    func testSaveDeletesKeychainWhenTokenIsBlank() throws {
        var deleteCalls = 0
        let store = HomeBasePairedStore(
            userDefaults: defaults,
            keychainReader: { _, _ in .success(nil) },
            keychainWriter: { _, _, _ in
                XCTFail("Keychain writer should not run when token is blank")
                return .success(())
            },
            keychainDeleter: { _, _ in
                deleteCalls += 1
                return .success(())
            }
        )

        try store.save(
            settings: HomeBasePairedSettings(pairedClientId: "paired-client"),
            pairedClientToken: "   "
        )

        XCTAssertEqual(deleteCalls, 1)
    }

    func testClearRemovesPersistedSettingsAndDeletesToken() throws {
        var deleteCalls = 0
        let store = HomeBasePairedStore(
            userDefaults: defaults,
            keychainReader: { _, _ in .success("paired-token") },
            keychainWriter: { _, _, _ in .success(()) },
            keychainDeleter: { _, _ in
                deleteCalls += 1
                return .success(())
            }
        )

        try store.save(
            settings: HomeBasePairedSettings(
                serverURL: "https://home-base.test",
                tlsPin: "pin",
                pairedClientId: "paired-client",
                username: "doctor",
                ambulatoryId: "amb-42"
            ),
            pairedClientToken: "paired-token"
        )

        try store.clear()

        XCTAssertEqual(deleteCalls, 1)
        XCTAssertEqual(store.loadSettings(), HomeBasePairedSettings())
    }

    func testLoadSnapshotPropagatesKeychainReadFailure() {
        let store = HomeBasePairedStore(
            userDefaults: defaults,
            keychainReader: { _, _ in .failure(.keychainRead(errSecNotAvailable)) },
            keychainWriter: { _, _, _ in .success(()) },
            keychainDeleter: { _, _ in .success(()) }
        )

        XCTAssertThrowsError(try store.loadSnapshot()) { error in
            XCTAssertEqual(error as? HomeBasePairedStoreError, .keychainRead(errSecNotAvailable))
        }
    }
}
