import Security
import XCTest
@testable import MediFlowAppleShared

final class HomeBasePairingLinkTests: XCTestCase {
    private let fingerprint = String(repeating: "a", count: 64)
    private let offerID = "35ab4d95-49da-46e7-b8c4-72bc95ef13a2"
    private let secret = String(repeating: "A", count: 43)

    private var validLink: String {
        "mediflow://collega?origin=https%3A%2F%2F192.168.1.52%3A3443&fingerprint=\(fingerprint)"
            + "&computer=MediFlow%20Prova&id=\(offerID)&secret=\(secret)"
    }

    func testParsesCanonicalLink() throws {
        let link = try XCTUnwrap(HomeBasePairingLink.parse(XCTUnwrap(URL(string: validLink))))
        XCTAssertEqual(link.origin.scheme, "https")
        XCTAssertEqual(link.origin.host, "192.168.1.52")
        XCTAssertEqual(link.origin.port, 3443)
        XCTAssertEqual(link.computer, "MediFlow Prova")
        XCTAssertEqual(link.fingerprint, fingerprint)
        XCTAssertEqual(link.offerID, offerID)
    }

    func testRejectsAmbiguousLinksAndUnpinnableOrigins() {
        for value in [
            validLink + "&secret=" + secret, validLink + "&unexpected=1", validLink + "#fragment",
            validLink.replacingOccurrences(of: "collega?", with: "collega/?"),
            validLink.replacingOccurrences(of: "collega?", with: "user@collega?"),
            validLink.replacingOccurrences(of: "collega?", with: "%63ollega?"),
            validLink.replacingOccurrences(of: "3443", with: "65536"),
            validLink.replacingOccurrences(of: "3443", with: "3443%2Fapi"),
            validLink.replacingOccurrences(of: "https%3A", with: "http%3A"),
            validLink.replacingOccurrences(of: "192.168.1.52", with: "192.168.001.52"),
            validLink.replacingOccurrences(of: "192.168.1.52", with: "user%40192.168.1.52"),
            validLink.replacingOccurrences(of: "192.168.1.52", with: "192.168.1.52%3Fx"),
            validLink.replacingOccurrences(of: "192.168.1.52", with: "192.168.1.52%5C"),
            validLink.replacingOccurrences(of: "Prova", with: "%0A"),
            validLink.replacingOccurrences(of: fingerprint, with: fingerprint.uppercased()),
            validLink.replacingOccurrences(of: secret, with: String(secret.dropLast()) + "B"),
            validLink.replacingOccurrences(of: secret, with: secret + "%0A"),
        ] {
            XCTAssertNil(URL(string: value).flatMap(HomeBasePairingLink.parse), value)
        }
    }

    @MainActor
    func testOpeningLinkOnlyPresentsConfirmation() async throws {
        let router = ClinicalNavigationRouter()
        let url = try XCTUnwrap(URL(string: validLink))
        await router.open(url, platform: .macOS, workspace: nil) { _ in
            XCTFail("Opening an offer cannot enter the workspace")
        }.value
        XCTAssertEqual(router.pairingOffer?.offerID, offerID)
        XCTAssertFalse(router.pairingLogin)
        router.dismissPairing()
        XCTAssertFalse(router.isPresentingPairing)
    }

    @MainActor
    func testReplacementRequiresCurrentConfirmationAndSavesOnlyDeviceCredentials() async throws {
        let name = "HomeBasePairingLinkTests.\(UUID())"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: name))
        defer { defaults.removePersistentDomain(forName: name) }
        var keychainToken: String? = nil
        var writesFail = false
        let store = HomeBasePairedStore(userDefaults: defaults,
            keychainReader: { _, _ in .success(keychainToken) },
            keychainWriter: { _, _, token in
                guard !writesFail else { return .failure(.keychainWrite(errSecAuthFailed)) }
                keychainToken = token
                return .success(())
            }
        )
        let cache = HomeBasePatientCacheStore(
            cacheDirectory: FileManager.default.temporaryDirectory.appendingPathComponent(name),
            keyProvider: { throw CocoaError(.fileReadNoSuchFile) }
        )
        try store.save(settings: .init(pairedClientId: "previous", username: UUID().uuidString), pairedClientToken: "previous-token")
        let before = try store.loadSnapshot()
        let model = PairedPatientsWorkspaceModel(pairedStore: store, cacheStore: cache)
        let offer = try XCTUnwrap(HomeBasePairingLink.parse(XCTUnwrap(URL(string: validLink))))
        let credentials = HomeBasePairedCredentials(clientId: "synthetic-client", clientToken: "synthetic-token")

        let connection = HomeBasePairingConnection(origin: offer.origin, credentials: credentials)

        do {
            try await model.acceptPairing(offer, replacing: nil) { _ in
                XCTFail("No redemption before confirmation of replacement")
                return connection
            }
            XCTFail("Unconfirmed replacement accepted")
        } catch HomeBasePairingError.contextChanged {}
        XCTAssertEqual(try store.loadSnapshot(), before)

        writesFail = true
        do {
            try await model.acceptPairing(offer, replacing: "previous") { _ in connection }
            XCTFail("A failed Keychain write advanced pairing")
        } catch HomeBasePairingError.storage {}
        XCTAssertEqual(try store.loadSnapshot(), before)
        XCTAssertEqual(model.pairedClientId, "previous")

        writesFail = false
        try await model.acceptPairing(offer, replacing: "previous") { _ in connection }
        XCTAssertEqual(try store.loadSnapshot(), .init(settings: .init(serverURL: offer.origin.absoluteString,
            tlsPin: offer.fingerprint, pairedClientId: credentials.clientId), pairedClientToken: credentials.clientToken))
        XCTAssertEqual(model.pairedClientId, credentials.clientId)
        XCTAssertEqual(model.username, "")
        XCTAssertEqual(model.password, "")
        XCTAssertNil(model.clinicalWorkspaceConnection)
    }

    @MainActor
    func testFirstQRRedemptionCallsOnlyRedeemAndNeverAuthCheck() async throws {
        let offer = try XCTUnwrap(HomeBasePairingLink.parse(XCTUnwrap(URL(string: validLink))))
        let clientID = "7d7c2b91-56ea-4a1a-a5f0-6c449db7f031"
        let clientToken = String(repeating: "z", count: 32)
        var requestedPaths: [String] = []
        PairingLinkMockURLProtocol.handler = { request in
            requestedPaths.append(request.url?.path ?? "")
            let response = HTTPURLResponse(url: request.url!, statusCode: 201, httpVersion: nil, headerFields: nil)!
            let body = try JSONSerialization.data(withJSONObject: [
                "clientId": clientID,
                "pairedClientToken": clientToken,
            ])
            return (response, body)
        }
        defer { PairingLinkMockURLProtocol.handler = nil }

        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [PairingLinkMockURLProtocol.self]
        let connection = try await offer.redeem(sessionConfiguration: config)
        XCTAssertEqual(requestedPaths, ["/api/v1/network/pairing-offers/redeem"])
        XCTAssertFalse(requestedPaths.contains("/api/auth/check"))
        XCTAssertEqual(connection.credentials.clientId, clientID)
        XCTAssertEqual(connection.credentials.clientToken, clientToken)
    }
}

private final class PairingLinkMockURLProtocol: URLProtocol {
    nonisolated(unsafe) static var handler: ((URLRequest) throws -> (HTTPURLResponse, Data))?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let handler = Self.handler else {
            client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse))
            return
        }
        do {
            let (response, data) = try handler(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}
