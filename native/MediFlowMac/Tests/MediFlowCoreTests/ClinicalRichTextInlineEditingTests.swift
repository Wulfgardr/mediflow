import Foundation
import XCTest
@testable import MediFlowCore

/* @Codex */
final class ClinicalRichTextInlineEditingTests: XCTestCase {
    func testMixedExistingParagraphIsEditableAndFormatsOnlySelectedWord() throws {
        let original = "<p><strong>Prima</strong> seconda terza</p>"
        var document = ClinicalRichTextEditorDocument.load(html: original)
        let block = try XCTUnwrap(document.blocks.first)
        XCTAssertFalse(block.isPreserved)
        XCTAssertEqual(block.runs?.count, 2)
        XCTAssertEqual(document.renderedHTML, original)
        XCTAssertTrue(document.toggleStyle(id: block.id, style: .italic, range: NSRange(location: 6, length: 7)))
        XCTAssertEqual(document.renderedHTML, "<p><strong>Prima</strong> <em>seconda</em> terza</p>")
        XCTAssertEqual(document.blocks[0].id, block.id)
        XCTAssertEqual(ClinicalRichTextEditorDocument.load(html: document.renderedHTML).renderedHTML, document.renderedHTML)
    }

    func testBalancedNonCanonicalInlineNestingKeepsOriginalUntilAnActualEdit() throws {
        let original = "<p><strong>Uno <em>due</em> tre</strong></p>"
        var document = ClinicalRichTextEditorDocument.load(html: original)
        let block = try XCTUnwrap(document.blocks.first)
        XCTAssertFalse(block.isPreserved)
        XCTAssertEqual(document.renderedHTML, original)
        XCTAssertTrue(document.toggleStyle(id: block.id, style: .underline, range: NSRange(location: 4, length: 3)))
        XCTAssertEqual(document.renderedHTML, "<p><strong>Uno </strong><strong><em><u>due</u></em></strong><strong> tre</strong></p>")
        XCTAssertTrue(document.toggleStyle(id: block.id, style: .underline, range: NSRange(location: 4, length: 3)))
        XCTAssertEqual(document.renderedHTML, original, "Undoing the semantic edit restores original tag grouping")
    }

    func testOverlappingStylesAndRemovalSplitOnlyTheirOwnRanges() throws {
        var document = ClinicalRichTextEditorDocument.load(html: "<p>ABCDEF</p>")
        let id = try XCTUnwrap(document.blocks.first?.id)
        XCTAssertTrue(document.toggleStyle(id: id, style: .bold, range: NSRange(location: 1, length: 4)))
        XCTAssertTrue(document.toggleStyle(id: id, style: .italic, range: NSRange(location: 3, length: 3)))
        XCTAssertTrue(document.toggleStyle(id: id, style: .bold, range: NSRange(location: 2, length: 2)))
        XCTAssertEqual(document.renderedHTML, "<p>A<strong>B</strong>C<em>D</em><strong><em>E</em></strong><em>F</em></p>")
    }

    func testMixedSelectionToggleEnablesStyleAcrossSelectionThenRemovesIt() throws {
        var document = ClinicalRichTextEditorDocument.load(html: "<p><strong>A</strong>B</p>")
        let id = try XCTUnwrap(document.blocks.first?.id)
        let range = NSRange(location: 0, length: 2)
        XCTAssertTrue(document.toggleStyle(id: id, style: .bold, range: range))
        XCTAssertEqual(document.renderedHTML, "<p><strong>AB</strong></p>")
        XCTAssertTrue(document.toggleStyle(id: id, style: .bold, range: range))
        XCTAssertEqual(document.renderedHTML, "<p>AB</p>")
    }

    func testReplacementPreservesNeighborStylesAcrossGraphemeBoundaries() throws {
        var document = ClinicalRichTextEditorDocument.load(html: "<p>A<strong>👩🏽‍⚕️</strong>e\u{301}Z</p>")
        let id = try XCTUnwrap(document.blocks.first?.id)
        let text = try XCTUnwrap(document.blocks[0].runs).map(\.text).joined() as NSString
        let emoji = text.range(of: "👩🏽‍⚕️")
        XCTAssertFalse(document.replaceText(id: id, range: NSRange(location: emoji.location, length: 1), with: []))
        XCTAssertFalse(document.replaceText(id: id, range: NSRange(location: NSNotFound, length: 1), with: []))
        XCTAssertTrue(document.replaceText(id: id, range: emoji, with: [ClinicalRichTextTextRun(text: "🙂", isItalic: true)]))
        XCTAssertEqual(document.renderedHTML, "<p>A<em>🙂</em>e\u{301}Z</p>")
        XCTAssertEqual(document.blocks[0].id, id)
    }

    func testMissingNativeSelectionIsNotInterpretedAsTextRange() {
        let runs = [ClinicalRichTextTextRun(text: "Sintetico")]
        XCTAssertTrue(ClinicalInlineEditing.slice(runs, range: NSRange(location: NSNotFound, length: 1)).isEmpty)
        XCTAssertTrue(ClinicalInlineEditing.slice(runs, range: NSRange(location: 5, length: 20)).isEmpty)
        XCTAssertNil(ClinicalInlineEditing.toggling(.bold, in: runs, range: NSRange(location: NSNotFound, length: 1)))
    }

    func testEntitiesAreDisplayedAsTextAndTypedEntitiesStayLiteral() throws {
        let original = "<p>A &amp; B &lt; C &#233;</p>"
        var document = ClinicalRichTextEditorDocument.load(html: original)
        let block = try XCTUnwrap(document.blocks.first)
        XCTAssertEqual(block.runs?.map(\.text).joined(), "A & B < C é")
        XCTAssertEqual(document.renderedHTML, original)
        XCTAssertTrue(document.replaceText(
            id: block.id, range: ("A & B < C é" as NSString).range(of: "é"),
            with: [ClinicalRichTextTextRun(text: "&lt; <test>", isUnderlined: true)]
        ))
        XCTAssertEqual(document.renderedHTML, "<p>A &amp; B &lt; C <u>&amp;lt; &lt;test></u></p>")
        let reloaded = ClinicalRichTextEditorDocument.load(html: document.renderedHTML)
        XCTAssertEqual(reloaded.blocks[0].runs?.map(\.text).joined(), "A & B < C &lt; <test>")
    }

    func testAllSupportedBlockKindsAcceptMixedInlineRuns() throws {
        for html in [
            "<h2>Uno <em>due</em></h2>", "<h3>Uno <s>due</s></h3>",
            "<ul><li>Uno <u>due</u></li><li>Tre</li></ul>",
            "<ol><li><p>Uno <strong>due</strong></p></li></ol>",
            "<blockquote><p>Uno <em>due</em></p></blockquote>"
        ] {
            var document = ClinicalRichTextEditorDocument.load(html: html)
            let block = try XCTUnwrap(document.blocks.first)
            XCTAssertFalse(block.isPreserved, html)
            XCTAssertEqual(document.renderedHTML, html)
            XCTAssertTrue(document.toggleStyle(id: block.id, style: .bold, range: NSRange(location: 0, length: 3)), html)
            XCTAssertEqual(
                ClinicalRichText.render(document: ClinicalRichText.parse(html: document.renderedHTML)),
                document.renderedHTML
            )
        }
    }

    func testUnsupportedStructureRemainsOpaqueAndSurvivesNeighborEdits() throws {
        for opaque in [
            "<h1>Legacy</h1>", "<p><strong>Non chiuso</p>",
            "<ul><li>Uno<ul><li>Due</li></ul></li></ul>",
            "<blockquote><blockquote><p>Annidato</p></blockquote></blockquote>",
            "<p>&NotEqualTilde;</p>",
            "<p><strong>A <em>&NotEqualTilde;</em></strong></p>"
        ] {
            var document = ClinicalRichTextEditorDocument.load(html: opaque)
            XCTAssertTrue(document.blocks.allSatisfy(\.isPreserved), opaque)
            XCTAssertEqual(document.renderedHTML, opaque)
            let preserved = try XCTUnwrap(document.blocks.first)
            XCTAssertFalse(document.updateRuns(id: preserved.id, runs: [ClinicalRichTextTextRun(text: "Sovrascrittura")]))
            document.appendNewBlock(kind: .paragraph)
            let id = try XCTUnwrap(document.blocks.last?.id)
            document.updateText(id: id, text: "Nota sintetica")
            XCTAssertEqual(document.renderedHTML, opaque + "<p>Nota sintetica</p>")
        }
    }

    func testStaleUpdateCannotOverwriteExternalEditOrResurrectRemovedUUID() throws {
        var document = ClinicalRichTextEditorDocument.load(html: "<p>Prima</p>")
        let block = try XCTUnwrap(document.blocks.first)
        let snapshot = try XCTUnwrap(block.runs)
        document.updateText(id: block.id, text: "Aggiornato")
        XCTAssertFalse(document.updateRuns(id: block.id, runs: snapshot, expecting: snapshot))
        document.removeBlock(id: block.id)
        document.appendNewBlock(kind: .paragraph)
        XCTAssertFalse(document.updateRuns(id: block.id, runs: snapshot))
        XCTAssertNotEqual(document.blocks[0].id, block.id)
    }
}
