import Foundation
import CryptoKit
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
    private func source(generation: UInt = 0, function: NativeOrdinaryFunction = .patientInsight, key: SymmetricKey? = nil) -> NativeOrdinarySnapshot {
        let connection = ClinicalWorkspaceConnection(dataSource: S6MockDataSource(details: [:]), credentials: .init(clientId: "synthetic-client", clientToken: "synthetic-token"),
            sessionCookie: "mediflow_session=synthetic-\(generation)", ambulatoryId: "synthetic-ambulatory", masterKey: key,
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
    private func retirement(_ reference: String, _ connection: ClinicalWorkspaceConnection) throws -> NativeAuthorityRetirement {
        try JSONDecoder().decode(NativeAuthorityRetirement.self, from: JSONSerialization.data(withJSONObject: [
            "schema": "mediflow.native-authority-retirement.v1", "previousAuthorityRef": reference,
            "currentAuthorityRef": NativeOrdinaryAuthority.reference(connection), "authorityRetired": true, "physicalCleanup": "not_attested"]))
    }
    func testRetiredAuthorityReleasesSuspendedPrepareWithoutKeyAndLateReplyCannotRegressNewAttempt() async throws {
        var session: UInt = 1, key: SymmetricKey? = SymmetricKey(data: Data(repeating: 9, count: 32))
        var resume: CheckedContinuation<NativeFabricResponse, Error>?, calls = 0, commands = 0
        var service = services()
        service.prepare = { _, connection in
            XCTAssertNil(connection.masterKey, "suspended prepare must retain no key")
            calls += 1
            if calls == 1 { return try await withCheckedThrowingContinuation { resume = $0 } }
            return try FabricFixture.response("ready")
        }
        service.command = { _, connection in commands += 1; throw HomeBaseClientError.httpStatus(401, nil) }
        service.status = { _, _ in throw HomeBaseClientError.httpStatus(401, nil) }
        service.retirement = { ref, connection in try self.retirement(ref, connection) }
        let model = NativeFabricModel(function: .patientInsight, snapshot: { self.source(generation: session, key: key) }, services: service)
        model.prepare(); for _ in 0..<500 where resume == nil { await Task.yield() }
        let retained = Mirror(reflecting: model).children.first { $0.label == "original" }!.value
        let saved = Mirror(reflecting: retained).children.first?.value as? NativeOrdinarySnapshot
        XCTAssertNotNil(saved); XCTAssertNil(saved?.connection.masterKey)
        key = nil; model.invalidate(); await settle(model); XCTAssertEqual(model.phase, .blocked)
        session = 2; key = SymmetricKey(data: Data(repeating: 8, count: 32))
        model.verifyClosure(); await settle(model); XCTAssertEqual(model.phase, .idle)
        XCTAssertTrue(model.canPrepare, "retirement releases the preparation gate even while S1 awaits transport")
        model.prepare(); await settle(model); XCTAssertEqual(model.phase, .ready)
        resume?.resume(returning: try FabricFixture.response("ready"))
        for _ in 0..<500 { await Task.yield() }
        XCTAssertEqual(model.phase, .ready); XCTAssertEqual(calls, 2); XCTAssertEqual(commands, 0)
        XCTAssertNil(model.proposal)
        model.invalidate(); await settle(model)
    }
    func testRetirementNetworkTLS401AndChangedHostRemainBlocked() async throws {
        for error in [HomeBaseClientError.transport(.unreachable), HomeBaseClientError.transport(.tlsHandshakeFailed), HomeBaseClientError.httpStatus(401, nil)] {
            var session: UInt = 1, recoveryCalls = 0
            var service = services()
            service.command = { _, _ in throw HomeBaseClientError.httpStatus(401, nil) }
            service.retirement = { _, _ in recoveryCalls += 1; throw error }
            let model = NativeFabricModel(function: .patientInsight, snapshot: { self.source(generation: session) }, services: service)
            model.prepare(); await settle(model); model.invalidate(); await settle(model)
            session = 2; model.verifyClosure(); await settle(model)
            XCTAssertEqual(model.phase, .blocked); XCTAssertFalse(model.canPrepare); XCTAssertEqual(recoveryCalls, 1)
        }
        let previous = source(generation: 1).connection
        var other = source(generation: 2).connection
        other.serverURL = "https://localhost:3444"
        XCTAssertThrowsError(try NativeOrdinaryAuthority.recoveryConnection(previous: previous, current: other))
        other = source(generation: 2).connection; other.tlsPin = String(repeating: "b", count: 64)
        XCTAssertThrowsError(try NativeOrdinaryAuthority.recoveryConnection(previous: previous, current: other))
    }
    func testRetirementReplyForS2CannotReleaseOwnerAfterS3() async throws {
        var session: UInt = 1
        var resume: CheckedContinuation<NativeAuthorityRetirement, Error>?, captured: ClinicalWorkspaceConnection?
        var reference = ""
        var service = services()
        service.command = { _, _ in throw HomeBaseClientError.httpStatus(401, nil) }
        service.retirement = { ref, connection in
            reference = ref; captured = connection
            return try await withCheckedThrowingContinuation { resume = $0 }
        }
        let model = NativeFabricModel(function: .patientInsight, snapshot: { self.source(generation: session) }, services: service)
        model.prepare(); await settle(model); model.invalidate(); await settle(model)
        session = 2; model.verifyClosure()
        for _ in 0..<500 where resume == nil { await Task.yield() }
        session = 3; model.invalidate()
        resume?.resume(returning: try retirement(reference, XCTUnwrap(captured)))
        await settle(model)
        XCTAssertEqual(model.phase, .blocked); XCTAssertFalse(model.canPrepare); XCTAssertNil(model.proposal)
    }

    func testRetirementRecoveryDoesNotRequireOldClinicalDocumentSnapshot() async throws {
        var session: UInt = 1, missingDocument = false
        var service = services()
        service.command = { _, _ in throw HomeBaseClientError.httpStatus(401, nil) }
        service.retirement = { ref, connection in try self.retirement(ref, connection) }
        let model = NativeFabricModel(function: .patientInsight, snapshot: {
            guard !missingDocument else { throw NativeOrdinaryContractError.noSources }
            return self.source(generation: session)
        }, currentConnection: { self.source(generation: session).connection }, services: service)
        model.prepare(); await settle(model); model.invalidate(); await settle(model)
        XCTAssertEqual(model.phase, .blocked)
        session = 2; missingDocument = true
        model.verifyClosure(); await settle(model)
        XCTAssertEqual(model.phase, .idle); XCTAssertTrue(model.canPrepare); XCTAssertNil(model.proposal)
    }

    func testRevokedSession401ThenS2RecoversSameOwner() async throws {
        var session: UInt = 1, retired = false, references: [String] = []
        var service = services()
        service.command = { _, connection in
            if connection.sessionGeneration == 1 { throw HomeBaseClientError.httpStatus(401, nil) }
            if !retired { XCTFail("S2 must not cancel S1's attempt") }
            return try FabricFixture.response("closed")
        }
        service.status = { _, _ in throw HomeBaseClientError.httpStatus(401, nil) }
        service.retirement = { reference, connection in
            references.append(reference)
            XCTAssertEqual(connection.sessionGeneration, 2)
            XCTAssertNil(connection.masterKey)
            guard retired else { throw NativeOrdinaryContractError.cleanupUnconfirmed }
            let body: [String: Any] = ["schema": "mediflow.native-authority-retirement.v1",
                "previousAuthorityRef": reference, "currentAuthorityRef": NativeOrdinaryAuthority.reference(connection),
                "authorityRetired": true, "physicalCleanup": "not_attested"]
            return try JSONDecoder().decode(NativeAuthorityRetirement.self, from: JSONSerialization.data(withJSONObject: body))
        }
        let model = NativeFabricModel(function: .patientInsight, snapshot: { self.source(generation: session) }, services: service)
        model.prepare(); await settle(model)
        model.invalidate(); await settle(model)
        XCTAssertEqual(model.phase, .blocked)
        model.verifyClosure(); await settle(model)
        XCTAssertEqual(model.phase, .blocked, "S1 still denied is not a retirement receipt")
        session = 2
        model.verifyClosure(); await settle(model)
        XCTAssertEqual(model.phase, .blocked, "S2 alone does not prove old authority retirement")
        retired = true
        model.verifyClosure(); await settle(model)
        XCTAssertEqual(model.phase, .idle, "host-attested retired S1 must release the stable owner")
        XCTAssertTrue(model.canPrepare)
        XCTAssertEqual(references.count, 2)
        XCTAssertNil(model.proposal)
        model.prepare(); await settle(model)
        XCTAssertEqual(model.phase, .ready)
        model.invalidate(); await settle(model)
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
