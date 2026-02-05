// Codex: created 2026-02-01
import Foundation
import CryptoKit

/* @Codex */
struct AuthHealthIssue: Equatable {
    let title: String
    let message: String
    let detail: String?
    /* @Codex */
    let canRepair: Bool
}

@MainActor
final class SecuritySession: ObservableObject {
    static let shared = SecuritySession()

    @Published private(set) var isUnlocked = false
    @Published private(set) var requiresSetup = false
    @Published var errorMessage: String?
    /* @Codex */
    @Published private(set) var healthIssue: AuthHealthIssue?

    private var masterKey: SymmetricKey?
    private var autoLockTimer: Timer?

    private init() {}

    func refreshSetupStatus() async {
        do {
            /* @Codex */
            let status = try await LocalAPIClient.shared.checkAuthStatus()
            if status.status == "error" || status.error != nil {
                requiresSetup = false
                errorMessage = nil
                healthIssue = AuthHealthIssue(
                    title: "Database non disponibile",
                    message: friendlyHealthMessage(code: status.error?.code, fallback: status.error?.message),
                    detail: status.db?.dbPath ?? status.db?.dataDir,
                    canRepair: status.db?.legacyExists == true
                )
                return
            }
            healthIssue = nil
            errorMessage = nil
            requiresSetup = !status.isSetup
        } catch {
            /* @Codex */
            if let urlError = error as? URLError, urlError.code == .cancelled {
                healthIssue = AuthHealthIssue(
                    title: "Handshake TLS fallito",
                    message: "Il certificato locale e il PIN TLS non coincidono. Rigenera la configurazione locale e riprova.",
                    detail: nil,
                    canRepair: false
                )
                return
            }
            healthIssue = AuthHealthIssue(
                title: "Verifica fallita",
                message: error.localizedDescription,
                detail: nil,
                canRepair: false
            )
        }
    }

    func unlock(pin: String) async -> Bool {
        guard !pin.isEmpty else {
            errorMessage = "Inserisci il PIN"
            return false
        }

        do {
            let auth = try await LocalAPIClient.shared.login(pin: pin)
            guard let saltData = Data(base64Encoded: auth.salt) else {
                throw CryptoService.CryptoError(message: "Salt non valida")
            }
            let kek = try CryptoService.deriveKeyFromPin(pin: pin, salt: saltData)
            let key = try CryptoService.unwrapMasterKey(encryptedMasterKeyB64: auth.encryptedMasterKey, kek: kek)
            masterKey = key
            isUnlocked = true
            errorMessage = nil
            /* @Codex */
            healthIssue = nil
            scheduleAutoLock()
            return true
        } catch {
            errorMessage = "PIN non valido"
            return false
        }
    }

    func setup(pin: String, displayName: String, ambulatoryName: String) async -> Bool {
        guard !pin.isEmpty else {
            errorMessage = "Inserisci un PIN"
            return false
        }

        do {
            let salt = Data((0..<16).map { _ in UInt8.random(in: 0...255) })
            let kek = try CryptoService.deriveKeyFromPin(pin: pin, salt: salt)
            let masterKey = SymmetricKey(size: .bits256)
            let encryptedMasterKey = try wrapMasterKey(masterKey: masterKey, kek: kek)
            let saltB64 = salt.base64EncodedString()

            try await LocalAPIClient.shared.setup(pin: pin, displayName: displayName, ambulatoryName: ambulatoryName, encryptedMasterKey: encryptedMasterKey, salt: saltB64)
            self.masterKey = masterKey
            isUnlocked = true
            requiresSetup = false
            errorMessage = nil
            /* @Codex */
            healthIssue = nil
            scheduleAutoLock()
            return true
        } catch let error as AuthFlowError {
            /* @Codex */
            switch error {
            case .setupAlreadyCompleted:
                requiresSetup = false
                let unlocked = await unlock(pin: pin)
                if !unlocked {
                    errorMessage = "Setup già completato. Inserisci il PIN esistente."
                }
                return unlocked
            case .httpStatus:
                errorMessage = error.localizedDescription
                return false
            }
        } catch {
            errorMessage = "Setup fallito"
            return false
        }
    }

    func lock() {
        masterKey = nil
        isUnlocked = false
        errorMessage = nil
        autoLockTimer?.invalidate()
        autoLockTimer = nil
    }

    /* @Codex */
    func repairFromLegacy() async -> Bool {
        do {
            try await LocalAPIClient.shared.repairDbFromLegacy()
            await refreshSetupStatus()
            return true
        } catch {
            errorMessage = "Ripristino fallito"
            return false
        }
    }

    /* @Codex */
    private func friendlyHealthMessage(code: String?, fallback: String?) -> String {
        switch code {
        case "DB_SCHEMA_MISSING":
            return "Schema del database mancante. Ripristina un DB valido o esegui le migrazioni."
        case "DB_QUERY_FAILED":
            return "Impossibile leggere il database locale. Verifica permessi e integrità del file."
        case "DATA_DIR_UNAVAILABLE":
            return "Cartella dati non accessibile. Verifica permessi e percorso."
        case "AUTH_CHECK_FAILED":
            return "Impossibile verificare lo stato di sicurezza."
        default:
            return fallback ?? "Verifica il file medical.db e la cartella dati."
        }
    }

    func decryptString(_ value: String?) -> String? {
        guard let value else { return nil }
        if !value.hasPrefix(CryptoService.encryptedPrefix) { return value }
        guard let masterKey else { return nil }
        return CryptoService.decryptIfNeeded(value, with: masterKey)
    }

    func encryptString(_ value: String?) throws -> String? {
        guard let value, !value.isEmpty else { return nil }
        guard let masterKey else { throw CryptoService.CryptoError(message: "Sessione non sbloccata") }
        return try CryptoService.encryptString(value, with: masterKey)
    }

    private func scheduleAutoLock() {
        autoLockTimer?.invalidate()
        autoLockTimer = Timer.scheduledTimer(withTimeInterval: 15 * 60, repeats: false) { [weak self] _ in
            Task { @MainActor in
                self?.lock()
            }
        }
    }

    private func wrapMasterKey(masterKey: SymmetricKey, kek: SymmetricKey) throws -> String {
        let rawKey = masterKey.withUnsafeBytes { Data($0) }
        let iv = AES.GCM.Nonce()
        let sealedBox = try AES.GCM.seal(rawKey, using: kek, nonce: iv)
        let combined = Data(iv) + sealedBox.ciphertext + sealedBox.tag
        return combined.base64EncodedString()
    }
}
