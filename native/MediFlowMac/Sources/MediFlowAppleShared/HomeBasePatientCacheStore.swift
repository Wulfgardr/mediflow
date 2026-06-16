// Codex: created 2026-05-02
// @Codex
import CryptoKit
import Foundation
import Security

/* @Codex */
struct HomeBasePatientListCacheSnapshot: Equatable, Sendable {
    let serverURL: String
    let ambulatoryId: String?
    let cachedAt: Date
    let patients: [HomeBasePatientSummary]

    var reviewLine: String {
        let formatter = DateFormatter()
        formatter.dateStyle = .short
        formatter.timeStyle = .short
        return "\(patients.count) pazienti da cache locale, aggiornata \(formatter.string(from: cachedAt))."
    }
}

/* @Codex */
enum HomeBasePatientCacheStoreError: LocalizedError, Equatable {
    case applicationSupportUnavailable
    case keychainRead(OSStatus)
    case keychainWrite(OSStatus)
    case encryptionFailed
    case decryptionFailed

    var errorDescription: String? {
        switch self {
        case .applicationSupportUnavailable:
            return "Cartella Application Support non disponibile per la cache mobile."
        case .keychainRead(let status):
            return "Impossibile leggere la chiave cache dal Portachiavi (\(status))."
        case .keychainWrite(let status):
            return "Impossibile salvare la chiave cache nel Portachiavi (\(status))."
        case .encryptionFailed:
            return "Impossibile cifrare la cache pazienti."
        case .decryptionFailed:
            return "Impossibile decifrare la cache pazienti."
        }
    }
}

/* @Codex */
struct HomeBasePatientCacheStore {
    static let shared = HomeBasePatientCacheStore()

    private static let defaultService = "com.mediflow.home-base-patient-cache"
    private static let defaultAccount = "cache-key-v1"
    private static let cacheFileName = "home-base-patient-list-cache.v1"

    private let fileManager: FileManager
    private let cacheDirectory: URL
    private let keyProvider: () throws -> SymmetricKey
    private let now: () -> Date
    private let maxCacheAge: TimeInterval

    init(
        fileManager: FileManager = .default,
        cacheDirectory: URL? = nil,
        keyProvider: @escaping () throws -> SymmetricKey = HomeBasePatientCacheStore.loadOrCreateCacheKey,
        now: @escaping () -> Date = Date.init,
        maxCacheAge: TimeInterval = 24 * 60 * 60
    ) {
        self.fileManager = fileManager
        self.cacheDirectory = cacheDirectory ?? Self.defaultCacheDirectory(fileManager: fileManager)
        self.keyProvider = keyProvider
        self.now = now
        self.maxCacheAge = maxCacheAge
    }

    func loadPatientList(serverURL: String, ambulatoryId: String?) throws -> HomeBasePatientListCacheSnapshot? {
        let url = cacheURL
        guard fileManager.fileExists(atPath: url.path) else { return nil }

        let encrypted = try Data(contentsOf: url)
        let envelope = try JSONDecoder().decode(EncryptedCacheEnvelope.self, from: encrypted)
        let box = try AES.GCM.SealedBox(
            nonce: AES.GCM.Nonce(data: envelope.nonce),
            ciphertext: envelope.ciphertext,
            tag: envelope.tag
        )
        let plaintext: Data
        do {
            plaintext = try AES.GCM.open(box, using: keyProvider())
        } catch {
            throw HomeBasePatientCacheStoreError.decryptionFailed
        }

        let payload = try Self.decoder.decode(CachePayload.self, from: plaintext)
        guard payload.serverURL == normalized(serverURL),
              payload.ambulatoryId == normalized(ambulatoryId) else {
            return nil
        }
        guard now().timeIntervalSince(payload.cachedAt) <= maxCacheAge else {
            return nil
        }

        return HomeBasePatientListCacheSnapshot(
            serverURL: payload.serverURL,
            ambulatoryId: payload.ambulatoryId,
            cachedAt: payload.cachedAt,
            patients: payload.patients
        )
    }

    func savePatientList(
        _ patients: [HomeBasePatientSummary],
        serverURL: String,
        ambulatoryId: String?
    ) throws {
        try fileManager.createDirectory(at: cacheDirectory, withIntermediateDirectories: true)
        let payload = CachePayload(
            version: 1,
            serverURL: normalized(serverURL),
            ambulatoryId: normalized(ambulatoryId),
            cachedAt: now(),
            patients: patients
        )
        let plaintext = try Self.encoder.encode(payload)
        let box: AES.GCM.SealedBox
        do {
            box = try AES.GCM.seal(plaintext, using: keyProvider())
        } catch {
            throw HomeBasePatientCacheStoreError.encryptionFailed
        }
        let envelope = EncryptedCacheEnvelope(
            version: 1,
            nonce: Data(box.nonce),
            ciphertext: box.ciphertext,
            tag: box.tag
        )
        let encrypted = try JSONEncoder().encode(envelope)
        try encrypted.write(to: cacheURL, options: .atomic)
    }

    func clear() throws {
        let url = cacheURL
        guard fileManager.fileExists(atPath: url.path) else { return }
        try fileManager.removeItem(at: url)
    }

    private var cacheURL: URL {
        cacheDirectory.appendingPathComponent(Self.cacheFileName, isDirectory: false)
    }

    private static var encoder: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }

    private static var decoder: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }

    private static func defaultCacheDirectory(fileManager: FileManager) -> URL {
        if let support = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first {
            return support.appendingPathComponent("MediFlow", isDirectory: true)
        }
        return fileManager.temporaryDirectory.appendingPathComponent("MediFlow", isDirectory: true)
    }

    private static func loadOrCreateCacheKey() throws -> SymmetricKey {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: defaultService,
            kSecAttrAccount as String: defaultAccount,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]

        var item: CFTypeRef?
        let readStatus = SecItemCopyMatching(query as CFDictionary, &item)
        if readStatus == errSecSuccess {
            guard let data = item as? Data else {
                throw HomeBasePatientCacheStoreError.keychainRead(errSecInternalComponent)
            }
            return SymmetricKey(data: data)
        }
        guard readStatus == errSecItemNotFound else {
            throw HomeBasePatientCacheStoreError.keychainRead(readStatus)
        }

        var keyData = Data(count: 32)
        let result = keyData.withUnsafeMutableBytes { buffer in
            SecRandomCopyBytes(kSecRandomDefault, buffer.count, buffer.baseAddress!)
        }
        guard result == errSecSuccess else {
            throw HomeBasePatientCacheStoreError.keychainWrite(result)
        }

        var addQuery = query
        addQuery[kSecReturnData as String] = nil
        addQuery[kSecMatchLimit as String] = nil
        addQuery[kSecValueData as String] = keyData
        addQuery[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let writeStatus = SecItemAdd(addQuery as CFDictionary, nil)
        guard writeStatus == errSecSuccess || writeStatus == errSecDuplicateItem else {
            throw HomeBasePatientCacheStoreError.keychainWrite(writeStatus)
        }
        return SymmetricKey(data: keyData)
    }

    private func normalized(_ value: String?) -> String? {
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? nil : trimmed
    }

    private func normalized(_ value: String) -> String {
        value.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

private struct CachePayload: Codable {
    let version: Int
    let serverURL: String
    let ambulatoryId: String?
    let cachedAt: Date
    let patients: [HomeBasePatientSummary]
}

private struct EncryptedCacheEnvelope: Codable {
    let version: Int
    let nonce: Data
    let ciphertext: Data
    let tag: Data
}
