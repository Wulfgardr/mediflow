import Foundation
import XCTest
@testable import MediFlowCore

/* @Codex */
final class ClinicalRichTextEditorTests: XCTestCase {
    private struct Fixture: Decodable {
        let name: String
        let input: String
        let sanitized: String
    }

    private func fixtureURL() -> URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("contracts/clinical-rich-text-fixtures.v1.json")
    }

    private func loadFixtures() throws -> [Fixture] {
        let data = try Data(contentsOf: fixtureURL())
        return try JSONDecoder().decode([Fixture].self, from: data)
    }

    private func text(_ value: String, bold: Bool = false, italic: Bool = false, underlined: Bool = false, struckThrough: Bool = false) -> ClinicalRichTextInline {
        .text(ClinicalRichTextTextRun(text: value, isBold: bold, isItalic: italic, isUnderlined: underlined, isStruckThrough: struckThrough))
    }

    // MARK: - Round trip over the S5 web-parity fixtures

    // @Codex: Opening an existing record and saving without edits preserves
    // every sanitized byte, including the four formerly normalized fragments.
    func testEditorRoundTripsWebFixtures() throws {
        let fixtures = try loadFixtures()
        XCTAssertEqual(fixtures.count, 40)
        for fixture in fixtures {
            let rebuilt = ClinicalRichTextEditorDocument.load(html: fixture.sanitized).renderedHTML
            XCTAssertEqual(rebuilt, fixture.sanitized, "No-op save changed fixture \(fixture.name)")
        }
    }

    /// Unsupported structural content the inline editor cannot
    /// represent losslessly must degrade to an opaque, non-editable block
    /// rather than being silently rewritten, and that opaque block must still
    /// render back byte-identical to the original.
    func testUnflattenableContentIsPreservedNotRewritten() throws {
        let fixtures = try loadFixtures()
        let preservedFixtureNames: Set<String> = [
            "malformed-unclosed-allowed-tag",
            "malformed-crossed-nesting",
            "nested-lists",
            "nested-blockquotes",
        ]
        for name in preservedFixtureNames {
            guard let fixture = fixtures.first(where: { $0.name == name }) else {
                return XCTFail("fixture \(name) missing")
            }
            let document = ClinicalRichTextEditorDocument.load(html: fixture.sanitized)
            XCTAssertTrue(
                document.blocks.contains { $0.isPreserved },
                "Fixture \(name) was expected to contain at least one preserved block"
            )
            XCTAssertEqual(document.renderedHTML, fixture.sanitized, "Preserved content for \(name) did not round-trip byte-exact")
        }
    }

    // MARK: - Editable model behavior

    func testEmptyDocumentIsEffectivelyEmpty() {
        XCTAssertTrue(ClinicalRichTextEditorDocument().isEffectivelyEmpty)
    }

    func testBlankParagraphIsEffectivelyEmpty() {
        var document = ClinicalRichTextEditorDocument()
        document.appendNewBlock(kind: .paragraph)
        XCTAssertTrue(document.isEffectivelyEmpty)
        document.updateText(id: document.blocks[0].id, text: "   ")
        XCTAssertTrue(document.isEffectivelyEmpty)
        document.updateText(id: document.blocks[0].id, text: "Testo")
        XCTAssertFalse(document.isEffectivelyEmpty)
    }

    func testPreservedBlockAlwaysCountsAsNonEmpty() {
        let document = ClinicalRichTextEditorDocument.load(document: ClinicalRichTextDocument(blocks: [
            .heading(level: .one, content: [text("Titolo legacy")]),
        ]))
        XCTAssertFalse(document.isEffectivelyEmpty)
        XCTAssertTrue(document.blocks[0].isPreserved)
    }

    func testAppendEditToggleAndRemoveBlock() {
        var document = ClinicalRichTextEditorDocument()
        document.appendNewBlock(kind: .paragraph)
        let id = document.blocks[0].id
        document.updateText(id: id, text: "Piano di cura")
        document.toggleBold(id: id)
        document.toggleItalic(id: id)
        // render(inlines:) wraps struck -> underline -> italic -> bold, bold
        // ends up outermost (ClinicalRichText.swift render(inlines:)).
        XCTAssertEqual(document.renderedHTML, "<p><strong><em>Piano di cura</em></strong></p>")

        document.toggleItalic(id: id)
        document.setKind(id: id, kind: .heading2)
        XCTAssertEqual(document.renderedHTML, "<h2><strong>Piano di cura</strong></h2>")

        document.removeBlock(id: id)
        XCTAssertTrue(document.blocks.isEmpty)
        XCTAssertEqual(document.renderedHTML, "")
    }

    func testConsecutiveBulletItemsGroupIntoOneList() {
        var document = ClinicalRichTextEditorDocument()
        document.appendNewBlock(kind: .bulletItem)
        document.updateText(id: document.blocks[0].id, text: "Emocromo")
        document.appendNewBlock(kind: .bulletItem)
        document.updateText(id: document.blocks[1].id, text: "PCR")
        XCTAssertEqual(document.renderedHTML, "<ul><li>Emocromo</li><li>PCR</li></ul>")
    }

    func testDifferentListKindsBetweenItemsProduceSeparateLists() {
        var document = ClinicalRichTextEditorDocument()
        document.appendNewBlock(kind: .bulletItem)
        document.updateText(id: document.blocks[0].id, text: "Uno")
        document.appendNewBlock(kind: .numberedItem)
        document.updateText(id: document.blocks[1].id, text: "Due")
        document.appendNewBlock(kind: .bulletItem)
        document.updateText(id: document.blocks[2].id, text: "Tre")
        XCTAssertEqual(
            document.renderedHTML,
            "<ul><li>Uno</li></ul><ol><li>Due</li></ol><ul><li>Tre</li></ul>"
        )
    }

    func testBlockquoteRoundTrips() {
        var document = ClinicalRichTextEditorDocument()
        document.appendNewBlock(kind: .blockquote)
        document.updateText(id: document.blocks[0].id, text: "Riferito dal caregiver")
        XCTAssertEqual(document.renderedHTML, "<blockquote><p>Riferito dal caregiver</p></blockquote>")

        let reparsed = ClinicalRichTextEditorDocument.load(html: document.renderedHTML)
        XCTAssertEqual(reparsed.blocks.count, 1)
        guard case .editable(.blockquote, let span) = reparsed.blocks[0].storage else {
            return XCTFail("expected an editable blockquote block")
        }
        XCTAssertEqual(span.text, "Riferito dal caregiver")
    }

    func testManualLineBreakWithinABlockRoundTrips() {
        var document = ClinicalRichTextEditorDocument()
        document.appendNewBlock(kind: .paragraph)
        document.updateText(id: document.blocks[0].id, text: "Prima riga\nSeconda riga")
        XCTAssertEqual(document.renderedHTML, "<p>Prima riga<br>Seconda riga</p>")

        let reparsed = ClinicalRichTextEditorDocument.load(html: document.renderedHTML)
        guard case .editable(.paragraph, let span) = reparsed.blocks[0].storage else {
            return XCTFail("expected an editable paragraph")
        }
        XCTAssertEqual(span.text, "Prima riga\nSeconda riga")
    }

    // MARK: - Visit draft insertion (D5)

    func testBlocksFromVisitDraftSectionsSkipsEmptySectionsAndJoinsLines() {
        let sections = HomeBaseVisitDraftResponse.Sections(
            subjective: ["Riferisce tosse da 3 giorni", "Nessuna febbre"],
            objective: [],
            assessment: ["Quadro compatibile con bronchite"],
            plan: []
        )
        let blocks = ClinicalRichTextEditorDocument.blocksFromVisitDraftSections(sections)
        XCTAssertEqual(blocks.count, 2)
        guard case .editable(.paragraph, let subjectiveSpan) = blocks[0].storage,
              case .editable(.paragraph, let assessmentSpan) = blocks[1].storage else {
            return XCTFail("expected editable paragraphs")
        }
        XCTAssertEqual(subjectiveSpan.text, "S: Riferisce tosse da 3 giorni\nNessuna febbre")
        XCTAssertEqual(assessmentSpan.text, "A: Quadro compatibile con bronchite")
    }

    func testBlocksFromVisitDraftSectionsEscapesAngleBracketsOnRender() {
        let sections = HomeBaseVisitDraftResponse.Sections(
            subjective: ["Riferisce <dolore> toracico"],
            objective: [], assessment: [], plan: []
        )
        let blocks = ClinicalRichTextEditorDocument.blocksFromVisitDraftSections(sections)
        var document = ClinicalRichTextEditorDocument()
        document.blocks.append(contentsOf: blocks)
        XCTAssertEqual(document.renderedHTML, "<p>S: Riferisce &lt;dolore> toracico</p>")
    }

    func testBlocksFromVisitDraftSectionsEmptyEverywhereProducesNoBlocks() {
        let sections = HomeBaseVisitDraftResponse.Sections(subjective: [], objective: [], assessment: [], plan: [])
        XCTAssertTrue(ClinicalRichTextEditorDocument.blocksFromVisitDraftSections(sections).isEmpty)
    }
}
