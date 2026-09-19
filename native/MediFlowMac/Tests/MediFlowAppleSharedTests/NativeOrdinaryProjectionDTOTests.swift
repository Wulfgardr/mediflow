/* @Codex — portable strict DTO tests. Synthetic only; no crypto/OS qualification. */
import Foundation
import XCTest
#if canImport(MediFlowAppleShared)
@testable import MediFlowAppleShared
#endif
final class NativeOrdinaryProjectionDTOTests: XCTestCase {
    typealias F = NativeOrdinaryTestFixtures
    static func preparation(_ function: NativeOrdinaryFunction) -> NativeOrdinaryPreparation {
        let input: NativeOrdinaryInput
        switch function {
        case .patientInsight: input = .patientInsight
        case .smartImport: input = .smartImport
        case .treatmentReasoning: input = .treatmentReasoning
        case .documentSynthesis: input = .documentSynthesis(attachmentId: "synthetic-attachment")
        }
        return .init(functionId: function, patientId: "synthetic-patient", ambulatoryId: "synthetic-ambulatory", patientRevision: 1, input: input)
    }
    static func plan(_ function: NativeOrdinaryFunction) -> [String: Any] {
        ["schemaVersion": NativeOrdinaryProjectionPlan.schema, "grantId": String(repeating: "a", count: 64),
         "functionId": function.rawValue, "expiresAt": Date().timeIntervalSince1970 * 1000 + 30_000,
         "roster": [["entity": function == .documentSynthesis ? "attachment_bytes" : "patient",
                     "id": function == .documentSynthesis ? "synthetic-attachment" : "synthetic-patient",
                     "fields": function == .documentSynthesis ? ["data"] : ["notes"]]]]
    }
    static func phase(_ function: NativeOrdinaryFunction) -> [String: Any] {
        let plan = plan(function)
        return ["schema": "mediflow.native-ordinary.v1", "phase": "needs_source_projection", "functionId": function.rawValue,
                "expiresAt": plan["expiresAt"]!, "sourceProjection": plan]
    }
    func testFourPlansAreClosedSelectorOnlyAndRoundTrip() throws {
        for f in NativeOrdinaryFunction.allCases {
            let p = try F.decode(NativeOrdinaryProjectionPlan.self, Self.plan(f))
            try p.validate(preparation: Self.preparation(f))
            XCTAssertEqual(try JSONDecoder().decode(NativeOrdinaryProjectionPlan.self, from: JSONEncoder().encode(p)), p)
            let response = try F.decode(NativeOrdinaryResponse.self, Self.phase(f))
            try response.validate(function: f)
            XCTAssertNil(response.attemptId); XCTAssertNil(response.disclosure); XCTAssertNil(response.acquisition)
            for extra in ["text", "ciphertext", "revision", "sourceRevision", "masterKey", "pin"] {
                var v = Self.plan(f); v[extra] = "synthetic-forbidden"
                XCTAssertThrowsError(try F.decode(NativeOrdinaryProjectionPlan.self, v))
            }
        }
    }
    func testNewPhaseCannotContainAttemptDisclosureOrAuthority() throws {
        for extra in ["attemptId", "disclosure", "result", "acquisition", "session", "capability", "clinicalText"] {
            var phase = Self.phase(.patientInsight); phase[extra] = NSNull()
            XCTAssertThrowsError(try F.decode(NativeOrdinaryResponse.self, phase))
        }
        var phase = Self.phase(.patientInsight); phase["expiresAt"] = 0
        XCTAssertThrowsError(try F.decode(NativeOrdinaryResponse.self, phase).validate(function: .patientInsight))
        XCTAssertThrowsError(try F.decode(NativeOrdinaryResponse.self, Self.phase(.patientInsight)).validate(function: .smartImport))
    }
    func testRosterFailureNeverShrinksThePlan() throws {
        let invalidRosters: [[Any]] = [[],
            [["entity":"patient", "id":"another-patient", "fields":["notes"]]],
            [["entity":"patient", "id":"synthetic-patient", "fields":["notes","notes"]]],
            [["entity":"patient", "id":"synthetic-patient", "fields":["diagnoses","notes"]]],
            [["entity":"patient", "id":"synthetic-patient", "fields":["firstName"]]],
            [["entity":"patient", "id":"synthetic-patient", "fields":[]]],
            [["entity":"attachment_bytes", "id":"synthetic-attachment", "fields":["data"]]],
            [["entity":"observations", "id":"o", "fields":["value"]]],
            [["entity":"patient", "id":"synthetic-patient", "fields":["notes"]], ["entity":"patient", "id":"synthetic-patient", "fields":["diagnoses"]]]]
        for roster in invalidRosters {
            var p = Self.plan(.patientInsight); p["roster"] = roster
            XCTAssertThrowsError(try F.decode(NativeOrdinaryProjectionPlan.self, p).validate(preparation: Self.preparation(.patientInsight)))
        }
        var p = Self.plan(.patientInsight); p["roster"] = [["entity":"patient", "id":"synthetic-patient", "fields":["notes"], "revision":1]]
        XCTAssertThrowsError(try F.decode(NativeOrdinaryProjectionPlan.self,p))
    }
    func testGrantExpiryAndCrossFunctionAreRejected() throws {
        for function in NativeOrdinaryFunction.allCases {
            let p = try F.decode(NativeOrdinaryProjectionPlan.self, Self.plan(function))
            XCTAssertThrowsError(try p.validate(preparation: Self.preparation(function), now: Date(timeIntervalSince1970: p.expiresAt / 1000)))
            for other in NativeOrdinaryFunction.allCases where other != function {
                XCTAssertThrowsError(try p.validate(preparation: Self.preparation(other)))
            }
        }
        for grant in ["", "a", String(repeating:"A",count:64), String(repeating:"a",count:65)] {
            var p = Self.plan(.patientInsight); p["grantId"] = grant
            XCTAssertThrowsError(try F.decode(NativeOrdinaryProjectionPlan.self,p).validate(preparation: Self.preparation(.patientInsight)))
        }
    }
    func testAcquisitionIsExactAndNeverCiphertextAttestation() throws {
        let correct: [String:Any] = ["origin":"authenticated_client_decryption", "ciphertextEquality":"not_attested"]
        XCTAssertNoThrow(try F.decode(NativeOrdinaryAcquisition.self,correct))
        for (key,value) in [("origin","server_decryption"),("ciphertextEquality","attested"),("key","synthetic")] {
            var v = correct; v[key] = value; XCTAssertThrowsError(try F.decode(NativeOrdinaryAcquisition.self,v))
        }
        var response = F.response(.patientInsight,"needs_consent");response["acquisition"] = correct
        XCTAssertNoThrow(try F.decode(NativeOrdinaryResponse.self,response).validate(function:.patientInsight))
        response = F.response(.patientInsight,"ready");response["acquisition"] = correct
        XCTAssertThrowsError(try F.decode(NativeOrdinaryResponse.self,response).validate(function:.patientInsight))
    }
    func testBodyContainsOnlyFunctionAndExactFieldProjection() throws {
        let body = NativeOrdinaryProjectionBody(functionId:.patientInsight,rows:[.init(entity:"patient",id:"synthetic-patient",fields:[.init(name:"notes",value:"Solo contenuto sintetico")])])
        let obj = try XCTUnwrap(JSONSerialization.jsonObject(with:JSONEncoder().encode(body)) as? [String:Any])
        XCTAssertEqual(Set(obj.keys),["schemaVersion","functionId","rows"])
    }
    static let portableTests = [
        ("fourPlansAreClosedSelectorOnlyAndRoundTrip",testFourPlansAreClosedSelectorOnlyAndRoundTrip),
        ("newPhaseCannotContainAttemptDisclosureOrAuthority",testNewPhaseCannotContainAttemptDisclosureOrAuthority),
        ("rosterFailureNeverShrinksThePlan",testRosterFailureNeverShrinksThePlan),
        ("grantExpiryAndCrossFunctionAreRejected",testGrantExpiryAndCrossFunctionAreRejected),
        ("acquisitionIsExactAndNeverCiphertextAttestation",testAcquisitionIsExactAndNeverCiphertextAttestation),
        ("bodyContainsOnlyFunctionAndExactFieldProjection",testBodyContainsOnlyFunctionAndExactFieldProjection)
    ]
}
