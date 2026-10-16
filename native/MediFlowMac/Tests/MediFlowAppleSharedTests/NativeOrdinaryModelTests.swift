/* fake HTTP transport only. Mac UI/viewmodel tests, no authority/admission claims. */
#if canImport(MediFlowAppleShared)
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
