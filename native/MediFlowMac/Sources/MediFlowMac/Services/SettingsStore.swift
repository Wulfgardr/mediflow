// Codex: created 2026-02-01
import Foundation

@MainActor
final class SettingsStore: ObservableObject {
    static let shared = SettingsStore()

    @Published var baseURLString: String
    @Published var tlsPin: String
    @Published var token: String
    @Published var errorMessage: String?

    private init() {
        LocalAPIBootstrap.applyIfNeeded()
        self.baseURLString = LocalAPISettings.loadBaseURLString()
        self.tlsPin = LocalAPISettings.loadTLSPin()
        /* @Codex */
        switch LocalAPITokenProvider.shared.resolveToken() {
        case .resolved(let token, _):
            self.token = token
        case .failure:
            self.token = ""
        }
    }

    /* @Codex */
    func refreshTokenFromKeychain() {
        switch LocalAPITokenProvider.shared.resolveKeychainToken(allowInteraction: true) {
        case .resolved(let token, _):
            self.token = token
            errorMessage = nil
        case .failure(let failure):
            errorMessage = failure.localizedDescription
        }
    }

    @discardableResult
    func save() -> Bool {
        let trimmedURL = baseURLString.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: trimmedURL), url.scheme?.lowercased() == "https" else {
            errorMessage = "La base URL deve usare HTTPS."
            return false
        }

        LocalAPISettings.saveBaseURLString(trimmedURL)
        LocalAPISettings.saveTLSPin(tlsPin.trimmingCharacters(in: .whitespacesAndNewlines))

        do {
            try KeychainService.saveToken(token)
            errorMessage = nil
            return true
        } catch {
            errorMessage = "Errore nel salvataggio del token."
            return false
        }
    }

    func clearToken() {
        do {
            try KeychainService.deleteToken()
            token = ""
            errorMessage = nil
        } catch {
            errorMessage = "Errore nella rimozione del token."
        }
    }
}
