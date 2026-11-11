import Foundation
import XCTest
@testable import MediFlowAppleShared

/// Rischio #4 (censimento macchine a stati, 11/11): a proposta locale completata
/// il watchdog dello stato resta attivo. Allo scadere del lease dell'attempt
/// (expiresAt della preparazione, 120 s sull'host) il watchdog chiude
/// l'operazione e cancella la proposta mentre il medico la sta leggendo.
private enum CompletedFabricFixture {
    static let id = "12345678-1234-4234-8234-123456789abc"
    static let selection: [String: Any] = ["modelOptionId": "model_option_" + String(repeating: "a", count: 32), "catalogRevision": "sha256_" + String(repeating: "b", count: 64),
        "preferenceRevision": "sha256_" + String(repeating: "c", count: 64), "source": "host_configuration",
        "provider": "ollama", "model": "synthetic-local:1", "venue": "local", "fallback": "none"]
    static func response(_ phase: String, expiresAt: Double) throws -> NativeFabricResponse {
        var value: [String: Any]
        if phase == "closed" { value = ["schema": "mediflow.native-fabric.v1", "phase": phase, "attemptId": id, "cleanupConfirmed": true] }
        else {
            value = ["schema": "mediflow.native-fabric.v1", "phase": phase, "attemptId": id, "functionId": "patient_insight", "selection": selection, "expiresAt": expiresAt]
            if phase == "completed" {
                let receipt: [String: Any] = ["capability": "patient_insight", "venue": "local_process", "provider": "ollama", "model": "synthetic-local:1",
                    "egress": "none", "egressProfile": ["egress": "none"], "fallbackCount": 0]
                value["result"] = ["preview": ["status": "available", "writesPerformed": 0, "apply": "denied", "proposal": ["reviewOnly": true, "writesPerformed": 0],
                    "receipt": receipt, "provenance": ["provider": "ollama"]]]
                value["clinicalWrites"] = 0; value["apply"] = "denied"
            }
        }
        return try JSONDecoder().decode(NativeFabricResponse.self, from: JSONSerialization.data(withJSONObject: value))
    }
}

@MainActor
final class NativeFabricCompletedProposalTests: XCTestCase {
    private func source() -> NativeOrdinarySnapshot {
        let connection = ClinicalWorkspaceConnection(dataSource: S6MockDataSource(details: [:]), credentials: .init(clientId: "synthetic-client", clientToken: "synthetic-token"),
            sessionCookie: "mediflow_session=synthetic-0", ambulatoryId: "synthetic-ambulatory", masterKey: nil,
            serverURL: "https://localhost", tlsPin: String(repeating: "a", count: 64), sessionGeneration: 0)
        return NativeOrdinarySnapshot(connection: connection, preparation: .init(functionId: .patientInsight, patientId: "synthetic-patient",
            ambulatoryId: "synthetic-ambulatory", patientRevision: 1, input: .patientInsight), fingerprint: "synthetic-source")
    }

    func testCompletedProposalSurvivesAttemptLeaseExpiry() async throws {
        let lease = Date().timeIntervalSince1970 * 1000 + 400
        var pollGate: CheckedContinuation<Void, Error>?, polls = 0, cancels = 0
        var services = NativeFabricModel.Services(prepare: { _, _ in try CompletedFabricFixture.response("ready", expiresAt: lease) }, command: { command, _ in
            if command.path == "generate" { return try CompletedFabricFixture.response("completed", expiresAt: lease) }
            cancels += 1; return try CompletedFabricFixture.response("closed", expiresAt: lease)
        }, status: { id, _ in try CompletedFabricFixture.response(id == nil ? "closed" : "current", expiresAt: lease) })
        services.waitForStatusPoll = { polls += 1; try await withCheckedThrowingContinuation { pollGate = $0 } }
        let model = NativeFabricModel(function: .patientInsight, snapshot: { self.source() }, services: services)

        model.prepare()
        for _ in 0..<500 where model.phase != .ready { await Task.yield() }
        XCTAssertEqual(model.phase, .ready)
        model.generate()
        for _ in 0..<500 where model.phase != .completed { await Task.yield() }
        XCTAssertEqual(model.phase, .completed)
        XCTAssertNotNil(model.proposal)

        // Il medico legge la proposta oltre il lease dell'attempt; il watchdog fa il suo giro.
        try await Task.sleep(nanoseconds: 600_000_000)
        for _ in 0..<500 where pollGate == nil { await Task.yield() }
        pollGate?.resume(); pollGate = nil
        for _ in 0..<500 { await Task.yield() }

        XCTAssertEqual(model.phase, .completed, "la proposta completata non viene chiusa dal watchdog dello stato")
        XCTAssertNotNil(model.proposal, "la proposta resta sotto gli occhi del medico")
        model.invalidate()
    }
}
