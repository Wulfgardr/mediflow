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
}
