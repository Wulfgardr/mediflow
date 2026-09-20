// @Codex
import CryptoKit
import Foundation

/* @Codex */
enum MediFlowQAStorageError: LocalizedError, Equatable {
    case invalidNamespace
    case missingNamespaceForQACopy
    case bundleIdentifierMismatch
    case userDefaultsUnavailable
    case cacheDirectoryUnavailable

    var errorDescription: String? {
        switch self {
        case .invalidNamespace:
            return "La candidata QA non ha un namespace di archiviazione valido."
        case .missingNamespaceForQACopy:
            return "La candidata QA non contiene il namespace di archiviazione richiesto."
        case .bundleIdentifierMismatch:
            return "L’identità della candidata QA non corrisponde al namespace di archiviazione."
        case .userDefaultsUnavailable:
            return "Impossibile creare le preferenze isolate della candidata QA."
        case .cacheDirectoryUnavailable:
            return "Impossibile creare la cache isolata della candidata QA."
        }
    }
}

/* @Codex */
enum MediFlowQAStorageSelection: Equatable {
    case ordinary
    case qa(namespace: String)

    static let metadataKey = "MediFlowQAStorageNamespace"
    static let qaBundlePrefix = "com.mediflow.qa."

    static func resolve(metadata: [String: Any], bundleIdentifier: String?) throws -> Self {
        let identifier = bundleIdentifier?.trimmingCharacters(in: .whitespacesAndNewlines)
        let isQACopy = identifier?.hasPrefix(qaBundlePrefix) == true

        guard let rawValue = metadata[metadataKey] else {
            if isQACopy { throw MediFlowQAStorageError.missingNamespaceForQACopy }
            return .ordinary
        }
        guard let namespace = rawValue as? String,
              namespace.utf8.count == 32,
              namespace.utf8.allSatisfy({ ($0 >= 48 && $0 <= 57) || ($0 >= 97 && $0 <= 102) }) else {
            throw MediFlowQAStorageError.invalidNamespace
        }
        guard identifier == qaBundlePrefix + namespace else {
            throw MediFlowQAStorageError.bundleIdentifierMismatch
        }
        return .qa(namespace: namespace)
    }
}

/* @Codex */
struct MediFlowMacStoragePair {
    let pairedStore: HomeBasePairedStore
    let cacheStore: HomeBasePatientCacheStore
}

/* @Codex */
struct MediFlowMacStorageFactory {
    private let metadata: () -> [String: Any]
    private let bundleIdentifier: () -> String?
    private let fileManager: FileManager
    private let pairedStoreBuilder: (UserDefaults, String) -> HomeBasePairedStore
    private let cacheStoreBuilder: (URL, String, String) -> HomeBasePatientCacheStore

    init(
        metadata: @escaping () -> [String: Any] = { Bundle.main.infoDictionary ?? [:] },
        bundleIdentifier: @escaping () -> String? = { Bundle.main.bundleIdentifier },
        fileManager: FileManager = .default,
        pairedStoreBuilder: @escaping (UserDefaults, String) -> HomeBasePairedStore = MediFlowMacStorageFactory.productionPairedStore,
        cacheStoreBuilder: @escaping (URL, String, String) -> HomeBasePatientCacheStore = MediFlowMacStorageFactory.productionCacheStore
    ) {
        self.metadata = metadata
        self.bundleIdentifier = bundleIdentifier
        self.fileManager = fileManager
        self.pairedStoreBuilder = pairedStoreBuilder
        self.cacheStoreBuilder = cacheStoreBuilder
    }

    func makeStores() throws -> MediFlowMacStoragePair {
        switch try MediFlowQAStorageSelection.resolve(metadata: metadata(), bundleIdentifier: bundleIdentifier()) {
        case .ordinary:
            return MediFlowMacStoragePair(pairedStore: .shared, cacheStore: .shared)
        case .qa(let namespace):
            guard let defaults = UserDefaults(suiteName: "com.mediflow.qa.\(namespace)") else {
                throw MediFlowQAStorageError.userDefaultsUnavailable
            }
            let directory = try qaCacheDirectory(namespace: namespace)
            return MediFlowMacStoragePair(
                pairedStore: pairedStoreBuilder(defaults, namespace),
                cacheStore: cacheStoreBuilder(directory, namespace, "com.mediflow.home-base-patient-cache.qa.\(namespace)")
            )
        }
    }

    private func qaCacheDirectory(namespace: String) throws -> URL {
        guard let applicationSupport = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else {
            throw MediFlowQAStorageError.cacheDirectoryUnavailable
        }
        let root = applicationSupport.appendingPathComponent("MediFlow-QA", isDirectory: true)
        let directory = root.appendingPathComponent(namespace, isDirectory: true)
        do {
            try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
            let resolvedRoot = root.resolvingSymlinksInPath().standardizedFileURL
            let resolvedDirectory = directory.resolvingSymlinksInPath().standardizedFileURL
            guard resolvedDirectory.path.hasPrefix(resolvedRoot.appendingPathComponent("", isDirectory: true).path) else {
                throw MediFlowQAStorageError.cacheDirectoryUnavailable
            }
            return directory
        } catch let error as MediFlowQAStorageError {
            throw error
        } catch {
            throw MediFlowQAStorageError.cacheDirectoryUnavailable
        }
    }

    private static func productionPairedStore(defaults: UserDefaults, namespace: String) -> HomeBasePairedStore {
        HomeBasePairedStore(
            userDefaults: defaults,
            service: "com.mediflow.home-base-paired.qa.\(namespace)"
        )
    }

    private static func productionCacheStore(directory: URL, namespace: String, service: String) -> HomeBasePatientCacheStore {
        HomeBasePatientCacheStore(
            cacheDirectory: directory,
            identityCacheLoader: { service, account in
                try HomeBasePatientCacheStore.loadOrCreateCacheKey(service: service, account: account)
            },
            cacheService: service,
            cacheAccount: "cache-key-v1"
        )
    }
}
