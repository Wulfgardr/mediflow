import XCTest
@testable import MediFlowAppleShared

/* @Codex */
final class ClinicalContentRenderingTests: XCTestCase {
    @MainActor
    func testSimpleHTMLRendersReadableText() {
        let rendered = ClinicalContentRendering.attributedString(from: "<p><strong>Pressione</strong> stabile</p>")
        XCTAssertEqual(String(rendered.characters).trimmingCharacters(in: .whitespacesAndNewlines), "Pressione stabile")
    }

    @MainActor
    func testPlainTextPassesThroughUnchanged() {
        let text = "Nota clinica senza markup < 3"
        let rendered = ClinicalContentRendering.attributedString(from: text)
        XCTAssertEqual(String(rendered.characters), text)
    }

    @MainActor
    func testMalformedHTMLFallsBackToRawText() {
        let malformed = "<p><"
        let rendered = ClinicalContentRendering.attributedString(from: malformed)
        XCTAssertEqual(String(rendered.characters), malformed)
    }

    func testSOAPTemplateMatchesWebVisitDraftShape() {
        XCTAssertEqual(
            ClinicalSOAPTemplate.html,
            "<p>S: motivo della visita, sintomi riferiti, contesto funzionale</p>" +
            "<p>O: parametri, esame obiettivo, elementi documentali</p>" +
            "<p>A: valutazione clinica da rivedere</p>" +
            "<p>P: piano, follow-up, indicazioni condivise</p>"
        )
    }

    // S7 (Wave 5, D11): the "Template S/O/A/P" button passes ClinicalSOAPTemplate
    // through the editor's transcoder-backed model rather than assigning raw
    // HTML into a plain-text field. Verified here (not MediFlowCoreTests)
    // because ClinicalSOAPTemplate itself lives in MediFlowAppleShared.
    func testSOAPTemplateLoadsAsFourEditableParagraphsAndRoundTripsByteExact() {
        let document = ClinicalRichTextEditorDocument.load(html: ClinicalSOAPTemplate.html)
        XCTAssertEqual(document.blocks.count, 4)
        for block in document.blocks {
            guard case .editable(.paragraph, _) = block.storage else {
                return XCTFail("expected every SOAP template block to be an editable paragraph")
            }
        }
        XCTAssertEqual(document.renderedHTML, ClinicalSOAPTemplate.html)
    }
}
