import Foundation
#if os(iOS)
import UIKit
#endif

struct HomeBasePairingLink: Equatable, Sendable {
    let origin: URL
    let fingerprint: String
    let computer: String
    let offerID: String
    private let secret: String

    static func isPairingURL(_ url: URL) -> Bool {
        url.scheme?.lowercased() == "mediflow" && url.host?.lowercased() == "collega"
    }

    static func parse(_ url: URL) -> Self? {
        guard url.absoluteString.utf8.count <= 2048,
              let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              parts.scheme == "mediflow", parts.percentEncodedHost == "collega",
              parts.user == nil, parts.password == nil, parts.port == nil,
              parts.percentEncodedPath.isEmpty, parts.fragment == nil,
              let items = parts.queryItems, items.count == 5 else { return nil }
        var fields: [String: String] = [:]
        for item in items {
            guard let value = item.value, fields.updateValue(value, forKey: item.name) == nil else { return nil }
        }

        guard let address = fields["origin"], let origin = URL(string: address),
              isHTTPSOrigin(address),
              let fingerprint = fields["fingerprint"], matches(fingerprint, #"[0-9a-f]{64}"#),
              let computer = fields["computer"], matches(computer, #"[\p{L}\p{N} ._-]{1,63}"#),
              !computer.trimmingCharacters(in: .whitespaces).isEmpty,
              let id = fields["id"], matchesUUID(id),
              let secret = fields["secret"], matches(secret, #"[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]"#) else { return nil }
        return Self(origin: origin, fingerprint: fingerprint, computer: computer, offerID: id, secret: secret)
    }

    private static func isHTTPSOrigin(_ address: String) -> Bool {
        guard let parts = URLComponents(string: address), parts.scheme == "https",
              let host = parts.host, host.utf8.count <= 253,
              !host.isEmpty, parts.user == nil, parts.password == nil, parts.percentEncodedPath.isEmpty,
              parts.query == nil, parts.fragment == nil,
              parts.port.map({ (1...65535).contains($0) }) ?? true,
              address.hasPrefix("https://"),
              address.dropFirst("https://".count) == host + (parts.port.map { ":\($0)" } ?? "") else { return false }

        let labels = host.split(separator: ".", omittingEmptySubsequences: false)
        if matches(host, #"[0-9.]+"#) {
            return labels.count == 4 && labels.allSatisfy { part in
                UInt8(part).map { String($0) == part } ?? false
            }
        }
        return labels.allSatisfy { matches(String($0), #"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?"#) }
    }

    fileprivate static func matchesUUID(_ value: String) -> Bool {
        matches(value, #"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"#)
    }

    fileprivate static func matches(_ value: String, _ pattern: String) -> Bool {
        value.range(of: "\\A(?:\(pattern))\\z", options: .regularExpression) != nil
    }

    @MainActor
    func redeem(sessionConfiguration: URLSessionConfiguration? = nil) async throws -> HomeBasePairingConnection {
        #if os(macOS)
        if sessionConfiguration == nil,
           let host = origin.host, !HomeBaseConnectionConfiguration.isLoopbackHost(host),
           Host.current().addresses.contains(host),
           var local = URLComponents(url: origin, resolvingAgainstBaseURL: false) {
            local.host = "127.0.0.1"
            if let loopback = local.url {
                do {
                    return try await redeem(at: loopback, sessionConfiguration: nil)
                } catch let error as URLError where error.code == .cannotConnectToHost {
                }
            }
        }
        #endif
        return try await redeem(at: origin, sessionConfiguration: sessionConfiguration)
    }

    @MainActor
    private func redeem(at server: URL, sessionConfiguration: URLSessionConfiguration?) async throws -> HomeBasePairingConnection {
        #if os(iOS)
        let isPad = UIDevice.current.userInterfaceIdiom == .pad
        let platform = isPad ? "ipados" : "ios"
        let deviceName = isPad ? "iPad" : "iPhone"
        #else
        let platform = "macos"
        let deviceName = "Mac"
        #endif
        let payload = Claim(offerId: offerID, secret: secret, deviceName: deviceName, clientPlatform: platform)
        let delegate = HomeBaseTLSSessionDelegate(expectedPin: fingerprint, rejectsRedirects: true)
        let configuration = sessionConfiguration ?? {
            let ephemeral = URLSessionConfiguration.ephemeral
            ephemeral.httpShouldSetCookies = false
            ephemeral.urlCredentialStorage = nil
            ephemeral.timeoutIntervalForRequest = 8
            ephemeral.timeoutIntervalForResource = 12
            return ephemeral
        }()
        let session = URLSession(configuration: configuration, delegate: delegate, delegateQueue: nil)
        defer { session.invalidateAndCancel() }

        let endpoint = server.appendingPathComponent("api/v1/network/pairing-offers/redeem")
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(payload)
        let (bytes, response) = try await session.bytes(for: request, delegate: delegate)
        guard let http = response as? HTTPURLResponse, http.url == endpoint else { throw HomeBasePairingError.rejected }
        if http.statusCode == 404 { throw HomeBasePairingError.expired }
        guard http.statusCode == 201 else { throw HomeBasePairingError.rejected }

        var data = Data()
        for try await byte in bytes {
            guard data.count < 1024 else { throw HomeBasePairingError.rejected }
            data.append(byte)
        }
        let redeemed = try JSONDecoder().decode(Redemption.self, from: data)
        guard Self.matchesUUID(redeemed.clientId), Self.matches(redeemed.pairedClientToken, #"[A-Za-z0-9_-]{32}"#)
        else { throw HomeBasePairingError.rejected }
        return HomeBasePairingConnection(origin: server,
            credentials: HomeBasePairedCredentials(clientId: redeemed.clientId, clientToken: redeemed.pairedClientToken))
    }

    private struct Claim: Encodable {
        let offerId: String
        let secret: String
        let deviceName: String
        let clientPlatform: String
    }

    private struct Redemption: Decodable {
        let clientId: String
        let pairedClientToken: String
    }
}

struct HomeBasePairingConnection {
    let origin: URL
    let credentials: HomeBasePairedCredentials
}

enum HomeBasePairingError: Error {
    case expired, rejected, contextChanged, storage
}
