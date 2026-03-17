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
