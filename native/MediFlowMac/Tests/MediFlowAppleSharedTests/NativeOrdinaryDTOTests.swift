/* @Codex — synthetic passive DTO fixtures; no server authority, provider or OS qualification. */
import Foundation
import XCTest
#if canImport(MediFlowAppleShared)
@testable import MediFlowAppleShared
#endif

enum NativeOrdinaryTestFixtures {
    static let attempt = "00000000-0000-4000-8000-000000000001"
    static let revision = "00000000-0000-4000-8000-000000000002"
    static let option = "00000000-0000-4000-8000-000000000003"
    static let source = "sha256_" + String(repeating: "a", count: 64)
    static let payload = String(repeating: "b", count: 64)
    static let output = String(repeating: "c", count: 64)
    static func decode<T: Decodable>(_ type: T.Type, _ object: [String: Any]) throws -> T {
        try JSONDecoder().decode(type, from: JSONSerialization.data(withJSONObject: object))
    }
    static func disclosure(_ function: NativeOrdinaryFunction) -> [String: Any] {
        ["schema": "mediflow.chatgpt-ordinary-disclosure.v1", "revision": revision, "operation": function.rawValue,
         "profileVersion": "mediflow.ordinary-redacted-profile.v1", "contextRevision": "synthetic-context",
         "attemptRevision": attempt, "qualificationRevision": "synthetic-NOT-QUALIFIED",
         "sourceSha256": source, "payloadSha256": payload, "payloadBytes": 320,
         "egress": ["auth.openai.com:443", "chatgpt.com:443"], "proposalOnly": true, "clinicalWrites": 0]
    }
    static var choice: [String: Any] { ["optionId": option, "model": "synthetic-model", "effort": "medium"] }
    static func response(_ function: NativeOrdinaryFunction, _ phase: String) -> [String: Any] {
        var v: [String: Any] = ["schema": "mediflow.chatgpt-ordinary-flow.v1", "phase": phase,
            "attemptId": attempt, "functionId": function.rawValue, "expiresAt": Date().timeIntervalSince1970 * 1000 + 60000]
        switch phase {
        case "needs_consent": v["disclosure"] = disclosure(function)
        case "awaiting_login": v["challenge"] = ["verificationUrl": "https://auth.openai.com/synthetic", "userCode": "SYNTHETIC-CODE"]
        case "ready": v["catalog"] = ["revision": revision, "choices": [choice]]
        case "closed": v["cleanupConfirmed"] = true
        case "completed": v["schema"] = "mediflow.native-ordinary.v1"; v["cleanupConfirmed"] = true; v["result"] = result(function)
        default: break
        }
        return v
    }
    static func result(_ function: NativeOrdinaryFunction) -> [String: Any] {
        let receipt: [String: Any] = ["schemaVersion": "mediflow.ai.chatgpt-receipt.v1", "capability": function.rawValue,
            "provider": "chatgpt_subscription", "venue": "cloud", "model": "synthetic-model", "effort": "medium",
            "egress": "redacted_explicit_consent", "fallback": "none", "retention": "chatgpt_service_terms_apply",
            "sourceSha256": source, "payloadSha256": payload, "outputSha256": output]
        switch function {
        case .patientInsight: return ["preview": ["status": "available", "writesPerformed": 0, "apply": "denied", "receipt": receipt,
            "proposal": ["schemaVersion": "mediflow.patient-insight.review-proposal.v2", "reviewOnly": true, "summary": "Sintesi sintetica"]]]
        case .smartImport: return ["preview": ["status": "available", "writesPerformed": 0, "apply": "denied", "receipt": receipt,
            "proposal": ["schemaVersion": "mediflow.smart-import.proposal.v1", "writesPerformed": 0, "summary": "Proposta sintetica"]]]
        case .treatmentReasoning: return ["schemaVersion": "mediflow.ai.treatment-reasoning-publication.chatgpt.v1",
            "status": "available", "writesPerformed": 0, "applyPolicy": "none", "review": "required", "fabricReceipt": receipt]
        case .documentSynthesis: return ["schemaVersion": "mediflow.document-synthesis.preview-wire.v1", "status": "available",
            "publication": ["receipt": ["reviewOnly": true, "applyPolicy": "none", "writesPerformed": 0, "providerBindingReceipt": receipt],
                            "citations": [["label": "S1", "quote": "Solo fonte sintetica."]]]]
        }
    }
}
final class NativeOrdinaryDTOTests: XCTestCase {
    typealias F = NativeOrdinaryTestFixtures
    func testFourOriginalFunctionResultsRequireOriginalReceipt() throws {
        for function in NativeOrdinaryFunction.allCases {
            let disclosure = try F.decode(NativeOrdinaryDisclosure.self, F.disclosure(function)); try disclosure.validate(function: function)
            let choice = try F.decode(NativeOrdinaryCatalog.Choice.self, F.choice)
            let response = try F.decode(NativeOrdinaryResponse.self, F.response(function, "completed"))
            XCTAssertNoThrow(try response.validatedProposal(function: function, attempt: F.attempt, disclosure: disclosure, choice: choice))
            let other = NativeOrdinaryFunction.allCases.first { $0 != function }!
            XCTAssertThrowsError(try response.validatedProposal(function: other, attempt: F.attempt, disclosure: disclosure, choice: choice))
            XCTAssertThrowsError(try response.validatedProposal(function: function, attempt: F.option, disclosure: disclosure, choice: choice))
            var wrongDisclosure = F.disclosure(function); wrongDisclosure["payloadSha256"] = F.output
            XCTAssertThrowsError(try response.validatedProposal(function: function, attempt: F.attempt,
                disclosure: F.decode(NativeOrdinaryDisclosure.self, wrongDisclosure), choice: choice))
            var wrongChoice = F.choice; wrongChoice["model"] = "another-synthetic-model"
            XCTAssertThrowsError(try response.validatedProposal(function: function, attempt: F.attempt, disclosure: disclosure,
                choice: F.decode(NativeOrdinaryCatalog.Choice.self, wrongChoice)))
        }
    }
    func testUnconfirmedCleanupNeverReturnsAProposalOrPermitsRestart() throws {
        for phase in ["closed", "completed"] {
            var value = F.response(.patientInsight, phase); value["cleanupConfirmed"] = false
            let decoded = try F.decode(NativeOrdinaryResponse.self, value)
            XCTAssertThrowsError(try decoded.validate(function: .patientInsight, attempt: F.attempt))
        }
        var active = F.response(.patientInsight, "ready"); active["expiresAt"] = 0
        XCTAssertThrowsError(try F.decode(NativeOrdinaryResponse.self, active).validate(function: .patientInsight))
    }
    func testCatalogIsExecutableOnlyAsFreshExplicitOpaqueChoice() throws {
        let live: [String: Any] = ["revision": F.revision, "choices": [F.choice]]
        XCTAssertNoThrow(try F.decode(NativeOrdinaryCatalog.self, live).validate())
        for invalid: [String: Any] in [["revision": F.revision, "choices": []],
            ["revision": "configuration-only", "choices": [F.choice]],
            ["revision": F.revision, "choices": [F.choice, F.choice]]] {
            XCTAssertThrowsError(try F.decode(NativeOrdinaryCatalog.self, invalid).validate())
        }
    }
    func testLoginRejectsOtherHostCredentialsAndScheme() throws {
        for url in ["http://auth.openai.com/a", "https://auth.openai.com.evil.invalid/a", "https://user@auth.openai.com/a", "https://chatgpt.com:444/a"] {
            let value = try F.decode(NativeOrdinaryChallenge.self, ["verificationUrl": url, "userCode": "SYNTHETIC"])
            XCTAssertNil(value.safeURL)
        }
    }
    func testCommandBodyContainsNoCapabilityOrPatientGrant() throws {
        let commands: [(NativeOrdinaryCommand, Set<String>)] = [
            (.consent(attemptId: F.attempt, disclosureRevision: F.revision), ["attemptId", "expectedDisclosureRevision"]),
            (.generate(attemptId: F.attempt, optionId: F.option, catalogRevision: F.revision), ["attemptId", "modelOptionId", "expectedCatalogRevision"]),
            (.cancel(attemptId: F.attempt), ["attemptId"])]
        for (command, expected) in commands {
            let object = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(command.body)) as? [String: Any])
            XCTAssertEqual(Set(object.keys), expected)
        }
    }
    func testDisclosureAndJSONBoundsAreFailClosed() throws {
        for key in ["sourceSha256", "payloadSha256", "profileVersion", "operation"] {
            var object = F.disclosure(.patientInsight); object[key] = "invalid"
            XCTAssertThrowsError(try F.decode(NativeOrdinaryDisclosure.self, object).validate(function: .patientInsight))
        }
        XCTAssertThrowsError(try JSONEncoder().encode(NativeOrdinaryJSON.number(.infinity)))
        let unicode = NativeOrdinaryJSON.object(["testo": .string("È sintetico: 🩺")])
        XCTAssertEqual(try JSONDecoder().decode(NativeOrdinaryJSON.self, from: JSONEncoder().encode(unicode)), unicode)
    }
    static let portableTests = [
        ("fourOriginalFunctionResultsRequireOriginalReceipt", testFourOriginalFunctionResultsRequireOriginalReceipt),
        ("unconfirmedCleanupNeverReturnsAProposalOrPermitsRestart", testUnconfirmedCleanupNeverReturnsAProposalOrPermitsRestart),
        ("catalogIsExecutableOnlyAsFreshExplicitOpaqueChoice", testCatalogIsExecutableOnlyAsFreshExplicitOpaqueChoice),
        ("loginRejectsOtherHostCredentialsAndScheme", testLoginRejectsOtherHostCredentialsAndScheme),
        ("commandBodyContainsNoCapabilityOrPatientGrant", testCommandBodyContainsNoCapabilityOrPatientGrant),
        ("disclosureAndJSONBoundsAreFailClosed", testDisclosureAndJSONBoundsAreFailClosed),
    ]
}
