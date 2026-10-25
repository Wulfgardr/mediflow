import CryptoKit
import Foundation

struct MobileVisitStore {
    let directory: URL
    private let fileManager: FileManager
    private let afterSave: (URL) throws -> Void
    private static let aad = Data("MediFlow.mobile-visit.v1".utf8)
    var fileURL: URL { directory.appendingPathComponent("visit-vault.v1") }
    var exists: Bool { fileManager.fileExists(atPath: fileURL.path) }

    init(directory: URL, fileManager: FileManager = .default,
         afterSave: @escaping (URL) throws -> Void = MobileVisitStore.protect) {
        self.directory = directory
        self.fileManager = fileManager
        self.afterSave = afterSave
    }

    static func applicationStore() throws -> Self {
        guard let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else {
            throw MobileVisitError.storage
        }
        return Self(directory: support.appendingPathComponent("MediFlow/VisitDossiers", isDirectory: true))
    }

    func read(key: SymmetricKey) throws -> [MobileVisitRecord] {
        guard exists else { return [] }
        do {
            let ciphertext = try Data(contentsOf: fileURL)
            let plaintext = try AES.GCM.open(AES.GCM.SealedBox(combined: ciphertext), using: key, authenticating: Self.aad)
            let records = try JSONDecoder().decode([MobileVisitRecord].self, from: plaintext)
            guard Set(records.map(\.id)).count == records.count,
                  Set(records.map { $0.note.id }).count == records.count,
                  records.allSatisfy({ $0.dossier.context.isValid && $0.note.context == $0.dossier.context
                      && $0.preparationLoginDigest.count == 32 && $0.note.revision >= 0 && $0.note.text.count <= 100_000
                      && Set($0.dossier.sections.map(\.id)).count == $0.dossier.sections.count
                      && $0.dossier.sections.allSatisfy { Set($0.rows.map(\.id)).count == $0.rows.count } }) else {
                throw MobileVisitError.corrupt
            }
            return records
        } catch { throw MobileVisitError.corrupt }
    }

    func write(_ records: [MobileVisitRecord], key: SymmetricKey) throws {
        do {
            try fileManager.createDirectory(at: directory, withIntermediateDirectories: true,
                                            attributes: [.posixPermissions: 0o700])
            try Self.protect(directory)
            let plaintext = try JSONEncoder().encode(records)
            guard let ciphertext = try AES.GCM.seal(plaintext, using: key, authenticating: Self.aad).combined else {
                throw MobileVisitError.storage
            }
            #if os(iOS)
            try ciphertext.write(to: fileURL, options: [.atomic, .completeFileProtection])
            #else
            try ciphertext.write(to: fileURL, options: .atomic)
            #endif
            try fileManager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: fileURL.path)
            try afterSave(fileURL)
        } catch { throw MobileVisitError.storage }
    }

    static func protect(_ target: URL) throws {
        var url = target
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try url.setResourceValues(values)
        guard try url.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup == true else {
            throw MobileVisitError.storage
        }
        #if os(iOS)
        try FileManager.default.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: url.path)
        let protection = try FileManager.default.attributesOfItem(atPath: url.path)[.protectionKey]
        let rawProtection = (protection as? FileProtectionType)?.rawValue ?? (protection as? String)
        #if targetEnvironment(simulator)
        guard rawProtection == nil || rawProtection == FileProtectionType.complete.rawValue else {
            throw MobileVisitError.storage
        }
        #else
        guard rawProtection == FileProtectionType.complete.rawValue else { throw MobileVisitError.storage }
        #endif
        #endif
    }
}
