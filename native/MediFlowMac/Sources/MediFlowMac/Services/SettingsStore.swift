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
        self.token = LocalAPITokenProvider.shared.token() ?? ""
    }

    /* @Codex */
    func refreshTokenFromKeychain() {
        if let token = LocalAPITokenProvider.shared.token(allowKeychain: true) {
            self.token = token
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
            /* @Codex */
            LocalAPITokenProvider.shared.cache(token: token)
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
            /* @Codex */
            LocalAPITokenProvider.shared.cache(token: "")
            errorMessage = nil
        } catch {
            errorMessage = "Errore nella rimozione del token."
        }
    }
}
