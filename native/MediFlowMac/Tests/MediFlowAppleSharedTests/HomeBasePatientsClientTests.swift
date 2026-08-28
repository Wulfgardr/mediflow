// Codex: created 2026-04-18
// @Codex
import Foundation
import CryptoKit
import XCTest
@testable import MediFlowAppleShared

final class HomeBasePatientsClientTests: XCTestCase {
    override func tearDown() {
        MockHomeBaseURLProtocol.requestHandler = nil
        super.tearDown()
    }

    func testCreateAttachmentSendsOnlySealedPairedProjection() async throws {
        let masterKey = SymmetricKey(data: Data(repeating: 5, count: 32))
        let rawData = Data("PDF".utf8).base64EncodedString()
        let payload = try ClinicalFieldCrypto.sealAttachmentCreatePayload(
            name: "referto.pdf",
            path: "uploads/referto.pdf",
            data: rawData,
            type: "application/pdf",
            size: 3,
            masterKey: masterKey
        )
        let client = makeClient { request in
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.url?.path, "/api/v1/network/patients/patient-1/attachments")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
            XCTAssertEqual(request.value(forHTTPHeaderField: "X-MediFlow-Source-Surface"), "native")
            XCTAssertEqual(request.value(forHTTPHeaderField: "x-mediflow-paired-client-id"), "paired-client-1")
            XCTAssertEqual(request.value(forHTTPHeaderField: "x-mediflow-paired-client-token"), "paired-token-1")
            XCTAssertEqual(
                request.value(forHTTPHeaderField: "Cookie"),
                "mediflow_session=session-123; ambulatory_id=amb-1"
            )

            let object = try self.requestObject(request)
            XCTAssertEqual(Set(object.keys), Set(["name", "path", "data", "type", "size"]))
            for field in ["name", "path", "data"] {
                let value = try XCTUnwrap(object[field] as? String)
                XCTAssertTrue(value.hasPrefix(CryptoService.encPrefix), "field \(field)")
            }
            for field in [
                "id", "patientId", "summarySnapshot", "parseEvidenceArtifactSnapshot",
                "ocrQueueState", "ocrQueueReason", "createdAt", "updatedAt",
            ] {
                XCTAssertFalse(object.keys.contains(field), "field \(field)")
            }
            XCTAssertEqual(object["type"] as? String, "application/pdf")
            XCTAssertEqual(object["size"] as? Int, 3)

            let response = HTTPURLResponse(
                url: try XCTUnwrap(request.url),
                statusCode: 201,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            return (response, Data(#"{"id":"attachment-1"}"#.utf8))
        }

        let created = try await client.createAttachment(
            patientId: "patient-1",
            payload: payload,
            credentials: creds,
            sessionCookie: cookie,
            ambulatoryId: "amb-1"
        )

        XCTAssertEqual(created, HomeBaseCreatedResource(id: "attachment-1", version: nil))
    }

    /* @Codex */
    func testLoginUsesPairedNativeRouteWithoutSourceSurfaceAuthority() async throws {
        let client = makeClient { request in
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
            XCTAssertNil(request.value(forHTTPHeaderField: "X-MediFlow-Source-Surface"))
            XCTAssertEqual(request.url?.absoluteString, "https://localhost:3443/api/auth/native/login")
            XCTAssertEqual(request.value(forHTTPHeaderField: "x-mediflow-paired-client-id"), "paired-client-1")
            XCTAssertEqual(request.value(forHTTPHeaderField: "x-mediflow-paired-client-token"), "paired-token-1")

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
            return (response, Data(#"{"success":true,"id":"user-1","username":"doctor","displayName":"Dott.ssa Ada","ambulatoryName":"Centro Salute","role":"admin","encryptedMasterKey":"d3JhcHBlZE1L","salt":"c2FsdA=="}"#.utf8))
        }

        let result = try await client.login(username: "doctor", password: "1992", credentials: creds)

        XCTAssertEqual(result.sessionCookie, "mediflow_session=session-123")
        XCTAssertEqual(result.encryptedMasterKey, "d3JhcHBlZE1L", "login must surface the wrapped master key")
        XCTAssertEqual(result.salt, "c2FsdA==", "login must surface the PBKDF2 salt for the field crypto")
        XCTAssertEqual(result.id, "user-1")
        XCTAssertEqual(result.username, "doctor")
        XCTAssertEqual(result.displayName, "Dott.ssa Ada")
        XCTAssertEqual(result.ambulatoryName, "Centro Salute")
        XCTAssertEqual(result.role, "admin")
    }

    /* @Codex */
    func testLoginRejectsMissingPairedCredentialsBeforeNetwork() async {
        let client = makeClient { _ in
            XCTFail("missing paired credentials must not create a request")
            throw URLError(.badServerResponse)
        }

        do {
            _ = try await client.login(
                username: "doctor",
                password: "1992",
                credentials: HomeBasePairedCredentials(clientId: "", clientToken: "")
            )
            XCTFail("missing paired credentials must fail")
        } catch {
            XCTAssertEqual(error as? HomeBaseClientError, .contract)
        }
    }

    /* @Codex */
    func testLogoutAcceptsExactEmpty204AcknowledgementWithoutRetry() async throws {
        var requestCount = 0
        let client = makeClient { request in
            requestCount += 1
            self.assertLogoutRequest(request)
            let response = HTTPURLResponse(
                url: try XCTUnwrap(request.url), statusCode: 204, httpVersion: nil, headerFields: nil
            )!
            return (response, Data())
        }

        let acknowledgement = try await client.logout(credentials: creds, sessionCookie: cookie)

        XCTAssertEqual(acknowledgement, HomeBaseMutationAcknowledgement(success: true))
        XCTAssertEqual(requestCount, 1)
    }

    /* @Codex */
    func testLogoutRejectsNonempty204BodyAsContractWithoutRetry() async {
        var requestCount = 0
        let client = makeClient { request in
            requestCount += 1
            self.assertLogoutRequest(request)
            let response = HTTPURLResponse(
                url: try XCTUnwrap(request.url), statusCode: 204, httpVersion: nil, headerFields: nil
            )!
            return (response, Data("unexpected".utf8))
        }

        do {
            _ = try await client.logout(credentials: creds, sessionCookie: cookie)
            XCTFail("A nonempty 204 body must fail the acknowledgement contract")
        } catch let error as HomeBaseClientError {
            XCTAssertEqual(error, .contract)
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
        XCTAssertEqual(requestCount, 1)
    }

    /* @Codex */
    func testLogoutKeepsJson2xxAcknowledgementCompatibility() async throws {
        var requestCount = 0
        let client = makeClient { request in
            requestCount += 1
            self.assertLogoutRequest(request)
            let response = HTTPURLResponse(
                url: try XCTUnwrap(request.url), statusCode: 200, httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            return (response, Data(#"{"success":true}"#.utf8))
        }

        let acknowledgement = try await client.logout(credentials: creds, sessionCookie: cookie)

        XCTAssertEqual(acknowledgement, HomeBaseMutationAcknowledgement(success: true))
        XCTAssertEqual(requestCount, 1)
    }

    /* @Codex */
    func testLogoutRejectsEmpty200AcknowledgementAsContractWithoutRetry() async {
        var requestCount = 0
        let client = makeClient { request in
            requestCount += 1
            self.assertLogoutRequest(request)
            let response = HTTPURLResponse(
                url: try XCTUnwrap(request.url), statusCode: 200, httpVersion: nil, headerFields: nil
            )!
            return (response, Data())
        }

        do {
            _ = try await client.logout(credentials: creds, sessionCookie: cookie)
            XCTFail("An empty 200 body must fail the acknowledgement contract")
        } catch let error as HomeBaseClientError {
            XCTAssertEqual(error, .contract)
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
        XCTAssertEqual(requestCount, 1)
    }

    /* @Codex */
    func testLogoutPreservesNon2xxTypedFailuresWithoutRetry() async {
        for (statusCode, message) in [(401, "Sessione non valida"), (409, "Logout in conflitto")] {
            var requestCount = 0
            let client = makeClient { request in
                requestCount += 1
                self.assertLogoutRequest(request)
                let response = HTTPURLResponse(
                    url: try XCTUnwrap(request.url), statusCode: statusCode, httpVersion: nil,
                    headerFields: ["Content-Type": "application/json"]
                )!
                return (response, Data("{\"error\":\"\(message)\"}".utf8))
            }

            do {
                _ = try await client.logout(credentials: creds, sessionCookie: cookie)
                XCTFail("Expected HTTP \(statusCode) failure")
            } catch let error as HomeBaseClientError {
                XCTAssertEqual(error, .httpStatus(statusCode, message))
            } catch {
                XCTFail("Unexpected error: \(error)")
            }
            XCTAssertEqual(requestCount, 1)
        }
    }

    /* @Codex */
    func testLocalDataSourceForwardsPairedLoginCredentialsUnchanged() async throws {
        let client = makeClient { request in
            XCTAssertEqual(request.url?.path, "/api/auth/native/login")
            XCTAssertEqual(request.value(forHTTPHeaderField: "x-mediflow-paired-client-id"), "paired-client-1")
            XCTAssertEqual(request.value(forHTTPHeaderField: "x-mediflow-paired-client-token"), "paired-token-1")
            let response = HTTPURLResponse(
                url: try XCTUnwrap(request.url), statusCode: 200, httpVersion: nil,
                headerFields: ["Set-Cookie": "mediflow_session=session-123; Path=/; HttpOnly"]
            )!
            return (response, Data(#"{"success":true}"#.utf8))
        }
        let source = LocalPatientsDataSource(
            databasePath: "/tmp/mediflow-unused-login-forwarding.db",
            masterKey: SymmetricKey(data: Data(repeating: 1, count: 32)),
            fallback: client
        )

        let result = try await source.login(username: "doctor", password: "1992", credentials: creds)

        XCTAssertEqual(result.sessionCookie, "mediflow_session=session-123")
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

    func testFetchNetworkAmbulatoriesDecodesVersionedContractFields() async throws {
        let client = makeClient { request in
            XCTAssertEqual(request.url?.path, "/api/v1/network/ambulatories")
            let response = HTTPURLResponse(
                url: try XCTUnwrap(request.url), statusCode: 200, httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            return (response, Data(#"[{"id":"amb-1","name":"Centro","address":"Via Roma 1","parentId":"amb-parent","type":"live","description":"Sede principale","isDefault":true,"version":7,"createdAt":"2026-07-10T08:00:00.000Z"}]"#.utf8))
        }

        let ambulatories = try await client.fetchNetworkAmbulatories(
            credentials: creds, sessionCookie: cookie, ambulatoryId: nil)

        XCTAssertEqual(ambulatories.first?.parentId, "amb-parent")
        XCTAssertEqual(ambulatories.first?.description, "Sede principale")
        XCTAssertEqual(ambulatories.first?.version, 7)
    }

    /* @Codex */
    func testFetchPatientsIncludeDeletedAddsQueryAndDecodesTombstoneFields() async throws {
        let client = makeClient { request in
            XCTAssertEqual(request.httpMethod, "GET")
            XCTAssertEqual(
                request.url?.absoluteString,
                "https://localhost:3443/api/v1/network/patients?includeDeleted=true"
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
                "id": "patient-deleted-1",
                "firstName": "Mario",
                "lastName": "Rossi",
                "birthDate": null,
                "taxCode": "RSSMRA70A01H501U",
                "isAdi": false,
                "isArchived": false,
                "version": 8,
                "updatedAt": "2026-07-08T09:31:00.000Z",
                "deletedAt": "2026-07-08T09:30:00.000Z",
                "deletionReason": "ENC:iv:cipher"
              }
            ]
            """.data(using: .utf8)!
            return (response, data)
        }

        let patients = try await client.fetchPatients(
            credentials: HomeBasePairedCredentials(clientId: "paired-client-1", clientToken: "paired-token-1"),
            sessionCookie: "mediflow_session=session-123",
            ambulatoryId: nil,
            includeDeleted: true
        )

        XCTAssertEqual(patients.first?.id, "patient-deleted-1")
        XCTAssertEqual(patients.first?.version, 8)
        XCTAssertNotNil(patients.first?.deletedAt)
        XCTAssertEqual(patients.first?.deletionReason, "ENC:iv:cipher")
    }

    /* @Codex */
    func testFetchPatientsIncludeDiagnosesPreservesCiphertextAndOptInDefault() async throws {
        var requests = 0
        let client = makeClient { request in
            requests += 1
            XCTAssertEqual(request.httpMethod, "GET")
            let url = try XCTUnwrap(request.url)
            let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil)!
            if requests == 1 {
                XCTAssertEqual(url.absoluteString, "https://localhost:3443/api/v1/network/patients?include=diagnoses")
                return (response, Data(#"[{"id":"patient-1","firstName":"Anna","lastName":"Rossi","birthDate":"1970-01-01T00:00:00.000Z","taxCode":"RSSANN70A41F205X","isAdi":false,"isArchived":false,"version":2,"updatedAt":"2026-07-09T08:30:00Z","diagnoses":"ENC:iv:ciphertext"}]"#.utf8))
            }
            XCTAssertEqual(url.absoluteString, "https://localhost:3443/api/v1/network/patients")
            return (response, Data(#"[{"id":"patient-1","firstName":"Anna","lastName":"Rossi","birthDate":"1970-01-01T00:00:00.000Z","taxCode":"RSSANN70A41F205X","isAdi":false,"isArchived":false,"version":2,"updatedAt":"2026-07-09T08:30:00Z"}]"#.utf8))
        }

        let withDiagnoses = try await client.fetchPatients(
            credentials: creds, sessionCookie: cookie, ambulatoryId: nil, includeDiagnoses: true)
        let withoutDiagnoses = try await client.fetchPatients(
            credentials: creds, sessionCookie: cookie, ambulatoryId: nil, includeDiagnoses: false)

        XCTAssertEqual(withDiagnoses.first?.diagnoses, "ENC:iv:ciphertext")
        XCTAssertNil(withoutDiagnoses.first?.diagnoses)
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
    func testSearchDrugsUsesNetworkCatalogRouteAndDecodesHostShape() async throws {
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
                "https://localhost:3443/api/v1/network/drugs?q=amoxi&limit=10"
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
                "aic": "012345678",
                "name": "Amoxicillina 1g compresse",
                "activePrinciple": "Amoxicillina",
                "company": "AIFA Test",
                "packaging": "12 compresse",
                "class": "A",
                "price": 560,
                "atc": "J01CA04"
              }
            ]
            """.data(using: .utf8)!
            return (response, data)
        }

        let drugs = try await client.searchDrugs(
            query: " amoxi ",
            limit: 10,
            credentials: HomeBasePairedCredentials(clientId: "paired-client-1", clientToken: "paired-token-1"),
            sessionCookie: "mediflow_session=session-123",
            ambulatoryId: "amb-42"
        )

        XCTAssertEqual(drugs, [
            HomeBaseDrugSummary(
                aic: "012345678",
                name: "Amoxicillina 1g compresse",
                activePrinciple: "Amoxicillina",
                company: "AIFA Test",
                packaging: "12 compresse",
                drugClass: "A",
                price: 560,
                atc: "J01CA04"
            )
        ])
    }

    /* @Codex */
    func testSearchExemptionsUsesNetworkCatalogRouteAndDecodesHostShape() async throws {
        let client = makeClient { request in
            XCTAssertEqual(request.httpMethod, "GET")
            XCTAssertEqual(
                request.url?.absoluteString,
                "https://localhost:3443/api/v1/network/exemptions?q=c01&limit=10"
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
                "code": "C01",
                "description": "Invalidi civili totali",
                "type": "nazionale",
                "source": "fixture",
                "startDate": null,
                "endDate": null,
                "isPharma": true,
                "isSpecialist": false,
                "isNational": true,
                "updatedAt": "2026-07-08T10:00:00.000Z"
              }
            ]
            """.data(using: .utf8)!
            return (response, data)
        }

        let exemptions = try await client.searchExemptions(
            query: " c01 ",
            limit: 10,
            credentials: HomeBasePairedCredentials(clientId: "paired-client-1", clientToken: "paired-token-1"),
            sessionCookie: "mediflow_session=session-123",
            ambulatoryId: nil
        )

        XCTAssertEqual(exemptions.count, 1)
        XCTAssertEqual(exemptions.first?.code, "C01")
        XCTAssertEqual(exemptions.first?.description, "Invalidi civili totali")
        XCTAssertEqual(exemptions.first?.isPharma, true)
        XCTAssertEqual(exemptions.first?.isSpecialist, false)
        XCTAssertEqual(exemptions.first?.isNational, true)
        XCTAssertNotNil(exemptions.first?.updatedAt)
    }

    /* @Codex */
    func testSearchTerminologyUsesNetworkRouteQueryAndDecodesOpenAPIShape() async throws {
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
                "https://localhost:3443/api/v1/network/terminology/search?system=LOINC&q=emoglobina&limit=10"
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
                "system": "LOINC",
                "code": "4548-4",
                "display": "Hemoglobin A1c/Hemoglobin.total in Blood",
                "displayIt": "Emoglobina A1c / emoglobina totale nel sangue",
                "defaultUnit": "%",
                "version": "2.77",
                "source": "local-static-loinc"
              }
            ]
            """.data(using: .utf8)!
            return (response, data)
        }

        let items = try await client.searchTerminology(
            system: " LOINC ",
            query: " emoglobina ",
            limit: 10,
            credentials: HomeBasePairedCredentials(clientId: "paired-client-1", clientToken: "paired-token-1"),
            sessionCookie: "mediflow_session=session-123",
            ambulatoryId: "amb-42"
        )

        XCTAssertEqual(items, [
            HomeBaseTerminologyItem(
                system: "LOINC",
                code: "4548-4",
                display: "Hemoglobin A1c/Hemoglobin.total in Blood",
                displayIt: "Emoglobina A1c / emoglobina totale nel sangue",
                defaultUnit: "%",
                version: "2.77",
                source: "local-static-loinc"
            )
        ])
    }

    /* @Codex */
    func testResolveTerminologyUsesNetworkRouteAndDecodesOpenAPIShape() async throws {
        let client = makeClient { request in
            XCTAssertEqual(request.httpMethod, "GET")
            XCTAssertEqual(
                request.url?.absoluteString,
                "https://localhost:3443/api/v1/network/terminology/resolve?system=UCUM&code=mg/dL"
            )

            let response = HTTPURLResponse(
                url: try XCTUnwrap(request.url),
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            let data = """
            {
              "system": "UCUM",
              "code": "mg/dL",
              "display": "milligram per deciliter",
              "defaultUnit": "mg/dL",
              "version": null,
              "source": "local-static-ucum"
            }
            """.data(using: .utf8)!
            return (response, data)
        }

        let item = try await client.resolveTerminology(
            system: "UCUM",
            code: " mg/dL ",
            credentials: HomeBasePairedCredentials(clientId: "paired-client-1", clientToken: "paired-token-1"),
            sessionCookie: "mediflow_session=session-123",
            ambulatoryId: nil
        )

        XCTAssertEqual(item.system, "UCUM")
        XCTAssertEqual(item.code, "mg/dL")
        XCTAssertEqual(item.defaultUnit, "mg/dL")
        XCTAssertEqual(item.source, "local-static-ucum")
    }

    /* @Codex */
    func testFetchTerminologySystemsUsesNetworkRouteAndTolerantDateDecode() async throws {
        let client = makeClient { request in
            XCTAssertEqual(request.httpMethod, "GET")
            XCTAssertEqual(request.value(forHTTPHeaderField: "x-mediflow-paired-client-id"), "paired-client-1")
            XCTAssertEqual(request.value(forHTTPHeaderField: "x-mediflow-paired-client-token"), "paired-token-1")
            XCTAssertEqual(
                request.url?.absoluteString,
                "https://localhost:3443/api/v1/network/terminology/systems"
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
                "system": "ATC",
                "display": "Anatomical Therapeutic Chemical",
                "version": "2026-local",
                "source": "local-aifa-drug-catalog",
                "status": "active",
                "updatedAt": "2026-07-08T10:00:00.000Z",
                "notes": "Catalogo locale derivato dai farmaci"
              }
            ]
            """.data(using: .utf8)!
            return (response, data)
        }

        let systems = try await client.fetchTerminologySystems(
            credentials: HomeBasePairedCredentials(clientId: "paired-client-1", clientToken: "paired-token-1"),
            sessionCookie: "mediflow_session=session-123",
            ambulatoryId: nil
        )

        XCTAssertEqual(systems.count, 1)
        XCTAssertEqual(systems.first?.system, "ATC")
        XCTAssertEqual(systems.first?.status, "active")
        XCTAssertNotNil(systems.first?.updatedAt)
        XCTAssertEqual(systems.first?.notes, "Catalogo locale derivato dai farmaci")
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
    func testFetchScopedEntriesUsesGlobalRouteAndTolerantDates() async throws {
        let client = makeClient { request in
            XCTAssertEqual(request.httpMethod, "GET")
            XCTAssertEqual(
                request.url?.absoluteString,
                "https://localhost:3443/api/v1/network/entries?type=note&dateFrom=2026-07-01T00:00:00Z&dateTo=2026-07-09T00:00:00Z&limit=100"
            )
            let response = HTTPURLResponse(url: try XCTUnwrap(request.url), statusCode: 200, httpVersion: nil, headerFields: nil)!
            return (response, Data(#"[{"id":"entry-1","patientId":"patient-1","type":"note","title":"Controllo","date":"2026-07-09T08:30:00.000Z","content":"ENC:iv:entry","setting":null,"metadata":null,"attachments":null,"deletedAt":"2026-07-09T09:00:00Z","deletionReason":"ENC:iv:reason","version":3,"createdAt":"2026-07-09T08:00:00Z","updatedAt":"2026-07-09T08:31:00.000Z"}]"#.utf8))
        }

        let entries = try await client.fetchScopedEntries(
            type: "note",
            dateFrom: Date(timeIntervalSince1970: 1_782_864_000),
            dateTo: Date(timeIntervalSince1970: 1_783_555_200),
            limit: 100,
            credentials: creds,
            sessionCookie: cookie,
            ambulatoryId: nil
        )

        XCTAssertEqual(entries.first?.id, "entry-1")
        XCTAssertEqual(entries.first?.content, "ENC:iv:entry")
        XCTAssertNotNil(entries.first?.updatedAt)
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
    func testRestoreEntryPutsDeletedAtAndReasonNulls() async throws {
        let client = makeClient { request in
            XCTAssertEqual(request.httpMethod, "PUT")
            XCTAssertEqual(
                request.url?.absoluteString,
                "https://localhost:3443/api/v1/network/patients/patient-1/entries/entry-1"
            )

            let body = try self.readRequestBody(from: request)
            let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
            XCTAssertEqual(payload["version"] as? Int, 6)
            XCTAssertTrue(payload.keys.contains("deletedAt"))
            XCTAssertTrue(payload["deletedAt"] is NSNull)
            XCTAssertTrue(payload.keys.contains("deletionReason"))
            XCTAssertTrue(payload["deletionReason"] is NSNull)
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
                version: 6,
                deletedAt: nil,
                deletionReason: nil,
                shouldEncodeDeletedAt: true,
                shouldEncodeDeletionReason: true
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
        XCTAssertNil(therapies.first?.aic)
        XCTAssertEqual(therapies.first?.atc, "A10BA02")
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
            XCTAssertEqual(payload["aic"] as? String, "012345678")
            XCTAssertEqual(payload["atc"] as? String, "A10BA02")
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
                aic: "012345678",
                atc: "A10BA02",
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
            XCTAssertEqual(payload["aic"] as? String, "")
            XCTAssertEqual(payload["atc"] as? String, "A10BA02")
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
                    aic: "",
                    atc: "A10BA02",
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
    func testFetchScopedCheckupsUsesGlobalRouteAndTolerantDates() async throws {
        let client = makeClient { request in
            XCTAssertEqual(request.httpMethod, "GET")
            XCTAssertEqual(
                request.url?.absoluteString,
                "https://localhost:3443/api/v1/network/checkups?dateFrom=2026-07-01T00:00:00Z&dateTo=2026-07-09T00:00:00Z&status=pending&status=completed&limit=500"
            )
            let response = HTTPURLResponse(url: try XCTUnwrap(request.url), statusCode: 200, httpVersion: nil, headerFields: nil)!
            return (response, Data(#"[{"id":"checkup-1","patientId":"patient-1","date":"2026-07-09T08:30:00.000Z","title":"Controllo","notes":"ENC:iv:notes","status":"pending","source":"manual","version":3,"createdAt":"2026-07-09T08:00:00Z","updatedAt":"2026-07-09T08:31:00.000Z","deletedAt":null,"deletionReason":null}]"#.utf8))
        }

        let checkups = try await client.fetchScopedCheckups(
            dateFrom: Date(timeIntervalSince1970: 1_782_864_000),
            dateTo: Date(timeIntervalSince1970: 1_783_555_200),
            status: ["pending", "completed"],
            limit: 500,
            credentials: creds,
            sessionCookie: cookie,
            ambulatoryId: nil
        )

        XCTAssertEqual(checkups.first?.id, "checkup-1")
        XCTAssertEqual(checkups.first?.notes, "ENC:iv:notes")
        XCTAssertNotNil(checkups.first?.date)
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

    func testChangePinConflictDecodesDedicatedServerCode() async throws {
        let client = makeClient { request in
            XCTAssertEqual(request.url?.path, "/api/auth/change-pin")
            let response = HTTPURLResponse(
                url: try XCTUnwrap(request.url), statusCode: 409, httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            return (response, Data(#"{"error":"Il PIN è stato modificato da un’altra sessione. Ricarica e riprova.","code":"PIN_CHANGE_CONFLICT","message":"Il PIN è stato modificato da un’altra sessione. Ricarica e riprova."}"#.utf8))
        }

        do {
            _ = try await client.changePin(
                currentPin: "1357",
                newPin: "2468",
                encryptedMasterKey: "v2:wrapped",
                salt: "AAECAwQFBgcICQoLDA0ODw==",
                credentials: creds,
                sessionCookie: cookie
            )
            XCTFail("Expected PIN_CHANGE_CONFLICT")
        } catch HomeBaseClientError.pinChangeConflict(let message) {
            XCTAssertEqual(message, "Il PIN è stato modificato da un’altra sessione. Ricarica e riprova.")
        }
    }

    func testAmbulatoryVersionConflictDecodesRealBoundaryPayload() async throws {
        let client = makeClient { request in
            XCTAssertEqual(request.url?.path, "/api/v1/network/ambulatories/amb-1")
            let response = HTTPURLResponse(
                url: try XCTUnwrap(request.url), statusCode: 409, httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            return (response, Data(#"{"error":"Conflict","code":"VERSION_CONFLICT","entity":"ambulatory","recordId":"amb-1","expectedVersion":2,"currentVersion":3,"currentUpdatedAt":null,"currentState":"present","currentSnapshot":{"id":"amb-1","version":3,"isDefault":true,"type":"live"}}"#.utf8))
        }

        do {
            _ = try await client.updateAmbulatory(
                id: "amb-1",
                payload: HomeBaseAmbulatoryUpdatePayload(expectedVersion: 2, name: "Sede"),
                credentials: creds,
                sessionCookie: cookie
            )
            XCTFail("Expected VERSION_CONFLICT")
        } catch HomeBaseClientError.versionConflict(let conflict) {
            XCTAssertEqual(conflict.entity, "ambulatory")
            XCTAssertEqual(conflict.recordId, "amb-1")
            XCTAssertEqual(conflict.expectedVersion, 2)
            XCTAssertEqual(conflict.currentVersion, 3)
            XCTAssertEqual(conflict.currentSnapshot?.version, 3)
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
            XCTAssertEqual(
                payload["diagnoses"] as? String,
                "[{\"code\":\"E11.9\",\"description\":\"Diabete\",\"system\":\"ICD-10\",\"date\":\"2026-01-01T00:00:00.000Z\"}]",
                "diagnoses must be sent verbatim as the JSON-array string"
            )

            let response = HTTPURLResponse(
                url: try XCTUnwrap(request.url), statusCode: 200, httpVersion: nil, headerFields: nil
            )!
            return (response, Data(#"{"success":true}"#.utf8))
        }

        let ack = try await client.updatePatient(
            patientId: "patient-1",
            payload: HomeBasePatientUpdatePayload(
                version: 5, firstName: "Mario", isArchived: true, address: .null, phone: .value("06 1234"),
                diagnoses: .value("[{\"code\":\"E11.9\",\"description\":\"Diabete\",\"system\":\"ICD-10\",\"date\":\"2026-01-01T00:00:00.000Z\"}]")
            ),
            credentials: HomeBasePairedCredentials(clientId: "paired-client-1", clientToken: "paired-token-1"),
            sessionCookie: "mediflow_session=session-123",
            ambulatoryId: nil
        )
        XCTAssertTrue(ack.success)
    }

    /* @Codex */
    func testCreatePatientPostsNetworkPatientPayload() async throws {
        let client = makeClient { request in
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
            XCTAssertEqual(request.value(forHTTPHeaderField: "X-MediFlow-Source-Surface"), "native")
            XCTAssertEqual(request.value(forHTTPHeaderField: "x-mediflow-paired-client-id"), "paired-client-1")
            XCTAssertEqual(request.value(forHTTPHeaderField: "x-mediflow-paired-client-token"), "paired-token-1")
            XCTAssertEqual(
                request.value(forHTTPHeaderField: "Cookie"),
                "mediflow_session=session-123; ambulatory_id=amb-42"
            )
            XCTAssertEqual(request.url?.absoluteString, "https://localhost:3443/api/v1/network/patients")

            let body = try self.readRequestBody(from: request)
            let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
            XCTAssertEqual(payload["firstName"] as? String, "Lucia")
            XCTAssertEqual(payload["lastName"] as? String, "Bianchi")
            XCTAssertEqual(payload["taxCode"] as? String, "BNCLCU85M41F205X")
            XCTAssertEqual(payload["birthDate"] as? String, "1985-08-01T00:00:00Z")
            XCTAssertEqual(payload["address"] as? String, "ENC:addr:sealed")
            XCTAssertEqual(payload["phone"] as? String, "ENC:phone:sealed")
            XCTAssertEqual(payload["caregiver"] as? String, "ENC:caregiver:sealed")
            XCTAssertEqual(payload["exemptions"] as? String, "ENC:exemptions:sealed")
            XCTAssertEqual(payload["diagnoses"] as? String, "ENC:diagnoses:sealed")
            XCTAssertEqual(payload["statusReason"] as? String, "ENC:status:sealed")
            XCTAssertEqual(payload["notes"] as? String, "ENC:notes:sealed")
            XCTAssertEqual(payload["isAdi"] as? Bool, true)
            // The create boundary rejects server-controlled fields by presence:
            // the wire payload must not carry any of them.
            for field in NetworkWriteBoundary.patientCreateServerControlledFields {
                XCTAssertNil(payload[field], "create payload must omit server-controlled \(field)")
            }

            let response = HTTPURLResponse(
                url: try XCTUnwrap(request.url),
                statusCode: 201,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            return (response, Data(#"{"id":"patient-new-1","version":1}"#.utf8))
        }

        let result = try await client.createPatient(
            payload: HomeBasePatientCreatePayload(
                firstName: "Lucia",
                lastName: "Bianchi",
                taxCode: "BNCLCU85M41F205X",
                birthDate: Date(timeIntervalSince1970: 491_702_400),
                address: "ENC:addr:sealed",
                phone: "ENC:phone:sealed",
                caregiver: "ENC:caregiver:sealed",
                exemptions: "ENC:exemptions:sealed",
                diagnoses: "ENC:diagnoses:sealed",
                statusReason: "ENC:status:sealed",
                notes: "ENC:notes:sealed",
                isAdi: true
            ),
            credentials: HomeBasePairedCredentials(clientId: "paired-client-1", clientToken: "paired-token-1"),
            sessionCookie: "mediflow_session=session-123",
            ambulatoryId: "amb-42"
        )

        XCTAssertEqual(result, HomeBaseCreatedResource(id: "patient-new-1", version: 1))
    }

    /* @Codex */
    func testSoftDeletePatientSendsDeleteWithVersionAndReason() async throws {
        let client = makeClient { request in
            XCTAssertEqual(request.httpMethod, "DELETE")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
            XCTAssertEqual(request.url?.absoluteString, "https://localhost:3443/api/v1/network/patients/patient-1")

            let body = try self.readRequestBody(from: request)
            let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
            XCTAssertEqual(payload["version"] as? Int, 7)
            XCTAssertEqual(payload["deletionReason"] as? String, "ENC:reason:sealed")

            let response = HTTPURLResponse(
                url: try XCTUnwrap(request.url),
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            return (response, Data(#"{"id":"patient-1","version":8}"#.utf8))
        }

        let result = try await client.softDeletePatient(
            id: "patient-1",
            version: 7,
            sealedReason: "ENC:reason:sealed",
            credentials: HomeBasePairedCredentials(clientId: "paired-client-1", clientToken: "paired-token-1"),
            sessionCookie: "mediflow_session=session-123",
            ambulatoryId: nil
        )

        XCTAssertEqual(result, HomeBaseCreatedResource(id: "patient-1", version: 8))
    }

    /* @Codex */
    func testRestorePatientPostsRestorePathWithVersion() async throws {
        let client = makeClient { request in
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
            XCTAssertEqual(
                request.url?.absoluteString,
                "https://localhost:3443/api/v1/network/patients/patient-1/restore"
            )

            let body = try self.readRequestBody(from: request)
            let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
            XCTAssertEqual(payload["version"] as? Int, 8)

            let response = HTTPURLResponse(
                url: try XCTUnwrap(request.url),
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            return (response, Data(#"{"id":"patient-1","version":9}"#.utf8))
        }

        let result = try await client.restorePatient(
            id: "patient-1",
            version: 8,
            credentials: HomeBasePairedCredentials(clientId: "paired-client-1", clientToken: "paired-token-1"),
            sessionCookie: "mediflow_session=session-123",
            ambulatoryId: nil
        )

        XCTAssertEqual(result, HomeBaseCreatedResource(id: "patient-1", version: 9))
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
            [{"id":"AMB-1","name":"Centrale","address":"Via Roma 1","parentId":null,"type":"live",\
            "description":"Sede principale","isDefault":true,"version":3,"createdAt":"2026-06-01T00:00:00.000Z"},\
            {"id":"AMB-2","name":"Nord","address":null,"parentId":"AMB-1","type":"test",\
            "description":null,"isDefault":false,"version":2,"createdAt":null}]
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
        XCTAssertEqual(result[0].version, 3)
        XCTAssertEqual(result[1].parentId, "AMB-1")
        XCTAssertNil(result[1].address, "a null address must decode as nil")
        XCTAssertNil(result[1].createdAt)
    }

    /* @Codex */
    func testFetchServicePrescriptionsUsesPatientQueryAndDecodesOpenAPIShape() async throws {
        let client = makeClient { request in
            XCTAssertEqual(request.httpMethod, "GET")
            XCTAssertEqual(request.value(forHTTPHeaderField: "x-mediflow-paired-client-id"), "paired-client-1")
            XCTAssertEqual(request.url?.absoluteString, "https://localhost:3443/api/v1/network/service-prescriptions?patientId=patient-1")
            let response = HTTPURLResponse(url: try XCTUnwrap(request.url), statusCode: 200, httpVersion: nil, headerFields: nil)!
            return (response, Data(#"[{"id":"sp-1","patientId":"patient-1","prescribedAt":"2026-07-08T08:00:00.000Z","status":"prescribed","category":"lab","priority":"D","codeSystem":"RL","serviceCode":"90.13.B","serviceName":"LDL","clinicalQuestion":null,"provider":null,"scheduledAt":null,"performedAt":null,"reportReceivedAt":null,"outcomeNote":null,"requestReference":null,"source":"manual","documentRefs":null,"notes":null,"version":2,"createdAt":"2026-07-08T08:01:00.000Z","updatedAt":"2026-07-08T08:02:00.000Z"}]"#.utf8))
        }
        let result = try await client.fetchServicePrescriptions(patientId: "patient-1", credentials: creds, sessionCookie: cookie, ambulatoryId: nil)
        XCTAssertEqual(result.first?.id, "sp-1")
        XCTAssertEqual(result.first?.version, 2)
        XCTAssertNotNil(result.first?.prescribedAt)
    }

    /* @Codex */
    func testCreateAndUpdateServicePrescriptionUseCleanPayloads() async throws {
        var step = 0
        let client = makeClient { request in
            defer { step += 1 }
            if step == 0 {
                XCTAssertEqual(request.httpMethod, "POST")
                XCTAssertEqual(request.url?.absoluteString, "https://localhost:3443/api/v1/network/service-prescriptions")
                let payload = try self.requestObject(request)
                XCTAssertEqual(payload["patientId"] as? String, "patient-1")
                XCTAssertEqual(payload["serviceName"] as? String, "Visita diabetologica")
                XCTAssertEqual(payload["status"] as? String, "prescribed")
                for field in ["version", "createdAt", "updatedAt"] { XCTAssertNil(payload[field]) }
                let response = HTTPURLResponse(url: try XCTUnwrap(request.url), statusCode: 201, httpVersion: nil, headerFields: nil)!
                return (response, Data(#"{"id":"sp-1","version":1}"#.utf8))
            }
            XCTAssertEqual(request.httpMethod, "PUT")
            XCTAssertEqual(request.url?.absoluteString, "https://localhost:3443/api/v1/network/service-prescriptions/sp-1")
            let payload = try self.requestObject(request)
            XCTAssertEqual(payload["version"] as? Int, 2)
            XCTAssertEqual(payload["status"] as? String, "booked")
            XCTAssertTrue(payload.keys.contains("scheduledAt"))
            XCTAssertNil(payload["createdAt"])
            XCTAssertNil(payload["updatedAt"])
            let response = HTTPURLResponse(url: try XCTUnwrap(request.url), statusCode: 200, httpVersion: nil, headerFields: nil)!
            return (response, Data(#"{"success":true}"#.utf8))
        }
        let created = try await client.createServicePrescription(
            payload: HomeBaseServicePrescriptionCreatePayload(patientId: "patient-1", prescribedAt: fixtureDate, serviceName: "Visita diabetologica", status: "prescribed"),
            credentials: creds, sessionCookie: cookie, ambulatoryId: "amb-42")
        let ack = try await client.updateServicePrescription(
            prescriptionId: "sp-1",
            payload: HomeBaseServicePrescriptionUpdatePayload(version: 2, status: "booked", scheduledAt: .value(fixtureDate)),
            credentials: creds, sessionCookie: cookie, ambulatoryId: nil)
        XCTAssertEqual(created, HomeBaseCreatedResource(id: "sp-1", version: 1))
        XCTAssertTrue(ack.success)
    }

    /* @Codex */
    func testServicePrescriptionItemsMethodsUseExactRoutesAndCleanPayloads() async throws {
        var step = 0
        let client = makeClient { request in
            defer { step += 1 }
            let response = HTTPURLResponse(url: try XCTUnwrap(request.url), statusCode: step == 2 ? 201 : 200, httpVersion: nil, headerFields: nil)!
            switch step {
            case 0:
                XCTAssertEqual(request.url?.absoluteString, "https://localhost:3443/api/v1/network/service-prescription-items?prescriptionId=sp-1")
                return (response, Data(#"[{"id":"spi-1","patientId":"patient-1","prescriptionId":"sp-1","ordinal":1,"status":"prescribed","category":"lab","codeSystem":"RL","serviceCode":"90.13.B","serviceName":"LDL","catalogEntryId":null,"catalogDisplayName":null,"matchStatus":"unmatched","confidence":null,"evidence":null,"notes":null,"scheduledAt":null,"performedAt":null,"reportReceivedAt":null,"outcomeNote":null,"version":3,"createdAt":"2026-07-08T08:01:00.000Z","updatedAt":"2026-07-08T08:02:00.000Z"}]"#.utf8))
            case 1:
                XCTAssertEqual(request.url?.absoluteString, "https://localhost:3443/api/v1/network/service-prescription-items?patientId=patient-1")
                return (response, Data(#"[]"#.utf8))
            case 2:
                XCTAssertEqual(request.httpMethod, "POST")
                let payload = try self.requestObject(request)
                XCTAssertEqual(payload["prescriptionId"] as? String, "sp-1")
                XCTAssertEqual(payload["serviceName"] as? String, "LDL")
                XCTAssertNil(payload["patientId"])
                for field in ["version", "createdAt", "updatedAt"] { XCTAssertNil(payload[field]) }
                return (response, Data(#"{"id":"spi-1","version":1}"#.utf8))
            default:
                XCTAssertEqual(request.httpMethod, "PUT")
                XCTAssertEqual(request.url?.absoluteString, "https://localhost:3443/api/v1/network/service-prescription-items/spi-1")
                let payload = try self.requestObject(request)
                XCTAssertEqual(payload["version"] as? Int, 3)
                XCTAssertEqual(payload["matchStatus"] as? String, "matched")
                XCTAssertTrue(payload.keys.contains("confidence"))
                XCTAssertNil(payload["createdAt"])
                XCTAssertNil(payload["updatedAt"])
                return (response, Data(#"{"success":true}"#.utf8))
            }
        }
        let byPrescription = try await client.fetchServicePrescriptionItems(patientId: nil, prescriptionId: "sp-1", credentials: creds, sessionCookie: cookie, ambulatoryId: nil)
        let byPatient = try await client.fetchServicePrescriptionItems(patientId: "patient-1", credentials: creds, sessionCookie: cookie, ambulatoryId: nil)
        let created = try await client.createServicePrescriptionItem(payload: HomeBaseServicePrescriptionItemCreatePayload(prescriptionId: "sp-1", serviceName: "LDL"), credentials: creds, sessionCookie: cookie, ambulatoryId: nil)
        let ack = try await client.updateServicePrescriptionItem(itemId: "spi-1", payload: HomeBaseServicePrescriptionItemUpdatePayload(version: 3, matchStatus: "matched", confidence: .null), credentials: creds, sessionCookie: cookie, ambulatoryId: nil)
        XCTAssertEqual(byPrescription.first?.id, "spi-1")
        XCTAssertTrue(byPatient.isEmpty)
        XCTAssertEqual(created, HomeBaseCreatedResource(id: "spi-1", version: 1))
        XCTAssertTrue(ack.success)
    }

    /* @Codex */
    func testFetchServiceCatalogAndCountUseExactQueryShapes() async throws {
        var urls: [String] = []
        let client = makeClient { request in
            urls.append(request.url?.absoluteString ?? "")
            let response = HTTPURLResponse(url: try XCTUnwrap(request.url), statusCode: 200, httpVersion: nil, headerFields: nil)!
            if request.url?.query == "count=1" {
                return (response, Data(#"{"count":12}"#.utf8))
            }
            return (response, Data(#"[{"id":"cat-1","codeSystem":"RL","serviceCode":"90.13.B","displayName":"LDL colesterolo","category":"lab","branchCode":null,"synonyms":null,"source":"fixture","version":"2026","active":true,"importedAt":"2026-07-08T08:00:00.000Z","updatedAt":null}]"#.utf8))
        }
        let entries = try await client.fetchServiceCatalog(query: " ldl ", code: "90.13.B", limit: 25, credentials: creds, sessionCookie: cookie, ambulatoryId: nil)
        let count = try await client.fetchServiceCatalogCount(credentials: creds, sessionCookie: cookie, ambulatoryId: nil)
        XCTAssertEqual(entries.first?.serviceCode, "90.13.B")
        XCTAssertEqual(count.count, 12)
        XCTAssertEqual(urls, [
            "https://localhost:3443/api/v1/network/service-catalog?limit=25&q=ldl&code=90.13.B",
            "https://localhost:3443/api/v1/network/service-catalog?count=1",
        ])
    }

    /* @Codex */
    func testProstheticPrescriptionMethodsUseCleanPayloadsAndDecodeSamples() async throws {
        var step = 0
        let client = makeClient { request in
            defer { step += 1 }
            let response = HTTPURLResponse(url: try XCTUnwrap(request.url), statusCode: step == 1 ? 201 : 200, httpVersion: nil, headerFields: nil)!
            switch step {
            case 0:
                XCTAssertEqual(request.httpMethod, "GET")
                XCTAssertEqual(request.url?.absoluteString, "https://localhost:3443/api/v1/network/prosthetic-prescriptions?patientId=patient-1")
                return (response, Data(#"[{"id":"pp-1","patientId":"patient-1","prescribedAt":"2026-07-08T08:00:00.000Z","status":"prescribed","category":"standard","isoCode":"ISO-1","description":"Ausilio","measures":null,"clinicalReason":null,"regionalPrescriptionId":null,"supplier":null,"collaudoAt":null,"collaudoOutcome":null,"source":"manual","documentRefs":null,"notes":null,"version":2,"createdAt":"2026-07-08T08:01:00.000Z","updatedAt":"2026-07-08T08:02:00.000Z"}]"#.utf8))
            case 1:
                XCTAssertEqual(request.httpMethod, "POST")
                XCTAssertEqual(request.url?.absoluteString, "https://localhost:3443/api/v1/network/prosthetic-prescriptions")
                let payload = try self.requestObject(request)
                XCTAssertEqual(payload["description"] as? String, "Ausilio")
                for field in ["version", "createdAt", "updatedAt"] { XCTAssertNil(payload[field]) }
                return (response, Data(#"{"id":"pp-2","version":1}"#.utf8))
            default:
                XCTAssertEqual(request.httpMethod, "PUT")
                XCTAssertEqual(request.url?.absoluteString, "https://localhost:3443/api/v1/network/prosthetic-prescriptions/pp-1")
                let payload = try self.requestObject(request)
                XCTAssertEqual(payload["version"] as? Int, 2)
                XCTAssertEqual(payload["status"] as? String, "tested")
                XCTAssertNil(payload["createdAt"])
                XCTAssertNil(payload["updatedAt"])
                return (response, Data(#"{"success":true}"#.utf8))
            }
        }
        let list = try await client.fetchProstheticPrescriptions(patientId: "patient-1", credentials: creds, sessionCookie: cookie, ambulatoryId: nil)
        let created = try await client.createProstheticPrescription(payload: HomeBaseProstheticPrescriptionCreatePayload(patientId: "patient-1", prescribedAt: fixtureDate, description: "Ausilio"), credentials: creds, sessionCookie: cookie, ambulatoryId: nil)
        let ack = try await client.updateProstheticPrescription(prescriptionId: "pp-1", payload: HomeBaseProstheticPrescriptionUpdatePayload(version: 2, status: "tested"), credentials: creds, sessionCookie: cookie, ambulatoryId: nil)
        XCTAssertEqual(list.first?.id, "pp-1")
        XCTAssertEqual(created, HomeBaseCreatedResource(id: "pp-2", version: 1))
        XCTAssertTrue(ack.success)
    }

    /* @Codex */
    func testDiscoveryAndRevisionMethodsUsePairedHeadersAndDecodeSamples() async throws {
        var paths: [String] = []
        let client = makeClient { request in
            paths.append(request.url?.path ?? "")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Cookie"), "mediflow_session=session-123")
            let response = HTTPURLResponse(url: try XCTUnwrap(request.url), statusCode: 200, httpVersion: nil, headerFields: nil)!
            switch request.url?.path {
            case "/api/v1/network/capabilities":
                return (response, Data(#"{"nodeId":"node-1","operatingMode":"network-home-base","protocolVersion":"1","capabilities":[{"key":"network.fse.validate","status":"available","requiresPairing":true,"description":"FSE"}]}"#.utf8))
            case "/api/v1/network/identity":
                return (response, Data(#"{"identityModel":"paired-device-plus-node-credentials","pairingBoundary":"device-pairing-separate-from-operator-login","credentialState":"session-bound","loginMode":"single-local-user-default","usernameHint":null,"displayNameHint":null,"operator":{"userId":"u1","username":"doctor","displayName":"Doctor","role":"admin","authChannel":"web"},"scope":{"policy":"session-context-else-node-default","effectiveAmbulatoryId":"amb-1","effectiveAmbulatoryName":"Centro","defaultAmbulatoryId":"amb-1","defaultAmbulatoryName":"Centro","source":"session-context"},"audit":{"actorType":"user","actorBinding":"session-user"},"limitations":[]}"#.utf8))
            case "/api/v1/network/node":
                return (response, Data(#"{"nodeId":"node-1","displayName":"Mac","role":"home-base-candidate","operatingMode":"network-home-base","protocolVersion":"1","transport":{"apiBasePath":"/api/v1","tlsRequired":true,"localTlsPort":3443}}"#.utf8))
            default:
                return (response, Data(#"{"revision":"rev-1","sourceFingerprint":"src-1","fingerprint":"fp-1"}"#.utf8))
            }
        }
        let capabilities = try await client.fetchNetworkCapabilities(credentials: creds, sessionCookie: cookie, ambulatoryId: nil)
        let identity = try await client.fetchNetworkIdentity(credentials: creds, sessionCookie: cookie, ambulatoryId: nil)
        let node = try await client.fetchNetworkNode(credentials: creds, sessionCookie: cookie, ambulatoryId: nil)
        let revision = try await client.fetchNetworkRevision(credentials: creds, sessionCookie: cookie, ambulatoryId: nil)
        XCTAssertEqual(capabilities.capabilities.first?.key, "network.fse.validate")
        XCTAssertEqual(identity.scope.effectiveAmbulatoryId, "amb-1")
        XCTAssertEqual(node.transport.localTlsPort, 3443)
        XCTAssertEqual(revision.fingerprint, "fp-1")
        XCTAssertEqual(paths, ["/api/v1/network/capabilities", "/api/v1/network/identity", "/api/v1/network/node", "/api/v1/network/revision"])
    }

    /* @Codex */
    func testFseValidationMethodsUseNetworkBoundaryAndDecodeResponses() async throws {
        var step = 0
        let client = makeClient { request in
            defer { step += 1 }
            let response = HTTPURLResponse(url: try XCTUnwrap(request.url), statusCode: 200, httpVersion: nil, headerFields: nil)!
            if step == 0 {
                XCTAssertEqual(request.httpMethod, "GET")
                XCTAssertEqual(request.url?.absoluteString, "https://localhost:3443/api/v1/network/fse/validate-patient?patientId=patient-1")
                return (response, Data(#"{"patientId":"patient-1","hasErrors":false,"hasWarnings":true,"therapyMedication":{"total":1,"ok":1,"withErrors":0,"withWarnings":1,"errorCount":0,"warningCount":1,"items":[{"id":"t1","ok":true,"errors":[],"warnings":[{"field":"dosage","code":"LOW_SIGNAL","message":"warning"}]}]},"observationVitals":{"total":0,"ok":0,"withErrors":0,"withWarnings":0,"errorCount":0,"warningCount":0,"items":[]}}"#.utf8))
            }
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.url?.absoluteString, "https://localhost:3443/api/v1/network/fse/validate-document")
            let payload = try self.requestObject(request)
            XCTAssertEqual(payload["profile"] as? String, "FSE_TEST")
            XCTAssertNotNil(payload["payload"])
            return (response, Data(#"{"ok":true,"profile":"FSE_TEST","errors":[],"warnings":[]}"#.utf8))
        }
        let patient = try await client.fetchFseValidatePatient(patientId: "patient-1", credentials: creds, sessionCookie: cookie, ambulatoryId: nil)
        let document = try await client.validateFseDocument(payload: HomeBaseFseDocumentValidationPayload(profile: "FSE_TEST", payload: .object(["id": .string("doc-1")])), credentials: creds, sessionCookie: cookie, ambulatoryId: nil)
        XCTAssertTrue(patient.hasWarnings)
        XCTAssertTrue(document.ok)
    }

    /* @Codex */
    func testNewDataPlaneMethodsDispatchHttpThroughDataSourceExistential() async throws {
        var requests: [String] = []
        let client = makeClient { request in
            let method = request.httpMethod ?? "GET"
            let url = try XCTUnwrap(request.url)
            requests.append("\(method) \(url.absoluteString)")
            let statusCode = method == "POST" && (
                url.path == "/api/v1/network/ambulatories"
                    || url.path == "/api/v1/network/patients/patient-1/attachments"
            ) ? 201 : 200
            let response = HTTPURLResponse(url: url, statusCode: statusCode, httpVersion: nil, headerFields: nil)!
            switch (method, url.path) {
            case ("POST", "/api/auth/change-pin"):
                XCTAssertEqual(request.value(forHTTPHeaderField: "Cookie"), self.cookie)
                XCTAssertEqual(request.value(forHTTPHeaderField: "x-mediflow-paired-client-id"), "paired-client-1")
                XCTAssertEqual(request.value(forHTTPHeaderField: "x-mediflow-paired-client-token"), "paired-token-1")
                let payload = try self.requestObject(request)
                XCTAssertEqual(payload["currentPin"] as? String, "1357")
                XCTAssertEqual(payload["newPin"] as? String, "2468")
                XCTAssertEqual(payload["encryptedMasterKey"] as? String, "v2:wrapped")
                XCTAssertEqual(payload["salt"] as? String, "AAECAwQFBgcICQoLDA0ODw==")
                return (response, Data(#"{"success":true,"message":"PIN aggiornato con successo."}"#.utf8))
            case ("POST", "/api/auth/logout"):
                XCTAssertEqual(request.value(forHTTPHeaderField: "Cookie"), self.cookie)
                XCTAssertEqual(request.value(forHTTPHeaderField: "x-mediflow-paired-client-id"), "paired-client-1")
                XCTAssertEqual(request.value(forHTTPHeaderField: "x-mediflow-paired-client-token"), "paired-token-1")
                return (response, Data(#"{"success":true}"#.utf8))
            case ("PUT", "/api/auth/profile"):
                XCTAssertEqual(request.value(forHTTPHeaderField: "Cookie"), self.cookie)
                XCTAssertEqual(request.value(forHTTPHeaderField: "x-mediflow-paired-client-id"), "paired-client-1")
                XCTAssertEqual(request.value(forHTTPHeaderField: "x-mediflow-paired-client-token"), "paired-token-1")
                let payload = try self.requestObject(request)
                XCTAssertEqual(payload["id"] as? String, "user-1")
                XCTAssertEqual(payload["displayName"] as? String, "Dott.ssa Ada")
                XCTAssertEqual(payload["ambulatoryName"] as? String, "Centro Salute")
                return (response, Data(#"{"success":true}"#.utf8))
            case ("POST", "/api/v1/network/ambulatories"):
                let payload = try self.requestObject(request)
                XCTAssertEqual(payload["id"] as? String, "amb-new")
                XCTAssertEqual(payload["name"] as? String, "Sede Nuova")
                XCTAssertEqual(payload["type"] as? String, "test")
                XCTAssertEqual(payload["isDefault"] as? Bool, false)
                return (response, Data(#"{"success":true,"id":"amb-new","version":1,"affectedAmbulatories":[{"id":"amb-new","version":1}]}"#.utf8))
            case ("PUT", "/api/v1/network/ambulatories/amb-new"):
                let payload = try self.requestObject(request)
                XCTAssertEqual(payload["version"] as? Int, 1)
                XCTAssertEqual(payload["name"] as? String, "Sede Aggiornata")
                XCTAssertTrue(payload.keys.contains("description"))
                XCTAssertEqual(payload["description"] as? NSNull, NSNull())
                return (response, Data(#"{"success":true,"version":2,"affectedAmbulatories":[{"id":"amb-old","version":4},{"id":"amb-new","version":2}]}"#.utf8))
            case ("DELETE", "/api/v1/network/ambulatories/amb-new"):
                XCTAssertEqual(try self.requestObject(request)["version"] as? Int, 2)
                return (response, Data(#"{"success":true,"affectedAmbulatories":[{"id":"amb-old","version":5}]}"#.utf8))
            case ("POST", "/api/v1/network/ambulatories/clear"):
                let payload = try self.requestObject(request)
                XCTAssertEqual(payload["ambulatoryId"] as? String, "amb-test")
                XCTAssertEqual(payload["version"] as? Int, 7)
                return (response, Data(#"{"success":true,"version":8,"clearedPatients":3,"preservedLivePatients":1,"removedMembershipRows":4}"#.utf8))
            case ("GET", "/api/v1/network/checkups"):
                return (response, Data(#"[]"#.utf8))
            case ("GET", "/api/v1/network/entries"):
                return (response, Data(#"[]"#.utf8))
            case ("GET", "/api/v1/network/patients"):
                return (response, Data(#"[]"#.utf8))
            case ("GET", "/api/v1/network/service-prescriptions"):
                return (response, Data(#"[]"#.utf8))
            case ("POST", "/api/v1/network/service-prescriptions"):
                return (response, Data(#"{"id":"sp-1","version":1}"#.utf8))
            case ("PUT", "/api/v1/network/service-prescriptions/sp-1"):
                return (response, Data(#"{"success":true}"#.utf8))
            case ("GET", "/api/v1/network/service-prescription-items"):
                return (response, Data(#"[]"#.utf8))
            case ("POST", "/api/v1/network/service-prescription-items"):
                return (response, Data(#"{"id":"spi-1","version":1}"#.utf8))
            case ("PUT", "/api/v1/network/service-prescription-items/spi-1"):
                return (response, Data(#"{"success":true}"#.utf8))
            case ("GET", "/api/v1/network/service-catalog") where url.query == "count=1":
                return (response, Data(#"{"count":1}"#.utf8))
            case ("GET", "/api/v1/network/service-catalog"):
                return (response, Data(#"[]"#.utf8))
            case ("GET", "/api/v1/network/prosthetic-prescriptions"):
                return (response, Data(#"[]"#.utf8))
            case ("POST", "/api/v1/network/prosthetic-prescriptions"):
                return (response, Data(#"{"id":"pp-1","version":1}"#.utf8))
            case ("PUT", "/api/v1/network/prosthetic-prescriptions/pp-1"):
                return (response, Data(#"{"success":true}"#.utf8))
            case ("GET", "/api/v1/network/patients/patient-1/attachments"):
                XCTAssertEqual(request.value(forHTTPHeaderField: "x-mediflow-paired-client-id"), "paired-client-1")
                XCTAssertEqual(request.value(forHTTPHeaderField: "x-mediflow-paired-client-token"), "paired-token-1")
                XCTAssertEqual(request.value(forHTTPHeaderField: "Cookie"), self.cookie)
                XCTAssertEqual(request.value(forHTTPHeaderField: "X-MediFlow-Source-Surface"), "native")
                return (response, Data(#"[{"id":"attachment-1","patientId":"patient-1","name":"ENC:name:value","type":"application/pdf","size":3,"path":"ENC:path:value","summarySnapshot":null,"parseEvidenceArtifactSnapshot":null,"ocrQueueState":"pending","ocrQueueReason":"paired_upload","ocrQueueUpdatedAt":"2026-07-10T10:11:12.123Z","ocrReplayArtifactSnapshot":null,"createdAt":"2026-07-10T10:11:13.456Z"}]"#.utf8))
            case ("GET", "/api/v1/network/patients/patient-1/attachments/attachment-1"):
                XCTAssertEqual(request.value(forHTTPHeaderField: "x-mediflow-paired-client-id"), "paired-client-1")
                XCTAssertEqual(request.value(forHTTPHeaderField: "x-mediflow-paired-client-token"), "paired-token-1")
                XCTAssertEqual(request.value(forHTTPHeaderField: "Cookie"), self.cookie)
                XCTAssertEqual(request.value(forHTTPHeaderField: "X-MediFlow-Source-Surface"), "native")
                return (response, Data(#"{"id":"attachment-1","patientId":"patient-1","name":"ENC:name:value","type":"application/pdf","size":3,"path":"ENC:path:value","summarySnapshot":null,"parseEvidenceArtifactSnapshot":null,"ocrQueueState":"pending","ocrQueueReason":"paired_upload","ocrQueueUpdatedAt":"2026-07-10T10:11:12.123Z","ocrReplayArtifactSnapshot":null,"createdAt":"2026-07-10T10:11:13.456Z","data":"ENC:data:value"}"#.utf8))
            case ("POST", "/api/v1/network/patients/patient-1/attachments"):
                XCTAssertEqual(request.value(forHTTPHeaderField: "x-mediflow-paired-client-id"), "paired-client-1")
                XCTAssertEqual(request.value(forHTTPHeaderField: "x-mediflow-paired-client-token"), "paired-token-1")
                XCTAssertEqual(request.value(forHTTPHeaderField: "Cookie"), self.cookie)
                XCTAssertEqual(request.value(forHTTPHeaderField: "X-MediFlow-Source-Surface"), "native")
                XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
                return (response, Data(#"{"id":"attachment-2"}"#.utf8))
            case ("POST", "/api/v1/network/visit-draft"):
                XCTAssertEqual(request.value(forHTTPHeaderField: "x-mediflow-paired-client-id"), "paired-client-1")
                XCTAssertEqual(request.value(forHTTPHeaderField: "x-mediflow-paired-client-token"), "paired-token-1")
                XCTAssertEqual(request.value(forHTTPHeaderField: "Cookie"), self.cookie)
                XCTAssertEqual(request.value(forHTTPHeaderField: "X-MediFlow-Source-Surface"), "native")
                XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
                let payload = try self.requestObject(request)
                XCTAssertEqual(payload["transcript"] as? String, "S: quadro stabile")
                XCTAssertFalse(payload.keys.contains("patientId"))
                return (response, Data(#"{"schemaVersion":"mediflow.visit_transcript_draft.v1","draftText":"S: quadro stabile","sections":{"subjective":["quadro stabile"],"objective":[],"assessment":[],"plan":[]},"medications":[],"session":{"state":"stopped","eventCount":0,"pauseCount":0,"resumeCount":0,"recordedMs":0,"pausedMs":0,"warnings":[]},"safety":{"reviewRequired":true,"forbiddenAutoWriteCount":0,"rawAudioPersisted":false,"writesPerformed":[]}}"#.utf8))
            case ("GET", "/api/v1/network/ai-runtime"):
                XCTAssertEqual(request.value(forHTTPHeaderField: "x-mediflow-paired-client-id"), "paired-client-1")
                XCTAssertEqual(request.value(forHTTPHeaderField: "x-mediflow-paired-client-token"), "paired-token-1")
                XCTAssertEqual(request.value(forHTTPHeaderField: "Cookie"), self.cookie)
                XCTAssertEqual(request.value(forHTTPHeaderField: "X-MediFlow-Source-Surface"), "native")
                return (response, Data(#"{"plane":"ai-plane-separate-from-data-plane","mode":"centralized-available","localRuntime":{"provider":"ollama","state":"configured","targetPolicy":"loopback-only","hardwareProfile":"high","clinicalModel":null,"reasoningModel":null,"ocrModel":null},"centralRuntime":{"state":"available","capabilityStatus":"available","requiresPairing":true,"executionTarget":"paired-home-base","accessMode":"status-only","executionAuthorized":false},"fabric":{"schemaVersion":"mediflow.ai.network-fabric-status.v1","contractVersion":"mediflow.ai.fabric.v1","access":"status_only","pairedExecution":"not_authorized","egressGateOpen":false,"readinessNote":"available_unqualified","fallback":"denied_by_contract","venues":{"local_process":"configured","home_base":"host_configured","on_device":"not_implemented","cloud":"egress_profile_closed"}},"fallbackPolicy":"ai-unavailable-no-automatic-fallback","rolloutGate":"lane-benchmarks-and-rollout-governance-required","surfaces":["patient-insight","smart-import","document-synthesis","treatment-reasoning"],"killSwitches":{"patientInsight":"enabled","documentSynthesis":"disabled","smartImport":"enabled","treatmentReasoning":"disabled"},"guardrails":[]}"#.utf8))
            case ("GET", "/api/v1/network/capabilities"):
                return (response, Data(#"{"nodeId":"node-1","operatingMode":"network-home-base","protocolVersion":"1","capabilities":[]}"#.utf8))
            case ("GET", "/api/v1/network/identity"):
                return (response, Data(#"{"identityModel":"paired-device-plus-node-credentials","pairingBoundary":"device-pairing-separate-from-operator-login","credentialState":"session-bound","loginMode":"single-local-user-default","usernameHint":null,"displayNameHint":null,"operator":{"userId":"u1","username":"doctor","displayName":"Doctor","role":"admin","authChannel":"web"},"scope":{"policy":"session-context-else-node-default","effectiveAmbulatoryId":"amb-1","effectiveAmbulatoryName":"Centro","defaultAmbulatoryId":"amb-1","defaultAmbulatoryName":"Centro","source":"session-context"},"audit":{"actorType":"user","actorBinding":"session-user"},"limitations":[]}"#.utf8))
            case ("GET", "/api/v1/network/node"):
                return (response, Data(#"{"nodeId":"node-1","displayName":"Mac","role":"home-base-candidate","operatingMode":"network-home-base","protocolVersion":"1","transport":{"apiBasePath":"/api/v1","tlsRequired":true,"localTlsPort":3443}}"#.utf8))
            case ("GET", "/api/v1/network/revision"):
                return (response, Data(#"{"revision":"rev-1","sourceFingerprint":"src-1","fingerprint":"fp-1"}"#.utf8))
            case ("GET", "/api/v1/network/fse/validate-patient"):
                return (response, Data(#"{"patientId":"patient-1","hasErrors":false,"hasWarnings":false,"therapyMedication":{"total":0,"ok":0,"withErrors":0,"withWarnings":0,"errorCount":0,"warningCount":0,"items":[]},"observationVitals":{"total":0,"ok":0,"withErrors":0,"withWarnings":0,"errorCount":0,"warningCount":0,"items":[]}}"#.utf8))
            case ("POST", "/api/v1/network/fse/validate-document"):
                return (response, Data(#"{"ok":true,"profile":"FSE_TEST","errors":[],"warnings":[]}"#.utf8))
            default:
                XCTFail("Unexpected request \(method) \(url.absoluteString)")
                return (response, Data(#"{}"#.utf8))
            }
        }
        let source: any HomeBasePatientsDataSource = client
        let attachmentPayload = try ClinicalFieldCrypto.sealAttachmentCreatePayload(
            name: "referto.pdf",
            path: "uploads/referto.pdf",
            data: Data("PDF".utf8).base64EncodedString(),
            type: "application/pdf",
            size: 3,
            masterKey: SymmetricKey(data: Data(repeating: 6, count: 32))
        )

        _ = try await source.changePin(currentPin: "1357", newPin: "2468", encryptedMasterKey: "v2:wrapped", salt: "AAECAwQFBgcICQoLDA0ODw==", credentials: creds, sessionCookie: cookie)
        _ = try await source.logout(credentials: creds, sessionCookie: cookie)
        _ = try await source.updateProfile(userId: "user-1", displayName: "Dott.ssa Ada", ambulatoryName: "Centro Salute", credentials: creds, sessionCookie: cookie)
        _ = try await source.createAmbulatory(payload: HomeBaseAmbulatoryCreatePayload(id: "amb-new", name: "Sede Nuova", type: "test"), credentials: creds, sessionCookie: cookie)
        _ = try await source.updateAmbulatory(id: "amb-new", payload: HomeBaseAmbulatoryUpdatePayload(expectedVersion: 1, name: "Sede Aggiornata", description: .null), credentials: creds, sessionCookie: cookie)
        _ = try await source.deleteAmbulatory(id: "amb-new", expectedVersion: 2, credentials: creds, sessionCookie: cookie)
        _ = try await source.clearAmbulatory(id: "amb-test", expectedVersion: 7, credentials: creds, sessionCookie: cookie)
        _ = try await source.fetchScopedCheckups(dateFrom: fixtureDate, dateTo: fixtureDate, status: ["pending", "completed"], limit: 500, credentials: creds, sessionCookie: cookie, ambulatoryId: nil)
        _ = try await source.fetchScopedEntries(type: "note", dateFrom: fixtureDate, dateTo: fixtureDate, limit: 100, credentials: creds, sessionCookie: cookie, ambulatoryId: nil)
        _ = try await source.fetchPatients(credentials: creds, sessionCookie: cookie, ambulatoryId: nil, includeDiagnoses: true)
        _ = try await source.fetchServicePrescriptions(patientId: "patient-1", credentials: creds, sessionCookie: cookie, ambulatoryId: nil)
        _ = try await source.createServicePrescription(payload: HomeBaseServicePrescriptionCreatePayload(patientId: "patient-1", prescribedAt: fixtureDate, serviceName: "Visita"), credentials: creds, sessionCookie: cookie, ambulatoryId: nil)
        _ = try await source.updateServicePrescription(prescriptionId: "sp-1", payload: HomeBaseServicePrescriptionUpdatePayload(version: 1, status: "booked"), credentials: creds, sessionCookie: cookie, ambulatoryId: nil)
        _ = try await source.fetchServicePrescriptionItems(patientId: "patient-1", prescriptionId: "sp-1", credentials: creds, sessionCookie: cookie, ambulatoryId: nil)
        _ = try await source.createServicePrescriptionItem(payload: HomeBaseServicePrescriptionItemCreatePayload(prescriptionId: "sp-1", serviceName: "LDL"), credentials: creds, sessionCookie: cookie, ambulatoryId: nil)
        _ = try await source.updateServicePrescriptionItem(itemId: "spi-1", payload: HomeBaseServicePrescriptionItemUpdatePayload(version: 1, matchStatus: "matched"), credentials: creds, sessionCookie: cookie, ambulatoryId: nil)
        _ = try await source.fetchServiceCatalog(query: "ldl", code: "90.13.B", limit: 10, credentials: creds, sessionCookie: cookie, ambulatoryId: nil)
        _ = try await source.fetchServiceCatalogCount(credentials: creds, sessionCookie: cookie, ambulatoryId: nil)
        _ = try await source.fetchProstheticPrescriptions(patientId: "patient-1", credentials: creds, sessionCookie: cookie, ambulatoryId: nil)
        _ = try await source.createProstheticPrescription(payload: HomeBaseProstheticPrescriptionCreatePayload(patientId: "patient-1", prescribedAt: fixtureDate, description: "Ausilio"), credentials: creds, sessionCookie: cookie, ambulatoryId: nil)
        _ = try await source.updateProstheticPrescription(prescriptionId: "pp-1", payload: HomeBaseProstheticPrescriptionUpdatePayload(version: 1, status: "tested"), credentials: creds, sessionCookie: cookie, ambulatoryId: nil)
        let attachments = try await source.fetchAttachments(patientId: "patient-1", credentials: creds, sessionCookie: cookie, ambulatoryId: nil)
        let attachment = try await source.fetchAttachment(patientId: "patient-1", attachmentId: "attachment-1", credentials: creds, sessionCookie: cookie, ambulatoryId: nil)
        _ = try await source.createAttachment(patientId: "patient-1", payload: attachmentPayload, credentials: creds, sessionCookie: cookie, ambulatoryId: nil)
        let draft = try await source.computeVisitDraft(input: HomeBaseVisitDraftInput(transcript: "S: quadro stabile"), credentials: creds, sessionCookie: cookie, ambulatoryId: nil)
        let aiRuntime = try await source.fetchAiRuntimeStatus(credentials: creds, sessionCookie: cookie, ambulatoryId: nil)
        _ = try await source.fetchNetworkCapabilities(credentials: creds, sessionCookie: cookie, ambulatoryId: nil)
        _ = try await source.fetchNetworkIdentity(credentials: creds, sessionCookie: cookie, ambulatoryId: nil)
        _ = try await source.fetchNetworkNode(credentials: creds, sessionCookie: cookie, ambulatoryId: nil)
        _ = try await source.fetchNetworkRevision(credentials: creds, sessionCookie: cookie, ambulatoryId: nil)
        _ = try await source.fetchFseValidatePatient(patientId: "patient-1", credentials: creds, sessionCookie: cookie, ambulatoryId: nil)
        _ = try await source.validateFseDocument(payload: HomeBaseFseDocumentValidationPayload(profile: "FSE_TEST", payload: .object(["id": .string("doc-1")])), credentials: creds, sessionCookie: cookie, ambulatoryId: nil)

        XCTAssertNotNil(attachments.first?.createdAt)
        XCTAssertEqual(attachment.data, "ENC:data:value")
        XCTAssertEqual(draft.safety.writesPerformed, [])
        XCTAssertEqual(aiRuntime.killSwitches.treatmentReasoning, .disabled)
        XCTAssertTrue(aiRuntime.surfaces.contains("treatment-reasoning"))
        XCTAssertEqual(aiRuntime.centralRuntime.accessMode, "status-only")
        XCTAssertFalse(aiRuntime.centralRuntime.executionAuthorized)
        XCTAssertEqual(aiRuntime.fabric.access, "status_only")
        XCTAssertEqual(aiRuntime.fabric.pairedExecution, "not_authorized")
        XCTAssertFalse(aiRuntime.fabric.egressGateOpen)
        XCTAssertEqual(aiRuntime.fabric.readinessNote, "available_unqualified")
        XCTAssertEqual(aiRuntime.fabric.fallback, "denied_by_contract")
        XCTAssertEqual(aiRuntime.fabric.venues.localProcess, "configured")
        XCTAssertEqual(aiRuntime.fabric.venues.homeBase, "host_configured")
        XCTAssertEqual(aiRuntime.fabric.venues.onDevice, "not_implemented")
        XCTAssertEqual(aiRuntime.fabric.venues.cloud, "egress_profile_closed")
        XCTAssertEqual(aiRuntime.fallbackPolicy, "ai-unavailable-no-automatic-fallback")

        XCTAssertEqual(requests, [
            "POST https://localhost:3443/api/auth/change-pin",
            "POST https://localhost:3443/api/auth/logout",
            "PUT https://localhost:3443/api/auth/profile",
            "POST https://localhost:3443/api/v1/network/ambulatories",
            "PUT https://localhost:3443/api/v1/network/ambulatories/amb-new",
            "DELETE https://localhost:3443/api/v1/network/ambulatories/amb-new",
            "POST https://localhost:3443/api/v1/network/ambulatories/clear",
            "GET https://localhost:3443/api/v1/network/checkups?dateFrom=2025-07-08T08:00:00Z&dateTo=2025-07-08T08:00:00Z&status=pending&status=completed&limit=500",
            "GET https://localhost:3443/api/v1/network/entries?type=note&dateFrom=2025-07-08T08:00:00Z&dateTo=2025-07-08T08:00:00Z&limit=100",
            "GET https://localhost:3443/api/v1/network/patients?include=diagnoses",
            "GET https://localhost:3443/api/v1/network/service-prescriptions?patientId=patient-1",
            "POST https://localhost:3443/api/v1/network/service-prescriptions",
            "PUT https://localhost:3443/api/v1/network/service-prescriptions/sp-1",
            "GET https://localhost:3443/api/v1/network/service-prescription-items?prescriptionId=sp-1&patientId=patient-1",
            "POST https://localhost:3443/api/v1/network/service-prescription-items",
            "PUT https://localhost:3443/api/v1/network/service-prescription-items/spi-1",
            "GET https://localhost:3443/api/v1/network/service-catalog?limit=10&q=ldl&code=90.13.B",
            "GET https://localhost:3443/api/v1/network/service-catalog?count=1",
            "GET https://localhost:3443/api/v1/network/prosthetic-prescriptions?patientId=patient-1",
            "POST https://localhost:3443/api/v1/network/prosthetic-prescriptions",
            "PUT https://localhost:3443/api/v1/network/prosthetic-prescriptions/pp-1",
            "GET https://localhost:3443/api/v1/network/patients/patient-1/attachments",
            "GET https://localhost:3443/api/v1/network/patients/patient-1/attachments/attachment-1",
            "POST https://localhost:3443/api/v1/network/patients/patient-1/attachments",
            "POST https://localhost:3443/api/v1/network/visit-draft",
            "GET https://localhost:3443/api/v1/network/ai-runtime",
            "GET https://localhost:3443/api/v1/network/capabilities",
            "GET https://localhost:3443/api/v1/network/identity",
            "GET https://localhost:3443/api/v1/network/node",
            "GET https://localhost:3443/api/v1/network/revision",
            "GET https://localhost:3443/api/v1/network/fse/validate-patient?patientId=patient-1",
            "POST https://localhost:3443/api/v1/network/fse/validate-document",
        ])
    }

    private var creds: HomeBasePairedCredentials {
        HomeBasePairedCredentials(clientId: "paired-client-1", clientToken: "paired-token-1")
    }

    private var cookie: String { "mediflow_session=session-123" }

    private var fixtureDate: Date { Date(timeIntervalSince1970: 1_751_961_600) }

    private func assertLogoutRequest(_ request: URLRequest) {
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.url?.absoluteString, "https://localhost:3443/api/auth/logout")
        XCTAssertEqual(request.value(forHTTPHeaderField: "X-MediFlow-Source-Surface"), "native")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Cookie"), cookie)
        XCTAssertEqual(request.value(forHTTPHeaderField: "x-mediflow-paired-client-id"), "paired-client-1")
        XCTAssertEqual(request.value(forHTTPHeaderField: "x-mediflow-paired-client-token"), "paired-token-1")
        XCTAssertNil(request.value(forHTTPHeaderField: "Content-Type"))
        XCTAssertNil(request.httpBody)
        XCTAssertNil(request.httpBodyStream)
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

    private func requestObject(_ request: URLRequest) throws -> [String: Any] {
        let body = try readRequestBody(from: request)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
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
