// Codex: created 2026-05-02
// @Codex
import Foundation

public struct HomeBaseOptionalServiceStatus: Identifiable, Equatable, Sendable {
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

public struct HomeBaseOptionalServicesSnapshot: Equatable, Sendable {
    public let services: [HomeBaseOptionalServiceStatus]

    public init(services: [HomeBaseOptionalServiceStatus]) {
        self.services = services
    }

    public static let initial = HomeBaseOptionalServicesProbe.buildSnapshot(
        ollamaReachable: nil,
        mlxReachable: nil,
        icdReachable: nil
    )
}

public enum HomeBaseOptionalServicesProbe {
    public static func probe(timeoutSeconds: TimeInterval = 0.5) async -> HomeBaseOptionalServicesSnapshot {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = timeoutSeconds
        configuration.timeoutIntervalForResource = timeoutSeconds
        configuration.requestCachePolicy = .reloadIgnoringLocalAndRemoteCacheData

        let session = URLSession(configuration: configuration)

        async let ollamaReachable = isReachable(
            URL(string: "http://127.0.0.1:11434/api/tags"),
            session: session,
            acceptedStatusCodes: 200..<300
        )
        async let mlxReachable = isReachable(
            URL(string: "http://127.0.0.1:8080/v1/models"),
            session: session,
            acceptedStatusCodes: 200..<300
        )
        async let icdReachable = isReachable(
            URL(string: "http://127.0.0.1:8888"),
            session: session,
            // Some container frontends can answer 401/403 while still proving that ICD is up.
            acceptedStatusCodes: 200..<500
        )

        return await buildSnapshot(
            ollamaReachable: ollamaReachable,
            mlxReachable: mlxReachable,
            icdReachable: icdReachable
        )
    }

    static func buildSnapshot(ollamaReachable: Bool?, mlxReachable: Bool?, icdReachable: Bool?) -> HomeBaseOptionalServicesSnapshot {
        HomeBaseOptionalServicesSnapshot(services: [
            HomeBaseOptionalServiceStatus(
                id: "optional-ollama",
                title: "Ollama (AI locale)",
                detail: detail(
                    reachable: ollamaReachable,
                    ready: "Endpoint 127.0.0.1:11434 raggiungibile",
                    notReady: "Endpoint 127.0.0.1:11434 non rilevato",
                    unknown: "Endpoint 127.0.0.1:11434 non ancora verificato"
                ),
                state: state(for: ollamaReachable)
            ),
            HomeBaseOptionalServiceStatus(
                id: "optional-mlx",
                title: "MLX (AI benchmark locale)",
                detail: detail(
                    reachable: mlxReachable,
                    ready: "Endpoint 127.0.0.1:8080/v1/models raggiungibile",
                    notReady: "Endpoint 127.0.0.1:8080 non rilevato",
                    unknown: "Endpoint 127.0.0.1:8080 non ancora verificato"
                ),
                state: state(for: mlxReachable)
            ),
            HomeBaseOptionalServiceStatus(
                id: "optional-docker-icd",
                title: "Docker / ICD (container)",
                detail: detail(
                    reachable: icdReachable,
                    ready: "Endpoint 127.0.0.1:8888 raggiungibile",
                    notReady: "Endpoint 127.0.0.1:8888 non rilevato",
                    unknown: "Endpoint 127.0.0.1:8888 non ancora verificato"
                ),
                state: state(for: icdReachable)
            )
        ])
    }

    private static func isReachable(
        _ url: URL?,
        session: URLSession,
        acceptedStatusCodes: Range<Int>
    ) async -> Bool {
        guard let url else { return false }
        do {
            let (_, response) = try await session.data(from: url)
            guard let httpResponse = response as? HTTPURLResponse else { return false }
            return acceptedStatusCodes.contains(httpResponse.statusCode)
        } catch {
            return false
        }
    }

    private static func state(for reachable: Bool?) -> HomeBaseRuntimeComponentState {
        reachable == true ? .ready : .unknown
    }

    private static func detail(reachable: Bool?, ready: String, notReady: String, unknown: String) -> String {
        guard let reachable else { return unknown }
        return reachable ? ready : notReady
    }
}
