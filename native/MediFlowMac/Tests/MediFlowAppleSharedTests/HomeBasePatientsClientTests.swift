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

    /* @Codex */
    func testFetchEntriesUsesNetworkDiaryRouteAndDecodesVersion() async throws {
        let client = makeClient { request in
            XCTAssertEqual(request.httpMethod, "GET")
            XCTAssertEqual(request.value(forHTTPHeaderField: "x-mediflow-paired-client-id"), "paired-client-1")
            XCTAssertEqual(request.value(forHTTPHeaderField: "x-mediflow-paired-client-token"), "paired-token-1")
            XCTAssertEqual(
                request.value(forHTTPHeaderField: "Cookie"),
                "mediflow_session=session-123; ambulatory_id=amb-42"
            )
            XCTAssertEqual(
                request.url?.absoluteString,
                "https://localhost:3443/api/v1/network/patients/patient-1/entries?limit=12"
            )

            let response = HTTPURLResponse(
                url: try XCTUnwrap(request.url),
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            let data = """
            [
              {
                "id": "entry-1",
                "patientId": "patient-1",
                "type": "note",
                "title": "Controllo telefonico",
                "date": "2026-05-02T12:00:00Z",
                "content": "Rivalutazione clinica stabile.",
                "setting": null,
                "metadata": null,
                "attachments": null,
                "deletedAt": null,
                "deletionReason": null,
                "version": 4,
                "createdAt": "2026-05-02T12:00:00Z",
                "updatedAt": "2026-05-02T12:05:00Z"
              }
            ]
            """.data(using: .utf8)!
            return (response, data)
        }

        let entries = try await client.fetchEntries(
            patientId: "patient-1",
            credentials: HomeBasePairedCredentials(clientId: "paired-client-1", clientToken: "paired-token-1"),
            sessionCookie: "mediflow_session=session-123",
            ambulatoryId: "amb-42",
            limit: 12
        )

        XCTAssertEqual(entries.count, 1)
        XCTAssertEqual(entries.first?.id, "entry-1")
        XCTAssertEqual(entries.first?.version, 4)
    }

    /* @Codex */
    func testCreateEntryPostsNetworkDiaryPayload() async throws {
        let client = makeClient { request in
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
            XCTAssertEqual(request.value(forHTTPHeaderField: "X-MediFlow-Source-Surface"), "native")
            XCTAssertEqual(request.value(forHTTPHeaderField: "x-mediflow-paired-client-id"), "paired-client-1")
            XCTAssertEqual(request.url?.absoluteString, "https://localhost:3443/api/v1/network/patients/patient-1/entries")

            let body = try self.readRequestBody(from: request)
            let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
            XCTAssertEqual(payload["id"] as? String, "entry-draft-1")
            XCTAssertEqual(payload["type"] as? String, "note")
            XCTAssertEqual(payload["title"] as? String, "Telefonata caregiver")
            XCTAssertEqual(payload["content"] as? String, "Riferita stabilita clinica.")
            XCTAssertEqual(payload["date"] as? String, "2026-05-02T12:00:00Z")

            let response = HTTPURLResponse(
                url: try XCTUnwrap(request.url),
                statusCode: 201,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            return (response, Data(#"{"id":"entry-2","version":1}"#.utf8))
        }

        let result = try await client.createEntry(
            patientId: "patient-1",
            payload: HomeBaseEntryCreatePayload(
                id: "entry-draft-1",
                type: "note",
                title: "Telefonata caregiver",
                date: Date(timeIntervalSince1970: 1_777_723_200),
                content: "Riferita stabilita clinica."
            ),
            credentials: HomeBasePairedCredentials(clientId: "paired-client-1", clientToken: "paired-token-1"),
            sessionCookie: "mediflow_session=session-123",
            ambulatoryId: nil
        )

        XCTAssertEqual(result, HomeBaseCreatedResource(id: "entry-2", version: 1))
    }

    /* @Codex */
    func testUpdateEntryPutsNetworkDiaryPayload() async throws {
        let client = makeClient { request in
            XCTAssertEqual(request.httpMethod, "PUT")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
            XCTAssertEqual(request.value(forHTTPHeaderField: "X-MediFlow-Source-Surface"), "native")
            XCTAssertEqual(request.value(forHTTPHeaderField: "x-mediflow-paired-client-id"), "paired-client-1")
            XCTAssertEqual(
                request.url?.absoluteString,
                "https://localhost:3443/api/v1/network/patients/patient-1/entries/entry-1"
            )

            let body = try self.readRequestBody(from: request)
            let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
            XCTAssertEqual(payload["version"] as? Int, 4)
            XCTAssertEqual(payload["type"] as? String, "phone")
            XCTAssertEqual(payload["title"] as? String, "Telefonata aggiornata")
            XCTAssertEqual(payload["content"] as? String, "Caregiver ricontattata.")
            XCTAssertNil(payload["deletedAt"])
            XCTAssertNil(payload["deletionReason"])

            let response = HTTPURLResponse(
                url: try XCTUnwrap(request.url),
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            return (response, Data(#"{"success":true}"#.utf8))
        }

        let result = try await client.updateEntry(
            patientId: "patient-1",
            entryId: "entry-1",
            payload: HomeBaseEntryUpdatePayload(
                version: 4,
                type: "phone",
                title: "Telefonata aggiornata",
                content: "Caregiver ricontattata."
            ),
            credentials: HomeBasePairedCredentials(clientId: "paired-client-1", clientToken: "paired-token-1"),
            sessionCookie: "mediflow_session=session-123",
            ambulatoryId: nil
        )

        XCTAssertEqual(result, HomeBaseMutationAcknowledgement(success: true))
    }

    /* @Codex */
    func testSoftDeleteEntryPutsDeletedAtAndReason() async throws {
        let client = makeClient { request in
            XCTAssertEqual(request.httpMethod, "PUT")
            XCTAssertEqual(
                request.url?.absoluteString,
                "https://localhost:3443/api/v1/network/patients/patient-1/entries/entry-1"
            )

            let body = try self.readRequestBody(from: request)
            let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
            XCTAssertEqual(payload["version"] as? Int, 5)
            XCTAssertEqual(payload["deletedAt"] as? String, "2026-05-02T12:00:00Z")
            XCTAssertEqual(payload["deletionReason"] as? String, "mobile-paired-operator-cancelled")
            XCTAssertNil(payload["content"])

            let response = HTTPURLResponse(
                url: try XCTUnwrap(request.url),
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            return (response, Data(#"{"success":true}"#.utf8))
        }

        let result = try await client.updateEntry(
            patientId: "patient-1",
            entryId: "entry-1",
            payload: HomeBaseEntryUpdatePayload(
                version: 5,
                deletedAt: Date(timeIntervalSince1970: 1_777_723_200),
                deletionReason: "mobile-paired-operator-cancelled"
            ),
            credentials: HomeBasePairedCredentials(clientId: "paired-client-1", clientToken: "paired-token-1"),
            sessionCookie: "mediflow_session=session-123",
            ambulatoryId: nil
        )

        XCTAssertEqual(result, HomeBaseMutationAcknowledgement(success: true))
    }

    /* @Codex */
    func testUpdateEntrySurfacesVersionConflictPayload() async throws {
        let client = makeClient { request in
            XCTAssertEqual(request.httpMethod, "PUT")
            XCTAssertEqual(
                request.url?.absoluteString,
                "https://localhost:3443/api/v1/network/patients/patient-1/entries/entry-1"
            )

            let response = HTTPURLResponse(
                url: try XCTUnwrap(request.url),
                statusCode: 409,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            let data = """
            {
              "error": "Conflict",
              "code": "VERSION_CONFLICT",
              "entity": "entry",
              "recordId": "entry-1",
              "expectedVersion": 4,
              "currentVersion": 5,
              "currentUpdatedAt": "2026-05-02T12:10:00.000Z",
              "currentState": "present",
              "currentSnapshot": {
                "id": "entry-1",
                "patientId": "patient-1",
                "version": 5,
                "updatedAt": "2026-05-02T12:10:00.000Z",
                "deletedAt": null
              }
            }
            """.data(using: .utf8)!
            return (response, data)
        }

        do {
            _ = try await client.updateEntry(
                patientId: "patient-1",
                entryId: "entry-1",
                payload: HomeBaseEntryUpdatePayload(version: 4, content: "Stale"),
                credentials: HomeBasePairedCredentials(clientId: "paired-client-1", clientToken: "paired-token-1"),
                sessionCookie: "mediflow_session=session-123",
                ambulatoryId: nil
            )
            XCTFail("Expected version conflict")
        } catch let error as HomeBaseClientError {
            XCTAssertEqual(error, .httpStatus(409, "Conflict"))
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    /* @Codex */
    func testFetchTherapiesUsesNetworkTherapyRouteAndDecodesVersion() async throws {
        let client = makeClient { request in
            XCTAssertEqual(request.httpMethod, "GET")
            XCTAssertEqual(request.value(forHTTPHeaderField: "x-mediflow-paired-client-id"), "paired-client-1")
            XCTAssertEqual(
                request.value(forHTTPHeaderField: "Cookie"),
                "mediflow_session=session-123; ambulatory_id=amb-42"
            )
            XCTAssertEqual(
                request.url?.absoluteString,
                "https://localhost:3443/api/v1/network/patients/patient-1/therapies?limit=12"
            )

            let response = HTTPURLResponse(
                url: try XCTUnwrap(request.url),
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            let data = """
            [
              {
                "id": "therapy-1",
                "patientId": "patient-1",
                "drugName": "Metformina",
                "aic": null,
                "atc": "A10BA02",
                "activePrinciple": "metformina",
                "dosage": "500 mg x 2",
                "motivation": "diabete",
                "diagnosisCode": null,
                "diagnosisName": null,
                "status": "active",
                "startDate": "2026-05-02T00:00:00Z",
                "endDate": null,
                "version": 4,
                "createdAt": "2026-05-02T12:00:00Z",
                "updatedAt": "2026-05-02T12:05:00Z",
                "deletedAt": null,
                "deletionReason": null
              }
            ]
            """.data(using: .utf8)!
            return (response, data)
        }

        let therapies = try await client.fetchTherapies(
            patientId: "patient-1",
            credentials: HomeBasePairedCredentials(clientId: "paired-client-1", clientToken: "paired-token-1"),
            sessionCookie: "mediflow_session=session-123",
            ambulatoryId: "amb-42",
            limit: 12
        )

        XCTAssertEqual(therapies.count, 1)
        XCTAssertEqual(therapies.first?.id, "therapy-1")
        XCTAssertEqual(therapies.first?.version, 4)
        XCTAssertEqual(therapies.first?.status, "active")
    }

    /* @Codex */
    func testCreateTherapyPostsNetworkTherapyPayload() async throws {
        let client = makeClient { request in
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
            XCTAssertEqual(request.value(forHTTPHeaderField: "X-MediFlow-Source-Surface"), "native")
            XCTAssertEqual(request.url?.absoluteString, "https://localhost:3443/api/v1/network/patients/patient-1/therapies")

            let body = try self.readRequestBody(from: request)
            let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
            XCTAssertEqual(payload["drugName"] as? String, "Metformina")
            XCTAssertEqual(payload["activePrinciple"] as? String, "metformina")
            XCTAssertEqual(payload["dosage"] as? String, "500 mg x 2")
            XCTAssertEqual(payload["status"] as? String, "active")
            XCTAssertEqual(payload["startDate"] as? String, "2026-05-02T12:00:00Z")
            XCTAssertEqual(payload["motivation"] as? String, "diabete")

            let response = HTTPURLResponse(
                url: try XCTUnwrap(request.url),
                statusCode: 201,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            return (response, Data(#"{"id":"therapy-2","version":1}"#.utf8))
        }

        let result = try await client.createTherapy(
            patientId: "patient-1",
            payload: HomeBaseTherapyCreatePayload(
                drugName: "Metformina",
                activePrinciple: "metformina",
                dosage: "500 mg x 2",
                status: "active",
                startDate: Date(timeIntervalSince1970: 1_777_723_200),
                motivation: "diabete"
            ),
            credentials: HomeBasePairedCredentials(clientId: "paired-client-1", clientToken: "paired-token-1"),
            sessionCookie: "mediflow_session=session-123",
            ambulatoryId: nil
        )

        XCTAssertEqual(result, HomeBaseCreatedResource(id: "therapy-2", version: 1))
    }

    /* @Codex */
    func testUpdateTherapyPutsNetworkTherapyPayloadAndClearsEndDate() async throws {
        let client = makeClient { request in
            XCTAssertEqual(request.httpMethod, "PUT")
            XCTAssertEqual(
                request.url?.absoluteString,
                "https://localhost:3443/api/v1/network/patients/patient-1/therapies/therapy-1"
            )

            let body = try self.readRequestBody(from: request)
            let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
            XCTAssertEqual(payload["version"] as? Int, 4)
            XCTAssertEqual(payload["drugName"] as? String, "Metformina")
            XCTAssertEqual(payload["activePrinciple"] as? String, "")
            XCTAssertEqual(payload["dosage"] as? String, "850 mg x 2")
            XCTAssertEqual(payload["status"] as? String, "suspended")
            XCTAssertEqual(payload["startDate"] as? String, "2026-05-02T12:00:00Z")
            XCTAssertTrue(payload.keys.contains("endDate"))
            XCTAssertTrue(payload["endDate"] is NSNull)
            XCTAssertEqual(payload["motivation"] as? String, "")

            let response = HTTPURLResponse(
                url: try XCTUnwrap(request.url),
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            return (response, Data(#"{"success":true}"#.utf8))
        }

        let result = try await client.updateTherapy(
            patientId: "patient-1",
            therapyId: "therapy-1",
            payload: HomeBaseTherapyUpdatePayload(
                version: 4,
                drugName: "Metformina",
                activePrinciple: "",
                dosage: "850 mg x 2",
                status: "suspended",
                startDate: Date(timeIntervalSince1970: 1_777_723_200),
                shouldEncodeEndDate: true,
                motivation: ""
            ),
            credentials: HomeBasePairedCredentials(clientId: "paired-client-1", clientToken: "paired-token-1"),
            sessionCookie: "mediflow_session=session-123",
            ambulatoryId: nil
        )

        XCTAssertEqual(result, HomeBaseMutationAcknowledgement(success: true))
    }

    /* @Codex */
    func testSoftDeleteTherapyPutsDeletedAtAndReason() async throws {
        let client = makeClient { request in
            XCTAssertEqual(request.httpMethod, "PUT")
            XCTAssertEqual(
                request.url?.absoluteString,
                "https://localhost:3443/api/v1/network/patients/patient-1/therapies/therapy-1"
            )

            let body = try self.readRequestBody(from: request)
            let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
            XCTAssertEqual(payload["version"] as? Int, 5)
            XCTAssertEqual(payload["deletedAt"] as? String, "2026-05-02T12:00:00Z")
            XCTAssertEqual(payload["deletionReason"] as? String, "mobile-paired-operator-cancelled")
            XCTAssertNil(payload["dosage"])

            let response = HTTPURLResponse(
                url: try XCTUnwrap(request.url),
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            return (response, Data(#"{"success":true}"#.utf8))
        }

        let result = try await client.updateTherapy(
            patientId: "patient-1",
            therapyId: "therapy-1",
            payload: HomeBaseTherapyUpdatePayload(
                version: 5,
                deletedAt: Date(timeIntervalSince1970: 1_777_723_200),
                deletionReason: "mobile-paired-operator-cancelled"
            ),
            credentials: HomeBasePairedCredentials(clientId: "paired-client-1", clientToken: "paired-token-1"),
            sessionCookie: "mediflow_session=session-123",
            ambulatoryId: nil
        )

        XCTAssertEqual(result, HomeBaseMutationAcknowledgement(success: true))
    }

    /* @Codex */
    func testUpdateTherapySurfacesVersionConflictPayload() async throws {
        let client = makeClient { request in
            XCTAssertEqual(request.httpMethod, "PUT")
            XCTAssertEqual(
                request.url?.absoluteString,
                "https://localhost:3443/api/v1/network/patients/patient-1/therapies/therapy-1"
            )

            let response = HTTPURLResponse(
                url: try XCTUnwrap(request.url),
                statusCode: 409,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            let data = """
            {
              "error": "Conflict",
              "code": "VERSION_CONFLICT",
              "entity": "therapy",
              "recordId": "therapy-1",
              "expectedVersion": 4,
              "currentVersion": 5,
              "currentUpdatedAt": "2026-05-02T12:10:00.000Z",
              "currentState": "present",
              "currentSnapshot": {
                "id": "therapy-1",
                "patientId": "patient-1",
                "version": 5,
                "updatedAt": "2026-05-02T12:10:00.000Z",
                "deletedAt": null
              }
            }
            """.data(using: .utf8)!
            return (response, data)
        }

        do {
            _ = try await client.updateTherapy(
                patientId: "patient-1",
                therapyId: "therapy-1",
                payload: HomeBaseTherapyUpdatePayload(version: 4, dosage: "stale"),
                credentials: HomeBasePairedCredentials(clientId: "paired-client-1", clientToken: "paired-token-1"),
                sessionCookie: "mediflow_session=session-123",
                ambulatoryId: nil
            )
            XCTFail("Expected version conflict")
        } catch let error as HomeBaseClientError {
            XCTAssertEqual(error, .httpStatus(409, "Conflict"))
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
