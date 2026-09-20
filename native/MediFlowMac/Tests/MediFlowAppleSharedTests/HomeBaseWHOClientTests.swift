#if os(macOS)
// @Codex: WUL-673. URLProtocol fixtures exercise the real WHO client methods.
// These do not qualify real TLS, pairing, WHO availability or live UI.
import Foundation
import XCTest
@testable import MediFlowAppleShared

final class HomeBaseWHOClientTests: XCTestCase {
    private let credentials = HomeBasePairedCredentials(clientId: "synthetic-paired", clientToken: "synthetic-token")
    private let cookie = "mediflow_session=synthetic-native-session"

    func testSearchUsesOnlyPairedRouteAndPreservesContextAndReceipt() async throws {
        let client = makeClient { request in
            self.assertPairedRequest(request, operation: "search")
            XCTAssertEqual(URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems,
                           [URLQueryItem(name: "q", value: "synthetic term")])
            return try self.reply(request, object: WHOSyntheticFixtures.search(source: "cache", partial: true))
        }
        let result = try await client.searchWHO(query: " synthetic   term ", credentials: credentials,
                                               sessionCookie: cookie, ambulatoryId: "synthetic-amb")
        XCTAssertEqual(result.receipt.source, .cache)
        XCTAssertTrue(result.partial)
        XCTAssertEqual(result.receipt.bindingId, HomeBaseWHODecoder.binding)
        XCTAssertEqual(result.entries.first?.canonicalUri, WHOSyntheticFixtures.uri)
    }

    func testReadinessUsesPassiveRouteAndAcceptsStructured503NotFalseAvailability() async throws {
        let client = makeClient { request in
            self.assertPairedRequest(request, operation: "readiness")
            XCTAssertTrue(URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems?.isEmpty ?? true)
            return try self.reply(request, object: WHOSyntheticFixtures.readiness(), status: 503)
        }
        let result = try await client.readWHOReadiness(credentials: credentials, sessionCookie: cookie, ambulatoryId: "synthetic-amb")
        XCTAssertEqual(result.status, .configured)
        XCTAssertNil(result.lastLiveObservedAt)
    }

    func testCodeCheckPinsReleaseAndEscapesWholeCombinationWithoutWebSessionEmulation() async throws {
        for code in ["AA00", "AA00&XA001", "AA00/XA001"] {
            let client = makeClient { request in
                self.assertPairedRequest(request, operation: "code-check")
                let items = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems
                XCTAssertEqual(items, [URLQueryItem(name: "code", value: code), URLQueryItem(name: "release", value: "2026-01")])
                return try self.reply(request, object: WHOSyntheticFixtures.check(code: code, found: false))
            }
            let result = try await client.checkWHOCode(code: code, credentials: credentials, sessionCookie: cookie, ambulatoryId: "synthetic-amb")
            XCTAssertEqual(result.code, code)
            XCTAssertEqual(result.status, .notFound)
            XCTAssertEqual(result.receipt.source, .live)
        }
    }

    func testRejectsMalformedBodyMediaTypeOversizeAndMismatchedSchema() async {
        let valid = try! WHOSyntheticFixtures.data(WHOSyntheticFixtures.search())
        var large = valid; large.append(Data(repeating: 32, count: 65_537 - valid.count))
        let wrong = try! WHOSyntheticFixtures.data(WHOSyntheticFixtures.readiness(status: "available"))
        for (data, contentType) in [(Data("{".utf8), "application/json"), (large, "application/json"),
                                    (wrong, "application/json"), (valid, "text/html")] {
            let client = makeClient { request in
                (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": contentType])!, data)
            }
            do {
                _ = try await client.searchWHO(query: "synthetic", credentials: credentials, sessionCookie: cookie, ambulatoryId: "synthetic-amb")
                XCTFail("Malformed or oversized projection must fail")
            } catch { XCTAssertEqual(error as? HomeBaseWHOError, .invalidResponse) }
        }
    }

    func testReadinessHTTPAndStatusMustAgree() async {
        for (status, readiness) in [(200, "configured"), (503, "available")] {
            let client = makeClient { request in try self.reply(request, object: WHOSyntheticFixtures.readiness(status: readiness), status: status) }
            do {
                _ = try await client.readWHOReadiness(credentials: credentials, sessionCookie: cookie, ambulatoryId: "synthetic-amb")
                XCTFail("Readiness mismatch must fail")
            } catch { XCTAssertEqual(error as? HomeBaseWHOError, .invalidResponse) }
        }
    }

    func testInvalidInputAndMissingCredentialsDoNotMakeRequests() async {
        let client = makeClient { _ in XCTFail("Invalid input must not start network work"); throw URLError(.badURL) }
        for query in ["", "  ", String(repeating: "é", count: 81), "<invalid>"] {
            do {
                _ = try await client.searchWHO(query: query, credentials: credentials, sessionCookie: cookie, ambulatoryId: nil)
                XCTFail("Invalid query")
            } catch { XCTAssertEqual(error as? HomeBaseWHOError, .invalidRequest) }
        }
        do {
            _ = try await client.checkWHOCode(code: "AA00&&XA001", credentials: credentials, sessionCookie: cookie, ambulatoryId: nil)
            XCTFail("Invalid code")
        } catch { XCTAssertEqual(error as? HomeBaseWHOError, .invalidRequest) }
        do {
            _ = try await client.readWHOReadiness(credentials: HomeBasePairedCredentials(clientId: "", clientToken: ""), sessionCookie: cookie, ambulatoryId: nil)
            XCTFail("Missing credentials")
        } catch { XCTAssertEqual(error as? HomeBaseWHOError, .unauthorized) }
    }

    func testKnownFailuresAreClosedAnd503DoesNotClaimOversize() async {
        for (status, code, expected) in [(401, "Unauthorized", HomeBaseWHOError.unauthorized),
                                        (403, "Forbidden", .forbidden), (409, "NETWORK_MODE_DISABLED", .networkModeDisabled),
                                        (502, "upstream_response_invalid", .upstreamResponseInvalid),
                                        (503, "service_unavailable", .unavailable), (504, "upstream_timeout", .upstreamTimeout)] {
            let client = makeClient { request in
                try self.reply(request, object: ["schemaVersion": "mediflow.reference-data.icd11-error.v1", "code": code], status: status)
            }
            do {
                _ = try await client.searchWHO(query: "synthetic", credentials: credentials, sessionCookie: cookie, ambulatoryId: nil)
                XCTFail("HTTP failure must fail")
            } catch { XCTAssertEqual(error as? HomeBaseWHOError, expected) }
        }
        XCTAssertFalse(HomeBaseWHOError.unavailable.localizedDescription.contains("oltre il limite"))
    }

    func testCancellationRemainsCancellationNotTLSError() async {
        let client = makeClient { _ in throw URLError(.cancelled) }
        do {
            _ = try await client.searchWHO(query: "synthetic", credentials: credentials, sessionCookie: cookie, ambulatoryId: nil)
            XCTFail("Cancellation must not deliver")
        } catch { XCTAssertTrue(error is CancellationError) }
    }

    func testExistingCatalogRoutesRemainIndependentOfWHO() async throws {
        for system in ["atc", "loinc", "ucum"] {
            let client = makeClient { request in
                XCTAssertEqual(request.url?.path, "/api/v1/network/terminology/search")
                let items = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems
                XCTAssertEqual(items?.first(where: { $0.name == "system" })?.value, system)
                return (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!, Data("[]".utf8))
            }
            let rows = try await client.searchTerminology(system: system, query: "synthetic", credentials: credentials, sessionCookie: cookie, ambulatoryId: nil)
            XCTAssertTrue(rows.isEmpty)
        }
        for catalogue in ["drugs", "exemptions"] {
            let client = makeClient { request in
                XCTAssertEqual(request.url?.path, "/api/v1/network/\(catalogue)")
                return (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!, Data("[]".utf8))
            }
            if catalogue == "drugs" {
                let rows = try await client.searchDrugs(query: "synthetic", credentials: credentials, sessionCookie: cookie, ambulatoryId: nil)
                XCTAssertTrue(rows.isEmpty)
            } else {
                let rows = try await client.searchExemptions(query: "synthetic", credentials: credentials, sessionCookie: cookie, ambulatoryId: nil)
                XCTAssertTrue(rows.isEmpty)
            }
        }
    }

    private func assertPairedRequest(_ request: URLRequest, operation: String) {
        XCTAssertEqual(request.httpMethod, "GET")
        XCTAssertEqual(request.url?.path, "/api/v1/network/terminology/who/\(operation)")
        XCTAssertEqual(request.value(forHTTPHeaderField: "x-mediflow-paired-client-id"), credentials.clientId)
        XCTAssertEqual(request.value(forHTTPHeaderField: "x-mediflow-paired-client-token"), credentials.clientToken)
        XCTAssertEqual(request.value(forHTTPHeaderField: "Cookie"), cookie + "; ambulatory_id=synthetic-amb")
        XCTAssertEqual(request.value(forHTTPHeaderField: "X-MediFlow-Source-Surface"), "native")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Cache-Control"), "no-store")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Accept"), "application/json")
        XCTAssertFalse(request.httpShouldHandleCookies)
        XCTAssertNil(request.httpBody)
        XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"))
    }
    private func reply(_ request: URLRequest, object: [String: Any], status: Int = 200) throws -> (HTTPURLResponse, Data) {
        (HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!, try WHOSyntheticFixtures.data(object))
    }
    private func makeClient(handler: @escaping (URLRequest) throws -> (HTTPURLResponse, Data)) -> HomeBasePatientsClient {
        WHOClientURLProtocol.handler = handler
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = false
        configuration.protocolClasses = [WHOClientURLProtocol.self]
        return HomeBasePatientsClient(configuration: HomeBaseConnectionConfiguration(serverURLString: "https://localhost:3443"), session: URLSession(configuration: configuration))
    }
}

private final class WHOClientURLProtocol: URLProtocol {
    static var handler: ((URLRequest) throws -> (HTTPURLResponse, Data))?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            guard let handler = Self.handler else { throw URLError(.badServerResponse) }
            let (response, data) = try handler(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}
#endif
