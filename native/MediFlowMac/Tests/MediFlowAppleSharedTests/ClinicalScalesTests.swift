// @Codex MF085-002/003: complete vectors replace impossible partial-total injections; legacy literals are tested in history.
import XCTest
@testable import MediFlowAppleShared

final class ClinicalScalesTests: XCTestCase {
    private let adl = ClinicalScales.adl

    func testAdlHasSixBinaryItemsAndMaxSixSummedScoring() {
        XCTAssertEqual(adl.id, "adl")
        XCTAssertEqual(adl.questions.count, 6)
        XCTAssertEqual(adl.maxScore, 6)
    }

    func testAdlScoringAndInterpretationThresholds() throws {
        func score(_ on: Set<String>) throws -> ClinicalScaleResult {
            try adl.result(from: Dictionary(uniqueKeysWithValues: adl.questions.map { ($0.id, on.contains($0.id) ? 1 : 0) }))
        }
        XCTAssertEqual(try score([]).score, 0)
        XCTAssertEqual(try score([]).interpretation, "Compromissione Grave (0-1/6)")
        XCTAssertEqual(try score(["bath", "dress"]).interpretation, "Compromissione Moderata (2-3/6)")
        XCTAssertEqual(try score(["bath", "dress", "toilet", "transfer"]).interpretation, "Compromissione Lieve (4-5/6)")
        let full = try score(["bath", "dress", "toilet", "transfer", "cont", "feed"])
        XCTAssertEqual(full.score, 6)
        XCTAssertEqual(full.interpretation, "Autonomia Conservata (6/6)")
    }

    func testMetadataJsonMatchesWebShape() throws {
        let result = try adl.result(from: ["bath": 1, "dress": 1, "toilet": 0, "transfer": 0, "cont": 0, "feed": 0])
        let json = try ClinicalScales.metadataJSON(definition: adl, result: result)
        // The web persists { title, scaleId, score, interpretation, answers }.
        XCTAssertTrue(json.contains("\"scaleId\":\"adl\""))
        XCTAssertTrue(json.contains("\"score\":2"))
        XCTAssertTrue(json.contains("\"title\":\"ADL (Indice di Katz)\""))
        XCTAssertTrue(json.contains("\"interpretation\":\"Compromissione Moderata (2-3/6)\""))
        XCTAssertTrue(json.contains("\"answers\""))
        // It must be valid JSON that re-parses.
        XCTAssertNoThrow(try JSONSerialization.jsonObject(with: Data(json.utf8)))
    }

    func testContentSummaryIsHumanReadable() throws {
        let result = try adl.result(from: Dictionary(uniqueKeysWithValues: adl.questions.map { ($0.id, 1) }))
        let summary = ClinicalScales.contentSummary(definition: adl, result: result)
        XCTAssertTrue(summary.contains("Punteggio: 6"))
        XCTAssertTrue(summary.contains("Autonomia Conservata"))
    }

    // --- Scale library (G1 parity: Tinetti/IADL/MMSE/GDS added) ---

    // Build a complete in-domain answer vector, never inject a total into one item.
    private func interpretation(_ def: ClinicalScaleDefinition, at total: Int) throws -> String {
        var remainder = total
        var answers: [String: Int] = [:]
        for question in def.questions {
            let value = question.options.map(\.value).filter { $0 <= remainder }.max() ?? 0
            answers[question.id] = value
            remainder -= value
        }
        XCTAssertEqual(remainder, 0, "Synthetic total must be representable by actual options")
        return try def.result(from: answers).interpretation
    }

    func testLibraryOrderMatchesWeb() {
        XCTAssertEqual(ClinicalScales.all.map(\.id), ["tinetti-poma28-v1", "adl", "iadl", "mmse", "gds"])
    }

    func testQuestionCountsMatchWeb() {
        XCTAssertEqual(ClinicalScales.tinetti.questions.count, 17) // Legacy remains distinct.
        XCTAssertEqual(ClinicalScales.tinettiPOMA28V1.questions.count, 20)
        XCTAssertEqual(ClinicalScales.adl.questions.count, 6)
        XCTAssertEqual(ClinicalScales.iadl.questions.count, 8)
        XCTAssertEqual(ClinicalScales.mmse.questions.count, 28) // 28 items, but 30 max points (lang4 worth 3)
        XCTAssertEqual(ClinicalScales.gds.questions.count, 15)
    }

    func testMaxScoresMatchOptionSums() {
        // Tinetti options sum to 24 (the "Max 28" in the description is web text only).
        XCTAssertEqual(ClinicalScales.tinetti.maxScore, 24)
        XCTAssertEqual(ClinicalScales.tinettiPOMA28V1.maxScore, 28)
        XCTAssertEqual(ClinicalScales.iadl.maxScore, 8)
        XCTAssertEqual(ClinicalScales.mmse.maxScore, 30)
        XCTAssertEqual(ClinicalScales.gds.maxScore, 15)
    }

    func testCorrectedTinettiNeverClassifiesAndLegacyCannotBeRecomputed() throws {
        for total in [0, 18, 24, 25, 28] {
            XCTAssertEqual(try interpretation(ClinicalScales.tinettiPOMA28V1, at: total), ClinicalScales.tinettiNonclassification)
        }
        XCTAssertThrowsError(try ClinicalScales.tinetti.result(from: [:]))
    }

    func testMmseInterpretationThresholds() throws {
        XCTAssertEqual(try interpretation(ClinicalScales.mmse, at: 9), "Decadimento Grave (< 10)")
        XCTAssertEqual(try interpretation(ClinicalScales.mmse, at: 17), "Decadimento Moderato-Grave (10-17)")
        XCTAssertEqual(try interpretation(ClinicalScales.mmse, at: 23), "Decadimento Lieve-Moderato (18-23)")
        XCTAssertEqual(try interpretation(ClinicalScales.mmse, at: 24), "Assenza di decadimento cognitivo (24-30)")
    }

    func testGdsInterpretationThresholds() throws {
        XCTAssertEqual(try interpretation(ClinicalScales.gds, at: 5), "Normale (0-5)")
        XCTAssertEqual(try interpretation(ClinicalScales.gds, at: 6), "Depressione Lieve (6-10)")
        XCTAssertEqual(try interpretation(ClinicalScales.gds, at: 11), "Depressione Severa (11-15)")
    }

    func testIadlInterpretationInterpolatesScore() throws {
        XCTAssertEqual(
            try interpretation(ClinicalScales.iadl, at: 8),
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

    func testCorrectedTinettiMetadataJsonShape() throws {
        let definition = ClinicalScales.tinettiPOMA28V1
        let result = try definition.result(from: Dictionary(uniqueKeysWithValues: definition.questions.map { ($0.id, $0.options.map(\.value).max()!) }))
        let json = try ClinicalScales.metadataJSON(definition: definition, result: result)
        XCTAssertTrue(json.contains("\"scaleId\":\"tinetti-poma28-v1\""))
        XCTAssertTrue(json.contains("\"score\":28"))
        XCTAssertTrue(json.contains("\"definitionVersion\":\"mediflow.poma28.v1\""))
        XCTAssertTrue(json.contains("\"riskClassification\":\"not-classified\""))
        XCTAssertNoThrow(try JSONSerialization.jsonObject(with: Data(json.utf8)))
    }
}
