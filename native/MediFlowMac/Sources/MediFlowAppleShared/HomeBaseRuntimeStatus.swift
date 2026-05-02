// Codex: created 2026-05-02
// @Codex
import Foundation

public enum HomeBaseRuntimeComponentState: String, Codable, Equatable, Sendable {
    case ready
    case missing
    case mismatch
    case unknown

    public var title: String {
        switch self {
        case .ready:
            return "Pronto"
        case .missing:
            return "Mancante"
        case .mismatch:
            return "Da verificare"
        case .unknown:
            return "Non rilevato"
        }
    }
}

public struct HomeBaseRuntimeComponent: Identifiable, Equatable, Sendable {
    public let id: String
    public let title: String
    public let detail: String
    public let state: HomeBaseRuntimeComponentState

    public init(id: String, title: String, detail: String, state: HomeBaseRuntimeComponentState) {
        self.id = id
        self.title = title
        self.detail = detail
        self.state = state
    }
}

public struct HomeBaseRuntimeSnapshot: Equatable, Sendable {
    public let dataDirectory: String
    public let baseURL: String?
    public let tlsPin: String?
    public let networkMode: String?
    public let generatedAt: String?
    public let port: Int?
    public let bindHost: String?
    public let httpTarget: String?
    public let certPath: String?
    public let keyPath: String?
    public let proxyPidPath: String?
    public let tokenPresent: Bool
    public let statusFilePresent: Bool
    public let tlsPinMatches: Bool?
    public let components: [HomeBaseRuntimeComponent]

    public var summary: String {
        if statusFilePresent {
            return "Bootstrap locale registrato. La app osserva lo stato runtime, ma non supervisiona ancora i processi."
        }
        return "Nessun bootstrap runtime registrato. Avvia il launcher corrente o riesegui il setup nativo."
    }

    public init(
        dataDirectory: String,
        baseURL: String?,
        tlsPin: String?,
        networkMode: String?,
        generatedAt: String?,
        port: Int?,
        bindHost: String?,
        httpTarget: String?,
        certPath: String?,
        keyPath: String?,
        proxyPidPath: String?,
        tokenPresent: Bool,
        statusFilePresent: Bool,
        tlsPinMatches: Bool?,
        components: [HomeBaseRuntimeComponent]
    ) {
        self.dataDirectory = dataDirectory
        self.baseURL = baseURL
        self.tlsPin = tlsPin
        self.networkMode = networkMode
        self.generatedAt = generatedAt
        self.port = port
        self.bindHost = bindHost
        self.httpTarget = httpTarget
        self.certPath = certPath
        self.keyPath = keyPath
        self.proxyPidPath = proxyPidPath
        self.tokenPresent = tokenPresent
        self.statusFilePresent = statusFilePresent
        self.tlsPinMatches = tlsPinMatches
        self.components = components
    }
}

public enum HomeBaseRuntimeStatusLoader {
    public static let defaultDataDirectory = "Library/Application Support/MediFlow"

    public static func defaultDataDirectoryURL(fileManager: FileManager = .default) -> URL {
        fileManager.homeDirectoryForCurrentUser.appendingPathComponent(defaultDataDirectory)
    }

    public static func load(
        dataDirectory: URL = defaultDataDirectoryURL(),
        fileManager: FileManager = .default
    ) -> HomeBaseRuntimeSnapshot {
        let configURL = dataDirectory.appendingPathComponent("native-config.json")
        let statusURL = dataDirectory.appendingPathComponent("runtime-status.json")
        let tokenURL = dataDirectory.appendingPathComponent("local-api-token")

        let config = decode(NativeRuntimeConfig.self, from: configURL)
        let status = decode(RuntimeStatus.self, from: statusURL)
        let pidURL = URL(fileURLWithPath: status?.proxyPidPath ?? dataDirectory.appendingPathComponent("local-api-tls-proxy.pid").path)
        let configPin = normalizedPin(config?.tlsPin)
        let statusPin = normalizedPin(status?.tlsPin)
        let tlsPinMatches: Bool?
        if let configPin, let statusPin {
            tlsPinMatches = configPin == statusPin
        } else {
            tlsPinMatches = nil
        }

        let baseURL = config?.baseURL ?? status?.baseURL
        let tokenPresent = (config?.token.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false)
            || fileManager.fileExists(atPath: tokenURL.path)
        let configPresent = fileManager.fileExists(atPath: configURL.path)
        let statusPresent = fileManager.fileExists(atPath: statusURL.path)
        let pidPresent = fileManager.fileExists(atPath: pidURL.path)
        let networkMode = status?.networkMode

        let components = [
            HomeBaseRuntimeComponent(
                id: "native-config",
                title: "Configurazione nativa",
                detail: configPresent ? "native-config.json disponibile" : "native-config.json non trovato",
                state: configPresent ? .ready : .missing
            ),
            HomeBaseRuntimeComponent(
                id: "local-token",
                title: "Token locale",
                detail: tokenPresent ? "Token presente, contenuto nascosto" : "Token locale assente",
                state: tokenPresent ? .ready : .missing
            ),
            HomeBaseRuntimeComponent(
                id: "tls-proxy",
                title: "Proxy TLS",
                detail: pidPresent ? "PID proxy registrato" : "PID proxy non registrato",
                state: pidPresent ? .ready : .unknown
            ),
            HomeBaseRuntimeComponent(
                id: "tls-pin",
                title: "Fingerprint TLS",
                detail: tlsPinDetail(tlsPinMatches: tlsPinMatches, tlsPin: config?.tlsPin ?? status?.tlsPin),
                state: tlsPinState(tlsPinMatches: tlsPinMatches, tlsPin: config?.tlsPin ?? status?.tlsPin)
            ),
            HomeBaseRuntimeComponent(
                id: "network-mode",
                title: "Modalita rete",
                detail: networkMode ?? "Non registrata nel runtime status",
                state: networkMode == nil ? .unknown : .ready
            )
        ]

        return HomeBaseRuntimeSnapshot(
            dataDirectory: dataDirectory.path,
            baseURL: baseURL,
            tlsPin: config?.tlsPin ?? status?.tlsPin,
            networkMode: networkMode,
            generatedAt: status?.generatedAt,
            port: status?.port,
            bindHost: status?.bindHost,
            httpTarget: status?.httpTarget,
            certPath: status?.certPath,
            keyPath: status?.keyPath,
            proxyPidPath: pidURL.path,
            tokenPresent: tokenPresent,
            statusFilePresent: statusPresent,
            tlsPinMatches: tlsPinMatches,
            components: components
        )
    }

    private static func decode<T: Decodable>(_ type: T.Type, from url: URL) -> T? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(T.self, from: data)
    }

    private static func normalizedPin(_ value: String?) -> String? {
        let normalized = value?
            .lowercased()
            .replacingOccurrences(of: ":", with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard let normalized, !normalized.isEmpty else { return nil }
        return normalized
    }

    private static func tlsPinDetail(tlsPinMatches: Bool?, tlsPin: String?) -> String {
        guard tlsPin?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false else {
            return "Fingerprint non registrato"
        }
        guard let tlsPinMatches else {
            return "Fingerprint presente"
        }
        return tlsPinMatches ? "Fingerprint coerente tra config e runtime" : "Fingerprint config/runtime non allineato"
    }

    private static func tlsPinState(tlsPinMatches: Bool?, tlsPin: String?) -> HomeBaseRuntimeComponentState {
        guard tlsPin?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false else {
            return .missing
        }
        guard let tlsPinMatches else {
            return .ready
        }
        return tlsPinMatches ? .ready : .mismatch
    }
}

private struct NativeRuntimeConfig: Decodable {
    let baseURL: String
    let tlsPin: String
    let token: String
}

private struct RuntimeStatus: Decodable {
    let generatedAt: String
    let baseURL: String?
    let tlsPin: String
    let networkMode: String
    let port: Int?
    let bindHost: String?
    let httpTarget: String?
    let certPath: String?
    let keyPath: String?
    let proxyPidPath: String?
}
