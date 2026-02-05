/* @Codex */
import Foundation

final class LocalAPITokenProvider {
    static let shared = LocalAPITokenProvider()

    private var cachedToken: String?
    private var keychainUnavailable = false

    private init() {}

    func token(allowKeychain: Bool = false) -> String? {
        if let cachedToken, !cachedToken.isEmpty {
            return cachedToken
        }

        if allowKeychain && !keychainUnavailable {
            switch KeychainService.readTokenResult(allowInteraction: true) {
            case .success(let token):
                cachedToken = token
                return token
            case .notFound:
                break
            case .userCanceled, .authFailed, .interactionNotAllowed:
                keychainUnavailable = true
            case .other:
                keychainUnavailable = true
            }
        }

        if let token = readConfigToken() {
            cachedToken = token
            return token
        }

        if let token = readLegacyTokenFile() {
            cachedToken = token
            return token
        }

        return nil
    }

    func cache(token: String?) {
        cachedToken = token?.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func readConfigToken() -> String? {
        guard let config = LocalAPIBootstrap.loadConfig() else { return nil }
        let token = config.token?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return token.isEmpty ? nil : token
    }

    private func readLegacyTokenFile() -> String? {
        let fileName = "local-api-token"
        let fileURL = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library")
            .appendingPathComponent("Application Support")
            .appendingPathComponent("MediFlow", isDirectory: true)
            .appendingPathComponent(fileName)

        guard FileManager.default.fileExists(atPath: fileURL.path) else { return nil }
        guard let content = try? String(contentsOf: fileURL) else { return nil }
        let trimmed = content.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
