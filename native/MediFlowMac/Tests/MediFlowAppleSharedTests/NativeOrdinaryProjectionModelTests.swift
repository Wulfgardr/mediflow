/* @Codex — Mac lifecycle reconciliation; synthetic transport only, no provider/authority claim. */
#if os(macOS)
import Foundation
import CryptoKit
import MediFlowCore
import XCTest
@testable import MediFlowAppleShared
@MainActor
final class NativeOrdinaryProjectionModelTests: XCTestCase {
    typealias F = NativeOrdinaryTestFixtures
    typealias P = NativeOrdinaryProjectionDTOTests
    private func source(generation: UInt = 0, unlocked: Bool = true) -> NativeOrdinarySnapshot {
        .init(connection:ClinicalWorkspaceConnection(dataSource:S6MockDataSource(details:[:]),
            credentials:.init(clientId:"synthetic",clientToken:"synthetic"),sessionCookie:"mediflow_session=synthetic",
            ambulatoryId:"synthetic-ambulatory",masterKey:unlocked ? SymmetricKey(data:Data(repeating:7,count:32)) : nil,
            serverURL:"https://localhost",tlsPin:String(repeating:"a",count:64),sessionGeneration:generation),
            preparation:P.preparation(.patientInsight),fingerprint:"synthetic")
    }
    private func planResponse() throws -> NativeOrdinaryResponse { try F.decode(NativeOrdinaryResponse.self,P.phase(.patientInsight)) }
    private func prepared() throws -> NativeOrdinaryResponse {
        var v=F.response(.patientInsight,"needs_consent");v["acquisition"]=["origin":"authenticated_client_decryption","ciphertextEquality":"not_attested"]
        return try F.decode(NativeOrdinaryResponse.self,v)
    }
    private func closed(_ confirmed: Bool = true) throws -> NativeOrdinaryResponse {
        try F.decode(NativeOrdinaryResponse.self,["schema":"mediflow.chatgpt-ordinary-flow.v1","phase":"closed","cleanupConfirmed":confirmed])
    }
    private func settle(_ model: NativeOrdinaryModel) async { for _ in 0..<1000 where model.isWorking { await Task.yield() } }
    func testProjectionEndsAtExplicitConsentWithoutAutomaticCommand() async throws {
        var projects=0,commands=0
        let model=NativeOrdinaryModel(function:.patientInsight,snapshot:{self.source()},services:.init(
            prepare:{_,_ in try self.planResponse()},command:{_,_ in commands += 1;return try self.closed()},status:{_ in try self.closed()},
            project:{plan,preparation,io in projects += 1;try plan.validate(preparation:preparation);_ = try io.current();try io.willSubmit();return try self.prepared()},cancelProjection:{_,_ in try self.closed()}))
        model.prepare();await settle(model);XCTAssertEqual(model.phase,.needsConsent);XCTAssertEqual(projects,1);XCTAssertEqual(commands,0)
        model.cancel();await settle(model)
    }
    func testDecryptFailureRetiresGrantWithoutAttemptOrFallback() async throws {
        var cancellations=0,commands=0
        let model=NativeOrdinaryModel(function:.patientInsight,snapshot:{self.source()},services:.init(
            prepare:{_,_ in try self.planResponse()},command:{_,_ in commands += 1;return try self.closed()},status:{_ in throw NativeOrdinaryContractError.invalid},
            project:{_,_,_ in throw NativeOrdinaryContractError.noSources},cancelProjection:{_,_ in cancellations += 1;return try self.closed()}))
        model.prepare();await settle(model);XCTAssertEqual(model.phase,.idle);XCTAssertEqual(cancellations,1);XCTAssertEqual(commands,0);XCTAssertNil(model.disclosure)
    }
    func testPendingPrepareCannotRestartBeforeLateGrantCleanup() async throws {
        var continuation:CheckedContinuation<NativeOrdinaryResponse,Error>?,prepares=0,cancels=0
        let model=NativeOrdinaryModel(function:.patientInsight,snapshot:{self.source()},services:.init(
            prepare:{_,_ in prepares += 1;return try await withCheckedThrowingContinuation{continuation=$0}},command:{_,_ in try self.closed()},status:{_ in try self.closed()},
            cancelProjection:{_,_ in cancels += 1;return try self.closed()}))
        model.prepare();for _ in 0..<1000 where continuation == nil {await Task.yield()}
        model.cancel();await settle(model);model.prepare();XCTAssertEqual(prepares,1)
        continuation?.resume(returning:try planResponse());for _ in 0..<1000 where cancels == 0 {await Task.yield()};await settle(model)
        XCTAssertEqual(cancels,1);XCTAssertNil(model.disclosure);XCTAssertEqual(model.phase,.idle)
    }
    func testLateAttemptFailedCleanupBlocksAndCanBeVerified() async throws {
        var continuation:CheckedContinuation<NativeOrdinaryResponse,Error>?,confirmed=false,attemptCancels=0
        let model=NativeOrdinaryModel(function:.patientInsight,snapshot:{self.source()},services:.init(
            prepare:{_,_ in try self.planResponse()},command:{command,_ in XCTAssertEqual(command.path,"cancel");attemptCancels += 1;return try self.closed(confirmed)},status:{_ in try self.closed(false)},
            project:{_,_,_ in try await withCheckedThrowingContinuation{continuation=$0}},cancelProjection:{_,_ in try self.closed(false)}))
        model.prepare();for _ in 0..<1000 where continuation == nil {await Task.yield()}
        model.cancel();await settle(model);continuation?.resume(returning:try prepared())
        for _ in 0..<1000 where attemptCancels == 0 {await Task.yield()};await settle(model)
        XCTAssertEqual(attemptCancels,1);XCTAssertEqual(model.phase,.blocked);XCTAssertNil(model.disclosure);XCTAssertNil(model.proposal)
        confirmed=true;model.verifyClosure();await settle(model);XCTAssertEqual(model.phase,.idle)
    }
    func testCurrentIORejectsLockAndWorkspaceGenerationChange() async throws {
        let original=source();var current=original,cancelled=0
        let model=NativeOrdinaryModel(function:.patientInsight,snapshot:{current},services:.init(
            prepare:{_,_ in try self.planResponse()},command:{_,_ in try self.closed()},status:{_ in try self.closed()},
            project:{_,_,io in
                current=self.source(generation:1,unlocked:false)
                XCTAssertThrowsError(try io.current());throw NativeOrdinaryContractError.stale
            },cancelProjection:{_,_ in cancelled += 1;return try self.closed()}))
        model.prepare();await settle(model);current=original;XCTAssertEqual(cancelled,1);XCTAssertNil(model.disclosure);XCTAssertEqual(model.phase,.idle)
    }
}
#endif
