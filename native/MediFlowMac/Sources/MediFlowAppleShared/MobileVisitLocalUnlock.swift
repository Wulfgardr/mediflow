import CryptoKit
import Foundation
import LocalAuthentication
import Security

@MainActor
protocol MobileVisitUnlocking: AnyObject {
    func unlock(createIfMissing: Bool) async throws -> SymmetricKey
    func invalidate()
}

@MainActor
final class MobileVisitLocalUnlock: MobileVisitUnlocking {
    private var context: LAContext?
    private var generation = UUID()

    func invalidate() {
        generation = UUID()
        context?.invalidate()
        context = nil
    }

    func unlock(createIfMissing: Bool) async throws -> SymmetricKey {
        invalidate()
        let ticket = generation
        let auth = LAContext()
        context = auth
        auth.localizedReason = "Apri dossier visita e appunti MediFlow"
        defer { auth.invalidate(); if ticket == generation { context = nil } }
        let key = try await Task.detached { try Self.readKey(auth: auth, createIfMissing: createIfMissing) }.value
        guard ticket == generation, !Task.isCancelled else { throw MobileVisitError.locked }
        return key
    }

    nonisolated private static func readKey(auth: LAContext, createIfMissing: Bool) throws -> SymmetricKey {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "com.mediflow.mobile-visit",
            kSecAttrAccount as String: "device-key-v1",
            kSecAttrSynchronizable as String: false,
            kSecUseAuthenticationContext as String: auth,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecSuccess, let data = item as? Data, data.count == 32 { return SymmetricKey(data: data) }
        guard status == errSecItemNotFound, createIfMissing else { throw MobileVisitError.denied }
        guard auth.canEvaluatePolicy(.deviceOwnerAuthentication, error: nil),
              let access = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly,
                                                          .userPresence, nil) else { throw MobileVisitError.denied }
        let key = SymmetricKey(size: .bits256)
        var add = query
        add[kSecReturnData as String] = nil
        add[kSecMatchLimit as String] = nil
        add[kSecAttrAccessControl as String] = access
        add[kSecValueData as String] = key.withUnsafeBytes { Data($0) }
        let added = SecItemAdd(add as CFDictionary, nil)
        guard added == errSecSuccess || added == errSecDuplicateItem else { throw MobileVisitError.denied }
        item = nil
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data, data.count == 32 else { throw MobileVisitError.denied }
        return SymmetricKey(data: data)
    }
}
