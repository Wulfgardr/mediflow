import Foundation
import XCTest
@testable import MediFlowAppleShared

private enum FabricFixture {
    static let id = "12345678-1234-4234-8234-123456789abc"
    static func selection(_ function: NativeOrdinaryFunction) -> [String: Any] {
        ["modelOptionId": "model_option_" + String(repeating: "a", count: 32), "catalogRevision": "sha256_" + String(repeating: "b", count: 64),
         "preferenceRevision": "sha256_" + String(repeating: "c", count: 64), "source": "host_configuration",
         "provider": function == .treatmentReasoning ? "athena_mlx" : "ollama", "model": "synthetic-local:1", "venue": "local", "fallback": "none"]
    }
    static func result(_ function: NativeOrdinaryFunction) -> [String: Any] {
        let receipt: [String: Any] = ["capability": function.rawValue, "venue": "local_process", "provider": function == .treatmentReasoning ? "athena_mlx" : "ollama",
            "model": function == .treatmentReasoning ? NSNull() : "synthetic-local:1", "egress": "none", "egressProfile": ["egress": "none"], "fallbackCount": 0]
        switch function {
        case .patientInsight, .smartImport:
            return ["preview": ["status": "available", "writesPerformed": 0, "apply": "denied", "proposal": ["reviewOnly": true, "writesPerformed": 0],
                "receipt": receipt, "provenance": ["provider": "ollama"]]]
        case .treatmentReasoning:
            return ["schemaVersion": "mediflow.ai.treatment-reasoning-publication.v1", "status": "available", "writesPerformed": 0, "applyPolicy": "none", "review": "required", "fabricReceipt": receipt]
        case .documentSynthesis:
            return ["status": "available", "publication": ["receipt": ["reviewOnly": true, "applyPolicy": "none", "writesPerformed": 0],
                "citations": [["label": "S1", "quote": "Fonte sintetica"]], "provenance": ["fabricProvenance": ["receipt": receipt]]]]
        }
    }
    static func object(_ phase: String, _ function: NativeOrdinaryFunction = .patientInsight) -> [String: Any] {
        if phase == "closed" { return ["schema": "mediflow.native-fabric.v1", "phase": phase, "attemptId": id, "cleanupConfirmed": true] }
        var value: [String: Any] = ["schema": "mediflow.native-fabric.v1", "phase": phase, "attemptId": id, "functionId": function.rawValue,
            "selection": selection(function), "expiresAt": Date().timeIntervalSince1970 * 1000 + 60_000]
        if phase == "completed" { value["result"] = result(function); value["clinicalWrites"] = 0; value["apply"] = "denied" }
        return value
    }
    static func decode(_ value: [String: Any]) throws -> NativeFabricResponse { try JSONDecoder().decode(NativeFabricResponse.self, from: JSONSerialization.data(withJSONObject: value)) }
    static func response(_ phase: String, _ function: NativeOrdinaryFunction = .patientInsight) throws -> NativeFabricResponse { try decode(object(phase, function)) }
}

final class NativeFabricDTOTests: XCTestCase {
    func testFourOriginalProposalShapesAndLocalBinding() throws {
        for function in NativeOrdinaryFunction.allCases {
            let ready = try FabricFixture.response("ready", function)
            try ready.validate(function: function)
            let response = try FabricFixture.response("completed", function)
            _ = try response.validatedProposal(function: function, attempt: FabricFixture.id, expected: XCTUnwrap(ready.selection))
        }
    }
    func testCloudBindingWrongModelWritesAndStaleExpiryAreDenied() throws {
        for key in ["provider", "venue", "model", "fallback"] {
            var value = FabricFixture.object("completed"), selection = FabricFixture.selection(.patientInsight)
            selection[key] = "forged"; value["selection"] = selection
            let response = try FabricFixture.decode(value)
            XCTAssertThrowsError(try response.validatedProposal(function: .patientInsight, attempt: FabricFixture.id, expected: XCTUnwrap(FabricFixture.response("ready").selection)))
        }
        for (key, forged) in [("clinicalWrites", 1 as Any), ("apply", "allowed"), ("expiresAt", 0), ("functionId", "smart_import")] {
            var value = FabricFixture.object("completed"); value[key] = forged
            XCTAssertThrowsError(try FabricFixture.decode(value).validate(function: .patientInsight, attempt: FabricFixture.id))
        }
        var closed = FabricFixture.object("closed"); closed["cleanupConfirmed"] = false
        XCTAssertThrowsError(try FabricFixture.decode(closed).validate(function: .patientInsight, attempt: FabricFixture.id))
    }
}

@MainActor
final class NativeFabricModelTests: XCTestCase {
    private func source(generation: UInt = 0, function: NativeOrdinaryFunction = .patientInsight) -> NativeOrdinarySnapshot {
        let connection = ClinicalWorkspaceConnection(dataSource: S6MockDataSource(details: [:]), credentials: .init(clientId: "synthetic-client", clientToken: "synthetic-token"),
            sessionCookie: "mediflow_session=synthetic", ambulatoryId: "synthetic-ambulatory", masterKey: nil,
            serverURL: "https://localhost", tlsPin: String(repeating: "a", count: 64), sessionGeneration: generation)
        let input: NativeOrdinaryInput
        switch function { case .patientInsight: input = .patientInsight; case .smartImport: input = .smartImport; case .treatmentReasoning: input = .treatmentReasoning; case .documentSynthesis: input = .documentSynthesis(attachmentId: "synthetic-document") }
        return NativeOrdinarySnapshot(connection: connection, preparation: .init(functionId: function, patientId: "synthetic-patient", ambulatoryId: "synthetic-ambulatory", patientRevision: 1, input: input), fingerprint: "synthetic-source")
    }
    private func settle(_ model: NativeFabricModel) async { for _ in 0..<500 where model.isWorking { await Task.yield() } }
    private func services(_ function: NativeOrdinaryFunction = .patientInsight) -> NativeFabricModel.Services {
        .init(prepare: { _, _ in try FabricFixture.response("ready", function) }, command: { command, _ in
            try FabricFixture.response(command.path == "generate" ? "completed" : "closed", function)
        }, status: { id, _ in try FabricFixture.response(id == nil ? "closed" : "current", function) })
    }
    func testFourFunctionsRequireExplicitGenerateAndCloseWithoutWriting() async throws {
        for function in NativeOrdinaryFunction.allCases {
            let model = NativeFabricModel(function: function, snapshot: { self.source(function: function) }, services: services(function))
            model.prepare(); await settle(model); XCTAssertEqual(model.phase, .ready); XCTAssertNil(model.proposal)
            model.generate(); await settle(model); XCTAssertEqual(model.phase, .completed); XCTAssertNotNil(model.proposal)
            model.invalidate(); await settle(model); XCTAssertEqual(model.phase, .idle); XCTAssertNil(model.proposal)
        }
    }
    func testSessionChangeDuringReplyCannotPublishAndCancelsExactOldHandle() async throws {
        var generation: UInt = 0, cancelled: [String] = []
        var service = services()
        service.command = { command, _ in
            if command.path == "generate" { generation += 1; return try FabricFixture.response("completed") }
            cancelled.append(command.attemptId); return try FabricFixture.response("closed")
        }
        let model = NativeFabricModel(function: .patientInsight, snapshot: { self.source(generation: generation) }, services: service)
        model.prepare(); await settle(model); model.generate(); await settle(model)
        XCTAssertNil(model.proposal); XCTAssertEqual(model.phase, .idle); XCTAssertEqual(cancelled, [FabricFixture.id])
    }
    func testLatePrepareAfterBackgroundCannotPublishOrResurrectEvenWhenCleanupFails() async throws {
        var resume: CheckedContinuation<NativeFabricResponse, Error>?
        var service = services(); service.prepare = { _, _ in try await withCheckedThrowingContinuation { resume = $0 } }
        service.command = { _, _ in throw HomeBaseClientError.transport(.unreachable) }
        let model = NativeFabricModel(function: .patientInsight, snapshot: { self.source() }, services: service)
        model.prepare(); for _ in 0..<500 where resume == nil { await Task.yield() }
        model.invalidate(); await settle(model)
        resume?.resume(returning: try FabricFixture.response("ready"))
        for _ in 0..<500 { await Task.yield() }
        XCTAssertNil(model.proposal); XCTAssertEqual(model.phase, .blocked)
        model.prepare(); XCTAssertEqual(model.phase, .blocked)
    }
    func testDisabledAndUnreachableAreVisibleAndNeverGenerate() async throws {
        for error in [NativeFabricFailure(status: 403, code: .functionDisabled) as Error, HomeBaseClientError.transport(.unreachable)] {
            var calls = 0, service = services()
            service.prepare = { _, _ in throw error }; service.command = { _, _ in calls += 1; throw error }
            let model = NativeFabricModel(function: .patientInsight, snapshot: { self.source() }, services: service)
            model.prepare(); await settle(model); XCTAssertNil(model.proposal); XCTAssertEqual(calls, 0)
            XCTAssertTrue(model.message.contains(error is NativeFabricFailure ? "disabilitata" : "raggiungibile"), model.message)
            model.invalidate(); await settle(model)
        }
    }
    func testCompletedProposalIsWithdrawnWhenHostStatusReportsDisable() async throws {
        var service = services(); service.status = { id, _ in
            if id != nil { throw NativeFabricFailure(status: 403, code: .functionDisabled) }
            return try FabricFixture.response("closed")
        }
        let model = NativeFabricModel(function: .patientInsight, snapshot: { self.source() }, services: service)
        model.prepare(); await settle(model); model.generate(); await settle(model); XCTAssertNotNil(model.proposal)
        try await Task.sleep(nanoseconds: 2_100_000_000); await settle(model)
        XCTAssertNil(model.proposal); XCTAssertTrue(model.message.contains("disabilitata")); XCTAssertEqual(model.phase, .idle)
    }
}
