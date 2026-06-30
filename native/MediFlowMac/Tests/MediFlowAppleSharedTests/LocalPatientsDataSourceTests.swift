import XCTest
import CryptoKit
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

    func testFetchPatientDecryptsLocally() async throws {
        let detail = try await makeSource().fetchPatient(
            id: "fixture-1", credentials: credentials, sessionCookie: "", ambulatoryId: "AMB-1")
        XCTAssertEqual(detail.firstName, "Mario")
        XCTAssertEqual(detail.address, "Via Roma 1, Milano")  // decrypted in-core, no HTTP
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

    // MARK: Local writes (Fase 3 slice 3) — on a writable fixture copy

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
        XCTAssertEqual(detail.address, "Via Nuova 5")
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
