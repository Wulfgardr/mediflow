// Codex: created 2026-02-01
import Foundation

struct LocalAPIBootstrapConfig: Decodable {
    let baseURL: String?
    let tlsPin: String?
    let token: String?
}

enum LocalAPIBootstrap {
    static func applyIfNeeded() {
        guard let configURL = resolveConfigURL() else { return }
        guard let data = try? Data(contentsOf: configURL) else { return }
        guard let config = try? JSONDecoder().decode(LocalAPIBootstrapConfig.self, from: data) else { return }

        /* @Codex */
        if let baseURL = config.baseURL,
           !baseURL.isEmpty,
           baseURL != LocalAPISettings.loadBaseURLString() {
            LocalAPISettings.saveBaseURLString(baseURL)
        }

        /* @Codex */
        if let tlsPin = config.tlsPin,
           !tlsPin.isEmpty,
           tlsPin != LocalAPISettings.loadTLSPin() {
            LocalAPISettings.saveTLSPin(tlsPin)
        }
    }

    /* @Codex */
    static func resolveConfigURL() -> URL? {
        let fileName = "native-config.json"
        var candidates: [URL] = []

        if let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first {
            candidates.append(appSupport.appendingPathComponent("MediFlow", isDirectory: true).appendingPathComponent(fileName))
        }

        candidates.append(
            FileManager.default.homeDirectoryForCurrentUser
                .appendingPathComponent("Library")
                .appendingPathComponent("Application Support")
                .appendingPathComponent("MediFlow", isDirectory: true)
                .appendingPathComponent(fileName)
        )

        return candidates.first(where: { FileManager.default.fileExists(atPath: $0.path) })
    }

    /* @Codex */
    static func loadConfig() -> LocalAPIBootstrapConfig? {
        guard let configURL = resolveConfigURL() else { return nil }
        guard let data = try? Data(contentsOf: configURL) else { return nil }
        return try? JSONDecoder().decode(LocalAPIBootstrapConfig.self, from: data)
    }
}
