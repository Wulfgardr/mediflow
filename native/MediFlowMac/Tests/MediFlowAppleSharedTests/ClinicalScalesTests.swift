import XCTest
@testable import MediFlowAppleShared

final class ClinicalScalesTests: XCTestCase {
    private let adl = ClinicalScales.adl

    func testAdlHasSixBinaryItemsAndMaxSixSummedScoring() {
        XCTAssertEqual(adl.id, "adl")
        XCTAssertEqual(adl.questions.count, 6)
        XCTAssertEqual(adl.maxScore, 6)
    }

    func testAdlScoringAndInterpretationThresholds() {
        func score(_ on: Set<String>) -> ClinicalScaleResult {
            adl.result(from: Dictionary(uniqueKeysWithValues: adl.questions.map { ($0.id, on.contains($0.id) ? 1 : 0) }))
        }
        XCTAssertEqual(score([]).score, 0)
        XCTAssertEqual(score([]).interpretation, "Compromissione Grave (0-1/6)")
        XCTAssertEqual(score(["bath", "dress"]).interpretation, "Compromissione Moderata (2-3/6)")
        XCTAssertEqual(score(["bath", "dress", "toilet", "transfer"]).interpretation, "Compromissione Lieve (4-5/6)")
        let full = score(["bath", "dress", "toilet", "transfer", "cont", "feed"])
        XCTAssertEqual(full.score, 6)
        XCTAssertEqual(full.interpretation, "Autonomia Conservata (6/6)")
    }

    func testMetadataJsonMatchesWebShape() {
        let result = adl.result(from: ["bath": 1, "dress": 1, "toilet": 0, "transfer": 0, "cont": 0, "feed": 0])
        let json = ClinicalScales.metadataJSON(definition: adl, result: result)!
        // The web persists { title, scaleId, score, interpretation, answers }.
        XCTAssertTrue(json.contains("\"scaleId\":\"adl\""))
        XCTAssertTrue(json.contains("\"score\":2"))
        XCTAssertTrue(json.contains("\"title\":\"ADL (Indice di Katz)\""))
        XCTAssertTrue(json.contains("\"interpretation\":\"Compromissione Moderata (2-3/6)\""))
        XCTAssertTrue(json.contains("\"answers\""))
        // It must be valid JSON that re-parses.
        XCTAssertNoThrow(try JSONSerialization.jsonObject(with: Data(json.utf8)))
    }

    func testContentSummaryIsHumanReadable() {
        let result = adl.result(from: Dictionary(uniqueKeysWithValues: adl.questions.map { ($0.id, 1) }))
        let summary = ClinicalScales.contentSummary(definition: adl, result: result)
        XCTAssertTrue(summary.contains("Punteggio: 6"))
        XCTAssertTrue(summary.contains("Autonomia Conservata"))
    }
}
