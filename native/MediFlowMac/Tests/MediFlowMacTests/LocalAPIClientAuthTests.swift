// @Codex
import Foundation
import XCTest
@testable import MediFlowMac

/* @Codex */
final class LocalAPIClientAuthTests: XCTestCase {
    private var originalBaseURL: String?

    override func setUp() {
        super.setUp()
        originalBaseURL = UserDefaults.standard.string(forKey: LocalAPISettings.baseURLKey)
        LocalAPISettings.saveBaseURLString(LocalAPISettings.defaultBaseURL)
    }

    override func tearDown() {
        if let originalBaseURL {
            LocalAPISettings.saveBaseURLString(originalBaseURL)
        } else {
            UserDefaults.standard.removeObject(forKey: LocalAPISettings.baseURLKey)
        }
        MockURLProtocol.requestHandler = nil
        super.tearDown()
    }

    func testTestConnectionFailsFastWhenTokenIsMissing() async {
        let client = LocalAPIClient(
            tokenProvider: LocalAPITokenProvider(
                keychainReader: { _ in .notFound },
                configReader: { nil },
                legacyReader: { nil }
            ),
            session: URLSession.shared
        )

        do {
            try await client.testConnection()
            XCTFail("Expected missing token failure")
        } catch let error as LocalAPIError {
            XCTAssertEqual(error, .missingAPIToken)
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    func testTestConnectionSurfacesIncompleteBootstrapBeforeNetwork() async {
        let client = LocalAPIClient(
            tokenProvider: LocalAPITokenProvider(
                keychainReader: { _ in .interactionNotAllowed },
                configReader: { "config-token" },
                legacyReader: { "legacy-token" }
            ),
            session: URLSession.shared
        )

        do {
            try await client.testConnection()
            XCTFail("Expected bootstrap failure")
        } catch let error as LocalAPIError {
            XCTAssertEqual(
                error,
                .incompleteAPITokenBootstrap(.keychainInteractionNotAllowed)
            )
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    func testLoginMapsUnauthorizedAsAuthError() async {
        let client = makeClient { request in
            let response = HTTPURLResponse(
                url: try XCTUnwrap(request.url),
                statusCode: 401,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            let data = #"{"error":"PIN non valido"}"#.data(using: .utf8)!
            return (response, data)
        }

        do {
            _ = try await client.login(pin: "0000")
            XCTFail("Expected auth error")
        } catch let error as LocalAPIError {
            XCTAssertEqual(error, .auth(statusCode: 401, message: "PIN non valido"))
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    func testTestConnectionMapsTLSHandshakeAsTransportError() async {
        let client = makeAuthenticatedClient { _ in
            throw URLError(.cancelled)
        }

        do {
            try await client.testConnection()
            XCTFail("Expected transport error")
        } catch let error as LocalAPIError {
            XCTAssertEqual(error, .transport(.tlsHandshakeFailed))
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    func testSaveSettingMapsValidationStatus() async {
        let client = makeAuthenticatedClient { request in
            let response = HTTPURLResponse(
                url: try XCTUnwrap(request.url),
                statusCode: 400,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            let data = #"{"error":"Key and value required"}"#.data(using: .utf8)!
            return (response, data)
        }

        do {
            try await client.saveSetting(key: "", value: "")
            XCTFail("Expected validation error")
        } catch let error as LocalAPIError {
            XCTAssertEqual(error, .validation(statusCode: 400, message: "Key and value required"))
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    func testFetchPatientsMapsInvalidPayloadAsContractError() async {
        let client = makeAuthenticatedClient { request in
            let response = HTTPURLResponse(
                url: try XCTUnwrap(request.url),
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            let data = #"{"patients":[]}"#.data(using: .utf8)!
            return (response, data)
        }

        do {
            _ = try await client.fetchPatients(ambulatoryId: nil)
            XCTFail("Expected contract error")
        } catch let error as LocalAPIError {
            XCTAssertEqual(error, .contract("Risposta API locale non valida."))
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    func testFetchObservationsBuildsNativeQueryAndDecodesObservationSummary() async throws {
        let dateFrom = Date(timeIntervalSince1970: 0)
        let dateTo = Date(timeIntervalSince1970: 3_600)
        let client = makeAuthenticatedClient { request in
            XCTAssertEqual(request.httpMethod, "GET")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer test-token")
            XCTAssertEqual(request.value(forHTTPHeaderField: "X-MediFlow-Source-Surface"), "native")

            let url = try XCTUnwrap(request.url)
            XCTAssertEqual(url.path, "/api/v1/patients/patient-1/observations")
            let components = try XCTUnwrap(URLComponents(url: url, resolvingAgainstBaseURL: false))
            let queryItems = Dictionary(uniqueKeysWithValues: (components.queryItems ?? []).compactMap { item in
                item.value.map { (item.name, $0) }
            })
            XCTAssertEqual(queryItems["limit"], "25")
            XCTAssertEqual(queryItems["code"], "8480-6")
            XCTAssertEqual(queryItems["dateFrom"], "1970-01-01T00:00:00Z")
            XCTAssertEqual(queryItems["dateTo"], "1970-01-01T01:00:00Z")

            let response = HTTPURLResponse(
                url: url,
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            let data = """
            [
              {
                "id": "obs-1",
                "patientId": "patient-1",
                "codeSystem": "LOINC",
                "code": "8480-6",
                "display": "Pressione sistolica",
                "unitSystem": "UCUM",
                "unitCode": "mm[Hg]",
                "value": "138",
                "notes": "Controllo domiciliare",
                "observedAt": "2026-03-18T08:30:00Z",
                "source": "manual",
                "createdAt": "2026-03-18T08:31:00Z"
              }
            ]
            """.data(using: .utf8)!
            return (response, data)
        }

        let observations = try await client.fetchObservations(
            patientId: "patient-1",
            limit: 25,
            code: "8480-6",
            dateFrom: dateFrom,
            dateTo: dateTo
        )

        XCTAssertEqual(observations.count, 1)
        XCTAssertEqual(observations.first?.codeSystem, "LOINC")
        XCTAssertEqual(observations.first?.unitSystem, "UCUM")
        XCTAssertEqual(observations.first?.display, "Pressione sistolica")
        XCTAssertEqual(observations.first?.value, "138")
    }

    func testCreateObservationUsesPostRouteAndNativeHeaders() async throws {
        let client = makeAuthenticatedClient { request in
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
            XCTAssertEqual(request.value(forHTTPHeaderField: "X-MediFlow-Source-Surface"), "native")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer test-token")
            XCTAssertEqual(request.url?.path, "/api/v1/patients/patient-1/observations")

            let response = HTTPURLResponse(
                url: try XCTUnwrap(request.url),
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            let data = #"{"id":"obs-1"}"#.data(using: .utf8)!
            return (response, data)
        }

        let createdId = try await client.createObservation(
            patientId: "patient-1",
            payload: CreateObservationPayload(
                codeSystem: "LOINC",
                code: "8480-6",
                display: "Pressione sistolica",
                unitSystem: "UCUM",
                unitCode: "mm[Hg]",
                value: "138",
                notes: "Controllo domiciliare",
                observedAt: Date(timeIntervalSince1970: 0),
                source: "manual"
            )
        )

        XCTAssertEqual(createdId, "obs-1")
    }

    func testUpdateObservationUsesPutRouteAndNativeHeaders() async throws {
        let client = makeAuthenticatedClient { request in
            XCTAssertEqual(request.httpMethod, "PUT")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
            XCTAssertEqual(request.value(forHTTPHeaderField: "X-MediFlow-Source-Surface"), "native")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer test-token")
            XCTAssertEqual(request.url?.path, "/api/v1/patients/patient-1/observations/obs-1")

            let response = HTTPURLResponse(
                url: try XCTUnwrap(request.url),
                statusCode: 204,
                httpVersion: nil,
                headerFields: nil
            )!
            return (response, Data())
        }

        try await client.updateObservation(
            patientId: "patient-1",
            observationId: "obs-1",
            payload: UpdateObservationPayload(
                codeSystem: "LOINC",
                code: "8480-6",
                display: "Pressione sistolica",
                unitSystem: "UCUM",
                unitCode: "mm[Hg]",
                value: "135",
                notes: "",
                observedAt: Date(timeIntervalSince1970: 0),
                source: "manual"
            )
        )
    }

    func testDeleteObservationUsesDeleteRoute() async throws {
        let client = makeAuthenticatedClient { request in
            XCTAssertEqual(request.httpMethod, "DELETE")
            XCTAssertEqual(request.url?.path, "/api/v1/patients/patient-1/observations/obs-1")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer test-token")

            let response = HTTPURLResponse(
                url: try XCTUnwrap(request.url),
                statusCode: 204,
                httpVersion: nil,
                headerFields: nil
            )!
            return (response, Data())
        }

        try await client.deleteObservation(patientId: "patient-1", observationId: "obs-1")
    }

    private func makeClient(
        handler: @escaping (URLRequest) throws -> (HTTPURLResponse, Data)
    ) -> LocalAPIClient {
        MockURLProtocol.requestHandler = handler
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockURLProtocol.self]
        let session = URLSession(configuration: configuration)
        return LocalAPIClient(session: session)
    }

    private func makeAuthenticatedClient(
        handler: @escaping (URLRequest) throws -> (HTTPURLResponse, Data)
    ) -> LocalAPIClient {
        MockURLProtocol.requestHandler = handler
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockURLProtocol.self]
        let session = URLSession(configuration: configuration)
        return LocalAPIClient(
            tokenProvider: LocalAPITokenProvider(
                keychainReader: { _ in .success("test-token") },
                configReader: { nil },
                legacyReader: { nil }
            ),
            session: session
        )
    }

}

private final class MockURLProtocol: URLProtocol {
    static var requestHandler: ((URLRequest) throws -> (HTTPURLResponse, Data))?

    override class func canInit(with request: URLRequest) -> Bool {
        true
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest {
        request
    }

    override func startLoading() {
        guard let handler = Self.requestHandler else {
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
