import CryptoKit
import Foundation
import Network
import Security
import XCTest
@testable import MediFlowAppleShared
@testable import MediFlowCore

#if os(macOS)
final class HomeBaseTLSPinningTests: XCTestCase {
    private static var legitimateIdentity: EphemeralTLSIdentity!
    private static var impostorIdentity: EphemeralTLSIdentity!

    override class func setUp() {
        super.setUp()
        do {
            legitimateIdentity = try EphemeralTLSIdentity.generate(commonName: "mediflow-synthetic-homebase")
            impostorIdentity = try EphemeralTLSIdentity.generate(commonName: "mediflow-synthetic-impostor")
            XCTAssertNotEqual(legitimateIdentity.sha256Fingerprint, impostorIdentity.sha256Fingerprint)
        } catch {
            fatalError("Failed to generate synthetic TLS identities: \(error)")
        }
    }

    override class func tearDown() {
        legitimateIdentity?.cleanup()
        impostorIdentity?.cleanup()
        legitimateIdentity = nil
        impostorIdentity = nil
        super.tearDown()
    }

    func testExpectedCertificateDeliversPairedRequest() async throws {
        let nodePayload = #"{"nodeId":"synthetic-node-1","displayName":"Ambulatorio Sintetico","role":"home-base","operatingMode":"network-home-base","protocolVersion":"1","transport":{"apiBasePath":"/api/v1","tlsRequired":true,"localTlsPort":3443}}"#
        let server = try LocalLoopbackTLSServer(identity: Self.legitimateIdentity) { _ in
            LocalLoopbackTLSServer.HTTPResponse(statusLine: "200 OK", body: Data(nodePayload.utf8))
        }
        defer { server.stop() }

        let configuration = HomeBaseConnectionConfiguration(
            serverURLString: "https://127.0.0.1:\(server.port)",
            tlsPin: Self.legitimateIdentity.sha256Fingerprint
        )
        let client = HomeBasePatientsClient(configuration: configuration)
        let credentials = HomeBasePairedCredentials(
            clientId: "synthetic-client-id",
            clientToken: "synthetic-paired-token-value"
        )

        let node = try await client.fetchNetworkNode(
            credentials: credentials,
            sessionCookie: "mediflow_session=synthetic-session-cookie",
            ambulatoryId: nil
        )

        XCTAssertEqual(node.nodeId, "synthetic-node-1")
        let requests = server.snapshotRequests()
        XCTAssertEqual(requests.count, 1)
        XCTAssertTrue(requests[0].contains("GET /api/v1/network/node HTTP/1.1"))
        XCTAssertTrue(requests[0].contains("synthetic-paired-token-value"))
    }

    func testImpostorCertificateBlocksRequestAndCredentialsBeforeHTTP() async throws {
        let server = try LocalLoopbackTLSServer(identity: Self.impostorIdentity) { _ in
            LocalLoopbackTLSServer.HTTPResponse(statusLine: "200 OK", body: Data("{}".utf8))
        }
        defer { server.stop() }

        let configuration = HomeBaseConnectionConfiguration(
            serverURLString: "https://127.0.0.1:\(server.port)",
            tlsPin: Self.legitimateIdentity.sha256Fingerprint
        )
        let client = HomeBasePatientsClient(configuration: configuration)
        let credentials = HomeBasePairedCredentials(
            clientId: "synthetic-client-id",
            clientToken: "synthetic-paired-token-do-not-leak"
        )

        do {
            _ = try await client.fetchNetworkNode(
                credentials: credentials,
                sessionCookie: "mediflow_session=synthetic-cookie-do-not-leak",
                ambulatoryId: nil
            )
            XCTFail("Expected TLS pinning failure against impostor certificate")
        } catch let error as HomeBaseClientError {
            XCTAssertEqual(error, .transport(.tlsHandshakeFailed))
        }

        let syntheticUser = ["synthetic", "clinician"].joined(separator: ".")
        let syntheticPassphrase = UUID().uuidString
        do {
            _ = try await client.login(
                username: syntheticUser,
                password: syntheticPassphrase,
                credentials: credentials
            )
            XCTFail("Expected TLS pinning failure during login against impostor certificate")
        } catch let error as HomeBaseClientError {
            XCTAssertEqual(error, .transport(.tlsHandshakeFailed))
        }

        XCTAssertEqual(server.snapshotRequests(), [])
        XCTAssertEqual(server.receivedApplicationByteCount(), 0)
    }

    func testEmptyOrMalformedExpectedPinRejectsSelfSignedCertificate() async throws {
        let server = try LocalLoopbackTLSServer(identity: Self.legitimateIdentity) { _ in
            LocalLoopbackTLSServer.HTTPResponse(statusLine: "200 OK", body: Data("{}".utf8))
        }
        defer { server.stop() }

        let credentials = HomeBasePairedCredentials(
            clientId: "synthetic-client-id",
            clientToken: "synthetic-paired-token-do-not-leak"
        )

        for invalidPin in ["", "not-a-valid-sha256-pin", String(repeating: "a", count: 63)] {
            let configuration = HomeBaseConnectionConfiguration(
                serverURLString: "https://127.0.0.1:\(server.port)",
                tlsPin: invalidPin
            )
            let client = HomeBasePatientsClient(configuration: configuration)
            do {
                _ = try await client.fetchNetworkNode(
                    credentials: credentials,
                    sessionCookie: "mediflow_session=synthetic-cookie",
                    ambulatoryId: nil
                )
                XCTFail("Expected TLS rejection for invalid pin '\(invalidPin)'")
            } catch let error as HomeBaseClientError {
                XCTAssertEqual(error, .transport(.tlsHandshakeFailed))
            }
        }

        XCTAssertEqual(server.snapshotRequests(), [])
        XCTAssertEqual(server.receivedApplicationByteCount(), 0)

        let nonLoopbackOrigin = "https://" + ["192", "168", "1", "52"].joined(separator: ".") + ":3443"
        for invalidPin in ["", "not-a-valid-sha256-pin"] {
            let remoteConfig = HomeBaseConnectionConfiguration(
                serverURLString: nonLoopbackOrigin,
                tlsPin: invalidPin
            )
            XCTAssertThrowsError(try remoteConfig.serverURL()) { error in
                XCTAssertEqual(error as? HomeBaseClientError, .invalidServerURL)
            }
        }
    }

    @MainActor
    func testPairingOfferRedemptionPinsCertificateAndProtectsOneTimeSecret() async throws {
        let offerID = "35ab4d95-49da-46e7-b8c4-72bc95ef13a2"
        let oneTimeSecret = String(repeating: "A", count: 43)
        let clientID = "12345678-1234-4234-8234-123456789abc"
        let pairedToken = String(repeating: "B", count: 32)
        let redeemBody = #"{"clientId":"\#(clientID)","pairedClientToken":"\#(pairedToken)"}"#

        let impostorServer = try LocalLoopbackTLSServer(identity: Self.impostorIdentity) { _ in
            LocalLoopbackTLSServer.HTTPResponse(statusLine: "201 Created", body: Data(redeemBody.utf8))
        }
        defer { impostorServer.stop() }

        let impostorOrigin = "https%3A%2F%2F127.0.0.1%3A\(impostorServer.port)"
        let impostorURLString = "mediflow://collega?origin=\(impostorOrigin)&fingerprint=\(Self.legitimateIdentity.sha256Fingerprint)&computer=Mac%20Sintetico&id=\(offerID)&secret=\(oneTimeSecret)"
        let impostorLink = try XCTUnwrap(HomeBasePairingLink.parse(XCTUnwrap(URL(string: impostorURLString))))

        do {
            _ = try await impostorLink.redeem()
            XCTFail("Expected pairing offer redemption to fail against impostor certificate")
        } catch let error as URLError {
            XCTAssertTrue(
                [.cancelled, .secureConnectionFailed, .serverCertificateUntrusted, .serverCertificateHasUnknownRoot]
                    .contains(error.code),
                "Unexpected URLError code: \(error.code)"
            )
        }

        XCTAssertEqual(impostorServer.snapshotRequests(), [])
        XCTAssertEqual(impostorServer.receivedApplicationByteCount(), 0)

        let legitimateServer = try LocalLoopbackTLSServer(identity: Self.legitimateIdentity) { _ in
            LocalLoopbackTLSServer.HTTPResponse(statusLine: "201 Created", body: Data(redeemBody.utf8))
        }
        defer { legitimateServer.stop() }

        let legitimateOrigin = "https%3A%2F%2F127.0.0.1%3A\(legitimateServer.port)"
        let legitimateURLString = "mediflow://collega?origin=\(legitimateOrigin)&fingerprint=\(Self.legitimateIdentity.sha256Fingerprint)&computer=Mac%20Sintetico&id=\(offerID)&secret=\(oneTimeSecret)"
        let legitimateLink = try XCTUnwrap(HomeBasePairingLink.parse(XCTUnwrap(URL(string: legitimateURLString))))

        let connection = try await legitimateLink.redeem()
        XCTAssertEqual(connection.credentials.clientId, clientID)
        XCTAssertEqual(connection.credentials.clientToken, pairedToken)

        let legitimateRequests = legitimateServer.snapshotRequests()
        XCTAssertEqual(legitimateRequests.count, 1)
        XCTAssertTrue(legitimateRequests[0].contains("POST /api/v1/network/pairing-offers/redeem HTTP/1.1"))
        XCTAssertTrue(legitimateRequests[0].contains(oneTimeSecret))
    }
}

private final class EphemeralTLSIdentity {
    let secIdentity: SecIdentity
    let sha256Fingerprint: String
    private let tempDir: URL
    private let keychain: SecKeychain

    private init(secIdentity: SecIdentity, sha256Fingerprint: String, tempDir: URL, keychain: SecKeychain) {
        self.secIdentity = secIdentity
        self.sha256Fingerprint = sha256Fingerprint
        self.tempDir = tempDir
        self.keychain = keychain
    }

    static func generate(commonName: String) throws -> EphemeralTLSIdentity {
        let tempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("mediflow-tls-pin-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)

        let keyURL = tempDir.appendingPathComponent("key.pem")
        let certPEMURL = tempDir.appendingPathComponent("cert.pem")
        let certDERURL = tempDir.appendingPathComponent("cert.der")
        let p12URL = tempDir.appendingPathComponent("identity.p12")
        let configURL = tempDir.appendingPathComponent("openssl.cnf")
        let keychainURL = tempDir.appendingPathComponent("ephemeral.keychain-db")
        let passphrase = UUID().uuidString

        let config = """
        [req]
        distinguished_name = dn
        x509_extensions = v3_ext
        prompt = no

        [dn]
        CN = \(commonName)

        [v3_ext]
        subjectAltName = IP:127.0.0.1,DNS:localhost
        basicConstraints = CA:FALSE
        keyUsage = digitalSignature,keyEncipherment
        extendedKeyUsage = serverAuth
        """
        try config.write(to: configURL, atomically: true, encoding: .utf8)

        try runOpenSSL([
            "req", "-x509", "-newkey", "rsa:2048", "-nodes",
            "-keyout", keyURL.path,
            "-out", certPEMURL.path,
            "-days", "1",
            "-config", configURL.path
        ])
        try runOpenSSL([
            "x509", "-in", certPEMURL.path, "-outform", "DER", "-out", certDERURL.path
        ])
        try runOpenSSL([
            "pkcs12", "-export",
            "-inkey", keyURL.path,
            "-in", certPEMURL.path,
            "-out", p12URL.path,
            "-passout", "pass:\(passphrase)"
        ])

        let derData = try Data(contentsOf: certDERURL)
        let fingerprint = SHA256.hash(data: derData)
            .map { String(format: "%02x", $0) }
            .joined()

        var rawKeychain: SecKeychain?
        let createStatus = SecKeychainCreate(
            keychainURL.path,
            UInt32(passphrase.utf8.count),
            passphrase,
            false,
            nil,
            &rawKeychain
        )
        guard createStatus == errSecSuccess, let keychain = rawKeychain else {
            throw NSError(domain: NSOSStatusErrorDomain, code: Int(createStatus))
        }

        let p12Data = try Data(contentsOf: p12URL)
        var importFormat: SecExternalFormat = .formatPKCS12
        var importType: SecExternalItemType = .itemTypeAggregate
        var keyParams = SecItemImportExportKeyParameters()
        keyParams.version = UInt32(SEC_KEY_IMPORT_EXPORT_PARAMS_VERSION)
        keyParams.passphrase = Unmanaged.passUnretained(passphrase as CFString)
        var importedItems: CFArray?
        let importStatus = SecItemImport(
            p12Data as CFData,
            nil,
            &importFormat,
            &importType,
            [],
            &keyParams,
            keychain,
            &importedItems
        )
        guard importStatus == errSecSuccess,
              let items = importedItems as? [Any],
              let identity = items.first(where: { CFGetTypeID($0 as CFTypeRef) == SecIdentityGetTypeID() }) else {
            SecKeychainDelete(keychain)
            throw NSError(domain: NSOSStatusErrorDomain, code: Int(importStatus))
        }

        return EphemeralTLSIdentity(
            secIdentity: (identity as! SecIdentity),
            sha256Fingerprint: fingerprint,
            tempDir: tempDir,
            keychain: keychain
        )
    }

    func cleanup() {
        SecKeychainDelete(keychain)
        try? FileManager.default.removeItem(at: tempDir)
    }

    private static func runOpenSSL(_ arguments: [String]) throws {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/openssl")
        process.arguments = arguments
        let stderr = Pipe()
        process.standardError = stderr
        process.standardOutput = Pipe()
        try process.run()
        process.waitUntilExit()
        guard process.terminationStatus == 0 else {
            let message = String(data: stderr.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
            throw NSError(domain: "OpenSSL", code: Int(process.terminationStatus), userInfo: [NSLocalizedDescriptionKey: message])
        }
    }
}

private final class LocalLoopbackTLSServer: @unchecked Sendable {
    struct HTTPResponse {
        let statusLine: String
        let body: Data
    }

    private(set) var port: UInt16 = 0
    private let listener: NWListener
    private let queue = DispatchQueue(label: "mediflow.test.tls-server")
    private let lock = NSLock()
    private let responder: (String) -> HTTPResponse
    private var requests: [String] = []
    private var totalApplicationBytes = 0
    private var activeConnections: [NWConnection] = []

    init(identity: EphemeralTLSIdentity, responder: @escaping (String) -> HTTPResponse) throws {
        self.responder = responder

        let tlsOptions = NWProtocolTLS.Options()
        guard let secIdentityRef = sec_identity_create(identity.secIdentity) else {
            throw NSError(domain: "LocalLoopbackTLSServer", code: -1)
        }
        sec_protocol_options_set_local_identity(tlsOptions.securityProtocolOptions, secIdentityRef)

        let tcpOptions = NWProtocolTCP.Options()
        let parameters = NWParameters(tls: tlsOptions, tcp: tcpOptions)
        parameters.requiredLocalEndpoint = NWEndpoint.hostPort(host: .ipv4(.loopback), port: .any)

        let listener = try NWListener(using: parameters)
        self.listener = listener

        let readySemaphore = DispatchSemaphore(value: 0)
        var startError: Error?

        listener.stateUpdateHandler = { state in
            switch state {
            case .ready:
                readySemaphore.signal()
            case .failed(let error):
                startError = error
                readySemaphore.signal()
            default:
                break
            }
        }

        listener.newConnectionHandler = { [weak self] connection in
            self?.handleConnection(connection)
        }

        listener.start(queue: queue)
        let waitResult = readySemaphore.wait(timeout: .now() + 5)
        if waitResult == .timedOut {
            listener.cancel()
            throw NSError(domain: "LocalLoopbackTLSServer", code: -2)
        }
        if let startError {
            listener.cancel()
            throw startError
        }
        guard let boundPort = listener.port?.rawValue, boundPort > 0 else {
            listener.cancel()
            throw NSError(domain: "LocalLoopbackTLSServer", code: -3)
        }
        self.port = boundPort
    }

    func stop() {
        listener.cancel()
        lock.lock()
        let connections = activeConnections
        activeConnections.removeAll()
        lock.unlock()
        for connection in connections {
            connection.cancel()
        }
    }

    func snapshotRequests() -> [String] {
        lock.lock()
        defer { lock.unlock() }
        return requests
    }

    func receivedApplicationByteCount() -> Int {
        lock.lock()
        defer { lock.unlock() }
        return totalApplicationBytes
    }

    private func handleConnection(_ connection: NWConnection) {
        lock.lock()
        activeConnections.append(connection)
        lock.unlock()

        connection.start(queue: queue)
        receiveHTTPRequest(on: connection, buffer: Data())
    }

    private func receiveHTTPRequest(on connection: NWConnection, buffer: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] data, _, isComplete, error in
            guard let self else { return }
            var accumulated = buffer
            if let data, !data.isEmpty {
                accumulated.append(data)
                self.lock.lock()
                self.totalApplicationBytes += data.count
                self.lock.unlock()
            }

            if self.isCompleteHTTPRequest(accumulated) {
                let rawRequest = String(data: accumulated, encoding: .utf8) ?? ""
                self.lock.lock()
                self.requests.append(rawRequest)
                self.lock.unlock()

                let reply = self.responder(rawRequest)
                let responseHeader = "HTTP/1.1 \(reply.statusLine)\r\nContent-Type: application/json\r\nContent-Length: \(reply.body.count)\r\nConnection: close\r\n\r\n"
                var wireData = Data(responseHeader.utf8)
                wireData.append(reply.body)
                connection.send(content: wireData, completion: .contentProcessed { _ in
                    connection.cancel()
                })
                return
            }

            if isComplete || error != nil {
                connection.cancel()
                return
            }

            self.receiveHTTPRequest(on: connection, buffer: accumulated)
        }
    }

    private func isCompleteHTTPRequest(_ data: Data) -> Bool {
        let delimiter = Data("\r\n\r\n".utf8)
        guard let headerRange = data.range(of: delimiter) else {
            return false
        }
        let headerString = String(data: data[..<headerRange.lowerBound], encoding: .utf8) ?? ""
        var contentLength = 0
        for line in headerString.split(separator: "\r\n") {
            let parts = line.split(separator: ":", maxSplits: 1)
            if parts.count == 2 && parts[0].lowercased() == "content-length" {
                contentLength = Int(parts[1].trimmingCharacters(in: .whitespaces)) ?? 0
            }
        }
        let bodyCount = data.count - headerRange.upperBound
        return bodyCount >= contentLength
    }
}
#endif
