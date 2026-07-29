#if os(macOS)
import CryptoKit
import Foundation

/// Client for the host's own administration surface.
///
/// The twenty-one capabilities the function map calls `host-only` were never
/// missing a backend: `system/update-awareness`, `system/audit`,
/// `system/network-overview`, `system/native`, `system/backup-restore`,
/// `system/mlx`, `ai/models` and the rest all exist as local API routes, and
/// they authenticate with the operator session cookie — the same cookie this app
/// already holds after login. What was missing was a client. Nothing here adds a
/// contract, a schema or an endpoint.
///
/// **Why these stay off the paired channel.** `/api/v1/network/*` is deliberately
/// the reduced surface a *remote* device is allowed to reach. Backup and restore,
/// database repair, orphan fixing and network-mode changes administer the machine
/// that holds the clinical database; reachable from any paired iPhone on the LAN
/// they would be a remote administration channel over a clinical store. So this
/// client refuses to talk to anything but a home base running on this same Mac
/// (see `HostAdminAvailability`), which is exactly the case the product already
/// describes: on macOS the Mac *is* the home base.
public actor HomeBaseHostAdminClient {
    private let configuration: HomeBaseConnectionConfiguration
    private let session: URLSession

    public init(configuration: HomeBaseConnectionConfiguration) {
        self.configuration = configuration
        let delegate = HostAdminTLSSessionDelegate(expectedPin: configuration.tlsPin)
        let sessionConfiguration = URLSessionConfiguration.ephemeral
        sessionConfiguration.httpShouldSetCookies = false
        session = URLSession(configuration: sessionConfiguration, delegate: delegate, delegateQueue: nil)
    }

    // MARK: - Diagnostics

    public func updateAwareness(sessionCookie: String) async throws -> HostUpdateAwareness {
        try await get(HostUpdateAwareness.self, path: ["api", "system", "update-awareness"], sessionCookie: sessionCookie)
    }

    public func networkOverview(sessionCookie: String) async throws -> HostNetworkOverview {
        try await get(HostNetworkOverview.self, path: ["api", "system", "network-overview"], sessionCookie: sessionCookie)
    }

    /// Audit summary over a window of days.
    ///
    /// Read the cap before trusting the numbers: the route accepts `limit` up to
    /// 1000, but `listAuditEvents` runs it through `normalizeLimit`, which clamps
    /// to 200. Every figure in this summary is therefore computed over **at most
    /// 200 records**, not over the window — and `isTruncated`, which the route
    /// derives from its own unclamped limit, is false with the defaults even when
    /// the clamp did bite. The UI has to say so.
    public func auditSummary(sessionCookie: String, days: Int = 30) async throws -> HostAuditSummary {
        try await get(
            HostAuditSummary.self,
            path: ["api", "system", "audit"],
            query: [
                URLQueryItem(name: "view", value: "summary"),
                URLQueryItem(name: "days", value: String(days)),
            ],
            sessionCookie: sessionCookie
        )
    }

    /// The plain audit list. Note the response is a **bare JSON array**, not an
    /// object with an `entries` key.
    public func auditEvents(sessionCookie: String, limit: Int = 50) async throws -> [HostAuditEvent] {
        try await get(
            [HostAuditEvent].self,
            path: ["api", "system", "audit"],
            query: [URLQueryItem(name: "limit", value: String(limit))],
            sessionCookie: sessionCookie
        )
    }

    public func aiModels(sessionCookie: String) async throws -> HostAIModels {
        try await get(HostAIModels.self, path: ["api", "ai", "models"], sessionCookie: sessionCookie)
    }

    // MARK: - Backup

    public func backupScheduler(sessionCookie: String) async throws -> HostBackupScheduler {
        try await get(
            HostBackupScheduler.self,
            path: ["api", "system", "backup-scheduler"],
            sessionCookie: sessionCookie
        )
    }

    /// The complete clinical archive, as the host serialises it.
    ///
    /// Returned as bytes and never parsed: this is an artifact to be written
    /// somewhere the operator chose, not a model to render. Decoding it would
    /// walk the entire archive through memory to learn nothing the caller needs.
    public func exportBackupArtifact(sessionCookie: String) async throws -> Data {
        var url = try configuration.serverURL()
        for component in ["api", "system", "backup-restore"] { url.appendPathComponent(component) }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue(sessionCookie, forHTTPHeaderField: "Cookie")
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw HostAdminError.transport }
        switch http.statusCode {
        case 200...299: return data
        case 401: throw HostAdminError.sessionExpired
        case 403: throw HostAdminError.forbidden
        default: throw HostAdminError.status(http.statusCode)
        }
    }

    // MARK: - Transport

    /// - Parameter query: several host reads are meaningless without one —
    ///   `audit?view=summary&days=30`, `icd/proxy?q=`. An earlier version of this
    ///   transport could only append path components, which made those endpoints
    ///   unreachable rather than merely unimplemented.
    /// - Parameter decodesBodyOnStatuses: statuses whose body is a documented
    ///   payload rather than an error. `icd/proxy` answers 503 with
    ///   `{"status":"offline"}`: that is the proxy telling us it is down, and
    ///   throwing it away as a plain status code loses the answer.
    private func get<T: Decodable>(
        _ type: T.Type,
        path: [String],
        query: [URLQueryItem] = [],
        sessionCookie: String,
        decodesBodyOnStatuses: Set<Int> = []
    ) async throws -> T {
        var url = try configuration.serverURL()
        for component in path { url.appendPathComponent(component) }
        if !query.isEmpty {
            guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
                throw HostAdminError.transport
            }
            components.queryItems = query
            guard let composed = components.url else { throw HostAdminError.transport }
            url = composed
        }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue(sessionCookie, forHTTPHeaderField: "Cookie")
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw HostAdminError.transport
        }

        if (200...299).contains(http.statusCode) || decodesBodyOnStatuses.contains(http.statusCode) {
            do {
                return try JSONDecoder().decode(T.self, from: data)
            } catch {
                throw HostAdminError.decoding(String(describing: error))
            }
        }

        switch http.statusCode {
        case 401:
            throw HostAdminError.sessionExpired
        case 403:
            // Not the same situation as 401, and saying so matters: the audit
            // route wants role == admin on the web channel, so a perfectly valid
            // session is refused here. Reported as "session expired" it would
            // send the operator to log in again, which changes nothing.
            throw HostAdminError.forbidden
        default:
            throw HostAdminError.status(http.statusCode)
        }
    }
}

public enum HostAdminError: Error, LocalizedError, Equatable {
    case transport
    case sessionExpired
    case forbidden
    case status(Int)
    case decoding(String)
    case notLocalHost

    public var errorDescription: String? {
        switch self {
        case .transport:
            "Non è stato possibile raggiungere il runtime locale."
        case .sessionExpired:
            "La sessione operatore è scaduta. Accedi di nuovo per gestire l'host."
        case .forbidden:
            // Measured, not guessed. The host guards these reads with
            // isWebAdminSession: role == admin AND authChannel == web. This app
            // sends `X-MediFlow-Source-Surface: native` on every request
            // (HomeBasePatientsClient.send), so its session is native and the
            // check fails no matter who is logged in. Verified against the
            // synthetic host: the same operator gets 200 over a web session and
            // 403 over this one.
            //
            // Saying "you need an admin account" would send an operator who
            // already is an admin looking for permissions they hold.
            "L'host riserva questa lettura alla console web. Un client nativo abbinato non vi accede, nemmeno con un account amministratore: si consulta da localhost."
        case let .status(code):
            "Il runtime locale ha risposto \(code)."
        case let .decoding(detail):
            "Risposta non riconosciuta dal runtime locale: \(detail)"
        case .notLocalHost:
            "Le funzioni di amministrazione sono disponibili solo quando l'home-base è questo Mac."
        }
    }
}

/// Decides whether the host surface may be offered at all.
///
/// Local means loopback: the connection terminates on this machine. A home base
/// reached over the LAN is someone else's machine, and administering it from here
/// is not a feature, it is a hole.
public enum HostAdminAvailability {
    public static func isLocalHost(serverURLString: String) -> Bool {
        let trimmed = serverURLString.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return false }

        // `URL(string:)` yields no host for a bare "host:port", so fall back to
        // parsing the authority directly. Failing to recognise a loopback host
        // only hides the panel, never opens it — but hiding it on a machine that
        // *is* the home base is still wrong.
        let host: String
        if let parsed = URL(string: trimmed)?.host {
            host = parsed.lowercased()
        } else {
            let authority = trimmed
                .replacingOccurrences(of: "https://", with: "")
                .replacingOccurrences(of: "http://", with: "")
                .split(separator: "/").first.map(String.init) ?? trimmed
            host = Self.hostFromAuthority(authority).lowercased()
        }

        if host == "localhost" || host == "::1" || host == "[::1]" { return true }
        // The whole 127.0.0.0/8 block is loopback, not just 127.0.0.1.
        let octets = host.split(separator: ".")
        if octets.count == 4, octets[0] == "127", octets.allSatisfy({ UInt8($0) != nil }) {
            return true
        }
        return false
    }

    /// Strips a port without mangling a bracketed IPv6 literal, where the colons
    /// belong to the address rather than separating a port.
    private static func hostFromAuthority(_ authority: String) -> String {
        if authority.hasPrefix("[") {
            guard let close = authority.firstIndex(of: "]") else { return authority }
            return String(authority[authority.index(after: authority.startIndex)..<close])
        }
        return authority.split(separator: ":").first.map(String.init) ?? authority
    }
}

// MARK: - Payloads

/// Decoded leniently on purpose: these routes are the host's own diagnostics and
/// they gain fields over time. A new key on the host must not blank a panel that
/// is telling the operator whether their machine is healthy.
public struct HostUpdateAwareness: Decodable, Equatable, Sendable {
    public let branch: String?
    public let revision: String?
    public let currentVersion: String?
    public let latestVersion: String?
    public let updateAvailable: Bool?
    public let checkedAt: String?
}

/// Mirrors `/api/system/network-overview` as the host actually returns it.
public struct HostNetworkOverview: Decodable, Equatable, Sendable {
    public let node: Node?
    public let session: Session?
    public let aiRuntime: AIRuntime?

    public struct Node: Decodable, Equatable, Sendable {
        public let nodeId: String?
        public let displayName: String?
        public let role: String?
        public let operatingMode: String?
        public let protocolVersion: String?
        public let transport: Transport?

        public struct Transport: Decodable, Equatable, Sendable {
            public let apiBasePath: String?
            public let tlsRequired: Bool?
            public let localTlsPort: Int?
        }
    }

    public struct Session: Decodable, Equatable, Sendable {
        public let operatingMode: String?
        public let sessionState: String?
        public let pairingState: String?
        public let trustedSession: Bool?
        public let degradedReason: String?
        public let authMode: String?
        public let replica: Replica?

        public struct Replica: Decodable, Equatable, Sendable {
            public let state: String?
            public let authority: String?
            public let pendingAction: String?
            public let lastSnapshotAt: String?
            public let lastReconciledAt: String?
        }
    }

    public struct AIRuntime: Decodable, Equatable, Sendable {
        public let mode: String?
        public let localRuntime: LocalRuntime?

        public struct LocalRuntime: Decodable, Equatable, Sendable {
            public let provider: String?
            public let state: String?
            public let targetPolicy: String?
            public let hardwareProfile: String?
            public let clinicalModel: String?
            public let reasoningModel: String?
            public let ocrModel: String?
        }
    }
}

/// `GET /api/system/audit?view=summary`. Every count here is over at most 200
/// records — see `auditSummary(sessionCookie:days:)`.
public struct HostAuditSummary: Decodable, Equatable, Sendable {
    public let days: Int?
    public let totalEvents: Int?
    public let distinctActors: Int?
    public let outcomes: Outcomes?
    public let sourceSurfaces: SourceSurfaces?
    public let topEventTypes: [TopEventType]?

    public struct Outcomes: Decodable, Equatable, Sendable {
        public let success: Int?
        public let failure: Int?
        public let denied: Int?
    }

    public struct SourceSurfaces: Decodable, Equatable, Sendable {
        public let web: Int?
        public let native: Int?
        public let api: Int?
        public let job: Int?
    }

    public struct TopEventType: Decodable, Equatable, Sendable, Identifiable {
        public let eventType: String?
        public let count: Int?
        public var id: String { eventType ?? "-" }
    }

    /// The route's own `isTruncated` is computed against its unclamped limit, so
    /// it reads false even when the 200 clamp applied. This says what actually
    /// happened.
    public var reachedRecordCap: Bool { (totalEvents ?? 0) >= 200 }
}

/// One element of the bare array returned by `GET /api/system/audit`.
public struct HostAuditEvent: Decodable, Equatable, Sendable, Identifiable {
    public let eventId: String?
    public let eventType: String?
    public let occurredAt: String?
    public let outcome: String?
    public let actorRef: String?
    public let subjectType: String?
    public let sourceSurface: String?

    public var id: String { eventId ?? "\(eventType ?? "-")-\(occurredAt ?? "-")" }
}

/// `GET /api/system/backup-scheduler`.
public struct HostBackupScheduler: Decodable, Equatable, Sendable {
    public let supported: Bool?
    public let installed: Bool?
    public let schedulePath: String?
    public let scheduleKind: String?
    public let state: State?

    public struct State: Decodable, Equatable, Sendable {
        public let enabled: Bool?
        public let hour: Int?
        public let minute: Int?
        public let retentionDays: Int?
        public let destination: String?
        public let lastRunAt: String?
        public let lastResult: String?
    }
}

public struct HostAIModels: Decodable, Equatable, Sendable {
    public let models: [Model]?
    public let runtime: String?

    public struct Model: Decodable, Equatable, Sendable, Identifiable {
        public let name: String?
        public let size: Int?
        public let status: String?
        public var id: String { name ?? UUID().uuidString }
    }
}

/// Same pinning rule as the paired client: an unpinned self-signed certificate on
/// loopback is still a certificate nobody verified.
private final class HostAdminTLSSessionDelegate: NSObject, URLSessionDelegate {
    private let expectedPin: String

    init(expectedPin: String) {
        self.expectedPin = expectedPin.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    func urlSession(
        _ session: URLSession,
        didReceive challenge: URLAuthenticationChallenge,
        completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
    ) {
        guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
              let trust = challenge.protectionSpace.serverTrust else {
            completionHandler(.performDefaultHandling, nil)
            return
        }
        guard !expectedPin.isEmpty else {
            // No pin configured: accept the loopback runtime the app itself
            // supervises, the same posture the paired client takes.
            completionHandler(.useCredential, URLCredential(trust: trust))
            return
        }
        guard let chain = SecTrustCopyCertificateChain(trust) as? [SecCertificate],
              let leaf = chain.first else {
            completionHandler(.cancelAuthenticationChallenge, nil)
            return
        }
        let data = SecCertificateCopyData(leaf) as Data
        let digest = HostAdminTLSSessionDelegate.sha256Hex(data)
        if digest == expectedPin {
            completionHandler(.useCredential, URLCredential(trust: trust))
        } else {
            completionHandler(.cancelAuthenticationChallenge, nil)
        }
    }

    private static func sha256Hex(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
}
#endif
