// @Codex
#if os(macOS)
import CryptoKit
import XCTest
@testable import MediFlowAppleShared

@MainActor
final class MediFlowQAStorageTests: XCTestCase {
    private let namespaceA = "0123456789abcdef0123456789abcdef"
    private let namespaceB = "fedcba9876543210fedcba9876543210"
    private var temporaryDirectory: URL!

    override func setUpWithError() throws {
        temporaryDirectory = FileManager.default.temporaryDirectory.appendingPathComponent("MediFlowQAStorageTests-\(UUID())")
        try FileManager.default.createDirectory(at: temporaryDirectory, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try FileManager.default.removeItem(at: temporaryDirectory)
    }

    func testResolverKeepsOrdinaryCopyOnSharedStores() throws {
        XCTAssertEqual(try MediFlowQAStorageSelection.resolve(metadata: [:], bundleIdentifier: "com.mediflow.app"), .ordinary)
    }

    func testResolverAcceptsExactNamespaceAndMatchingQAIdentity() throws {
        XCTAssertEqual(try resolve(namespaceA, bundleIdentifier: "com.mediflow.qa.\(namespaceA)"), .qa(namespace: namespaceA))
    }

    func testResolverRejectsInvalidMetadataAndQAIdentityFailures() {
        for metadata in [
            [MediFlowQAStorageSelection.metadataKey: "ABCDEF"],
            [MediFlowQAStorageSelection.metadataKey: 12],
            [MediFlowQAStorageSelection.metadataKey: ""],
            [MediFlowQAStorageSelection.metadataKey: namespaceA + "\n"],
        ] as [[String: Any]] {
            XCTAssertThrowsError(try MediFlowQAStorageSelection.resolve(metadata: metadata, bundleIdentifier: "com.mediflow.app"))
        }
        XCTAssertThrowsError(try resolve([:], bundleIdentifier: "com.mediflow.qa."))
        XCTAssertThrowsError(try resolve(namespaceA, bundleIdentifier: "com.mediflow.qa.\(namespaceB)"))
    }

    func testQAPairingOperationsNeverRouteToOrdinaryIdentity() throws {
        var seen: [(String, String)] = []
        let store = HomeBasePairedStore(
            userDefaults: UserDefaults(suiteName: "MediFlowQAStorageTests.\(UUID())")!,
            service: "com.mediflow.home-base-paired.qa.\(namespaceA)",
            keychainReader: { service, account in seen.append((service, account)); return .success(nil) },
            keychainWriter: { service, account, _ in seen.append((service, account)); return .success(()) },
            keychainDeleter: { service, account in seen.append((service, account)); return .success(()) }
        )
        _ = try store.loadSnapshot()
        try store.save(settings: HomeBasePairedSettings(), pairedClientToken: "token")
        try store.save(settings: HomeBasePairedSettings(), pairedClientToken: "")
        try store.clear()
        XCTAssertEqual(Set(seen.map(\.0)), ["com.mediflow.home-base-paired.qa.\(namespaceA)"])
        XCTAssertEqual(Set(seen.map(\.1)), ["paired-client-token"])
    }

    func testQAIdentityRoutesCacheKeysAndKeepsNamespacesSeparate() throws {
        let first = temporaryDirectory.appendingPathComponent(namespaceA)
        let second = temporaryDirectory.appendingPathComponent(namespaceB)
        var identities: [(String, String)] = []
        let key = SymmetricKey(data: Data(repeating: 7, count: 32))
        let firstStore = HomeBasePatientCacheStore(cacheDirectory: first, identityCacheLoader: { service, account in
            identities.append((service, account)); return key
        }, cacheService: "com.mediflow.home-base-patient-cache.qa.\(namespaceA)", cacheAccount: "cache-key-v1")
        let secondStore = HomeBasePatientCacheStore(cacheDirectory: second, identityCacheLoader: { service, account in
            identities.append((service, account)); return key
        }, cacheService: "com.mediflow.home-base-patient-cache.qa.\(namespaceB)", cacheAccount: "cache-key-v1")
        let context = OfflineCacheFixture.context()
        try firstStore.savePatientList([OfflineCacheFixture.summary()], context: context)
        try secondStore.savePatientList([OfflineCacheFixture.summary(id: "p2")], context: context)
        XCTAssertNotNil(try firstStore.loadPatientList(context: context))
        XCTAssertEqual(try secondStore.loadPatientList(context: context)?.patients, [OfflineCacheFixture.summary(id: "p2")])
        XCTAssertEqual(Set(identities.map(\.0)), [
            "com.mediflow.home-base-patient-cache.qa.\(namespaceA)",
            "com.mediflow.home-base-patient-cache.qa.\(namespaceB)",
        ])
        XCTAssertEqual(Set(identities.map(\.1)), ["cache-key-v1"])
    }

    func testBootstrapPassesFactoryStoresToWorkspaceAndFailsClosed() {
        var builders = 0
        let factory = MediFlowMacStorageFactory(
            metadata: { [MediFlowQAStorageSelection.metadataKey: self.namespaceA] },
            bundleIdentifier: { "com.mediflow.qa.\(self.namespaceA)" },
            fileManager: .default,
            applicationSupportDirectory: { self.temporaryDirectory },
            pairedStoreBuilder: { _, _ in builders += 1; return self.makeStore() },
            cacheStoreBuilder: { _, _, _ in builders += 1; return HomeBasePatientCacheStore(cacheDirectory: self.temporaryDirectory, keyProvider: { SymmetricKey(data: Data(repeating: 4, count: 32)) }) }
        )
        let scene = MediFlowMacSceneModel(storageFactory: factory)
        scene.prepareWorkspaceIfNeeded()
        XCTAssertEqual(builders, 2)
        XCTAssertNotNil(scene.workspaceModel)
        XCTAssertNil(scene.startupError)

        let invalid = MediFlowMacSceneModel(storageFactory: MediFlowMacStorageFactory(
            metadata: { [MediFlowQAStorageSelection.metadataKey: "invalid"] },
            bundleIdentifier: { "com.mediflow.qa.invalid" }
        ))
        invalid.prepareWorkspaceIfNeeded()
        XCTAssertNil(invalid.workspaceModel)
        XCTAssertNotNil(invalid.startupError)
    }

    func testFactoryUsesDedicatedPairedDefaultsDomainDistinctFromQAAppIdentity() throws {
        var requestedSuite: String?
        let bundleIdentifier = "com.mediflow.qa.\(namespaceA)"
        let factory = MediFlowMacStorageFactory(
            metadata: { [MediFlowQAStorageSelection.metadataKey: self.namespaceA] },
            bundleIdentifier: { bundleIdentifier },
            fileManager: .default,
            applicationSupportDirectory: { self.temporaryDirectory },
            userDefaultsBuilder: { suite in
                requestedSuite = suite
                return UserDefaults(suiteName: "MediFlowQAStorageTests.\(UUID())")
            },
            pairedStoreBuilder: { _, _ in self.makeStore() },
            cacheStoreBuilder: { directory, _, _ in
                HomeBasePatientCacheStore(cacheDirectory: directory, keyProvider: {
                    SymmetricKey(data: Data(repeating: 5, count: 32))
                })
            }
        )

        _ = try factory.makeStores()

        XCTAssertEqual(requestedSuite, "com.mediflow.home-base-paired.qa.\(namespaceA)")
        XCTAssertNotEqual(requestedSuite, bundleIdentifier)
    }

    func testFactoryRejectsQARootSymlinkToOrdinaryStorageBeforeCreatingNamespace() throws {
        let ordinary = temporaryDirectory.appendingPathComponent("MediFlow")
        let qaRoot = temporaryDirectory.appendingPathComponent("MediFlow-QA")
        try FileManager.default.createDirectory(at: ordinary, withIntermediateDirectories: true)
        try FileManager.default.createSymbolicLink(at: qaRoot, withDestinationURL: ordinary)

        XCTAssertThrowsError(try makeFactory(namespaceA).makeStores())
        XCTAssertFalse(FileManager.default.fileExists(atPath: ordinary.appendingPathComponent(namespaceA).path))
    }

    func testFactoryRejectsNamespaceSymlinkToAnotherQANamespaceBeforeCreatingCache() throws {
        let root = temporaryDirectory.appendingPathComponent("MediFlow-QA")
        let target = root.appendingPathComponent(namespaceB)
        let alias = root.appendingPathComponent(namespaceA)
        try FileManager.default.createDirectory(at: target, withIntermediateDirectories: true)
        try FileManager.default.createSymbolicLink(at: alias, withDestinationURL: target)

        XCTAssertThrowsError(try makeFactory(namespaceA).makeStores())
        XCTAssertTrue(FileManager.default.fileExists(atPath: target.path))
    }

    func testFactoryRejectsDanglingQARootSymlinkBeforeCreatingCache() throws {
        let alias = temporaryDirectory.appendingPathComponent("MediFlow-QA")
        let missing = temporaryDirectory.appendingPathComponent("missing-target")
        try FileManager.default.createSymbolicLink(at: alias, withDestinationURL: missing)

        XCTAssertThrowsError(try makeFactory(namespaceA).makeStores())
        XCTAssertFalse(FileManager.default.fileExists(atPath: missing.path))
    }

    private func resolve(_ value: Any, bundleIdentifier: String) throws -> MediFlowQAStorageSelection {
        try MediFlowQAStorageSelection.resolve(metadata: [MediFlowQAStorageSelection.metadataKey: value], bundleIdentifier: bundleIdentifier)
    }

    private func makeStore() -> HomeBasePairedStore {
        HomeBasePairedStore(
            userDefaults: UserDefaults(suiteName: "MediFlowQAStorageTests.\(UUID())")!,
            keychainReader: { _, _ in .success(nil) },
            keychainWriter: { _, _, _ in .success(()) },
            keychainDeleter: { _, _ in .success(()) }
        )
    }

    private func makeFactory(_ namespace: String) -> MediFlowMacStorageFactory {
        MediFlowMacStorageFactory(
            metadata: { [MediFlowQAStorageSelection.metadataKey: namespace] },
            bundleIdentifier: { "com.mediflow.qa.\(namespace)" },
            fileManager: .default,
            applicationSupportDirectory: { self.temporaryDirectory },
            pairedStoreBuilder: { _, _ in
                XCTFail("Lo store paired non deve essere costruito per un percorso QA non valido.")
                return self.makeStore()
            },
            cacheStoreBuilder: { _, _, _ in
                XCTFail("La cache non deve essere costruita per un percorso QA non valido.")
                return HomeBasePatientCacheStore(cacheDirectory: self.temporaryDirectory, keyProvider: {
                    SymmetricKey(data: Data(repeating: 9, count: 32))
                })
            }
        )
    }
}
#endif
