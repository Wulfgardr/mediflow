import CryptoKit
import Foundation
import XCTest
@testable import MediFlowAppleShared

/// ADR 0071 Fase 3: the in-process local-authority adapter serves patient list/detail
/// from the on-device medical.db. These tests point it at the committed core fixture
/// (read-only) with the golden-vector master key; the HTTP fallback is a client at a
/// dead URL that the local-read paths must never invoke.
final class LocalPatientsDataSourceTests: XCTestCase {

    private let masterKey = SymmetricKey(
        data: Data(hexString: "404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f"))
    private let credentials = HomeBasePairedCredentials(clientId: "c", clientToken: "t")

    /// The core test target's fixture db (sibling Tests directory).
    private func fixturePath() -> String {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()   // MediFlowAppleSharedTests
            .deletingLastPathComponent()   // Tests
            .appendingPathComponent("MediFlowCoreTests/Fixtures/medical_fixture.db")
            .path
    }

    private func makeSource() -> LocalPatientsDataSource {
        // A real HTTP client at a dead URL as the fallback: the local-read paths must
        // never reach it, so the bogus host is harmless.
        let fallback = HomeBasePatientsClient(
            configuration: HomeBaseConnectionConfiguration(serverURLString: "https://127.0.0.1:1", tlsPin: ""))
        return LocalPatientsDataSource(databasePath: fixturePath(), masterKey: masterKey, fallback: fallback)
    }

    func testFetchPatientsServedLocallyAndScoped() async throws {
        let source = makeSource()
        let inScope = try await source.fetchPatients(credentials: credentials, sessionCookie: "", ambulatoryId: "AMB-1")
        XCTAssertEqual(inScope.map(\.id), ["fixture-1"])
        let outOfScope = try await source.fetchPatients(credentials: credentials, sessionCookie: "", ambulatoryId: "AMB-OTHER")
        XCTAssertTrue(outOfScope.isEmpty)
    }

    /* @Codex */
    func testFetchPatientPreservesRawEncryptedFieldsForModelParity() async throws {
        let detail = try await makeSource().fetchPatient(
            id: "fixture-1", credentials: credentials, sessionCookie: "", ambulatoryId: "AMB-1")
        XCTAssertEqual(detail.firstName, "Mario")
        /* @Codex */
        XCTAssertTrue(detail.address?.hasPrefix(CryptoService.encPrefix) == true)
        XCTAssertEqual(PatientFieldCrypto.decryptStringField(detail.address, masterKey: masterKey), "Via Roma 1, Milano")
    }

    /* @Codex */
    func testNewDataPlaneMethodsDelegateToHTTPFallback() async throws {
        let source = makeSource()

        do {
            _ = try await source.fetchPatients(
                credentials: credentials, sessionCookie: "", ambulatoryId: nil, includeDiagnoses: true)
            XCTFail("expected the HTTP fallback to be used")
        } catch let HomeBaseClientError.transport(issue) {
            XCTAssertEqual(issue, .unreachable)
        }

        do {
            _ = try await source.fetchScopedCheckups(
                dateFrom: nil, dateTo: nil, status: [], limit: nil,
                credentials: credentials, sessionCookie: "", ambulatoryId: nil)
            XCTFail("expected the HTTP fallback to be used")
        } catch let HomeBaseClientError.transport(issue) {
            XCTAssertEqual(issue, .unreachable)
        }

        do {
            _ = try await source.fetchScopedEntries(
                type: nil, dateFrom: nil, dateTo: nil, limit: nil,
                credentials: credentials, sessionCookie: "", ambulatoryId: nil)
            XCTFail("expected the HTTP fallback to be used")
        } catch let HomeBaseClientError.transport(issue) {
            XCTAssertEqual(issue, .unreachable)
        }
    }

    func testAccountOperationsForwardThroughHTTPFallback() async throws {
        var requests: [String] = []
        LocalAccountURLProtocol.requestHandler = { request in
            let url = try XCTUnwrap(request.url)
            requests.append("\(request.httpMethod ?? "GET") \(url.path)")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Cookie"), "mediflow_session=test")
            let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil)!
            return (response, Data(#"{"success":true}"#.utf8))
        }
        defer { LocalAccountURLProtocol.requestHandler = nil }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [LocalAccountURLProtocol.self]
        let client = HomeBasePatientsClient(
            configuration: HomeBaseConnectionConfiguration(serverURLString: "https://localhost:3443"),
            session: URLSession(configuration: configuration)
        )
        let source = LocalPatientsDataSource(
            databasePath: fixturePath(), masterKey: masterKey, fallback: client)

        _ = try await source.changePin(
            currentPin: "1357", newPin: "2468", encryptedMasterKey: "v2:wrapped",
            salt: "AAECAwQFBgcICQoLDA0ODw==", credentials: credentials,
            sessionCookie: "mediflow_session=test")
        _ = try await source.updateProfile(
            userId: "user-1", displayName: "Ada", ambulatoryName: "Centro",
            credentials: credentials, sessionCookie: "mediflow_session=test")
        _ = try await source.logout(
            credentials: credentials, sessionCookie: "mediflow_session=test")

        XCTAssertEqual(requests, [
            "POST /api/auth/change-pin",
            "PUT /api/auth/profile",
            "POST /api/auth/logout",
        ])
    }

    func testAmbulatoryWritesFailHonestlyInLocalAuthorityMode() async throws {
        let source = makeSource()

        do {
            _ = try await source.createAmbulatory(
                payload: HomeBaseAmbulatoryCreatePayload(name: "Sede"),
                credentials: credentials, sessionCookie: "sid=test")
            XCTFail("Expected local-authority rejection")
        } catch let error as HomeBaseClientError {
            XCTAssertEqual(error, .localAuthorityUnsupported("Creazione ambulatorio"))
        }

        do {
            _ = try await source.updateAmbulatory(
                id: "amb-1", payload: HomeBaseAmbulatoryUpdatePayload(expectedVersion: 1, name: "Sede"),
                credentials: credentials, sessionCookie: "sid=test")
            XCTFail("Expected local-authority rejection")
        } catch let error as HomeBaseClientError {
            XCTAssertEqual(error, .localAuthorityUnsupported("Aggiornamento ambulatorio"))
        }

        do {
            _ = try await source.deleteAmbulatory(
                id: "amb-1", expectedVersion: 1,
                credentials: credentials, sessionCookie: "sid=test")
            XCTFail("Expected local-authority rejection")
        } catch let error as HomeBaseClientError {
            XCTAssertEqual(error, .localAuthorityUnsupported("Eliminazione ambulatorio"))
        }

        do {
            _ = try await source.clearAmbulatory(
                id: "amb-test", expectedVersion: 1,
                credentials: credentials, sessionCookie: "sid=test")
            XCTFail("Expected local-authority rejection")
        } catch let error as HomeBaseClientError {
            XCTAssertEqual(error, .localAuthorityUnsupported("Pulizia ambulatorio"))
        }
    }

    // MARK: Local clinical reads (Fase 3 slice 4) - read-only against the committed
    // fixture, which ships one pre-seeded row per sub-resource (fixture-entry-1 etc.)

    func testFetchEntriesServedLocallyAndDecrypted() async throws {
        let entries = try await makeSource().fetchEntries(
            patientId: "fixture-1", credentials: credentials, sessionCookie: "", ambulatoryId: "AMB-1", limit: 20)
        XCTAssertEqual(entries.map(\.id), ["fixture-entry-1"])
        XCTAssertEqual(entries.first?.content, "Paziente stabile, nessuna variazione terapeutica.")
    }

    func testFetchTherapiesServedLocallyAndDecrypted() async throws {
        let therapies = try await makeSource().fetchTherapies(
            patientId: "fixture-1", credentials: credentials, sessionCookie: "", ambulatoryId: "AMB-1", limit: 20)
        XCTAssertEqual(therapies.map(\.id), ["fixture-therapy-1"])
        XCTAssertEqual(therapies.first?.motivation, "Diabete tipo 2")
    }

    func testFetchCheckupsServedLocallyAndDecrypted() async throws {
        let checkups = try await makeSource().fetchCheckups(
            patientId: "fixture-1", credentials: credentials, sessionCookie: "", ambulatoryId: "AMB-1", limit: 20)
        XCTAssertEqual(checkups.map(\.id), ["fixture-checkup-1"])
        XCTAssertEqual(checkups.first?.notes, "Valori nella norma")
    }

    func testFetchObservationsServedLocallyAndDecrypted() async throws {
        let observations = try await makeSource().fetchObservations(
            patientId: "fixture-1", credentials: credentials, sessionCookie: "", ambulatoryId: "AMB-1", limit: 20)
        XCTAssertEqual(observations.map(\.id), ["fixture-observation-1"])
        XCTAssertEqual(observations.first?.notes, "Buon controllo glicemico")
        XCTAssertEqual(observations.first?.value, "6.8")
    }

    func testFetchEntriesOutOfScopeIsEmpty() async throws {
        let entries = try await makeSource().fetchEntries(
            patientId: "fixture-1", credentials: credentials, sessionCookie: "", ambulatoryId: "AMB-OTHER", limit: 20)
        XCTAssertTrue(entries.isEmpty)
    }

    func testFetchPatientMissingMaps404() async throws {
        do {
            _ = try await makeSource().fetchPatient(
                id: "does-not-exist", credentials: credentials, sessionCookie: "", ambulatoryId: "AMB-1")
            XCTFail("expected a 404")
        } catch let HomeBaseClientError.httpStatus(code, _) {
            XCTAssertEqual(code, 404)
        }
    }

    func testFetchPatientOutOfScopeMaps404() async throws {
        do {
            // fixture-1 exists but is not a member of AMB-OTHER -> membership scope 404.
            _ = try await makeSource().fetchPatient(
                id: "fixture-1", credentials: credentials, sessionCookie: "", ambulatoryId: "AMB-OTHER")
            XCTFail("expected a 404")
        } catch let HomeBaseClientError.httpStatus(code, _) {
            XCTAssertEqual(code, 404)
        }
    }

    // MARK: Local writes (Fase 3 slice 3) - on a writable fixture copy

    private func writableFixtureCopy() throws -> String {
        let destination = NSTemporaryDirectory() + "mediflow-localds-\(UUID().uuidString).db"
        try? FileManager.default.removeItem(atPath: destination)
        try FileManager.default.copyItem(atPath: fixturePath(), toPath: destination)
        return destination
    }

    private func writableSource(_ path: String) -> LocalPatientsDataSource {
        let fallback = HomeBasePatientsClient(
            configuration: HomeBaseConnectionConfiguration(serverURLString: "https://127.0.0.1:1", tlsPin: ""))
        return LocalPatientsDataSource(databasePath: path, masterKey: masterKey, fallback: fallback)
    }

    func testUpdatePatientWritesLocally() async throws {
        let path = try writableFixtureCopy()
        defer { try? FileManager.default.removeItem(atPath: path) }
        let source = writableSource(path)

        // Pre-seal like the model does for the HTTP path; the store passes it through.
        guard case .sealed(let presealed?) = CryptoService.seal("Via Nuova 5", masterKey: masterKey) else {
            return XCTFail("seal failed")
        }
        let ack = try await source.updatePatient(
            patientId: "fixture-1", payload: HomeBasePatientUpdatePayload(version: 1, address: .value(presealed)),
            credentials: credentials, sessionCookie: "", ambulatoryId: "AMB-1")
        XCTAssertTrue(ack.success)

        // Persisted locally + decrypts to the plaintext (no double-encryption).
        let detail = try await source.fetchPatient(
            id: "fixture-1", credentials: credentials, sessionCookie: "", ambulatoryId: "AMB-1")
        /* @Codex */
        XCTAssertTrue(detail.address?.hasPrefix(CryptoService.encPrefix) == true)
        XCTAssertEqual(PatientFieldCrypto.decryptStringField(detail.address, masterKey: masterKey), "Via Nuova 5")
        XCTAssertEqual(detail.version, 2)
    }

    func testUpdatePatientVersionConflictThrows() async throws {
        let path = try writableFixtureCopy()
        defer { try? FileManager.default.removeItem(atPath: path) }
        let source = writableSource(path)
        do {
            _ = try await source.updatePatient(
                patientId: "fixture-1", payload: HomeBasePatientUpdatePayload(version: 99, firstName: "Stale"),
                credentials: credentials, sessionCookie: "", ambulatoryId: "AMB-1")
            XCTFail("expected a version conflict")
        } catch let HomeBaseClientError.versionConflict(payload) {
            XCTAssertEqual(payload.currentVersion, 1)
            XCTAssertEqual(payload.entity, "patient")
        }
    }

    // MARK: Local patient CREATE (ADR 0071 - only real create path)

    func testCreatePatientWritesLocally() async throws {
        let path = try writableFixtureCopy()
        defer { try? FileManager.default.removeItem(atPath: path) }
        let source = writableSource(path)

        // Plaintext payload; the store seals the ENCRYPTED_FIELDS in-core on create.
        let created = try await source.createPatient(
            payload: HomeBasePatientCreatePayload(
                firstName: "Nuovo", lastName: "Paziente", taxCode: "NVOPZT80A01H501Z", address: "Via Test 1"),
            credentials: credentials, sessionCookie: "", ambulatoryId: "AMB-1")
        XCTAssertFalse(created.id.isEmpty)
        XCTAssertEqual(created.version, 1)

        // Appears in the AMB-1 scoped list (membership upserted) and its encrypted
        // address round-trips to plaintext (seal-on-create works, no double-encryption).
        let list = try await source.fetchPatients(credentials: credentials, sessionCookie: "", ambulatoryId: "AMB-1")
        XCTAssertTrue(list.contains { $0.id == created.id && $0.lastName == "Paziente" })
        let detail = try await source.fetchPatient(
            id: created.id, credentials: credentials, sessionCookie: "", ambulatoryId: "AMB-1")
        /* @Codex */
        XCTAssertTrue(detail.address?.hasPrefix(CryptoService.encPrefix) == true)
        XCTAssertEqual(PatientFieldCrypto.decryptStringField(detail.address, masterKey: masterKey), "Via Test 1")
        XCTAssertEqual(detail.taxCode, "NVOPZT80A01H501Z")
    }

    func testCreatePatientWithoutScopeFallsBackToHTTPPeer() async throws {
        let path = try writableFixtureCopy()
        defer { try? FileManager.default.removeItem(atPath: path) }
        let source = writableSource(path)
        do {
            _ = try await source.createPatient(
                payload: HomeBasePatientCreatePayload(firstName: "X", lastName: "Y", taxCode: "T"),
                credentials: credentials, sessionCookie: "", ambulatoryId: nil)
            XCTFail("expected the HTTP fallback to be used")
        } catch let HomeBaseClientError.transport(issue) {
            XCTAssertEqual(issue, .unreachable)
        }
    }

    // MARK: Local clinical writes (Fase 3 slice 5)

    func testCreateEntryWritesLocally() async throws {
        let path = try writableFixtureCopy()
        defer { try? FileManager.default.removeItem(atPath: path) }
        let source = writableSource(path)

        let created = try await source.createEntry(
            patientId: "fixture-1",
            payload: HomeBaseEntryCreatePayload(id: "e-new", type: "note", date: Date(), content: "nuovo"),
            credentials: credentials, sessionCookie: "", ambulatoryId: "AMB-1")
        XCTAssertEqual(created.id, "e-new")
        XCTAssertEqual(created.version, 1)

        let entries = try await source.fetchEntries(
            patientId: "fixture-1", credentials: credentials, sessionCookie: "", ambulatoryId: "AMB-1", limit: 20)
        XCTAssertTrue(entries.contains { $0.id == "e-new" && $0.content == "nuovo" })
    }

    /// Proves the clinical double-encryption fix end to end: a value pre-sealed like
    /// the model does for HTTP passes through the write verbatim, and a SINGLE
    /// decryption on read recovers the plaintext (no double-encryption).
    func testUpdateTherapyPassesThroughPreSealedMotivation() async throws {
        let path = try writableFixtureCopy()
        defer { try? FileManager.default.removeItem(atPath: path) }
        let source = writableSource(path)

        guard case .sealed(let presealed?) = CryptoService.seal("motivazione aggiornata", masterKey: masterKey) else {
            return XCTFail("seal failed")
        }
        let ack = try await source.updateTherapy(
            patientId: "fixture-1", therapyId: "fixture-therapy-1",
            payload: HomeBaseTherapyUpdatePayload(version: 1, motivation: presealed),
            credentials: credentials, sessionCookie: "", ambulatoryId: "AMB-1")
        XCTAssertTrue(ack.success)

        let therapies = try await source.fetchTherapies(
            patientId: "fixture-1", credentials: credentials, sessionCookie: "", ambulatoryId: "AMB-1", limit: 20)
        XCTAssertEqual(therapies.first { $0.id == "fixture-therapy-1" }?.motivation, "motivazione aggiornata")
    }

    func testUpdateCheckupVersionConflictThrows() async throws {
        let path = try writableFixtureCopy()
        defer { try? FileManager.default.removeItem(atPath: path) }
        let source = writableSource(path)
        do {
            _ = try await source.updateCheckup(
                patientId: "fixture-1", checkupId: "fixture-checkup-1",
                payload: HomeBaseCheckupUpdatePayload(version: 99, title: "Stale"),
                credentials: credentials, sessionCookie: "", ambulatoryId: "AMB-1")
            XCTFail("expected a version conflict")
        } catch let HomeBaseClientError.versionConflict(payload) {
            XCTAssertEqual(payload.currentVersion, 1)
            XCTAssertEqual(payload.entity, "checkup")
        }
    }

    // The 5 remaining wired methods (adversarial audit, slice 5): each round-trips
    // through the adapter and asserts on the SPECIFIC row id, which would fail
    // (.notFound / wrong row) if id and patientId were ever swapped at the wiring layer.

    func testUpdateEntryWritesLocally() async throws {
        let path = try writableFixtureCopy()
        defer { try? FileManager.default.removeItem(atPath: path) }
        let source = writableSource(path)

        let ack = try await source.updateEntry(
            patientId: "fixture-1", entryId: "fixture-entry-1",
            payload: HomeBaseEntryUpdatePayload(version: 1, content: "aggiornato"),
            credentials: credentials, sessionCookie: "", ambulatoryId: "AMB-1")
        XCTAssertTrue(ack.success)

        let entries = try await source.fetchEntries(
            patientId: "fixture-1", credentials: credentials, sessionCookie: "", ambulatoryId: "AMB-1", limit: 20)
        XCTAssertEqual(entries.first { $0.id == "fixture-entry-1" }?.content, "aggiornato")
    }

    func testCreateTherapyWritesLocally() async throws {
        let path = try writableFixtureCopy()
        defer { try? FileManager.default.removeItem(atPath: path) }
        let source = writableSource(path)

        let created = try await source.createTherapy(
            patientId: "fixture-1",
            payload: HomeBaseTherapyCreatePayload(drugName: "Plavix", dosage: "75mg", status: "active", startDate: Date()),
            credentials: credentials, sessionCookie: "", ambulatoryId: "AMB-1")
        XCTAssertEqual(created.version, 1)

        let therapies = try await source.fetchTherapies(
            patientId: "fixture-1", credentials: credentials, sessionCookie: "", ambulatoryId: "AMB-1", limit: 20)
        XCTAssertTrue(therapies.contains { $0.id == created.id && $0.drugName == "Plavix" })
    }

    func testCreateCheckupWritesLocally() async throws {
        let path = try writableFixtureCopy()
        defer { try? FileManager.default.removeItem(atPath: path) }
        let source = writableSource(path)

        let created = try await source.createCheckup(
            patientId: "fixture-1",
            payload: HomeBaseCheckupCreatePayload(date: Date(), title: "Nuovo controllo", status: "pending"),
            credentials: credentials, sessionCookie: "", ambulatoryId: "AMB-1")
        XCTAssertEqual(created.version, 1)

        let checkups = try await source.fetchCheckups(
            patientId: "fixture-1", credentials: credentials, sessionCookie: "", ambulatoryId: "AMB-1", limit: 20)
        XCTAssertTrue(checkups.contains { $0.id == created.id && $0.title == "Nuovo controllo" })
    }

    func testCreateObservationWritesLocally() async throws {
        let path = try writableFixtureCopy()
        defer { try? FileManager.default.removeItem(atPath: path) }
        let source = writableSource(path)

        let created = try await source.createObservation(
            patientId: "fixture-1",
            payload: HomeBaseObservationCreatePayload(code: "29463-7", display: "Peso", unitCode: "kg",
                                                      value: "70", observedAt: Date()),
            credentials: credentials, sessionCookie: "", ambulatoryId: "AMB-1")
        XCTAssertEqual(created.version, 1)

        let observations = try await source.fetchObservations(
            patientId: "fixture-1", credentials: credentials, sessionCookie: "", ambulatoryId: "AMB-1", limit: 20)
        XCTAssertTrue(observations.contains { $0.id == created.id && $0.value == "70" })
    }

    func testUpdateObservationWritesLocally() async throws {
        let path = try writableFixtureCopy()
        defer { try? FileManager.default.removeItem(atPath: path) }
        let source = writableSource(path)

        let ack = try await source.updateObservation(
            patientId: "fixture-1", observationId: "fixture-observation-1",
            payload: HomeBaseObservationUpdatePayload(version: 1, value: "7.2"),
            credentials: credentials, sessionCookie: "", ambulatoryId: "AMB-1")
        XCTAssertTrue(ack.success)

        let observations = try await source.fetchObservations(
            patientId: "fixture-1", credentials: credentials, sessionCookie: "", ambulatoryId: "AMB-1", limit: 20)
        XCTAssertEqual(observations.first { $0.id == "fixture-observation-1" }?.value, "7.2")
    }
}

private final class LocalAccountURLProtocol: URLProtocol {
    static var requestHandler: ((URLRequest) throws -> (HTTPURLResponse, Data))?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

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

private extension Data {
    init(hexString: String) {
        var data = Data(capacity: hexString.count / 2)
        var index = hexString.startIndex
        while index < hexString.endIndex {
            let next = hexString.index(index, offsetBy: 2)
            data.append(UInt8(hexString[index..<next], radix: 16)!)
            index = next
        }
        self = data
    }
}
