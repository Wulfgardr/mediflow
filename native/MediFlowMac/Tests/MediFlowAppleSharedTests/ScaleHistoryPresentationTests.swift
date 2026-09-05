import XCTest
@testable import MediFlowAppleShared

/* @Codex */
final class ScaleHistoryPresentationTests: XCTestCase {
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
