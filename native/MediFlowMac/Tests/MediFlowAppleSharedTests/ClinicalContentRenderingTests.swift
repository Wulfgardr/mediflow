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

    /// The template inserts structure, never prose.
    ///
    /// This test used to pin the web's `VISIT_DRAFT_PLACEHOLDER` string, under
    /// the name "matches web visit draft shape", and so certified an
    /// equivalence that does not hold. On the web that text is the editor's
    /// `placeholder`: grey, unsaved, gone the moment you type. Native loaded the
    /// identical string as *document content*, so the app could write four lines
    /// of clinical prose into a record that no clinician typed — including
    /// "valutazione clinica da rivedere" sitting under A, where it reads as an
    /// assessment. Same words, categorically different behaviour.
    func testSOAPTemplateInsertsHeadingsAndNoAuthoredProse() {
        XCTAssertEqual(
            ClinicalSOAPTemplate.html,
            "<p>S:</p><p>O:</p><p>A:</p><p>P:</p>"
        )
        for gloss in ["motivo della visita", "da rivedere", "follow-up", "esame obiettivo"] {
            XCTAssertFalse(
                ClinicalSOAPTemplate.html.contains(gloss),
                "the template must not author clinical content on the clinician's behalf"
            )
        }
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
