/* @Codex */
import Foundation

/* @Codex */
enum LocalAPITokenSource: Equatable {
    case keychain
    case config
    case legacyFile
}

/* @Codex */
enum LocalAPITokenBootstrapFailure: LocalizedError, Equatable {
    case notFound
    case keychainAccessCanceled
    case keychainAuthFailed
    case keychainInteractionNotAllowed
    case keychainUnavailable

    var errorDescription: String? {
        switch self {
        case .notFound:
            return "Token API locale assente. Salvalo nel Portachiavi o nella configurazione locale."
        case .keychainAccessCanceled:
            return "Lettura del token dal Portachiavi annullata."
        case .keychainAuthFailed:
            return "Bootstrap token incompleto. Il token nel Portachiavi non è accessibile."
        case .keychainInteractionNotAllowed:
            return "Bootstrap token incompleto. Sblocca il Portachiavi per usare il token locale."
        case .keychainUnavailable:
            return "Bootstrap token incompleto. Impossibile leggere il Portachiavi locale."
        }
    }
}

/* @Codex */
enum LocalAPITokenResolution: Equatable {
    case resolved(String, source: LocalAPITokenSource)
    case failure(LocalAPITokenBootstrapFailure)
}

final class LocalAPITokenProvider {
    static let shared = LocalAPITokenProvider()

    private let keychainReader: (Bool) -> KeychainReadResult
    private let configReader: () -> String?
    private let legacyReader: () -> String?

    init(
        keychainReader: @escaping (Bool) -> KeychainReadResult = { allowInteraction in
            KeychainService.readTokenResult(allowInteraction: allowInteraction)
        },
        configReader: @escaping () -> String? = {
            LocalAPITokenProvider.readConfigToken()
        },
        legacyReader: @escaping () -> String? = {
            LocalAPITokenProvider.readLegacyTokenFile()
        }
    ) {
        self.keychainReader = keychainReader
        self.configReader = configReader
        self.legacyReader = legacyReader
    }

    func resolveToken() -> LocalAPITokenResolution {
        let keychainResolution = resolveKeychainToken(allowInteraction: false)
        switch keychainResolution {
        case .resolved:
            return keychainResolution
        case .failure(.notFound):
            break
        case .failure(let failure):
            return .failure(failure)
        }

        if let token = normalizedToken(configReader()) {
            return .resolved(token, source: .config)
        }

        if let token = normalizedToken(legacyReader()) {
            return .resolved(token, source: .legacyFile)
        }

        return .failure(.notFound)
    }

    func token() -> String? {
        guard case let .resolved(token, _) = resolveToken() else { return nil }
        return token
    }

    func resolveKeychainToken(allowInteraction: Bool = true) -> LocalAPITokenResolution {
        switch keychainReader(allowInteraction) {
        case .success(let token):
            guard let token = normalizedToken(token) else {
                return .failure(.notFound)
            }
            return .resolved(token, source: .keychain)
        case .notFound:
            return .failure(.notFound)
        case .userCanceled:
            return .failure(.keychainAccessCanceled)
        case .authFailed:
            return .failure(.keychainAuthFailed)
        case .interactionNotAllowed:
            return .failure(.keychainInteractionNotAllowed)
        case .other:
            return .failure(.keychainUnavailable)
        }
    }

    func keychainToken(allowInteraction: Bool = true) -> String? {
        guard case let .resolved(token, _) = resolveKeychainToken(allowInteraction: allowInteraction) else {
            return nil
        }
        return token
    }

    private static func readConfigToken() -> String? {
        guard let config = LocalAPIBootstrap.loadConfig() else { return nil }
        let token = config.token?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return token.isEmpty ? nil : token
    }

    private static func readLegacyTokenFile() -> String? {
        let fileName = "local-api-token"
        let fileURL = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library")
            .appendingPathComponent("Application Support")
            .appendingPathComponent("MediFlow", isDirectory: true)
            .appendingPathComponent(fileName)

        guard FileManager.default.fileExists(atPath: fileURL.path) else { return nil }
        guard let content = try? String(contentsOf: fileURL, encoding: .utf8) else { return nil }
        let trimmed = content.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    private func normalizedToken(_ token: String?) -> String? {
        let trimmed = token?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? nil : trimmed
    }
}
