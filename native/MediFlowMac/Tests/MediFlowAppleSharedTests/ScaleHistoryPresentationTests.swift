import XCTest
@testable import MediFlowAppleShared

/* @Codex */
final class ScaleHistoryPresentationTests: XCTestCase {
    func testStoredScreeningTextAndVersionRemainIndependentOfCurrentPolicy() throws {
        for (id, score, interpretation) in [("mmse", 24, "Assenza di decadimento cognitivo (24-30)"),
                                           ("gds", 6, "Depressione Lieve (6-10)")] {
            let raw = "{\"scaleId\":\"\(id)\",\"score\":\(score),\"interpretation\":\"\(interpretation)\"}"
            let entry = makeEntry(type: "scale", title: id, content: "Storico originale", metadata: raw)
            let item = try XCTUnwrap(ScaleHistoryPresentation.item(from: entry))
            XCTAssertEqual(item.interpretation, interpretation)
            XCTAssertNil(item.interpretationVersion)
            XCTAssertEqual(item.content, entry.content)
            XCTAssertEqual(entry.metadata, raw)
        }
        let definition = ClinicalScales.gds
        let submission = try ClinicalScales.prepareSubmission(definition: definition,
            answers: ["g1": 1, "g2": 1, "g3": 1, "g4": 1, "g5": 1, "g6": 1, "g7": 0, "g8": 0,
                      "g9": 0, "g10": 0, "g11": 0, "g12": 0, "g13": 0, "g14": 0, "g15": 0])
        let entry = makeEntry(type: "scale", title: definition.title,
            content: ClinicalScales.contentSummary(definition: definition, result: submission.result), metadata: submission.metadataJSON)
        let item = try XCTUnwrap(ScaleHistoryPresentation.item(from: entry))
        XCTAssertEqual(item.interpretation, submission.result.interpretation)
        XCTAssertEqual(item.interpretationVersion, "mediflow.gds15.screening-limits.v1")
        XCTAssertEqual(item.provenanceLabel, "Versione interpretazione: mediflow.gds15.screening-limits.v1")
        XCTAssertEqual(entry.metadata, submission.metadataJSON)
    }

    func testRunnerMetadataBuildsHistoryItemWithNameAndScore() throws {
        let definition = ClinicalScales.adl
        let result = try definition.result(from: ["bath": 1, "dress": 1, "toilet": 0, "transfer": 0, "cont": 0, "feed": 0])
        let entry = makeEntry(
            type: "scale",
            title: definition.title,
            content: ClinicalScales.contentSummary(definition: definition, result: result),
            metadata: try ClinicalScales.metadataJSON(definition: definition, result: result)
        )

        let item = ScaleHistoryPresentation.item(from: entry)

        XCTAssertEqual(item?.title, "ADL (Indice di Katz)")
        XCTAssertEqual(item?.scoreLabel, "2/6")
        XCTAssertEqual(item?.interpretation, "Compromissione Moderata (2-3/6)")
    }

    func testHistoryItemFallsBackToEntryFieldsWhenMetadataIsMissing() {
        let entry = makeEntry(
            type: "scale",
            title: "MMSE manuale",
            content: """
            Valutazione MMSE completata.
            Punteggio: 24
            Interpretazione: Assenza di decadimento cognitivo
            """,
            metadata: nil
        )

        let item = ScaleHistoryPresentation.item(from: entry)

        XCTAssertEqual(item?.title, "MMSE manuale")
        XCTAssertEqual(item?.scoreLabel, "24")
        XCTAssertEqual(item?.interpretation, "Assenza di decadimento cognitivo")
    }

    func testNonScaleEntryDoesNotBuildHistoryItem() {
        let entry = makeEntry(type: "note", title: "Nota", content: "Contenuto", metadata: nil)

        XCTAssertNil(ScaleHistoryPresentation.item(from: entry))
    }

    // @Codex: these are stored legacy literals, not recalculated scores or newly asserted cutoffs.
    func testLegacyHistoricalScoresAndInterpretationsAreNotRecomputed() throws {
        for (score, interpretation) in [(18, "ALTO Rischio di Caduta (< 19)"),
                                         (24, "MEDIO Rischio di Caduta (19-24)"),
                                         (25, "BASSO Rischio di Caduta (> 24)")] {
            let payload: [String: Any] = ["scaleId": "tinetti", "score": score,
                "title": "Scala Tinetti (Balance & Gait)", "interpretation": interpretation,
                "answers": ["b8": 1]]
            let metadata = String(decoding: try JSONSerialization.data(withJSONObject: payload), as: UTF8.self)
            let entry = makeEntry(type: "scale", title: "Tinetti", content: "Contenuto storico originale", metadata: metadata)
            let item = try XCTUnwrap(ScaleHistoryPresentation.item(from: entry))
            XCTAssertEqual(item.scoreLabel, String(score))
            XCTAssertEqual(item.interpretation, interpretation)
            XCTAssertEqual(item.content, entry.content)
            XCTAssertEqual(item.provenanceLabel, ClinicalScales.legacyTinettiNotice)
            XCTAssertEqual(entry.metadata, metadata)
        }
    }

    func testCorrectedMissingOrMalformedProvenanceDoesNotGainDenominator() throws {
        for instrument: Any in [NSNull(), "unknown", ["instrumentVersion": "poma28-16b12g"]] {
            let metadata = String(decoding: try JSONSerialization.data(withJSONObject: [
                "scaleId": "tinetti-poma28-v1", "score": 24,
                "interpretation": "Originale", "instrument": instrument
            ]), as: UTF8.self)
            let item = try XCTUnwrap(ScaleHistoryPresentation.item(from:
                makeEntry(type: "scale", title: "Tinetti", content: "Originale", metadata: metadata)))
            XCTAssertEqual(item.scoreLabel, "24")
            XCTAssertEqual(item.interpretation, "Originale")
            XCTAssertEqual(item.provenanceLabel, ClinicalScales.legacyTinettiNotice)
        }
    }

    private func makeEntry(
        type: String,
        title: String,
        content: String,
        metadata: String?
    ) -> HomeBaseEntrySummary {
        let date = Date(timeIntervalSince1970: 1_750_000_000)
        return HomeBaseEntrySummary(
            id: UUID().uuidString,
            patientId: "patient-1",
            type: type,
            title: title,
            date: date,
            content: content,
            setting: nil,
            metadata: metadata,
            attachments: nil,
            deletedAt: nil,
            deletionReason: nil,
            version: 1,
            createdAt: date,
            updatedAt: date
        )
    }
}
