// Codex: created 2026-04-18
// @Codex
import Foundation
import XCTest
@testable import MediFlowAppleShared

final class HomeBasePatientsClientTests: XCTestCase {
    override func tearDown() {
        MockHomeBaseURLProtocol.requestHandler = nil
        super.tearDown()
    }

    func testLoginSendsNativePayloadAndReturnsSessionCookie() async throws {
        let client = makeClient { request in
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
            XCTAssertEqual(request.value(forHTTPHeaderField: "X-MediFlow-Source-Surface"), "native")
            XCTAssertEqual(request.url?.absoluteString, "https://localhost:3443/api/auth/login")

            let body = try self.readRequestBody(from: request)
            let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
            XCTAssertEqual(payload["username"] as? String, "doctor")
            XCTAssertEqual(payload["password"] as? String, "1992")

            let response = HTTPURLResponse(
                url: try XCTUnwrap(request.url),
                statusCode: 200,
                httpVersion: nil,
                headerFields: [
                    "Content-Type": "application/json",
                    "Set-Cookie": "mediflow_session=session-123; Path=/; HttpOnly; SameSite=Lax",
                ]
            )!
            return (response, Data(#"{"success":true}"#.utf8))
        }

        let cookie = try await client.login(username: "doctor", password: "1992")

        XCTAssertEqual(cookie, "mediflow_session=session-123")
    }

    func testFetchPatientsUsesPairedHeadersAndAmbulatoryCookie() async throws {
        let client = makeClient { request in
            XCTAssertEqual(request.httpMethod, "GET")
            XCTAssertEqual(request.value(forHTTPHeaderField: "X-MediFlow-Source-Surface"), "native")
            XCTAssertEqual(request.value(forHTTPHeaderField: "x-mediflow-paired-client-id"), "paired-client-1")
            XCTAssertEqual(request.value(forHTTPHeaderField: "x-mediflow-paired-client-token"), "paired-token-1")
            XCTAssertEqual(
                request.value(forHTTPHeaderField: "Cookie"),
                "mediflow_session=session-123; ambulatory_id=amb-42"
            )
            XCTAssertEqual(request.url?.absoluteString, "https://localhost:3443/api/v1/network/patients")

            let response = HTTPURLResponse(
                url: try XCTUnwrap(request.url),
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            let data = """
            [
              {
                "id": "patient-1",
                "firstName": "Mario",
                "lastName": "Rossi",
                "birthDate": "1970-01-01T00:00:00Z",
                "taxCode": "RSSMRA70A01H501U",
                "isAdi": false,
                "isArchived": false,
                "version": 7,
                "updatedAt": "2026-04-18T09:30:00Z"
              }
            ]
            """.data(using: .utf8)!
            return (response, data)
        }

        let patients = try await client.fetchPatients(
            credentials: HomeBasePairedCredentials(clientId: "paired-client-1", clientToken: "paired-token-1"),
            sessionCookie: "mediflow_session=session-123",
            ambulatoryId: " amb-42 "
        )

        XCTAssertEqual(patients.count, 1)
        XCTAssertEqual(patients.first?.id, "patient-1")
        XCTAssertEqual(patients.first?.version, 7)
    }

    func testFetchPatientSurfacesHomeBaseStatusMessage() async {
        let client = makeClient { request in
            XCTAssertEqual(request.httpMethod, "GET")
            XCTAssertEqual(request.url?.absoluteString, "https://localhost:3443/api/v1/network/patients/patient-404")

            let response = HTTPURLResponse(
                url: try XCTUnwrap(request.url),
                statusCode: 403,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            return (response, Data(#"{"error":"Network scope unavailable"}"#.utf8))
        }

        do {
            _ = try await client.fetchPatient(
                id: "patient-404",
                credentials: HomeBasePairedCredentials(clientId: "paired-client-1", clientToken: "paired-token-1"),
                sessionCookie: "mediflow_session=session-123",
                ambulatoryId: nil
            )
            XCTFail("Expected home-base status error")
        } catch let error as HomeBaseClientError {
            XCTAssertEqual(error, .httpStatus(403, "Network scope unavailable"))
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    private func makeClient(
        handler: @escaping (URLRequest) throws -> (HTTPURLResponse, Data)
    ) -> HomeBasePatientsClient {
        MockHomeBaseURLProtocol.requestHandler = handler
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockHomeBaseURLProtocol.self]
        let session = URLSession(configuration: configuration)
        return HomeBasePatientsClient(
            configuration: HomeBaseConnectionConfiguration(serverURLString: "https://localhost:3443"),
            session: session
        )
    }

    private func readRequestBody(from request: URLRequest) throws -> Data {
        if let httpBody = request.httpBody {
            return httpBody
        }

        guard let stream = request.httpBodyStream else {
            throw URLError(.badURL)
        }

        stream.open()
        defer { stream.close() }

        var data = Data()
        let bufferSize = 1024
        let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: bufferSize)
        defer { buffer.deallocate() }

        while stream.hasBytesAvailable {
            let read = stream.read(buffer, maxLength: bufferSize)
            if read < 0 {
                throw stream.streamError ?? URLError(.cannotDecodeRawData)
            }
            if read == 0 {
                break
            }
            data.append(buffer, count: read)
        }

        return data
    }
}

private final class MockHomeBaseURLProtocol: URLProtocol {
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
