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
    private let applicationSupportDirectory: () -> URL?
    private let userDefaultsBuilder: (String) -> UserDefaults?
    private let pairedStoreBuilder: (UserDefaults, String) -> HomeBasePairedStore
    private let cacheStoreBuilder: (URL, String, String) -> HomeBasePatientCacheStore

    init(
        metadata: @escaping () -> [String: Any] = { Bundle.main.infoDictionary ?? [:] },
        bundleIdentifier: @escaping () -> String? = { Bundle.main.bundleIdentifier },
        fileManager: FileManager = .default,
        applicationSupportDirectory: @escaping () -> URL? = {
            FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
        },
        userDefaultsBuilder: @escaping (String) -> UserDefaults? = UserDefaults.init(suiteName:),
        pairedStoreBuilder: @escaping (UserDefaults, String) -> HomeBasePairedStore = MediFlowMacStorageFactory.productionPairedStore,
        cacheStoreBuilder: @escaping (URL, String, String) -> HomeBasePatientCacheStore = MediFlowMacStorageFactory.productionCacheStore
    ) {
        self.metadata = metadata
        self.bundleIdentifier = bundleIdentifier
        self.fileManager = fileManager
        self.applicationSupportDirectory = applicationSupportDirectory
        self.userDefaultsBuilder = userDefaultsBuilder
        self.pairedStoreBuilder = pairedStoreBuilder
        self.cacheStoreBuilder = cacheStoreBuilder
    }

    func makeStores() throws -> MediFlowMacStoragePair {
        switch try MediFlowQAStorageSelection.resolve(metadata: metadata(), bundleIdentifier: bundleIdentifier()) {
        case .ordinary:
            return MediFlowMacStoragePair(pairedStore: .shared, cacheStore: .shared)
        case .qa(let namespace):
            guard let defaults = userDefaultsBuilder("com.mediflow.home-base-paired.qa.\(namespace)") else {
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
        guard let applicationSupport = applicationSupportDirectory() else {
            throw MediFlowQAStorageError.cacheDirectoryUnavailable
        }
        let root = applicationSupport.appendingPathComponent("MediFlow-QA", isDirectory: true)
        let directory = root.appendingPathComponent(namespace, isDirectory: true)
        do {
            try rejectSymbolicLink(at: root)
            try rejectSymbolicLink(at: directory)
            try validateDerivedQAPath(root, within: applicationSupport)
            try validateDerivedQAPath(directory, within: applicationSupport)
            try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
            try rejectSymbolicLink(at: root)
            try rejectSymbolicLink(at: directory)
            try validateContainedQAPath(root, within: applicationSupport)
            try validateContainedQAPath(directory, within: applicationSupport)
            return directory
        } catch let error as MediFlowQAStorageError {
            throw error
        } catch {
            throw MediFlowQAStorageError.cacheDirectoryUnavailable
        }
    }

    private func rejectSymbolicLink(at url: URL) throws {
        do {
            let attributes = try fileManager.attributesOfItem(atPath: url.path)
            guard attributes[.type] as? FileAttributeType != .typeSymbolicLink else {
                throw MediFlowQAStorageError.cacheDirectoryUnavailable
            }
        } catch let error as MediFlowQAStorageError {
            throw error
        } catch let error as NSError where error.domain == NSCocoaErrorDomain && error.code == CocoaError.Code.fileReadNoSuchFile.rawValue {
            return
        } catch {
            throw MediFlowQAStorageError.cacheDirectoryUnavailable
        }
    }

    private func validateContainedQAPath(_ url: URL, within applicationSupport: URL) throws {
        let resolvedBase = applicationSupport.resolvingSymlinksInPath().standardizedFileURL
        let resolvedPath = url.resolvingSymlinksInPath().standardizedFileURL
        try validatePath(resolvedPath, isDescendantOf: resolvedBase)
    }

    private func validateDerivedQAPath(_ url: URL, within applicationSupport: URL) throws {
        try validatePath(url.standardizedFileURL, isDescendantOf: applicationSupport.standardizedFileURL)
    }

    private func validatePath(_ url: URL, isDescendantOf base: URL) throws {
        let baseComponents = base.pathComponents
        let pathComponents = url.pathComponents
        guard pathComponents.count > baseComponents.count,
              pathComponents.starts(with: baseComponents) else {
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
