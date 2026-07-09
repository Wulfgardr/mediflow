import XCTest
@testable import MediFlowAppleShared

/* @Codex */
final class ScaleHistoryPresentationTests: XCTestCase {
    func testRunnerMetadataBuildsHistoryItemWithNameAndScore() {
        let definition = ClinicalScales.adl
        let result = definition.result(from: ["bath": 1, "dress": 1, "toilet": 0, "transfer": 0, "cont": 0, "feed": 0])
        let entry = makeEntry(
            type: "scale",
            title: definition.title,
            content: ClinicalScales.contentSummary(definition: definition, result: result),
            metadata: ClinicalScales.metadataJSON(definition: definition, result: result)
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
