#if DEBUG && os(iOS) && targetEnvironment(simulator)
import CryptoKit
import Foundation
import MediFlowCore

@MainActor
final class MobileVisitSyntheticRuntime: MobileVisitUnlocking {
    static let shared: MobileVisitSyntheticRuntime? = {
        let environment = ProcessInfo.processInfo.environment
        guard environment["MEDIFLOW_APPLE_UITEST_PATIENTS"] == "1",
              let run = environment["MEDIFLOW_APPLE_UITEST_VISIT"],
              run.range(of: "^[A-Za-z0-9-]{1,64}$", options: .regularExpression) != nil else { return nil }
        return MobileVisitSyntheticRuntime(run: run)
    }()
    static let key = SymmetricKey(data: Data(repeating: 71, count: 32))
    let store: MobileVisitStore
    let source: HomeBasePatientsClient
    let configuration = HomeBaseConnectionConfiguration(serverURLString: "https://127.0.0.1:49293", tlsPin: String(repeating: "a", count: 64))
    let credentials: HomeBasePairedCredentials
    let patient = HomeBasePatientSummary(id: "visit-synthetic-patient", firstName: "Paziente", lastName: "Sintetico",
        birthDate: nil, taxCode: "SYNTHETIC", isAdi: false, isArchived: false, version: 1, updatedAt: nil)

    private init(run: String) {
        credentials = HomeBasePairedCredentials(clientId: "synthetic-device", clientToken: SHA256.hash(data: Data(run.utf8)).map { String(format: "%02x", $0) }.joined())
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("MobileVisitSynthetic/\(run)")
        store = MobileVisitStore(directory: directory.appendingPathComponent("vault"))
        MobileVisitSyntheticProtocol.hostFile = directory.appendingPathComponent("synthetic-host.json")
        let session = URLSessionConfiguration.ephemeral
        session.httpShouldSetCookies = false
        session.urlCache = nil
        session.protocolClasses = [MobileVisitSyntheticProtocol.self]
        source = HomeBasePatientsClient(configuration: configuration, session: URLSession(configuration: session))
    }

    func unlock(createIfMissing: Bool) async throws -> SymmetricKey { Self.key }
    func invalidate() {}
}

private final class MobileVisitSyntheticProtocol: URLProtocol {
    static var hostFile: URL?
    private static let lock = NSLock()
    override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "127.0.0.1" && request.url?.port == 49293 }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func stopLoading() {}
    override func startLoading() {
        do {
            let (status, object, cookie) = try Self.lock.withLock { try response() }
            let data = try JSONSerialization.data(withJSONObject: object)
            let headers = ["Content-Type": "application/json", "Cache-Control": "no-store"]
                .merging(cookie.map { ["Set-Cookie": $0] } ?? [:]) { _, new in new }
            client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status,
                httpVersion: nil, headerFields: headers)!, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }

    private func response() throws -> (Int, Any, String?) {
        let path = request.url!.path
        var body = request.httpBody ?? Data()
        if let stream = request.httpBodyStream {
            stream.open(); defer { stream.close() }
            var bytes = [UInt8](repeating: 0, count: 4096)
            while true {
                let count = stream.read(&bytes, maxLength: bytes.count)
                if count <= 0 { break }
                body.append(contentsOf: bytes.prefix(count))
            }
        }
        if path == "/api/auth/check" {
            return (200, ["status": "ok", "isSetup": true, "unlock": ["credential": "pin"]], nil)
        }
        if path == "/api/auth/native/login" {
            let input = try JSONSerialization.jsonObject(with: body) as? [String: Any]
            guard let credential = input?["password"] as? String, !credential.isEmpty else { return (401, [:], nil) }
            let salt = Data(repeating: 4, count: 16)
            guard let wrapped = CryptoService.wrapMasterKeyVersioned(Self.syntheticKey, pin: credential, salt: salt, version: 2) else {
                return (400, [:], nil)
            }
            return (200, ["success": true, "id": "synthetic-operator", "username": "synthetic", "encryptedMasterKey": wrapped,
                          "salt": salt.base64EncodedString()], "mediflow_session=synthetic-\(UUID().uuidString); Path=/; Secure; HttpOnly")
        }
        if path == "/api/auth/profile" {
            return (200, ["operation": "account-profile.read.v1", "contractVersion": 1, "userId": "synthetic-operator", "username": "synthetic",
                "displayName": NSNull(), "ambulatoryName": NSNull(), "profileVersion": "1", "archiveGeneration": "synthetic-archive"] as [String: Any], nil)
        }
        if path.hasSuffix("/identity") {
            return (200, ["identityModel": "paired", "pairingBoundary": "separate", "credentialState": "session-bound", "loginMode": "explicit",
                "operator": ["userId": "synthetic-operator", "role": "admin", "authChannel": "paired-native"],
                "scope": ["policy": "session-context", "effectiveAmbulatoryId": "AMB-1", "source": "session-context"],
                "audit": ["actorType": "user", "actorBinding": "session-user"], "limitations": ["Solo dati sintetici"]] as [String: Any], nil)
        }
        if path.hasSuffix("/capabilities") {
            return (200, ["nodeId": "synthetic-node", "operatingMode": "network-home-base", "protocolVersion": "1", "capabilities":
                ["network.replica.readonly-patients", "network.replica.write-clinical-diary"].map {
                    ["key": $0, "status": "available", "requiresPairing": true, "description": "Fixture sintetica"] as [String: Any]
                }] as [String: Any], nil)
        }
        if path.hasSuffix("/ambulatories") { return (200, [["id": "AMB-1", "name": "Ambulatorio sintetico", "version": 1]], nil) }
        if path.hasSuffix("/revision") { return (200, ["revision": "synthetic", "sourceFingerprint": "synthetic", "fingerprint": "synthetic"], nil) }
        let patient: [String: Any] = ["id": "visit-synthetic-patient", "firstName": "Paziente", "lastName": "Sintetico",
            "taxCode": "SYNTHETIC", "version": 1, "ambulatoryId": "AMB-1", "notes": "Solo dati inventati"]
        if path.hasSuffix("/patients") { return (200, [patient], nil) }
        if path.hasSuffix("/patients/visit-synthetic-patient") { return (200, patient, nil) }
        var entries = try loadHost()
        if path.hasSuffix("/entries"), request.httpMethod == "POST" {
            guard var entry = try JSONSerialization.jsonObject(with: body) as? [String: Any], let id = entry["id"] as? String else { return (400, [:], nil) }
            entry["patientId"] = "visit-synthetic-patient"
            entry["version"] = 1
            if let existing = entries.first(where: { $0["id"] as? String == id }) {
                guard NSDictionary(dictionary: existing).isEqual(to: entry) else { return (409, [:], nil) }
                return (200, ["id": id, "version": 1], nil)
            }
            entries.append(entry)
            guard let file = Self.hostFile else { throw MobileVisitError.storage }
            try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
            try JSONSerialization.data(withJSONObject: entries).write(to: file, options: .atomic)
            return (201, ["id": id, "version": 1], nil)
        }
        if path.contains("/entries/") {
            guard let entry = entries.first(where: { $0["id"] as? String == request.url!.lastPathComponent }) else { return (404, [:], nil) }
            return (200, entry, nil)
        }
        if path.hasSuffix("/entries") { return (200, entries, nil) }
        return (200, [], nil)
    }

    private static var syntheticKey: SymmetricKey { SymmetricKey(data: Data(repeating: 71, count: 32)) }
    private func loadHost() throws -> [[String: Any]] {
        guard let file = Self.hostFile, FileManager.default.fileExists(atPath: file.path) else { return [] }
        return try JSONSerialization.jsonObject(with: Data(contentsOf: file)) as? [[String: Any]] ?? []
    }
}
#endif
