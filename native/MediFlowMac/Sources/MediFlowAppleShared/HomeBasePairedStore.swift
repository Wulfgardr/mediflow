// Codex: created 2026-04-18
// @Codex
import Foundation
import LocalAuthentication
import Security

/* @Codex */
struct HomeBasePairedSettings: Equatable, Sendable {
    static let defaultServerURL = "https://localhost:3443"

    var serverURL: String
    var tlsPin: String
    var pairedClientId: String
    var username: String
    var ambulatoryId: String

    init(
        serverURL: String = HomeBasePairedSettings.defaultServerURL,
        tlsPin: String = "",
        pairedClientId: String = "",
        username: String = "",
        ambulatoryId: String = ""
    ) {
        self.serverURL = serverURL
        self.tlsPin = tlsPin
        self.pairedClientId = pairedClientId
        self.username = username
        self.ambulatoryId = ambulatoryId
    }
}

/* @Codex */
struct HomeBasePairedSnapshot: Equatable, Sendable {
    var settings: HomeBasePairedSettings
    var pairedClientToken: String
}

/* @Codex */
enum HomeBasePairedStoreError: LocalizedError, Equatable {
    case keychainRead(OSStatus)
    case keychainWrite(OSStatus)
    case keychainDelete(OSStatus)

    var errorDescription: String? {
        switch self {
        case .keychainRead(let status):
            return "Impossibile leggere il token paired dal Portachiavi (\(status))."
        case .keychainWrite(let status):
            return "Impossibile salvare il token paired nel Portachiavi (\(status))."
        case .keychainDelete(let status):
            return "Impossibile rimuovere il token paired dal Portachiavi (\(status))."
        }
    }
}

/* @Codex */
struct HomeBasePairedStore {
    static let shared = HomeBasePairedStore()

    private static let defaultService = "com.mediflow.home-base-paired"
    private static let defaultAccount = "paired-client-token"

    private enum Keys {
        static let serverURL = "mediflow.homeBase.serverURL"
        static let tlsPin = "mediflow.homeBase.tlsPin"
        static let pairedClientId = "mediflow.homeBase.pairedClientId"
        static let username = "mediflow.homeBase.username"
        static let ambulatoryId = "mediflow.homeBase.ambulatoryId"
    }

    private let userDefaults: UserDefaults
    private let service: String
    private let account: String
    private let keychainReader: (String, String) -> Result<String?, HomeBasePairedStoreError>
    private let keychainWriter: (String, String, String) -> Result<Void, HomeBasePairedStoreError>
    private let keychainDeleter: (String, String) -> Result<Void, HomeBasePairedStoreError>

    init(
        userDefaults: UserDefaults = .standard,
        service: String = HomeBasePairedStore.defaultService,
        account: String = HomeBasePairedStore.defaultAccount,
        keychainReader: @escaping (String, String) -> Result<String?, HomeBasePairedStoreError> = HomeBasePairedStore.readToken,
        keychainWriter: @escaping (String, String, String) -> Result<Void, HomeBasePairedStoreError> = HomeBasePairedStore.writeToken,
        keychainDeleter: @escaping (String, String) -> Result<Void, HomeBasePairedStoreError> = HomeBasePairedStore.deleteToken
    ) {
        self.userDefaults = userDefaults
        self.service = service
        self.account = account
        self.keychainReader = keychainReader
        self.keychainWriter = keychainWriter
        self.keychainDeleter = keychainDeleter
    }

    func loadSettings() -> HomeBasePairedSettings {
        HomeBasePairedSettings(
            serverURL: normalized(userDefaults.string(forKey: Keys.serverURL)) ?? HomeBasePairedSettings.defaultServerURL,
            tlsPin: normalized(userDefaults.string(forKey: Keys.tlsPin)) ?? "",
            pairedClientId: normalized(userDefaults.string(forKey: Keys.pairedClientId)) ?? "",
            username: normalized(userDefaults.string(forKey: Keys.username)) ?? "",
            ambulatoryId: normalized(userDefaults.string(forKey: Keys.ambulatoryId)) ?? ""
        )
    }

    func loadSnapshot() throws -> HomeBasePairedSnapshot {
        let token = try keychainReader(service, account).get() ?? ""
        return HomeBasePairedSnapshot(settings: loadSettings(), pairedClientToken: normalized(token) ?? "")
    }

    func save(settings: HomeBasePairedSettings, pairedClientToken: String) throws {
        persist(settings.serverURL, forKey: Keys.serverURL)
        persist(settings.tlsPin, forKey: Keys.tlsPin)
        persist(settings.pairedClientId, forKey: Keys.pairedClientId)
        persist(settings.username, forKey: Keys.username)
        persist(settings.ambulatoryId, forKey: Keys.ambulatoryId)

        let trimmedToken = normalized(pairedClientToken) ?? ""
        if trimmedToken.isEmpty {
            try keychainDeleter(service, account).get()
        } else {
            try keychainWriter(service, account, trimmedToken).get()
        }
    }

    func clear() throws {
        userDefaults.removeObject(forKey: Keys.serverURL)
        userDefaults.removeObject(forKey: Keys.tlsPin)
        userDefaults.removeObject(forKey: Keys.pairedClientId)
        userDefaults.removeObject(forKey: Keys.username)
        userDefaults.removeObject(forKey: Keys.ambulatoryId)
        try keychainDeleter(service, account).get()
    }

    private func persist(_ value: String, forKey key: String) {
        guard let normalizedValue = normalized(value) else {
            userDefaults.removeObject(forKey: key)
            return
        }
        userDefaults.set(normalizedValue, forKey: key)
    }

    private func normalized(_ value: String?) -> String? {
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? nil : trimmed
    }

    private static func readToken(service: String, account: String) -> Result<String?, HomeBasePairedStoreError> {
        let context = LAContext()
        context.interactionNotAllowed = true
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
            kSecUseAuthenticationContext as String: context
        ]

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        switch status {
        case errSecSuccess:
            guard let data = item as? Data else {
                return .failure(.keychainRead(errSecInternalComponent))
            }
            guard let token = String(data: data, encoding: .utf8) else {
                return .failure(.keychainRead(errSecInternalComponent))
            }
            return .success(token)
        case errSecItemNotFound:
            return .success(nil)
        default:
            return .failure(.keychainRead(status))
        }
    }

    private static func writeToken(service: String, account: String, token: String) -> Result<Void, HomeBasePairedStoreError> {
        let data = Data(token.utf8)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        let attributes: [String: Any] = [
            kSecValueData as String: data
        ]

        let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            var addQuery = query
            addQuery[kSecValueData as String] = data
            let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
            guard addStatus == errSecSuccess else {
                return .failure(.keychainWrite(addStatus))
            }
            return .success(())
        }

        guard status == errSecSuccess else {
            return .failure(.keychainWrite(status))
        }
        return .success(())
    }

    private static func deleteToken(service: String, account: String) -> Result<Void, HomeBasePairedStoreError> {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            return .failure(.keychainDelete(status))
        }
        return .success(())
    }
}
