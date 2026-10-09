import Foundation
import XCTest
@testable import MediFlowCore

final class ClinicalScaleInterpretationTests: XCTestCase {
    func testStoredVersionIdentifierIsBoundedData() {
        XCTAssertEqual(ClinicalScaleInterpretation.recordedVersion("future.v9"), "future.v9")
        XCTAssertEqual(ClinicalScaleInterpretation.recordedVersion(String(repeating: "v", count: 96)), String(repeating: "v", count: 96))
        for invalid in ["", String(repeating: "v", count: 97), "v\n", "v\ninstruction", "<b>v</b>", " v", "-v"] {
            XCTAssertNil(ClinicalScaleInterpretation.recordedVersion(invalid))
        }
    }

    func testNewVersionsCrossFormerBoundariesWithoutDiagnosticLabels() throws {
        let cases: [(ClinicalScaleDefinition, [String], [Int], String)] = [
            (ClinicalScales.mmse,
             ["ot1", "ot2", "ot3", "ot4", "ot5", "os1", "os2", "os3", "os4", "os5",
              "reg1", "reg2", "reg3", "att1", "att2", "att3", "att4", "att5", "rec1", "rec2", "rec3",
              "lang1", "lang2", "lang3", "lang4", "lang5", "lang6", "lang7"],
             [0, 9, 10, 17, 18, 23, 24, 30], "mediflow.mmse.screening-limits.v1"),
            (ClinicalScales.gds,
             ["g1", "g2", "g3", "g4", "g5", "g6", "g7", "g8", "g9", "g10", "g11", "g12", "g13", "g14", "g15"],
             [0, 5, 6, 10, 11, 15], "mediflow.gds15.screening-limits.v1")
        ]
        for (definition, keys, totals, version) in cases {
            XCTAssertEqual(definition.questions.map(\.id), keys)
            for total in totals {
                var remaining = total
                let answers = Dictionary(uniqueKeysWithValues: keys.map { key in
                    let value = min(remaining, key == "lang4" ? 3 : 1)
                    remaining -= value
                    return (key, value)
                })
                XCTAssertEqual(remaining, 0)
                let submission = try ClinicalScales.prepareSubmission(definition: definition, answers: answers)
                XCTAssertEqual(submission.result.score, total)
                XCTAssertEqual(submission.result.interpretationVersion, version)
                XCTAssertTrue(submission.result.interpretation.contains("Screening"))
                XCTAssertFalse(submission.result.interpretation.contains("Assenza di decadimento"))
                XCTAssertFalse(submission.result.interpretation.contains("Depressione Severa"))
                let metadata = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(submission.metadataJSON.utf8)) as? [String: Any])
                XCTAssertEqual(metadata["interpretationVersion"] as? String, version)
                XCTAssertEqual(metadata["interpretation"] as? String, submission.result.interpretation)
                XCTAssertNil(metadata["instrument"])
                XCTAssertTrue(ClinicalScales.contentSummary(definition: definition, result: submission.result)
                    .hasSuffix("Versione interpretazione: \(version)"))
                let forged = ClinicalScaleResult(score: total, interpretation: submission.result.interpretation,
                    answers: answers, interpretationVersion: "forged.v1")
                XCTAssertThrowsError(try ClinicalScales.metadataJSON(definition: definition, result: forged))
            }
        }
    }
}
