// @Codex
import CryptoKit
import Foundation
import Security

/* @Codex */
struct HomeBasePatientCacheContext: Codable, Equatable, Sendable {
    let serverURL: String
    let ambulatoryId: String?
    let tlsPin: String
    let pairedClientId: String
    let pairedTokenDigest: Data
    let operatorId: String
    let sessionDigest: Data

    init?(serverURL: String, ambulatoryId: String?, tlsPin: String,
          credentials: HomeBasePairedCredentials, operatorId: String, sessionCookie: String) {
        let server = serverURL.trimmingCharacters(in: .whitespacesAndNewlines)
        let pin = tlsPin.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: server), url.scheme == "https", url.host != nil,
              !pin.isEmpty, !credentials.clientId.isEmpty, !credentials.clientToken.isEmpty,
              !operatorId.isEmpty, !sessionCookie.isEmpty else { return nil }
        self.serverURL = server
        self.ambulatoryId = ambulatoryId?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
        self.tlsPin = pin
        self.pairedClientId = credentials.clientId
        self.pairedTokenDigest = Data(SHA256.hash(data: Data(credentials.clientToken.utf8)))
        self.operatorId = operatorId
        self.sessionDigest = Data(SHA256.hash(data: Data(sessionCookie.utf8)))
    }
}

/* @Codex */
struct HomeBasePatientCacheMetadata: Equatable, Sendable {
    enum ExpiryReason: Equatable, Sendable { case ttlExceeded, clockMovedBackwards }
    let cachedAt: Date
    let expiresAt: Date
    let patientCount: Int
    let expiryReason: ExpiryReason?
    var isStale: Bool { expiryReason != nil }

    var reviewLine: String {
        let acquired = cachedAt.formatted(date: .numeric, time: .shortened)
        let expiry = expiresAt.formatted(date: .numeric, time: .shortened)
        let reason: String
        switch expiryReason {
        case .ttlExceeded: reason = "Cache scaduta: TTL di consultazione superato. Dati paziente non disponibili."
        case .clockMovedBackwards: reason = "Orologio precedente all’acquisizione. Dati paziente non disponibili."
        case nil: reason = "Copia storica in sola lettura; aggiornamenti del Mac non verificati."
        }
        return "Ultima lista: \(patientCount) pazienti. Copia acquisita \(acquired); scadenza \(expiry). \(reason)"
    }
}

/* @Codex */
struct HomeBasePatientListCacheSnapshot: Equatable, Sendable {
    let metadata: HomeBasePatientCacheMetadata
    let patients: [HomeBasePatientSummary]
}

/* @Codex */
struct HomeBasePatientDetailCacheSnapshot: Equatable, Sendable {
    let metadata: HomeBasePatientCacheMetadata
    let patient: HomeBasePatientDetail?
}

/* @Codex */
enum HomeBasePatientCacheStoreError: LocalizedError, Equatable {
    case applicationSupportUnavailable
    case keychainRead(OSStatus)
    case keychainWrite(OSStatus)
    case encryptionFailed
    case decryptionFailed
    case invalidSnapshot

    var errorDescription: String? {
        switch self {
        case .applicationSupportUnavailable: return "Cartella Application Support non disponibile per la cache mobile."
        case .keychainRead(let status): return "Impossibile leggere la chiave cache dal Portachiavi (\(status))."
        case .keychainWrite(let status): return "Impossibile salvare la chiave cache nel Portachiavi (\(status))."
        case .encryptionFailed: return "Impossibile cifrare la cache pazienti."
        case .decryptionFailed: return "Impossibile decifrare la cache pazienti."
        case .invalidSnapshot: return "La cache pazienti non rispetta il contratto atteso."
        }
    }
}

/* @Codex */
struct HomeBasePatientCacheStore {
    static let shared = HomeBasePatientCacheStore()
    private static let defaultService = "com.mediflow.home-base-patient-cache"
    private static let defaultAccount = "cache-key-v1"
    // Reuse the existing encrypted location. An unbound v1 envelope is not readable.
    private static let cacheFileName = "home-base-patient-list-cache.v1"
    private let fileManager: FileManager
    private let cacheDirectory: URL
    private let keyProvider: () throws -> SymmetricKey
    private let now: () -> Date
    private let maxCacheAge: TimeInterval

    init(fileManager: FileManager = .default, cacheDirectory: URL? = nil,
         keyProvider: @escaping () throws -> SymmetricKey = { try HomeBasePatientCacheStore.loadOrCreateCacheKey() },
         identityCacheLoader: ((String, String) throws -> SymmetricKey)? = nil,
         cacheService: String = HomeBasePatientCacheStore.defaultService,
         cacheAccount: String = HomeBasePatientCacheStore.defaultAccount,
         now: @escaping () -> Date = Date.init, maxCacheAge: TimeInterval = 24 * 60 * 60) {
        self.fileManager = fileManager
        self.cacheDirectory = cacheDirectory ?? Self.defaultCacheDirectory(fileManager: fileManager)
        self.keyProvider = identityCacheLoader.map { loader in { try loader(cacheService, cacheAccount) } } ?? keyProvider
        self.now = now
        self.maxCacheAge = min(max(maxCacheAge, 0), 24 * 60 * 60)
    }

    func loadPatientList(context: HomeBasePatientCacheContext) throws -> HomeBasePatientListCacheSnapshot? {
        guard let payload = try loadPayload(context: context) else { return nil }
        let metadata = metadata(for: payload.cachedAt, count: payload.patients.count)
        return HomeBasePatientListCacheSnapshot(metadata: metadata, patients: metadata.isStale ? [] : payload.patients)
    }

    func savePatientList(_ patients: [HomeBasePatientSummary], context: HomeBasePatientCacheContext) throws {
        let active = patients.filter { $0.deletedAt == nil }
        let previous = try loadPayload(context: context)
        let retainedDetail = previous?.detail.flatMap { detail in
            active.contains(where: { matches($0, detail.patient) }) ? detail : nil
        }
        try savePayload(CachePayload(version: 2, context: context, cachedAt: now(), patients: active, detail: retainedDetail))
    }

    func savePatientDetail(_ patient: HomeBasePatientDetail, context: HomeBasePatientCacheContext) throws {
        guard let list = try loadPayload(context: context),
              !metadata(for: list.cachedAt, count: list.patients.count).isStale,
              patient.deletedAt == nil,
              context.ambulatoryId == nil || context.ambulatoryId == patient.ambulatoryId,
              list.patients.contains(where: { matches($0, patient) }) else { return }
        // Persist the host representation, never an already-decrypted field or AI/document artifact.
        let profile = HomeBasePatientDetail(
            id: patient.id, firstName: patient.firstName, lastName: patient.lastName,
            birthDate: patient.birthDate, taxCode: patient.taxCode, address: patient.address,
            phone: patient.phone, caregiver: patient.caregiver, exemptions: patient.exemptions,
            diagnoses: patient.diagnoses, monitoringProfile: nil, statusReason: patient.statusReason,
            notes: patient.notes, aiSummary: nil, documentInsights: nil, isAdi: patient.isAdi,
            isArchived: patient.isArchived, version: patient.version, ambulatoryId: patient.ambulatoryId,
            createdAt: patient.createdAt, updatedAt: patient.updatedAt)
        try savePayload(CachePayload(version: 2, context: context, cachedAt: list.cachedAt,
            patients: list.patients, detail: CachedDetail(cachedAt: now(), patient: profile)))
    }

    func loadPatientDetail(patientID: String, context: HomeBasePatientCacheContext) throws -> HomeBasePatientDetailCacheSnapshot? {
        guard let payload = try loadPayload(context: context), let detail = payload.detail,
              detail.patient.id == patientID,
              payload.patients.contains(where: { matches($0, detail.patient) }) else { return nil }
        // A profile can never outlive the list that authorizes its membership.
        let listMetadata = metadata(for: payload.cachedAt, count: payload.patients.count)
        let profileMetadata = metadata(for: detail.cachedAt, count: payload.patients.count)
        let bounded = HomeBasePatientCacheMetadata(cachedAt: detail.cachedAt,
            expiresAt: min(listMetadata.expiresAt, profileMetadata.expiresAt), patientCount: payload.patients.count,
            expiryReason: listMetadata.expiryReason ?? profileMetadata.expiryReason)
        return HomeBasePatientDetailCacheSnapshot(metadata: bounded, patient: bounded.isStale ? nil : detail.patient)
    }

    func clear() throws {
        guard fileManager.fileExists(atPath: cacheURL.path) else { return }
        try fileManager.removeItem(at: cacheURL)
    }

    private func matches(_ summary: HomeBasePatientSummary, _ detail: HomeBasePatientDetail) -> Bool {
        summary.id == detail.id && summary.version == detail.version && summary.updatedAt == detail.updatedAt
            && summary.deletedAt == nil && detail.deletedAt == nil
    }

    private func metadata(for cachedAt: Date, count: Int) -> HomeBasePatientCacheMetadata {
        let expiry = cachedAt.addingTimeInterval(maxCacheAge)
        let current = now()
        return HomeBasePatientCacheMetadata(cachedAt: cachedAt, expiresAt: expiry, patientCount: count,
            expiryReason: current < cachedAt ? .clockMovedBackwards : (current >= expiry ? .ttlExceeded : nil))
    }

    private func loadPayload(context: HomeBasePatientCacheContext) throws -> CachePayload? {
        guard fileManager.fileExists(atPath: cacheURL.path) else { return nil }
        let envelope = try JSONDecoder().decode(EncryptedCacheEnvelope.self, from: Data(contentsOf: cacheURL))
        guard envelope.version == 2 else { return nil }
        let plaintext: Data
        do {
            let box = try AES.GCM.SealedBox(nonce: AES.GCM.Nonce(data: envelope.nonce),
                ciphertext: envelope.ciphertext, tag: envelope.tag)
            plaintext = try AES.GCM.open(box, using: keyProvider())
        } catch { throw HomeBasePatientCacheStoreError.decryptionFailed }
        let payload = try Self.decoder.decode(CachePayload.self, from: plaintext)
        guard payload.version == 2 else { throw HomeBasePatientCacheStoreError.invalidSnapshot }
        return payload.context == context ? payload : nil
    }

    private func savePayload(_ payload: CachePayload) throws {
        try fileManager.createDirectory(at: cacheDirectory, withIntermediateDirectories: true)
        let plaintext = try Self.encoder.encode(payload)
        let box: AES.GCM.SealedBox
        do { box = try AES.GCM.seal(plaintext, using: keyProvider()) }
        catch { throw HomeBasePatientCacheStoreError.encryptionFailed }
        let envelope = EncryptedCacheEnvelope(version: 2, nonce: Data(box.nonce), ciphertext: box.ciphertext, tag: box.tag)
        try JSONEncoder().encode(envelope).write(to: cacheURL, options: .atomic)
    }

    private var cacheURL: URL { cacheDirectory.appendingPathComponent(Self.cacheFileName, isDirectory: false) }
    private static var encoder: JSONEncoder {
        let encoder = JSONEncoder()
        // This private v2 payload uses Date's exact reference interval. ISO-8601
        // rounding would change revision equality or put cachedAt ahead of now.
        encoder.dateEncodingStrategy = .deferredToDate
        return encoder
    }
    private static var decoder: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .deferredToDate
        return decoder
    }

    private static func defaultCacheDirectory(fileManager: FileManager) -> URL {
        if let support = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first {
            return support.appendingPathComponent("MediFlow", isDirectory: true)
        }
        return fileManager.temporaryDirectory.appendingPathComponent("MediFlow", isDirectory: true)
    }

    static func loadOrCreateCacheKey(
        service: String = HomeBasePatientCacheStore.defaultService,
        account: String = HomeBasePatientCacheStore.defaultAccount
    ) throws -> SymmetricKey {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
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

}

/* @Codex */
private extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}

/* @Codex */
private struct CachePayload: Codable {
    let version: Int
    let context: HomeBasePatientCacheContext
    let cachedAt: Date
    let patients: [HomeBasePatientSummary]
    let detail: CachedDetail?
}

/* @Codex */
private struct CachedDetail: Codable {
    let cachedAt: Date
    let patient: HomeBasePatientDetail
}

/* @Codex */
private struct EncryptedCacheEnvelope: Codable {
    let version: Int
    let nonce: Data
    let ciphertext: Data
    let tag: Data
}
