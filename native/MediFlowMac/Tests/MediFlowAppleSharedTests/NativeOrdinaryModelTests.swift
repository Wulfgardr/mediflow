/* fake HTTP transport only. Mac UI/viewmodel tests, no authority/admission claims. */
#if canImport(MediFlowAppleShared)
import Foundation
import CryptoKit
import XCTest
@testable import MediFlowAppleShared

@MainActor
final class NativeOrdinaryModelTests: XCTestCase {
    typealias F = NativeOrdinaryTestFixtures
    private func source(generation: UInt = 0, fingerprint: String = "synthetic-source-a", key: SymmetricKey? = nil) -> NativeOrdinarySnapshot {
        let connection = ClinicalWorkspaceConnection(dataSource: S6MockDataSource(details: [:]),
            credentials: HomeBasePairedCredentials(clientId: "synthetic-mac", clientToken: "synthetic-token"),
            sessionCookie: "mediflow_session=synthetic-native-\(generation)", ambulatoryId: "synthetic-ambulatory", masterKey: key,
            serverURL: "https://localhost", tlsPin: String(repeating: "a", count: 64), sessionGeneration: generation)
        return NativeOrdinarySnapshot(connection: connection, preparation: NativeOrdinaryPreparation(functionId: .patientInsight,
            patientId: "synthetic-patient", ambulatoryId: "synthetic-ambulatory", patientRevision: 1, input: .patientInsight), fingerprint: fingerprint)
    }
    private func response(_ phase: String) throws -> NativeOrdinaryResponse { try F.decode(NativeOrdinaryResponse.self, F.response(.patientInsight, phase)) }
    private func settle(_ model: NativeOrdinaryModel) async {
        for _ in 0..<200 where model.isWorking { await Task.yield() }
    }
    private func retirement(_ reference: String, _ connection: ClinicalWorkspaceConnection) throws -> NativeAuthorityRetirement {
        try JSONDecoder().decode(NativeAuthorityRetirement.self, from: JSONSerialization.data(withJSONObject: [
            "schema": "mediflow.native-authority-retirement.v1", "previousAuthorityRef": reference,
            "currentAuthorityRef": NativeOrdinaryAuthority.reference(connection), "authorityRetired": true, "physicalCleanup": "not_attested"]))
    }
    func testRetiredAuthorityReleasesSuspendedPrepareWithoutKeyAndLateReplyCannotRegressNewAttempt() async throws {
        var session: UInt = 1, key: SymmetricKey? = SymmetricKey(data: Data(repeating: 9, count: 32))
        var resume: CheckedContinuation<NativeOrdinaryResponse, Error>?, calls = 0, commands = 0
        var service = .init(prepare: { _, _ in try self.response("needs_consent") }, command: { _, _ in try self.response("closed") }, status: { _ in try self.response("closed") }) as NativeOrdinaryModel.Services
        service.prepare = { _, connection in
            XCTAssertNil(connection.masterKey, "suspended prepare must retain no key")
            calls += 1
            if calls == 1 { return try await withCheckedThrowingContinuation { resume = $0 } }
            return try self.response("needs_consent")
        }
        service.command = { _, connection in commands += 1; throw HomeBaseClientError.httpStatus(401, nil) }
        service.status = { _ in throw HomeBaseClientError.httpStatus(401, nil) }
        service.retirement = { ref, connection in try self.retirement(ref, connection) }
        let model = NativeOrdinaryModel(function: .patientInsight, snapshot: { self.source(generation: session, key: key) }, services: service)
        model.prepare(); for _ in 0..<500 where resume == nil { await Task.yield() }
        let retained = Mirror(reflecting: model).children.first { $0.label == "original" }!.value
        let saved = Mirror(reflecting: retained).children.first?.value as? NativeOrdinarySnapshot
        XCTAssertNotNil(saved); XCTAssertNil(saved?.connection.masterKey)
        key = nil; model.invalidate(); await settle(model); XCTAssertEqual(model.phase, .blocked)
        session = 2; key = SymmetricKey(data: Data(repeating: 8, count: 32))
        model.verifyClosure(); await settle(model); XCTAssertEqual(model.phase, .idle)
        XCTAssertTrue(model.canPrepare, "retirement releases the preparation gate even while S1 awaits transport")
        model.prepare(); await settle(model); XCTAssertEqual(model.phase, .needsConsent)
        resume?.resume(returning: try self.response("needs_consent"))
        for _ in 0..<500 { await Task.yield() }
        XCTAssertEqual(model.phase, .needsConsent); XCTAssertEqual(calls, 2); XCTAssertEqual(commands, 0)
        XCTAssertNil(model.proposal)
        model.invalidate(); await settle(model)
    }
    func testRetirementNetworkTLS401AndChangedHostRemainBlocked() async throws {
        for error in [HomeBaseClientError.transport(.unreachable), HomeBaseClientError.transport(.tlsHandshakeFailed), HomeBaseClientError.httpStatus(401, nil)] {
            var session: UInt = 1, recoveryCalls = 0
            var service = .init(prepare: { _, _ in try self.response("needs_consent") }, command: { _, _ in try self.response("closed") }, status: { _ in try self.response("closed") }) as NativeOrdinaryModel.Services
            service.command = { _, _ in throw HomeBaseClientError.httpStatus(401, nil) }
            service.retirement = { _, _ in recoveryCalls += 1; throw error }
            let model = NativeOrdinaryModel(function: .patientInsight, snapshot: { self.source(generation: session) }, services: service)
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
        var service = .init(prepare: { _, _ in try self.response("needs_consent") }, command: { _, _ in try self.response("closed") }, status: { _ in try self.response("closed") }) as NativeOrdinaryModel.Services
        service.command = { _, _ in throw HomeBaseClientError.httpStatus(401, nil) }
        service.retirement = { ref, connection in
            reference = ref; captured = connection
            return try await withCheckedThrowingContinuation { resume = $0 }
        }
        let model = NativeOrdinaryModel(function: .patientInsight, snapshot: { self.source(generation: session) }, services: service)
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
        var service = .init(prepare: { _, _ in try self.response("needs_consent") }, command: { _, _ in try self.response("closed") }, status: { _ in try self.response("closed") }) as NativeOrdinaryModel.Services
        service.command = { _, _ in throw HomeBaseClientError.httpStatus(401, nil) }
        service.retirement = { ref, connection in try self.retirement(ref, connection) }
        let model = NativeOrdinaryModel(function: .patientInsight, snapshot: {
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
        var service = .init(prepare: { _, _ in try self.response("needs_consent") }, command: { _, _ in try self.response("closed") }, status: { _ in try self.response("closed") }) as NativeOrdinaryModel.Services
        service.command = { _, connection in
            if connection.sessionGeneration == 1 { throw HomeBaseClientError.httpStatus(401, nil) }
            if !retired { XCTFail("S2 must not cancel S1's attempt") }
            return try self.response("closed")
        }
        service.status = { _ in throw HomeBaseClientError.httpStatus(401, nil) }
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
        let model = NativeOrdinaryModel(function: .patientInsight, snapshot: { self.source(generation: session) }, services: service)
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
        XCTAssertEqual(model.phase, .needsConsent)
        model.invalidate(); await settle(model)
    }

    func testNeverPreparedInvalidationKeepsInitialMessageWithoutServiceCalls() {
        var calls = 0
        let model = NativeOrdinaryModel(function: .patientInsight, snapshot: { self.source() }, services: .init(
            prepare: { _, _ in calls += 1; throw NativeOrdinaryContractError.invalid },
            command: { _, _ in calls += 1; throw NativeOrdinaryContractError.invalid },
            status: { _ in calls += 1; throw NativeOrdinaryContractError.invalid }))
        let initialMessage = model.message
        model.invalidate()
        model.invalidate()
        XCTAssertEqual(model.message, initialMessage)
        XCTAssertEqual(model.phase, .idle)
        XCTAssertFalse(model.isWorking)
        XCTAssertEqual(calls, 0)
    }

    func testFirstPatientWorkspacePublicationsKeepInitialMessageWithoutPreparing() {
        let suite = "NativeOrdinaryInitialStateTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(suite)
        defer { try? FileManager.default.removeItem(at: directory) }
        let pairedStore = HomeBasePairedStore(userDefaults: defaults,
            keychainReader: { _, _ in .success(nil) }, keychainWriter: { _, _, _ in .success(()) },
            keychainDeleter: { _, _ in .success(()) })
        let cacheStore = HomeBasePatientCacheStore(cacheDirectory: directory,
            keyProvider: { throw NativeOrdinaryContractError.invalid })
        let workspace = PairedPatientsWorkspaceModel(pairedStore: pairedStore, cacheStore: cacheStore,
            dataSourceFactory: { _ in S6MockDataSource(details: [:]) })
        var calls = 0
        let model = NativeOrdinaryModel(function: .patientInsight, snapshot: { self.source() }, services: .init(
            prepare: { _, _ in calls += 1; throw NativeOrdinaryContractError.invalid },
            command: { _, _ in calls += 1; throw NativeOrdinaryContractError.invalid },
            status: { _ in calls += 1; throw NativeOrdinaryContractError.invalid }))
        let initialMessage = model.message
        model.observe(workspace)
        let patient = HomeBasePatientDetail(id: "synthetic-patient", firstName: "Ada", lastName: "Sintetica",
            birthDate: nil, taxCode: "RSSMRA80A01H501U", address: nil, phone: nil, caregiver: nil,
            exemptions: nil, diagnoses: nil, monitoringProfile: nil, statusReason: nil, notes: nil,
            aiSummary: nil, documentInsights: nil, isAdi: false, isArchived: false, version: 1,
            ambulatoryId: "synthetic-ambulatory", createdAt: nil, updatedAt: nil)
        workspace.ambulatoryId = "synthetic-ambulatory"
        workspace.configurePairedOnlineForTests(selectedPatient: patient)
        XCTAssertEqual(workspace.selectedPatientID, patient.id)
        XCTAssertEqual(model.message, initialMessage)
        XCTAssertEqual(model.phase, .idle)
        XCTAssertNil(model.proposal)
        XCTAssertFalse(model.isWorking)
        XCTAssertEqual(calls, 0)
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
        XCTAssertEqual(model.message, "Il contesto è cambiato. Prepara una nuova proposta.")
    }
    func testEverySharedFunctionDiscardsConsentAndProposalWhenContextIsInvalidated() async throws {
        for function in NativeOrdinaryFunction.allCases {
            let input: NativeOrdinaryInput
            switch function {
            case .patientInsight: input = .patientInsight
            case .smartImport: input = .smartImport
            case .documentSynthesis: input = .documentSynthesis(attachmentId: "synthetic-attachment")
            case .treatmentReasoning: input = .treatmentReasoning
            }
            let source = NativeOrdinarySnapshot(connection: self.source().connection,
                preparation: .init(functionId: function, patientId: "synthetic-patient", ambulatoryId: "synthetic-ambulatory",
                    patientRevision: 1, input: input), fingerprint: function.rawValue)
            var commands: [String] = []
            let model = NativeOrdinaryModel(function: function, snapshot: { source }, services: .init(
                prepare: { _, _ in try F.decode(NativeOrdinaryResponse.self, F.response(function, "needs_consent")) },
                command: { command, _ in
                    commands.append(command.path)
                    return try F.decode(NativeOrdinaryResponse.self, F.response(function, "closed"))
                }, status: { _ in throw NativeOrdinaryContractError.invalid }))
            model.prepare(); await settle(model)
            XCTAssertEqual(model.phase, .needsConsent); XCTAssertTrue(commands.isEmpty)
            model.invalidate()
            XCTAssertNil(model.disclosure); XCTAssertNil(model.challenge); XCTAssertNil(model.catalog); XCTAssertNil(model.proposal)
            await settle(model)
            XCTAssertEqual(model.phase, .idle); XCTAssertEqual(commands, ["cancel"])
        }
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
    func testPrepareFailureKeepsBoundedReasonAfterConfirmedCleanup() async throws {
        let model = NativeOrdinaryModel(function: .patientInsight, snapshot: { self.source() }, services: .init(
            prepare: { _, _ in throw HomeBaseClientError.httpStatus(503, "untrusted host payload") },
            command: { _, _ in throw NativeOrdinaryContractError.invalid },
            status: { _ in
                var closed = F.response(.patientInsight, "closed")
                closed.removeValue(forKey: "attemptId")
                return try F.decode(NativeOrdinaryResponse.self, closed)
            }))
        model.prepare(); await settle(model)
        XCTAssertEqual(model.phase, .idle)
        XCTAssertEqual(model.message, "Operazione non completata (HTTP 503): servizio non disponibile o risposta non verificata. Operazione chiusa; nessuna modifica alla cartella.")
        XCTAssertFalse(model.message.contains("untrusted host payload"))
        let failureMessage = model.message
        model.invalidate()
        XCTAssertEqual(model.message, failureMessage)
        XCTAssertEqual(model.phase, .idle)
    }
    func testPrepareUpstreamFailureUsesNeutralPreparationReasonAfterConfirmedCleanup() async throws {
        let model = NativeOrdinaryModel(function: .patientInsight, snapshot: { self.source() }, services: .init(
            prepare: { _, _ in throw NativeOrdinaryServerFailure(status: 503, code: .upstreamError) },
            command: { _, _ in throw NativeOrdinaryContractError.invalid },
            status: { _ in
                var closed = F.response(.patientInsight, "closed")
                closed.removeValue(forKey: "attemptId")
                return try F.decode(NativeOrdinaryResponse.self, closed)
            }))
        model.prepare(); await settle(model)
        XCTAssertEqual(model.message, "Operazione non completata (upstream_error): preparazione locale non disponibile. Operazione chiusa; nessuna modifica alla cartella.")
    }
    func testPrepareFailureKeepsOnlyAllowlistedServerCodeAfterConfirmedCleanup() async throws {
        let model = NativeOrdinaryModel(function: .patientInsight, snapshot: { self.source() }, services: .init(
            prepare: { _, _ in throw NativeOrdinaryServerFailure(status: 503, code: .unqualifiedBoundary) },
            command: { _, _ in throw NativeOrdinaryContractError.invalid },
            status: { _ in
                var closed = F.response(.patientInsight, "closed")
                closed.removeValue(forKey: "attemptId")
                return try F.decode(NativeOrdinaryResponse.self, closed)
            }))
        model.prepare(); await settle(model)
        XCTAssertEqual(model.message, "Operazione non completata (unqualified_boundary): runtime locale non qualificato per questa operazione. Operazione chiusa; nessuna modifica alla cartella.")
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
