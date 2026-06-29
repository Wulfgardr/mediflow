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
            guard case .versionConflict(let conflict) = error else {
                return XCTFail("Expected versionConflict, got \(error)")
            }
            XCTAssertEqual(conflict.code, "VERSION_CONFLICT")
            XCTAssertFalse(conflict.entity.isEmpty)
            XCTAssertNotNil(conflict.currentSnapshot)
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
            guard case .versionConflict(let conflict) = error else {
                return XCTFail("Expected versionConflict, got \(error)")
            }
            XCTAssertEqual(conflict.code, "VERSION_CONFLICT")
            XCTAssertFalse(conflict.entity.isEmpty)
            XCTAssertNotNil(conflict.currentSnapshot)
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    /* @Codex */
    func testFetchCheckupsUsesNetworkCheckupRouteAndDecodesVersion() async throws {
        let client = makeClient { request in
            XCTAssertEqual(request.httpMethod, "GET")
            XCTAssertEqual(
                request.url?.absoluteString,
                "https://localhost:3443/api/v1/network/patients/patient-1/checkups?limit=12"
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
                "id": "checkup-1",
                "patientId": "patient-1",
                "date": "2026-05-02T12:00:00Z",
                "title": "Controllo domiciliare",
                "notes": "Pressione stabile",
                "status": "pending",
                "source": "manual",
                "version": 3,
                "createdAt": "2026-05-02T11:00:00Z",
                "updatedAt": "2026-05-02T12:00:00Z",
                "deletedAt": null,
                "deletionReason": null
              }
            ]
            """.data(using: .utf8)!
            return (response, data)
        }

        let checkups = try await client.fetchCheckups(
            patientId: "patient-1",
            credentials: HomeBasePairedCredentials(clientId: "paired-client-1", clientToken: "paired-token-1"),
            sessionCookie: "mediflow_session=session-123",
            ambulatoryId: nil,
            limit: 12
        )

        XCTAssertEqual(checkups.first?.id, "checkup-1")
        XCTAssertEqual(checkups.first?.version, 3)
        XCTAssertEqual(checkups.first?.status, "pending")
    }

    /* @Codex */
    func testCreateAndUpdateCheckupUseNetworkPayloads() async throws {
        var seenMethods: [String] = []
        let client = makeClient { request in
            seenMethods.append(request.httpMethod ?? "")
            let body = try self.readRequestBody(from: request)
            let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])

            if request.httpMethod == "POST" {
                XCTAssertEqual(request.url?.absoluteString, "https://localhost:3443/api/v1/network/patients/patient-1/checkups")
                XCTAssertEqual(payload["title"] as? String, "Controllo domiciliare")
                XCTAssertEqual(payload["status"] as? String, "pending")
                XCTAssertEqual(payload["date"] as? String, "2026-05-02T12:00:00Z")
                XCTAssertEqual(payload["notes"] as? String, "nota")
                XCTAssertEqual(payload["source"] as? String, "manual")
                let response = HTTPURLResponse(url: try XCTUnwrap(request.url), statusCode: 201, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
                return (response, Data(#"{"id":"checkup-2","version":1}"#.utf8))
            }

            XCTAssertEqual(request.httpMethod, "PUT")
            XCTAssertEqual(request.url?.absoluteString, "https://localhost:3443/api/v1/network/patients/patient-1/checkups/checkup-2")
            XCTAssertEqual(payload["version"] as? Int, 1)
            XCTAssertEqual(payload["status"] as? String, "completed")
            XCTAssertEqual(payload["notes"] as? String, "")
            let response = HTTPURLResponse(url: try XCTUnwrap(request.url), statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
            return (response, Data(#"{"success":true}"#.utf8))
        }

        let created = try await client.createCheckup(
            patientId: "patient-1",
            payload: HomeBaseCheckupCreatePayload(
                date: Date(timeIntervalSince1970: 1_777_723_200),
                title: "Controllo domiciliare",
                status: "pending",
                notes: "nota"
            ),
            credentials: HomeBasePairedCredentials(clientId: "paired-client-1", clientToken: "paired-token-1"),
            sessionCookie: "mediflow_session=session-123",
            ambulatoryId: nil
        )
        let updated = try await client.updateCheckup(
            patientId: "patient-1",
            checkupId: "checkup-2",
            payload: HomeBaseCheckupUpdatePayload(version: 1, status: "completed", notes: ""),
            credentials: HomeBasePairedCredentials(clientId: "paired-client-1", clientToken: "paired-token-1"),
            sessionCookie: "mediflow_session=session-123",
            ambulatoryId: nil
        )

        XCTAssertEqual(created, HomeBaseCreatedResource(id: "checkup-2", version: 1))
        XCTAssertEqual(updated, HomeBaseMutationAcknowledgement(success: true))
        XCTAssertEqual(seenMethods, ["POST", "PUT"])
    }

    /* @Codex */
    func testSoftDeleteCheckupPutsDeletedAtAndReason() async throws {
        let client = makeClient { request in
            XCTAssertEqual(request.httpMethod, "PUT")
            XCTAssertEqual(request.url?.absoluteString, "https://localhost:3443/api/v1/network/patients/patient-1/checkups/checkup-1")

            let body = try self.readRequestBody(from: request)
            let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
            XCTAssertEqual(payload["version"] as? Int, 4)
            XCTAssertEqual(payload["deletedAt"] as? String, "2026-05-02T12:00:00Z")
            XCTAssertEqual(payload["deletionReason"] as? String, "mobile-paired-operator-cancelled")
            XCTAssertNil(payload["title"])
            XCTAssertNil(payload["status"])
            XCTAssertNil(payload["date"])
            XCTAssertNil(payload["notes"])

            let response = HTTPURLResponse(url: try XCTUnwrap(request.url), statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
            return (response, Data(#"{"success":true}"#.utf8))
        }

        let result = try await client.updateCheckup(
            patientId: "patient-1",
            checkupId: "checkup-1",
            payload: HomeBaseCheckupUpdatePayload(
                version: 4,
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
    func testUpdateCheckupSurfacesVersionConflictPayload() async throws {
        let client = makeClient { request in
            XCTAssertEqual(request.httpMethod, "PUT")
            XCTAssertEqual(request.url?.absoluteString, "https://localhost:3443/api/v1/network/patients/patient-1/checkups/checkup-1")

            let response = HTTPURLResponse(url: try XCTUnwrap(request.url), statusCode: 409, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
            let data = """
            {
              "error": "Conflict",
              "code": "VERSION_CONFLICT",
              "entity": "checkup",
              "recordId": "checkup-1",
              "expectedVersion": 4,
              "currentVersion": 5,
              "currentUpdatedAt": "2026-05-02T12:10:00.000Z",
              "currentState": "present",
              "currentSnapshot": {
                "id": "checkup-1",
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
            _ = try await client.updateCheckup(
                patientId: "patient-1",
                checkupId: "checkup-1",
                payload: HomeBaseCheckupUpdatePayload(version: 4, title: "stale"),
                credentials: HomeBasePairedCredentials(clientId: "paired-client-1", clientToken: "paired-token-1"),
                sessionCookie: "mediflow_session=session-123",
                ambulatoryId: nil
            )
            XCTFail("Expected version conflict")
        } catch let error as HomeBaseClientError {
            guard case .versionConflict(let conflict) = error else {
                return XCTFail("Expected versionConflict, got \(error)")
            }
            XCTAssertEqual(conflict.code, "VERSION_CONFLICT")
            XCTAssertFalse(conflict.entity.isEmpty)
            XCTAssertNotNil(conflict.currentSnapshot)
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    /* @Codex */
    func testFetchObservationsUsesNetworkObservationRouteAndDecodesVersion() async throws {
        let client = makeClient { request in
            XCTAssertEqual(request.httpMethod, "GET")
            XCTAssertEqual(
                request.url?.absoluteString,
                "https://localhost:3443/api/v1/network/patients/patient-1/observations?limit=12"
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
                "id": "observation-1",
                "patientId": "patient-1",
                "codeSystem": "LOINC",
                "code": "8480-6",
                "display": "Pressione sistolica",
                "unitSystem": "UCUM",
                "unitCode": "mm[Hg]",
                "value": "128",
                "notes": "seduto",
                "observedAt": "2026-05-02T12:00:00Z",
                "source": "manual",
                "version": 3,
                "createdAt": "2026-05-02T11:00:00Z",
                "updatedAt": "2026-05-02T12:00:00Z",
                "deletedAt": null,
                "deletionReason": null
              }
            ]
            """.data(using: .utf8)!
            return (response, data)
        }

        let observations = try await client.fetchObservations(
            patientId: "patient-1",
            credentials: HomeBasePairedCredentials(clientId: "paired-client-1", clientToken: "paired-token-1"),
            sessionCookie: "mediflow_session=session-123",
            ambulatoryId: nil,
            limit: 12
        )

        XCTAssertEqual(observations.first?.id, "observation-1")
        XCTAssertEqual(observations.first?.version, 3)
        XCTAssertEqual(observations.first?.unitCode, "mm[Hg]")
    }

    /* @Codex */
    func testCreateAndUpdateObservationUseNetworkPayloads() async throws {
        var seenMethods: [String] = []
        let client = makeClient { request in
            seenMethods.append(request.httpMethod ?? "")
            let body = try self.readRequestBody(from: request)
            let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])

            if request.httpMethod == "POST" {
                XCTAssertEqual(request.url?.absoluteString, "https://localhost:3443/api/v1/network/patients/patient-1/observations")
                XCTAssertEqual(payload["codeSystem"] as? String, "LOINC")
                XCTAssertEqual(payload["code"] as? String, "8480-6")
                XCTAssertEqual(payload["display"] as? String, "Pressione sistolica")
                XCTAssertEqual(payload["unitSystem"] as? String, "UCUM")
                XCTAssertEqual(payload["unitCode"] as? String, "mm[Hg]")
                XCTAssertEqual(payload["value"] as? String, "128")
                XCTAssertEqual(payload["source"] as? String, "manual")
                let response = HTTPURLResponse(url: try XCTUnwrap(request.url), statusCode: 201, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
                return (response, Data(#"{"id":"observation-2","version":1}"#.utf8))
            }

            XCTAssertEqual(request.httpMethod, "PUT")
            XCTAssertEqual(request.url?.absoluteString, "https://localhost:3443/api/v1/network/patients/patient-1/observations/observation-2")
            XCTAssertEqual(payload["version"] as? Int, 1)
            XCTAssertEqual(payload["value"] as? String, "132")
            XCTAssertEqual(payload["notes"] as? String, "")
            let response = HTTPURLResponse(url: try XCTUnwrap(request.url), statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
            return (response, Data(#"{"success":true}"#.utf8))
        }

        let created = try await client.createObservation(
            patientId: "patient-1",
            payload: HomeBaseObservationCreatePayload(
                code: "8480-6",
                display: "Pressione sistolica",
                unitCode: "mm[Hg]",
                value: "128",
                observedAt: Date(timeIntervalSince1970: 1_777_723_200),
                notes: "seduto"
            ),
            credentials: HomeBasePairedCredentials(clientId: "paired-client-1", clientToken: "paired-token-1"),
            sessionCookie: "mediflow_session=session-123",
            ambulatoryId: nil
        )
        let updated = try await client.updateObservation(
            patientId: "patient-1",
            observationId: "observation-2",
            payload: HomeBaseObservationUpdatePayload(version: 1, value: "132", notes: ""),
            credentials: HomeBasePairedCredentials(clientId: "paired-client-1", clientToken: "paired-token-1"),
            sessionCookie: "mediflow_session=session-123",
            ambulatoryId: nil
        )

        XCTAssertEqual(created, HomeBaseCreatedResource(id: "observation-2", version: 1))
        XCTAssertEqual(updated, HomeBaseMutationAcknowledgement(success: true))
        XCTAssertEqual(seenMethods, ["POST", "PUT"])
    }

    /* @Codex */
    func testUpdateObservationSurfacesVersionConflictPayload() async throws {
        let client = makeClient { request in
            XCTAssertEqual(request.httpMethod, "PUT")
            XCTAssertEqual(request.url?.absoluteString, "https://localhost:3443/api/v1/network/patients/patient-1/observations/observation-1")

            let response = HTTPURLResponse(url: try XCTUnwrap(request.url), statusCode: 409, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
            let data = """
            {
              "error": "Conflict",
              "code": "VERSION_CONFLICT",
              "entity": "observation",
              "recordId": "observation-1",
              "expectedVersion": 4,
              "currentVersion": 5,
              "currentUpdatedAt": "2026-05-02T12:10:00.000Z",
              "currentState": "present",
              "currentSnapshot": {
                "id": "observation-1",
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
            _ = try await client.updateObservation(
                patientId: "patient-1",
                observationId: "observation-1",
                payload: HomeBaseObservationUpdatePayload(version: 4, value: "stale"),
                credentials: HomeBasePairedCredentials(clientId: "paired-client-1", clientToken: "paired-token-1"),
                sessionCookie: "mediflow_session=session-123",
                ambulatoryId: nil
            )
            XCTFail("Expected version conflict")
        } catch let error as HomeBaseClientError {
            guard case .versionConflict(let conflict) = error else {
                return XCTFail("Expected versionConflict, got \(error)")
            }
            XCTAssertEqual(conflict.code, "VERSION_CONFLICT")
            XCTAssertFalse(conflict.entity.isEmpty)
            XCTAssertNotNil(conflict.currentSnapshot)
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    /* @Codex */
    func testSoftDeleteObservationPutsDeletedAtAndReason() async throws {
        let client = makeClient { request in
            XCTAssertEqual(request.httpMethod, "PUT")
            XCTAssertEqual(request.url?.absoluteString, "https://localhost:3443/api/v1/network/patients/patient-1/observations/observation-1")

            let body = try self.readRequestBody(from: request)
            let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
            XCTAssertEqual(payload["version"] as? Int, 4)
            XCTAssertEqual(payload["deletedAt"] as? String, "2026-05-02T12:00:00Z")
            XCTAssertEqual(payload["deletionReason"] as? String, "mobile-paired-operator-cancelled")
            XCTAssertNil(payload["code"])
            XCTAssertNil(payload["display"])
            XCTAssertNil(payload["unitCode"])
            XCTAssertNil(payload["value"])
            XCTAssertNil(payload["observedAt"])
            XCTAssertNil(payload["notes"])

            let response = HTTPURLResponse(url: try XCTUnwrap(request.url), statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
            return (response, Data(#"{"success":true}"#.utf8))
        }

        let result = try await client.updateObservation(
            patientId: "patient-1",
            observationId: "observation-1",
            payload: HomeBaseObservationUpdatePayload(
                version: 4,
                deletedAt: Date(timeIntervalSince1970: 1_777_723_200),
                deletionReason: "mobile-paired-operator-cancelled"
            ),
            credentials: HomeBasePairedCredentials(clientId: "paired-client-1", clientToken: "paired-token-1"),
            sessionCookie: "mediflow_session=session-123",
            ambulatoryId: nil
        )

        XCTAssertEqual(result, HomeBaseMutationAcknowledgement(success: true))
    }

    func testVersionConflictExposesStructuredFieldsAndMessage() async throws {
        let client = makeClient { request in
            let response = HTTPURLResponse(
                url: try XCTUnwrap(request.url), statusCode: 409, httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            let data = """
            {
              "error": "Conflict", "code": "VERSION_CONFLICT", "entity": "entry",
              "recordId": "entry-1", "expectedVersion": 4, "currentVersion": 5,
              "currentUpdatedAt": "2026-05-02T12:10:00.000Z", "currentState": "present",
              "currentSnapshot": { "id": "entry-1", "patientId": "patient-1", "version": 5,
                "updatedAt": "2026-05-02T12:10:00.000Z", "deletedAt": null }
            }
            """.data(using: .utf8)!
            return (response, data)
        }

        do {
            _ = try await client.updateEntry(
                patientId: "patient-1", entryId: "entry-1",
                payload: HomeBaseEntryUpdatePayload(version: 4, content: "Stale"),
                credentials: HomeBasePairedCredentials(clientId: "paired-client-1", clientToken: "paired-token-1"),
                sessionCookie: "mediflow_session=session-123", ambulatoryId: nil
            )
            XCTFail("Expected version conflict")
        } catch HomeBaseClientError.versionConflict(let conflict) {
            XCTAssertEqual(conflict.entity, "entry")
            XCTAssertEqual(conflict.recordId, "entry-1")
            XCTAssertEqual(conflict.expectedVersion, 4)
            XCTAssertEqual(conflict.currentVersion, 5)
            XCTAssertEqual(conflict.currentState, "present")
            XCTAssertEqual(conflict.currentSnapshot?.version, 5)
            XCTAssertEqual(conflict.currentSnapshot?.patientId, "patient-1")
            // The user-facing message names the expected version.
            XCTAssertTrue(HomeBaseClientError.versionConflict(conflict).localizedDescription.contains("4"))
        }
    }

    func testGeneric409WithoutVersionConflictFallsBackToHttpStatus() async throws {
        let client = makeClient { request in
            let response = HTTPURLResponse(
                url: try XCTUnwrap(request.url), statusCode: 409, httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            let data = #"{"error":"Locked","message":"Risorsa bloccata da un altro processo"}"#.data(using: .utf8)!
            return (response, data)
        }

        do {
            _ = try await client.updateEntry(
                patientId: "patient-1", entryId: "entry-1",
                payload: HomeBaseEntryUpdatePayload(version: 1, content: "x"),
                credentials: HomeBasePairedCredentials(clientId: "paired-client-1", clientToken: "paired-token-1"),
                sessionCookie: "mediflow_session=session-123", ambulatoryId: nil
            )
            XCTFail("Expected error")
        } catch let error as HomeBaseClientError {
            XCTAssertEqual(error, .httpStatus(409, "Risorsa bloccata da un altro processo"))
        }
    }

    func testUpdatePatientPutsNetworkPatientPayloadWithPatchSemantics() async throws {
        let client = makeClient { request in
            XCTAssertEqual(request.httpMethod, "PUT")
            XCTAssertEqual(
                request.url?.absoluteString,
                "https://localhost:3443/api/v1/network/patients/patient-1"
            )
            let body = try self.readRequestBody(from: request)
            let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
            XCTAssertEqual(payload["version"] as? Int, 5)
            XCTAssertEqual(payload["firstName"] as? String, "Mario")
            XCTAssertNil(payload["lastName"], "an omit-only optional left nil must be absent")
            XCTAssertEqual(payload["phone"] as? String, "06 1234")
            XCTAssertTrue(payload.keys.contains("address"), "PatchValue .null must emit an explicit null")
            XCTAssertTrue(payload["address"] is NSNull)
            XCTAssertNil(payload["caregiver"], "PatchValue .omit must be absent")
            XCTAssertEqual(payload["isArchived"] as? Bool, true, "a set isArchived flag must be sent")
            XCTAssertNil(payload["isAdi"], "an unset bool flag must be absent (encodeIfPresent)")

            let response = HTTPURLResponse(
                url: try XCTUnwrap(request.url), statusCode: 200, httpVersion: nil, headerFields: nil
            )!
            return (response, Data(#"{"success":true}"#.utf8))
        }

        let ack = try await client.updatePatient(
            patientId: "patient-1",
            payload: HomeBasePatientUpdatePayload(
                version: 5, firstName: "Mario", isArchived: true, address: .null, phone: .value("06 1234")
            ),
            credentials: HomeBasePairedCredentials(clientId: "paired-client-1", clientToken: "paired-token-1"),
            sessionCookie: "mediflow_session=session-123",
            ambulatoryId: nil
        )
        XCTAssertTrue(ack.success)
    }

    func testFetchNetworkAmbulatoriesDecodesScopeOptions() async throws {
        let client = makeClient { request in
            XCTAssertEqual(request.httpMethod, "GET")
            XCTAssertEqual(
                request.url?.absoluteString,
                "https://localhost:3443/api/v1/network/ambulatories"
            )
            let response = HTTPURLResponse(
                url: try XCTUnwrap(request.url), statusCode: 200, httpVersion: nil, headerFields: nil
            )!
            let body = """
            [{"id":"AMB-1","name":"Centrale","address":"Via Roma 1","type":"principale",\
            "isDefault":true,"createdAt":"2026-06-01T00:00:00.000Z"},\
            {"id":"AMB-2","name":"Nord","address":null,"type":null,"isDefault":false,"createdAt":null}]
            """
            return (response, Data(body.utf8))
        }

        let result = try await client.fetchNetworkAmbulatories(
            credentials: HomeBasePairedCredentials(clientId: "c1", clientToken: "t1"),
            sessionCookie: "mediflow_session=s1",
            ambulatoryId: nil
        )
        XCTAssertEqual(result.count, 2)
        XCTAssertEqual(result[0].id, "AMB-1")
        XCTAssertEqual(result[0].name, "Centrale")
        XCTAssertEqual(result[0].isDefault, true)
        XCTAssertNil(result[1].address, "a null address must decode as nil")
        XCTAssertNil(result[1].createdAt)
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
