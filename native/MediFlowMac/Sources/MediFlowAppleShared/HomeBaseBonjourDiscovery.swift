// Codex: created 2026-04-18
// @Codex
import Foundation

public struct HomeBaseDiscoveryCandidate: Equatable, Sendable {
    public let serviceName: String
    public let displayName: String
    public let serverURLString: String
    public let tlsPin: String?
    public let nodeId: String?
    public let protocolVersion: String?
    public let operatingMode: String?

    public init(
        serviceName: String,
        displayName: String,
        serverURLString: String,
        tlsPin: String?,
        nodeId: String?,
        protocolVersion: String?,
        operatingMode: String?
    ) {
        self.serviceName = serviceName
        self.displayName = displayName
        self.serverURLString = serverURLString
        self.tlsPin = tlsPin
        self.nodeId = nodeId
        self.protocolVersion = protocolVersion
        self.operatingMode = operatingMode
    }

    public var reviewLine: String {
        var parts = [displayName]
        if let operatingMode, !operatingMode.isEmpty {
            parts.append(operatingMode)
        }
        if let protocolVersion, !protocolVersion.isEmpty {
            parts.append("protocollo \(protocolVersion)")
        }
        return parts.joined(separator: " · ")
    }
}

public enum HomeBaseBonjourService {
    public static let type = "_mediflow-homebase._tcp"
    public static let domain = "local."
    public static let localNetworkUsageDescription = "MediFlow cerca il tuo home-base sulla rete locale per collegarsi in modo paired e cifrato."

    static let txtKeyDisplay = "display"
    static let txtKeyNode = "node"
    static let txtKeyProtocol = "proto"
    static let txtKeyMode = "mode"
    static let txtKeyPin = "pin"

    public static func makeCandidate(
        serviceName: String,
        hostName: String?,
        port: Int,
        txtRecordData: Data?
    ) -> HomeBaseDiscoveryCandidate? {
        guard
            let hostName = normalized(hostName),
            port > 0
        else {
            return nil
        }

        let txt = txtRecordValues(from: txtRecordData)
        let displayName = normalized(txt[txtKeyDisplay]) ?? serviceName
        return HomeBaseDiscoveryCandidate(
            serviceName: serviceName,
            displayName: displayName,
            serverURLString: "https://\(hostName):\(port)",
            tlsPin: normalized(txt[txtKeyPin]),
            nodeId: normalized(txt[txtKeyNode]),
            protocolVersion: normalized(txt[txtKeyProtocol]),
            operatingMode: normalized(txt[txtKeyMode])
        )
    }

    static func txtRecordValues(from data: Data?) -> [String: String] {
        guard let data else { return [:] }
        return NetService
            .dictionary(fromTXTRecord: data)
            .reduce(into: [:]) { result, item in
                guard let value = String(data: item.value, encoding: .utf8) else { return }
                result[item.key] = value
            }
    }

    private static func normalized(_ value: String?) -> String? {
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let withoutTrailingDot = trimmed.hasSuffix(".") ? String(trimmed.dropLast()) : trimmed
        return withoutTrailingDot.isEmpty ? nil : withoutTrailingDot
    }
}

public enum HomeBaseDiscoveryError: LocalizedError, Equatable {
    case noServiceFound
    case browseFailed

    public var errorDescription: String? {
        switch self {
        case .noServiceFound:
            return "Nessun home-base trovato sulla rete locale."
        case .browseFailed:
            return "La ricerca Bonjour dell'home-base non e riuscita."
        }
    }
}

@MainActor
public final class HomeBaseBonjourDiscovery: NSObject {
    private let serviceType: String
    private let domain: String
    private let browser = NetServiceBrowser()

    private var continuation: CheckedContinuation<HomeBaseDiscoveryCandidate, Error>?
    private var timeoutTask: Task<Void, Never>?
    private var didFinish = false
    private var services: [NetService] = []

    public init(
        serviceType: String = HomeBaseBonjourService.type,
        domain: String = HomeBaseBonjourService.domain
    ) {
        self.serviceType = serviceType
        self.domain = domain
        super.init()
    }

    public func discoverFirst(timeout: TimeInterval = 4) async throws -> HomeBaseDiscoveryCandidate {
        finishIfNeeded(.failure(HomeBaseDiscoveryError.browseFailed))
        return try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            self.didFinish = false
            self.services.removeAll()
            self.browser.delegate = self
            self.browser.searchForServices(ofType: self.serviceType, inDomain: self.domain)

            let timeoutNanoseconds = UInt64(max(timeout, 0.5) * 1_000_000_000)
            self.timeoutTask = Task { [weak self] in
                try? await Task.sleep(nanoseconds: timeoutNanoseconds)
                await MainActor.run {
                    self?.finishIfNeeded(.failure(HomeBaseDiscoveryError.noServiceFound))
                }
            }
        }
    }

    private func finishIfNeeded(_ result: Result<HomeBaseDiscoveryCandidate, Error>) {
        guard !didFinish else { return }
        didFinish = true
        timeoutTask?.cancel()
        timeoutTask = nil
        browser.stop()
        services.forEach {
            $0.stop()
            $0.delegate = nil
        }
        services.removeAll()

        guard let continuation else { return }
        self.continuation = nil
        switch result {
        case .success(let candidate):
            continuation.resume(returning: candidate)
        case .failure(let error):
            continuation.resume(throwing: error)
        }
    }
}

extension HomeBaseBonjourDiscovery: NetServiceBrowserDelegate, NetServiceDelegate {
    nonisolated public func netServiceBrowser(_ browser: NetServiceBrowser, didFind service: NetService, moreComing: Bool) {
        Task { @MainActor in
            guard !self.didFinish else { return }
            self.services.append(service)
            service.delegate = self
            service.resolve(withTimeout: 3)
        }
    }

    nonisolated public func netServiceBrowser(_ browser: NetServiceBrowser, didNotSearch errorDict: [String : NSNumber]) {
        Task { @MainActor in
            self.finishIfNeeded(.failure(HomeBaseDiscoveryError.browseFailed))
        }
    }

    nonisolated public func netServiceDidResolveAddress(_ sender: NetService) {
        Task { @MainActor in
            guard
                !self.didFinish,
                let candidate = HomeBaseBonjourService.makeCandidate(
                    serviceName: sender.name,
                    hostName: sender.hostName,
                    port: sender.port,
                    txtRecordData: sender.txtRecordData()
                )
            else {
                return
            }
            self.finishIfNeeded(.success(candidate))
        }
    }

    nonisolated public func netService(_ sender: NetService, didNotResolve errorDict: [String : NSNumber]) {
        Task { @MainActor in
            guard !self.didFinish else { return }
            self.services.removeAll { $0 == sender }
        }
    }
}
