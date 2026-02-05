// Codex: created 2026-02-01
import Foundation
import Security

/* @Codex */
enum KeychainReadResult {
    case success(String)
    case notFound
    case userCanceled
    case authFailed
    case interactionNotAllowed
    case other(OSStatus)
}

enum KeychainService {
    private static let service = "com.mediflow.local-api"
    private static let account = "token"

    /* @Codex */
    static func readTokenResult(allowInteraction: Bool = false) -> KeychainReadResult {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
            /* @Codex */
            kSecUseAuthenticationUI as String: allowInteraction ? kSecUseAuthenticationUIAllow : kSecUseAuthenticationUIFail
        ]

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        switch status {
        case errSecSuccess:
            if let data = item as? Data, let token = String(data: data, encoding: .utf8) {
                return .success(token)
            }
            return .other(errSecInternalComponent)
        case errSecItemNotFound:
            return .notFound
        case errSecUserCanceled:
            return .userCanceled
        case errSecAuthFailed:
            return .authFailed
        case errSecInteractionNotAllowed:
            return .interactionNotAllowed
        default:
            return .other(status)
        }
    }

    /* @Codex */
    static func readToken() -> String? {
        if case let .success(token) = readTokenResult() {
            return token
        }
        return nil
    }

    static func saveToken(_ token: String?) throws {
        let trimmed = token?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if trimmed.isEmpty {
            try deleteToken()
            return
        }

        let data = Data(trimmed.utf8)
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
                throw NSError(domain: "Keychain", code: Int(addStatus))
            }
            return
        }

        guard status == errSecSuccess else {
            throw NSError(domain: "Keychain", code: Int(status))
        }
    }

    static func deleteToken() throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]

        let status = SecItemDelete(query as CFDictionary)
        if status == errSecItemNotFound || status == errSecSuccess {
            return
        }

        throw NSError(domain: "Keychain", code: Int(status))
    }
}
