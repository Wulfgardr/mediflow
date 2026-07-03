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

    // --- Scale library (G1 parity: Tinetti/IADL/MMSE/GDS added) ---

    // Inject an arbitrary total by putting it on the first question; result() sums
    // answers over the questions, so this exercises the interpret() thresholds
    // directly (independent of per-option validity).
    private func interpretation(_ def: ClinicalScaleDefinition, at total: Int) -> String {
        def.result(from: [def.questions[0].id: total]).interpretation
    }

    func testLibraryOrderMatchesWeb() {
        XCTAssertEqual(ClinicalScales.all.map(\.id), ["tinetti", "adl", "iadl", "mmse", "gds"])
    }

    func testQuestionCountsMatchWeb() {
        XCTAssertEqual(ClinicalScales.tinetti.questions.count, 17)
        XCTAssertEqual(ClinicalScales.adl.questions.count, 6)
        XCTAssertEqual(ClinicalScales.iadl.questions.count, 8)
        XCTAssertEqual(ClinicalScales.mmse.questions.count, 28) // 28 items, but 30 max points (lang4 worth 3)
        XCTAssertEqual(ClinicalScales.gds.questions.count, 15)
    }

    func testMaxScoresMatchOptionSums() {
        // Tinetti options sum to 24 (the "Max 28" in the description is web text only).
        XCTAssertEqual(ClinicalScales.tinetti.maxScore, 24)
        XCTAssertEqual(ClinicalScales.iadl.maxScore, 8)
        XCTAssertEqual(ClinicalScales.mmse.maxScore, 30)
        XCTAssertEqual(ClinicalScales.gds.maxScore, 15)
    }

    func testTinettiInterpretationThresholds() {
        XCTAssertEqual(interpretation(ClinicalScales.tinetti, at: 18), "ALTO Rischio di Caduta (< 19)")
        XCTAssertEqual(interpretation(ClinicalScales.tinetti, at: 24), "MEDIO Rischio di Caduta (19-24)")
        XCTAssertEqual(interpretation(ClinicalScales.tinetti, at: 25), "BASSO Rischio di Caduta (> 24)")
    }

    func testMmseInterpretationThresholds() {
        XCTAssertEqual(interpretation(ClinicalScales.mmse, at: 9), "Decadimento Grave (< 10)")
        XCTAssertEqual(interpretation(ClinicalScales.mmse, at: 17), "Decadimento Moderato-Grave (10-17)")
        XCTAssertEqual(interpretation(ClinicalScales.mmse, at: 23), "Decadimento Lieve-Moderato (18-23)")
        XCTAssertEqual(interpretation(ClinicalScales.mmse, at: 24), "Assenza di decadimento cognitivo (24-30)")
    }

    func testGdsInterpretationThresholds() {
        XCTAssertEqual(interpretation(ClinicalScales.gds, at: 5), "Normale (0-5)")
        XCTAssertEqual(interpretation(ClinicalScales.gds, at: 6), "Depressione Lieve (6-10)")
        XCTAssertEqual(interpretation(ClinicalScales.gds, at: 11), "Depressione Severa (11-15)")
    }

    func testIadlInterpretationInterpolatesScore() {
        XCTAssertEqual(
            interpretation(ClinicalScales.iadl, at: 8),
            "Punteggio totale: 8/8. (Minore è il punteggio, maggiore è la dipendenza strumentale)."
        )
    }

    // GDS positive items map Si->0 / No->+1; negative items map No->0 / Si->+1.
    func testGdsPerItemOptionOrderIsInverted() {
        func options(_ id: String) -> [ClinicalScaleOption] {
            ClinicalScales.gds.questions.first { $0.id == id }!.options
        }
        XCTAssertEqual(options("g1"), [ClinicalScaleOption(label: "Sì", value: 0), ClinicalScaleOption(label: "No (+1)", value: 1)])
        XCTAssertEqual(options("g2"), [ClinicalScaleOption(label: "No", value: 0), ClinicalScaleOption(label: "Sì (+1)", value: 1)])
    }

    func testTinettiMetadataJsonShape() {
        let result = ClinicalScales.tinetti.result(from: [ClinicalScales.tinetti.questions[0].id: 20])
        let json = ClinicalScales.metadataJSON(definition: ClinicalScales.tinetti, result: result)!
        XCTAssertTrue(json.contains("\"scaleId\":\"tinetti\""))
        XCTAssertTrue(json.contains("\"score\":20"))
        XCTAssertTrue(json.contains("\"title\":\"Scala Tinetti (Balance & Gait)\""))
        XCTAssertNoThrow(try JSONSerialization.jsonObject(with: Data(json.utf8)))
    }
}
