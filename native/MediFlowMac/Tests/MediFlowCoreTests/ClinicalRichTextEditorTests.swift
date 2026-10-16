import Foundation
import XCTest
@testable import MediFlowCore

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

    // Opening an existing record and saving without edits preserves
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

    func testIndentAndOutdentListItemKeepsStylesAndFollowingSiblings() {
        let original = "<ul><li>A</li><li><strong>B [1]</strong></li><li>C</li></ul>"
        var document = ClinicalRichTextEditorDocument.load(html: original)
        let id = document.blocks[1].id
        XCTAssertFalse(document.canIncreaseIndent(id: document.blocks[0].id))
        XCTAssertTrue(document.increaseIndent(id: id))
        XCTAssertEqual(document.renderedHTML, "<ul><li>A<ul><li><strong>B [1]</strong></li></ul></li><li>C</li></ul>")
        document.updateText(id: id, text: "B rivisto [1]")
        XCTAssertTrue(document.decreaseIndent(id: id))
        XCTAssertEqual(document.renderedHTML, "<ul><li>A</li><li><strong>B rivisto [1]</strong></li><li>C</li></ul>")
    }

    func testIndentThenOutdentRestoresOriginalSanitizedBytes() {
        let original = "<ol><li><p>A</p></li><li><p><em>B <strong>C</strong></em></p></li></ol>"
        var document = ClinicalRichTextEditorDocument.load(html: original)
        let id = document.blocks[1].id
        XCTAssertTrue(document.increaseIndent(id: id))
        XCTAssertTrue(document.decreaseIndent(id: id))
        XCTAssertEqual(document.renderedHTML, original)
    }

    func testNestedMixedListsCanBeEditedAndMovedWithTheirSubtree() {
        var document = ClinicalRichTextEditorDocument.load(html: "<ol><li>A</li><li>B<ul><li>C</li></ul></li><li>D</li></ol>")
        let ids = document.blocks.map(\.id)
        XCTAssertTrue(document.blocks.allSatisfy { !$0.isPreserved })
        XCTAssertTrue(document.increaseIndent(id: ids[1]))
        XCTAssertEqual(document.renderedHTML, "<ol><li>A<ol><li>B<ul><li>C</li></ul></li></ol></li><li>D</li></ol>")
        XCTAssertEqual(document.blocks.map(\.id), ids)
        document.updateText(id: ids[2], text: "C rivisto")
        XCTAssertTrue(document.decreaseIndent(id: ids[1]))
        XCTAssertEqual(document.renderedHTML, "<ol><li>A</li><li>B<ul><li>C rivisto</li></ul></li><li>D</li></ol>")
    }

    func testOutdentNestedItemKeepsTrailingSiblingsUnderMovedItem() {
        var document = ClinicalRichTextEditorDocument.load(html: "<ul><li>A<ol><li>B</li><li>C</li></ol></li><li>D</li></ul>")
        XCTAssertTrue(document.decreaseIndent(id: document.blocks[1].id))
        XCTAssertEqual(document.renderedHTML, "<ul><li>A</li><li>B<ol><li>C</li></ol></li><li>D</li></ul>")
        XCTAssertEqual(document.blocks.compactMap(\.runs).flatMap { $0 }.map(\.text), ["A", "B", "C", "D"])
    }

    func testOutdentTopLevelItemSplitsListAndRetainsItsChildren() {
        var document = ClinicalRichTextEditorDocument.load(html: "<ul><li>A</li><li>B<ol><li>C</li></ol></li><li>D</li></ul>")
        XCTAssertTrue(document.decreaseIndent(id: document.blocks[1].id))
        XCTAssertEqual(document.renderedHTML, "<ul><li>A</li></ul><p>B</p><ol><li>C</li></ol><ul><li>D</li></ul>")
    }

    func testWebDirectNestedListIsProjectedWithoutChangingNoOpBytes() {
        let original = "<ul><li>A</li><ul><li><strong>B <em>[2]</em></strong></li></ul><li>C</li></ul>"
        var document = ClinicalRichTextEditorDocument.load(html: original)
        XCTAssertEqual(document.renderedHTML, original)
        XCTAssertEqual(document.blocks.count, 3)
        XCTAssertTrue(document.blocks.allSatisfy { !$0.isPreserved })
        document.updateText(id: document.blocks[1].id, text: "B rivisto [2]")
        XCTAssertEqual(document.blocks[1].runs?.map(\.text).joined(), "B rivisto [2]")
        XCTAssertTrue(document.decreaseIndent(id: document.blocks[1].id))
        XCTAssertEqual(document.renderedHTML, "<ul><li>A</li><li><strong>B rivisto </strong><strong><em>[2]</em></strong></li><li>C</li></ul>")
    }

    func testParagraphAndHeadingIndentAsQuotesAndCanBeOutdented() {
        for html in ["<p>A <u>[3]</u></p>", "<h2>A <u>[3]</u></h2>"] {
            var document = ClinicalRichTextEditorDocument.load(html: html)
            let id = document.blocks[0].id
            XCTAssertFalse(document.canDecreaseIndent(id: id))
            XCTAssertTrue(document.increaseIndent(id: id))
            XCTAssertEqual(document.renderedHTML, "<blockquote>" + html + "</blockquote>")
            XCTAssertTrue(document.increaseIndent(id: id))
            XCTAssertEqual(document.renderedHTML, "<blockquote><blockquote>" + html + "</blockquote></blockquote>")
            XCTAssertTrue(document.decreaseIndent(id: id))
            XCTAssertTrue(document.decreaseIndent(id: id))
            XCTAssertEqual(document.renderedHTML, html)
        }
    }

    func testMultiblockQuoteKeepsGroupingWhenEditingOrIndentingOneParagraph() {
        var document = ClinicalRichTextEditorDocument.load(html: "<blockquote><p>A [1]</p><p>B [2]</p></blockquote><p>C</p>")
        let id = document.blocks[1].id
        XCTAssertTrue(document.increaseIndent(id: id))
        XCTAssertEqual(document.renderedHTML, "<blockquote><p>A [1]</p><blockquote><p>B [2]</p></blockquote></blockquote><p>C</p>")
        XCTAssertTrue(document.decreaseIndent(id: id))
        XCTAssertTrue(document.decreaseIndent(id: id))
        XCTAssertEqual(document.renderedHTML, "<blockquote><p>A [1]</p></blockquote><p>B [2]</p><p>C</p>")
    }

    func testChangingNestedListKindRetainsDescendantsAndNeighborQuote() {
        let quote = "<blockquote><p>Citazione <em>[7]</em></p><p>Secondo periodo</p></blockquote>"
        var document = ClinicalRichTextEditorDocument.load(html: "<ul><li>A</li><li>B<ul><li>C</li></ul></li></ul>" + quote)
        document.setKind(id: document.blocks[1].id, kind: .numberedItem)
        XCTAssertEqual(document.renderedHTML, "<ul><li>A</li></ul><ol><li>B<ul><li>C</li></ul></li></ol>" + quote)
    }

    func testUnsupportedNeighborRemainsByteExactThroughIndentAndTextEdit() {
        let opaque = "<h1>Legacy [4]</h1><p><strong>Non chiuso</p>"
        var document = ClinicalRichTextEditorDocument.load(html: opaque)
        document.appendNewBlock(kind: .paragraph)
        let id = document.blocks.last!.id
        document.updateText(id: id, text: "Nota [5]")
        XCTAssertTrue(document.increaseIndent(id: id))
        XCTAssertEqual(document.renderedHTML, opaque + "<blockquote><p>Nota [5]</p></blockquote>")
        let preserved = document.blocks.first!.id
        XCTAssertFalse(document.increaseIndent(id: preserved))
        XCTAssertFalse(document.decreaseIndent(id: preserved))
    }

    func testHeadingInsideListRetainsHeadingWhenOutdented() {
        var document = ClinicalRichTextEditorDocument.load(html: "<ul><li>A</li><li><h2>B [1]</h2></li></ul>")
        let id = document.blocks[1].id
        XCTAssertTrue(document.increaseIndent(id: id))
        XCTAssertEqual(document.renderedHTML, "<ul><li>A<ul><li><h2>B [1]</h2></li></ul></li></ul>")
        XCTAssertTrue(document.decreaseIndent(id: id))
        XCTAssertTrue(document.decreaseIndent(id: id))
        XCTAssertEqual(document.renderedHTML, "<ul><li>A</li></ul><h2>B [1]</h2>")
    }

    func testFirstIndentedWebListAndMalformedListsStayOpaque() {
        for original in [
            "<ul><ul><li>A</li></ul><li>B</li></ul>",
            "<ul><li>A<li>B</li></li></ul>"
        ] {
            var document = ClinicalRichTextEditorDocument.load(html: original)
            XCTAssertTrue(document.blocks.allSatisfy(\.isPreserved))
            document.appendNewBlock(kind: .paragraph)
            document.updateText(id: document.blocks.last!.id, text: "Nota")
            XCTAssertEqual(document.renderedHTML, original + "<p>Nota</p>")
        }
    }

    func testUnknownOrRemovedBlockCannotChangeIndentation() {
        var document = ClinicalRichTextEditorDocument.load(html: "<ul><li>A</li><li>B</li></ul>")
        let removed = document.blocks[1].id
        document.removeBlock(id: removed)
        let before = document
        XCTAssertFalse(document.increaseIndent(id: removed))
        XCTAssertFalse(document.decreaseIndent(id: removed))
        XCTAssertEqual(document, before)
    }

    func testEveryWebFixtureRetainsContentThroughAvailableStructuralCommands() throws {
        func content(_ document: ClinicalRichTextEditorDocument) -> String {
            document.blocks.map { block in
                block.runs?.map(\.text).joined() ?? block.preservedPreviewText ?? ""
            }.joined(separator: "|")
        }
        for fixture in try loadFixtures() {
            let original = ClinicalRichTextEditorDocument.load(html: fixture.sanitized)
            for block in original.blocks where !block.isPreserved {
                for action in 0..<3 {
                    var edited = original
                    switch action {
                    case 0: _ = edited.increaseIndent(id: block.id)
                    case 1: _ = edited.decreaseIndent(id: block.id)
                    default: edited.setKind(id: block.id, kind: .paragraph)
                    }
                    XCTAssertEqual(content(edited), content(original), "Content changed for \(fixture.name), command \(action)")
                    let reloaded = ClinicalRichTextEditorDocument.load(html: edited.renderedHTML)
                    XCTAssertEqual(content(reloaded), content(original), "Reload lost content for \(fixture.name), command \(action)")
                    XCTAssertEqual(reloaded.renderedHTML, edited.renderedHTML)
                }
            }
        }
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
