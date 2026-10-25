import Foundation
import XCTest
@testable import MediFlowAppleShared

final class HomeBaseEntryFetchTests: XCTestCase {
    override func tearDown() { EntryFetchURLProtocol.handler = nil; super.tearDown() }
    private func client(_ handler: @escaping (URLRequest) throws -> (Int, String)) -> HomeBasePatientsClient {
        EntryFetchURLProtocol.handler = handler
        let configuration = URLSessionConfiguration.ephemeral; configuration.protocolClasses = [EntryFetchURLProtocol.self]
        return HomeBasePatientsClient(configuration: .init(serverURLString: "https://localhost:3443"), session: URLSession(configuration: configuration))
    }
    private func body(id: String = "synthetic-old-entry", patientId: String = "synthetic-patient") -> String {
        "{\"id\":\"\(id)\",\"patientId\":\"\(patientId)\",\"type\":\"note\",\"title\":\"ENC:synthetic\",\"content\":\"ENC:synthetic\",\"date\":\"2025-01-01T00:00:00Z\",\"version\":7}"
    }
    func testProtocolFetchReadsExactOldEntryFreshWithPairedAndOperatorScope() async throws {
        let source: any HomeBasePatientsDataSource = client { request in
            XCTAssertEqual(request.httpMethod, "GET")
            XCTAssertEqual(request.url?.path, "/api/v1/network/patients/synthetic-patient/entries/synthetic-old-entry")
            XCTAssertNil(request.url?.query)
            XCTAssertEqual(request.value(forHTTPHeaderField: "Cache-Control"), "no-store")
            XCTAssertEqual(request.cachePolicy, .reloadIgnoringLocalAndRemoteCacheData)
            XCTAssertEqual(request.value(forHTTPHeaderField: "x-mediflow-paired-client-id"), "synthetic-client")
            XCTAssertEqual(request.value(forHTTPHeaderField: "x-mediflow-paired-client-token"), "synthetic-token")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Cookie"), "mediflow_session=synthetic; ambulatory_id=synthetic-ambulatory")
            return (200, self.body())
        }
        let entry = try await source.fetchEntry(patientId: "synthetic-patient", entryId: "synthetic-old-entry", credentials: .init(clientId: "synthetic-client", clientToken: "synthetic-token"), sessionCookie: "mediflow_session=synthetic", ambulatoryId: "synthetic-ambulatory")
        XCTAssertEqual(entry.id, "synthetic-old-entry"); XCTAssertEqual(entry.version, 7); XCTAssertEqual(entry.title, "ENC:synthetic")
    }
    func testNotFoundAuthenticationAndWrongRecordNeverBecomeSuccessOrCreate() async throws {
        for status in [401, 403, 404] {
            var requests = 0
            let source = client { request in requests += 1; XCTAssertEqual(request.httpMethod, "GET"); return (status, "{}") }
            do {
                _ = try await source.fetchEntry(patientId: "synthetic-patient", entryId: "synthetic-old-entry", credentials: .init(clientId: "synthetic-client", clientToken: "synthetic-token"), sessionCookie: "mediflow_session=synthetic", ambulatoryId: "synthetic-ambulatory")
                XCTFail("Expected HTTP failure")
            } catch HomeBaseClientError.httpStatus(let code, _) { XCTAssertEqual(code, status) }
            XCTAssertEqual(requests, 1)
        }
        for record in [body(id: "different-entry"), body(patientId: "different-patient")] {
            let source = client { _ in (200, record) }
            do {
                _ = try await source.fetchEntry(patientId: "synthetic-patient", entryId: "synthetic-old-entry", credentials: .init(clientId: "synthetic-client", clientToken: "synthetic-token"), sessionCookie: "mediflow_session=synthetic", ambulatoryId: "synthetic-ambulatory")
                XCTFail("Wrong record must be rejected")
            } catch HomeBaseClientError.contract {}
        }
    }
}
private final class EntryFetchURLProtocol: URLProtocol {
    static var handler: ((URLRequest) throws -> (Int, String))?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            let (status, body) = try Self.handler!(request)
            client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: Data(body.utf8)); client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}
