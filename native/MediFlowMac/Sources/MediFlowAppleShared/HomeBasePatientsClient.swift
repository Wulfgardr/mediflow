// Codex: created 2026-04-17
// @Codex
import CryptoKit
import Foundation

public struct HomeBaseConnectionConfiguration: Hashable, Sendable {
    public var serverURLString: String
    public var tlsPin: String

    public init(serverURLString: String = "https://localhost:3443", tlsPin: String = "") {
        self.serverURLString = serverURLString
        self.tlsPin = tlsPin
    }

    func serverURL() throws -> URL {
        var candidate = serverURLString.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !candidate.isEmpty else { throw HomeBaseClientError.invalidServerURL }
        if candidate.hasSuffix("/api/v1/") {
            candidate.removeLast("/api/v1/".count)
        } else if candidate.hasSuffix("/api/v1") {
            candidate.removeLast("/api/v1".count)
        }
        if candidate.hasSuffix("/") {
            candidate.removeLast()
        }
        guard let url = URL(string: candidate), url.host != nil else {
            throw HomeBaseClientError.invalidServerURL
        }
        guard url.scheme?.lowercased() == "https" else {
            throw HomeBaseClientError.insecureTransport
        }
        return url
    }

    func apiBaseURL() throws -> URL {
        try serverURL()
            .appendingPathComponent("api")
            .appendingPathComponent("v1")
    }

    var normalizedTLSPin: String {
        tlsPin
            .lowercased()
            .replacingOccurrences(of: ":", with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

public struct HomeBasePairedCredentials: Hashable, Sendable {
    public let clientId: String
    public let clientToken: String

    public init(clientId: String, clientToken: String) {
        self.clientId = clientId
        self.clientToken = clientToken
    }
}

public struct HomeBasePatientSummary: Identifiable, Codable, Hashable, Sendable {
    public let id: String
    public let firstName: String
    public let lastName: String
    public let birthDate: Date?
    public let taxCode: String
    public let isAdi: Bool?
    public let isArchived: Bool?
    public let version: Int
    public let updatedAt: Date?
}

public struct HomeBasePatientDetail: Identifiable, Codable, Hashable, Sendable {
    public let id: String
    public let firstName: String
    public let lastName: String
    public let birthDate: Date?
    public let taxCode: String
    public let address: String?
    public let phone: String?
    public let caregiver: String?
    public let exemptions: String?
    public let diagnoses: String?
    public let monitoringProfile: String?
    public let statusReason: String?
    public let notes: String?
    public let aiSummary: String?
    public let documentInsights: String?
    public let isAdi: Bool?
    public let isArchived: Bool?
    public let version: Int
    public let ambulatoryId: String?
    public let createdAt: Date?
    public let updatedAt: Date?
}

/* @Codex */
public struct HomeBaseEntrySummary: Identifiable, Codable, Hashable, Sendable {
    public let id: String
    public let patientId: String
    public let type: String
    public let title: String
    public let date: Date
    public let content: String
    public let setting: String?
    public let metadata: String?
    public let attachments: String?
    public let deletedAt: Date?
    public let deletionReason: String?
    public let version: Int
    public let createdAt: Date?
    public let updatedAt: Date?
}

/* @Codex */
public struct HomeBaseEntryCreatePayload: Encodable, Sendable {
    public let id: String
    public let type: String
    public let title: String?
    public let date: Date
    public let content: String

    public init(id: String, type: String, title: String? = nil, date: Date, content: String) {
        self.id = id
        self.type = type
        self.title = title
        self.date = date
        self.content = content
    }
}

public enum HomeBaseClientError: LocalizedError, Equatable {
    case invalidServerURL
    case insecureTransport
    case missingSessionCookie
    case transport(HomeBaseTransportIssue)
    case httpStatus(Int, String?)
    case contract

    public var errorDescription: String? {
        switch self {
        case .invalidServerURL:
            return "URL home-base non valida."
        case .insecureTransport:
            return "Trasporto non sicuro: HTTPS richiesto."
        case .missingSessionCookie:
            return "La login non ha restituito una sessione operatore valida."
        case .transport(let issue):
            return issue.localizedDescription
        case .httpStatus(_, let message):
            return message ?? "La richiesta verso l'home-base non e andata a buon fine."
        case .contract:
            return "La risposta dell'home-base non rispetta il contratto atteso."
        }
    }
}

public enum HomeBaseTransportIssue: Equatable {
    case tlsHandshakeFailed
    case unreachable
    case timeout
    case other(Int)

    var localizedDescription: String {
        switch self {
        case .tlsHandshakeFailed:
            return "Handshake TLS fallito. Verifica fingerprint o certificato."
        case .unreachable:
            return "Home-base non raggiungibile."
        case .timeout:
            return "Timeout verso l'home-base."
        case .other:
            return "Errore di trasporto verso l'home-base."
        }
    }
}

public actor HomeBasePatientsClient {
    private let configuration: HomeBaseConnectionConfiguration
    private let session: URLSession

    // @Codex
    init(configuration: HomeBaseConnectionConfiguration, session: URLSession) {
        self.configuration = configuration
        self.session = session
    }

    public init(configuration: HomeBaseConnectionConfiguration) {
        self.configuration = configuration
        let delegate = HomeBaseTLSSessionDelegate(expectedPin: configuration.normalizedTLSPin)
        let sessionConfiguration = URLSessionConfiguration.ephemeral
        sessionConfiguration.httpShouldSetCookies = false
        self.session = URLSession(configuration: sessionConfiguration, delegate: delegate, delegateQueue: nil)
    }

    public func login(username: String?, password: String) async throws -> String {
        let url = try configuration.serverURL()
            .appendingPathComponent("api")
            .appendingPathComponent("auth")
            .appendingPathComponent("login")
        let body = try JSONEncoder().encode(AuthLoginRequest(username: username, password: password))
        let (_, response) = try await send(to: url, method: "POST", body: body)
        return try Self.extractSessionCookie(from: response, url: url)
    }

    public func fetchPatients(
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> [HomeBasePatientSummary] {
        let url = try configuration.apiBaseURL()
            .appendingPathComponent("network")
            .appendingPathComponent("patients")
        let (data, _) = try await send(
            to: url,
            headers: [
                "x-mediflow-paired-client-id": credentials.clientId,
                "x-mediflow-paired-client-token": credentials.clientToken,
                "Cookie": Self.cookieHeader(sessionCookie: sessionCookie, ambulatoryId: ambulatoryId),
            ]
        )
        return try decode([HomeBasePatientSummary].self, from: data)
    }

    public func fetchPatient(
        id: String,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> HomeBasePatientDetail {
        let url = try configuration.apiBaseURL()
            .appendingPathComponent("network")
            .appendingPathComponent("patients")
            .appendingPathComponent(id)
        let (data, _) = try await send(
            to: url,
            headers: [
                "x-mediflow-paired-client-id": credentials.clientId,
                "x-mediflow-paired-client-token": credentials.clientToken,
                "Cookie": Self.cookieHeader(sessionCookie: sessionCookie, ambulatoryId: ambulatoryId),
            ]
        )
        return try decode(HomeBasePatientDetail.self, from: data)
    }

    /* @Codex */
    public func fetchEntries(
        patientId: String,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?,
        limit: Int = 20
    ) async throws -> [HomeBaseEntrySummary] {
        let url = try configuration.apiBaseURL()
            .appendingPathComponent("network")
            .appendingPathComponent("patients")
            .appendingPathComponent(patientId)
            .appendingPathComponent("entries")
            .appending(queryItems: [URLQueryItem(name: "limit", value: String(max(1, min(limit, 100))))])
        let (data, _) = try await send(
            to: url,
            headers: pairedHeaders(credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
        )
        return try decode([HomeBaseEntrySummary].self, from: data)
    }

    /* @Codex */
    public func createEntry(
        patientId: String,
        payload: HomeBaseEntryCreatePayload,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> HomeBaseCreatedResource {
        let url = try configuration.apiBaseURL()
            .appendingPathComponent("network")
            .appendingPathComponent("patients")
            .appendingPathComponent(patientId)
            .appendingPathComponent("entries")
        let (data, _) = try await send(
            to: url,
            method: "POST",
            headers: pairedHeaders(credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId),
            body: encode(payload)
        )
        return try decode(HomeBaseCreatedResource.self, from: data)
    }

    static func cookieHeader(sessionCookie: String, ambulatoryId: String?) -> String {
        let trimmedAmbulatory = ambulatoryId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !trimmedAmbulatory.isEmpty else { return sessionCookie }
        return "\(sessionCookie); ambulatory_id=\(trimmedAmbulatory)"
    }

    private func pairedHeaders(
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) -> [String: String] {
        [
            "x-mediflow-paired-client-id": credentials.clientId,
            "x-mediflow-paired-client-token": credentials.clientToken,
            "Cookie": Self.cookieHeader(sessionCookie: sessionCookie, ambulatoryId: ambulatoryId),
        ]
    }

    private func send(
        to url: URL,
        method: String = "GET",
        headers: [String: String] = [:],
        body: Data? = nil
    ) async throws -> (Data, HTTPURLResponse) {
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.httpBody = body
        request.setValue("native", forHTTPHeaderField: "X-MediFlow-Source-Surface")
        for (key, value) in headers {
            request.setValue(value, forHTTPHeaderField: key)
        }
        if body != nil {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }

        do {
            let (data, response) = try await session.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse else {
                throw HomeBaseClientError.contract
            }
            guard 200..<300 ~= httpResponse.statusCode else {
                throw HomeBaseClientError.httpStatus(httpResponse.statusCode, Self.errorMessage(from: data))
            }
            return (data, httpResponse)
        } catch let error as URLError {
            throw HomeBaseClientError.transport(Self.mapTransportError(error))
        }
    }

    private func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        do {
            return try decoder.decode(type, from: data)
        } catch {
            throw HomeBaseClientError.contract
        }
    }

    private func encode<T: Encodable>(_ payload: T) throws -> Data {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return try encoder.encode(payload)
    }

    private static func extractSessionCookie(from response: HTTPURLResponse, url: URL) throws -> String {
        let headers = response.allHeaderFields.reduce(into: [String: String]()) { result, item in
            if let key = item.key as? String, let value = item.value as? String {
                result[key] = value
            }
        }
        let cookies = HTTPCookie.cookies(withResponseHeaderFields: headers, for: url)
        guard let session = cookies.first(where: { $0.name == "mediflow_session" }) else {
            throw HomeBaseClientError.missingSessionCookie
        }
        return "\(session.name)=\(session.value)"
    }

    private static func errorMessage(from data: Data) -> String? {
        guard !data.isEmpty else { return nil }
        return (try? JSONDecoder().decode(APIErrorPayload.self, from: data)).flatMap { $0.message ?? $0.error }
    }

    private static func mapTransportError(_ error: URLError) -> HomeBaseTransportIssue {
        switch error.code {
        case .cancelled, .secureConnectionFailed, .serverCertificateUntrusted, .serverCertificateHasBadDate, .serverCertificateHasUnknownRoot:
            return .tlsHandshakeFailed
        case .cannotConnectToHost, .cannotFindHost, .notConnectedToInternet:
            return .unreachable
        case .timedOut:
            return .timeout
        default:
            return .other(error.code.rawValue)
        }
    }
}

private final class HomeBaseTLSSessionDelegate: NSObject, URLSessionDelegate {
    private let expectedPin: String

    init(expectedPin: String) {
        self.expectedPin = expectedPin
    }

    func urlSession(
        _ session: URLSession,
        didReceive challenge: URLAuthenticationChallenge,
        completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
    ) {
        guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
              let serverTrust = challenge.protectionSpace.serverTrust else {
            completionHandler(.performDefaultHandling, nil)
            return
        }

        if !expectedPin.isEmpty,
           let certificate = (SecTrustCopyCertificateChain(serverTrust) as? [SecCertificate])?.first {
            let pin = SHA256.hash(data: SecCertificateCopyData(certificate) as Data)
                .map { String(format: "%02x", $0) }
                .joined()
            if pin == expectedPin {
                completionHandler(.useCredential, URLCredential(trust: serverTrust))
            } else {
                completionHandler(.cancelAuthenticationChallenge, nil)
            }
            return
        }

        if SecTrustEvaluateWithError(serverTrust, nil) {
            completionHandler(.useCredential, URLCredential(trust: serverTrust))
        } else {
            completionHandler(.cancelAuthenticationChallenge, nil)
        }
    }
}

private struct AuthLoginRequest: Encodable {
    let username: String?
    let password: String
}

private struct APIErrorPayload: Decodable {
    let error: String?
    let message: String?
}

/* @Codex */
public struct HomeBaseCreatedResource: Decodable, Equatable, Sendable {
    public let id: String
    public let version: Int?
}
