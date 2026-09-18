/* @Codex — fake HTTP transport only. Mac UI/viewmodel tests, no authority/admission claims. */
#if os(macOS)
import Foundation
import XCTest
@testable import MediFlowAppleShared

@MainActor
final class NativeOrdinaryModelTests: XCTestCase {
    typealias F = NativeOrdinaryTestFixtures
    private func source(generation: UInt = 0, fingerprint: String = "synthetic-source-a") -> NativeOrdinarySnapshot {
        let connection = ClinicalWorkspaceConnection(dataSource: S6MockDataSource(details: [:]),
            credentials: HomeBasePairedCredentials(clientId: "synthetic-mac", clientToken: "synthetic-token"),
            sessionCookie: "mediflow_session=synthetic-native", ambulatoryId: "synthetic-ambulatory", masterKey: nil,
            serverURL: "https://localhost", tlsPin: String(repeating: "a", count: 64), sessionGeneration: generation)
        return NativeOrdinarySnapshot(connection: connection, preparation: NativeOrdinaryPreparation(functionId: .patientInsight,
            patientId: "synthetic-patient", ambulatoryId: "synthetic-ambulatory", patientRevision: 1, input: .patientInsight), fingerprint: fingerprint)
    }
    private func response(_ phase: String) throws -> NativeOrdinaryResponse { try F.decode(NativeOrdinaryResponse.self, F.response(.patientInsight, phase)) }
    private func settle(_ model: NativeOrdinaryModel) async {
        for _ in 0..<200 where model.isWorking { await Task.yield() }
    }
    func testExplicitConsentLoginCatalogChoiceGenerateAndNoAutoApply() async throws {
        var commands: [String] = []
        let model = NativeOrdinaryModel(function: .patientInsight, snapshot: { self.source() }, services: .init(
            prepare: { _, _ in try self.response("needs_consent") }, command: { command, _ in
                commands.append(command.path)
                let phases = ["consent": "consented", "login/start": "awaiting_login", "login/complete": "connected", "models": "ready", "generate": "completed", "cancel": "closed"]
                return try self.response(phases[command.path]!)
            }, status: { _ in try self.response("closed") }))
        model.prepare(); await settle(model); XCTAssertEqual(model.phase, .needsConsent); XCTAssertTrue(commands.isEmpty)
        model.generate(); XCTAssertTrue(commands.isEmpty)
        model.consent(); await settle(model); XCTAssertEqual(commands, ["consent"])
        model.startLogin(); await settle(model); model.completeLogin(); await settle(model); model.loadModels(); await settle(model)
        XCTAssertEqual(model.phase, .ready); model.generate(); XCTAssertFalse(commands.contains("generate"))
        model.selectedOptionId = F.option; model.generate(); await settle(model)
        XCTAssertEqual(model.phase, .completed); XCTAssertNotNil(model.proposal)
        XCTAssertEqual(commands, ["consent", "login/start", "login/complete", "models", "generate"])
        model.invalidate(); XCTAssertNil(model.proposal); XCTAssertEqual(model.phase, .idle)
    }
    func testLatePreparationAfterContextABAIsCancelledThroughOldConnection() async throws {
        let original = source(); var current = original
        var continuation: CheckedContinuation<NativeOrdinaryResponse, Error>?
        var cleanupIdentities: [String] = []
        let model = NativeOrdinaryModel(function: .patientInsight, snapshot: { current }, services: .init(
            prepare: { _, _ in try await withCheckedThrowingContinuation { continuation = $0 } }, command: { command, connection in
                XCTAssertEqual(command.path, "cancel"); cleanupIdentities.append(String(describing: connection.identity)); return try self.response("closed")
            }, status: { _ in throw NativeOrdinaryContractError.cleanupUnconfirmed }))
        model.prepare(); for _ in 0..<100 where continuation == nil { await Task.yield() }
        current = source(generation: 1, fingerprint: "synthetic-source-b"); model.invalidate(); await settle(model)
        current = original
        continuation?.resume(returning: try response("needs_consent")); for _ in 0..<100 { await Task.yield() }
        XCTAssertNil(model.proposal); XCTAssertNil(model.disclosure); XCTAssertNotEqual(model.phase, .needsConsent)
        XCTAssertEqual(cleanupIdentities, [String(describing: original.connection.identity)])
    }
    func testUnconfirmedCleanupBlocksNewAttemptUntilVerified() async throws {
        var prepares = 0, confirmed = false
        let model = NativeOrdinaryModel(function: .patientInsight, snapshot: { self.source() }, services: .init(
            prepare: { _, _ in prepares += 1; return try self.response("needs_consent") }, command: { _, _ in
                var object = F.response(.patientInsight, "closed"); object["cleanupConfirmed"] = confirmed
                return try F.decode(NativeOrdinaryResponse.self, object)
            }, status: { _ in throw NativeOrdinaryContractError.cleanupUnconfirmed }))
        model.prepare(); await settle(model); model.cancel(); await settle(model); XCTAssertEqual(model.phase, .blocked)
        model.prepare(); XCTAssertEqual(prepares, 1)
        confirmed = true; model.verifyClosure(); await settle(model); XCTAssertEqual(model.phase, .idle)
        model.prepare(); await settle(model); XCTAssertEqual(prepares, 2); model.cancel(); await settle(model)
    }
    func testPendingLoginKeepsTheOriginalAttemptWithoutClosingOrRestarting() async throws {
        var completed = false, cancellations = 0
        let model = NativeOrdinaryModel(function: .patientInsight, snapshot: { self.source() }, services: .init(
            prepare: { _, _ in try self.response("needs_consent") }, command: { command, _ in
                switch command.path {
                case "consent": return try self.response("consented")
                case "login/start": return try self.response("awaiting_login")
                case "login/complete":
                    if !completed { throw NativeOrdinaryContractError.loginPending }; return try self.response("connected")
                default: cancellations += 1; return try self.response("closed")
                }
            }, status: { _ in try self.response("closed") }))
        model.prepare(); await settle(model); model.consent(); await settle(model); model.startLogin(); await settle(model)
        model.completeLogin(); await settle(model); XCTAssertEqual(model.phase, .awaitingLogin); XCTAssertEqual(cancellations, 0)
        completed = true; model.completeLogin(); await settle(model); XCTAssertEqual(model.phase, .connected)
        model.cancel(); await settle(model)
    }
    func testSnapshotChecksFunctionPatientRevisionConnectionAndContent() {
        let a = source(); XCTAssertTrue(a.matches(source()))
        XCTAssertFalse(a.matches(source(generation: 1))); XCTAssertFalse(a.matches(source(fingerprint: "synthetic-source-b")))
        let changed = NativeOrdinarySnapshot(connection: a.connection, preparation: .init(functionId: .smartImport,
            patientId: "synthetic-other-patient", ambulatoryId: "synthetic-ambulatory", patientRevision: 2, input: .smartImport), fingerprint: a.fingerprint)
        XCTAssertFalse(a.matches(changed))
    }
}
#endif
