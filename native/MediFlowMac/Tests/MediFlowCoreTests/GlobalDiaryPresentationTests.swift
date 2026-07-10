import XCTest
@testable import MediFlowCore

final class GlobalDiaryPresentationTests: XCTestCase {
    func testCompactClinicalTextStripsTagsDecodesKnownEntitiesAndCollapsesWhitespace() {
        XCTAssertEqual(
            GlobalDiaryPresentation.compactClinicalText(" <p>Prima&nbsp; riga &amp; &lt;ok&gt;</p>\n <strong>seconda</strong> "),
            "Prima riga & <ok> seconda"
        )
        XCTAssertEqual(GlobalDiaryPresentation.compactClinicalText(nil), "Voce senza testo clinico.")
    }

    func testCompactClinicalTextTruncatesAtWebBoundary() {
        let text = String(repeating: "a", count: 181)
        XCTAssertEqual(GlobalDiaryPresentation.compactClinicalText(text), String(repeating: "a", count: 177) + "…")
    }

    func testBuildStateJoinsFirstFiftyEntriesAndCountsSoftDeletedRowsSeparately() {
        let deletedAt = Date(timeIntervalSince1970: 1_783_500_000)
        let entries = [
            GlobalDiaryEntry(id: "one", patientId: "p1", title: "", content: "nota", deletedAt: nil),
            GlobalDiaryEntry(id: "two", patientId: "p1", title: "Eliminata", content: "vecchia", deletedAt: deletedAt),
            GlobalDiaryEntry(id: "three", patientId: "gone", title: "", content: nil, deletedAt: nil)
        ] + (0..<50).map { index in
            GlobalDiaryEntry(id: "extra-\(index)", patientId: "extra", title: "x", content: "x", deletedAt: nil)
        }
        let state = GlobalDiaryPresentation.buildState(
            entries: entries,
            patients: [GlobalDiaryPatient(id: "p1", name: "Ada Rossi", code: "RSSDAA")]
        )
        XCTAssertEqual(state.entries.count, 50)
        XCTAssertEqual(state.activeCount, 49)
        XCTAssertEqual(state.patientCount, 3)
        XCTAssertEqual(state.entries[0].patientName, "Ada Rossi")
        XCTAssertEqual(state.entries[0].title, "Voce diario")
        XCTAssertFalse(state.entries[0].deleted)
        XCTAssertTrue(state.entries[1].deleted)
        XCTAssertEqual(state.entries[2].patientName, "Paziente non trovato")
        XCTAssertEqual(state.entries[2].patientCode, "CF non disponibile")
        XCTAssertEqual(state.entries[2].preview, "Voce senza testo clinico.")
    }
}
