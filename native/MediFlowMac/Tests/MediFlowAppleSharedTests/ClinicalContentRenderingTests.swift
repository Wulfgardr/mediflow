import XCTest
@testable import MediFlowAppleShared
#if canImport(AppKit)
import AppKit
import SwiftUI
#endif

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

    #if canImport(AppKit)
    @MainActor
    func testSwiftUIContentDrawsNestedMarkersAtDifferentIndents() async throws {
        let html = "<ol><li>Prima voce<ol><li>Seconda voce</li></ol></li></ol>"
        let rendering = ClinicalContentTextModel()
        await rendering.load(.init(content: html))
        let content = ClinicalContentText(html, rendering: rendering)
            .frame(width: 400, height: 120, alignment: .topLeading)
        let host = NSHostingView(rootView: content)
        host.frame = NSRect(x: 0, y: 0, width: 400, height: 120)
        host.layoutSubtreeIfNeeded()
        let bitmap = try XCTUnwrap(host.bitmapImageRepForCachingDisplay(in: host.bounds))
        host.cacheDisplay(in: host.bounds, to: bitmap)
        let background = try XCTUnwrap(bitmap.colorAt(x: bitmap.pixelsWide - 1, y: bitmap.pixelsHigh - 1)?.usingColorSpace(.deviceRGB))
        var lineStarts: [Int] = []
        var bandStart: Int?
        for y in 0..<bitmap.pixelsHigh {
            var rowStart: Int?
            for x in 0..<bitmap.pixelsWide {
                guard let color = bitmap.colorAt(x: x, y: y)?.usingColorSpace(.deviceRGB) else { continue }
                let difference = abs(color.redComponent - background.redComponent)
                    + abs(color.greenComponent - background.greenComponent)
                    + abs(color.blueComponent - background.blueComponent)
                    + abs(color.alphaComponent - background.alphaComponent)
                if difference > 0.5 { rowStart = x; break }
            }
            if let rowStart {
                bandStart = min(bandStart ?? rowStart, rowStart)
            } else if let start = bandStart {
                lineStarts.append(start)
                bandStart = nil
            }
        }
        if let bandStart { lineStarts.append(bandStart) }
        XCTAssertEqual(lineStarts.count, 2, "Expected two readable list lines: \(lineStarts)")
        guard lineStarts.count == 2 else { return }
        XCTAssertGreaterThan(lineStarts[1], lineStarts[0] + 20)
    }

    @MainActor
    func testViewConstructionAndBodyDoNotImportHTML() async {
        var imports = 0
        let rendering = ClinicalContentTextModel { request in
            imports += 1
            return NSAttributedString(string: request.content)
        }
        let html = "<p>Nota sintetica</p>"
        let view = ClinicalContentText(html, rendering: rendering)
        _ = view.body
        XCTAssertEqual(imports, 0)
        let request = ClinicalContentTextModel.Request(content: html)
        XCTAssertNil(rendering.value(for: request))
        await rendering.load(request)
        XCTAssertEqual(imports, 1)
        XCTAssertEqual(rendering.value(for: request)?.string, html)
        await rendering.load(request)
        XCTAssertEqual(imports, 1)
    }

    @MainActor
    func testContentAndStyleChangesNeverExposePreviousRenderedValue() async {
        let rendering = ClinicalContentTextModel { NSAttributedString(string: $0.content) }
        let first = ClinicalContentTextModel.Request(content: "Nota sintetica A")
        let second = ClinicalContentTextModel.Request(content: "Nota sintetica B")
        let deleted = ClinicalContentTextModel.Request(content: second.content, foregroundStyle: .secondary)
        await rendering.load(first)
        XCTAssertNotNil(rendering.value(for: first))
        XCTAssertNil(rendering.value(for: second))
        await rendering.load(second)
        XCTAssertNil(rendering.value(for: first))
        XCTAssertNotNil(rendering.value(for: second))
        XCTAssertNil(rendering.value(for: deleted))
        await rendering.load(deleted)
        XCTAssertNil(rendering.value(for: second))
        XCTAssertNotNil(rendering.value(for: deleted))
    }

    @MainActor
    func testCancelledLoadDoesNotImportOrPublishContent() async {
        var imports = 0
        let rendering = ClinicalContentTextModel { request in
            imports += 1
            return NSAttributedString(string: request.content)
        }
        let request = ClinicalContentTextModel.Request(content: "Nota sintetica annullata")
        let loading = Task { await rendering.load(request) }
        loading.cancel()
        await loading.value
        XCTAssertEqual(imports, 0)
        XCTAssertNil(rendering.value(for: request))
    }

    @MainActor
    func testNestedOrderedListRetainsItsVisualIndentation() throws {
        let html = "<ol><li>Primo controllo sintetico<ol><li>Dettaglio sintetico subordinato</li></ol></li><li>Secondo controllo</li></ol>"
        let view = ClinicalContentNativeTextView()
        view.setContent(ClinicalContentRendering.nativeAttributedString(from: html))
        _ = view.fittingSize(for: 400)

        let parent = try glyphRect("Primo", in: view)
        let child = try glyphRect("Dettaglio", in: view)
        let sibling = try glyphRect("Secondo", in: view)
        XCTAssertGreaterThan(child.minX, parent.minX + 20)
        XCTAssertEqual(sibling.minX, parent.minX, accuracy: 0.5)
        XCTAssertGreaterThan(child.minY, parent.minY)
        XCTAssertTrue(view.string.contains("2\tSecondo"))
        XCTAssertFalse(view.isEditable)
        XCTAssertTrue(view.isSelectable)
    }

    @MainActor
    func testNestedQuotesAndListWrappingRetainTheirParagraphLayout() throws {
        let html = "<p>Prosa sintetica</p><blockquote><p>Citazione sintetica</p><blockquote><p>Interna sintetica</p></blockquote></blockquote><ol><li>Voce sintetica<ol><li>Annidata sintetica con una descrizione sufficientemente lunga per andare a capo e mantenere il rientro fino alla parola finale</li></ol></li></ol>"
        let view = ClinicalContentNativeTextView()
        view.setContent(ClinicalContentRendering.nativeAttributedString(from: html))
        let narrow = view.fittingSize(for: 220)
        let prose = try glyphRect("Prosa", in: view)
        let quote = try glyphRect("Citazione", in: view)
        let nestedQuote = try glyphRect("Interna", in: view)
        XCTAssertGreaterThan(quote.minX, prose.minX)
        XCTAssertGreaterThan(nestedQuote.minX, quote.minX)

        let first = try glyphRect("Annidata", in: view)
        let wrapped = try glyphRect("finale", in: view)
        XCTAssertGreaterThan(wrapped.minY, first.minY)
        let manager = try XCTUnwrap(view.layoutManager)
        let range = (view.string as NSString).range(of: "finale")
        let glyph = manager.glyphIndexForCharacter(at: range.location)
        XCTAssertEqual(manager.lineFragmentUsedRect(forGlyphAt: glyph, effectiveRange: nil).minX, first.minX, accuracy: 0.5)
        XCTAssertGreaterThan(narrow.height, view.fittingSize(for: 600).height)
    }

    @MainActor
    func testNativeContentKeepsInlineMarksLinksAndFont() throws {
        let rendered = ClinicalContentRendering.nativeAttributedString(from: "<p><strong>Grassetto</strong> <em>Corsivo</em> <u>Sottolineato</u> <s>Barrato</s> <a href=\"https://127.0.0.1/nota\">Fonte</a></p>")
        func attributes(_ text: String) -> [NSAttributedString.Key: Any] {
            rendered.attributes(at: (rendered.string as NSString).range(of: text).location, effectiveRange: nil)
        }
        XCTAssertTrue(try XCTUnwrap(attributes("Grassetto")[.font] as? NSFont).fontDescriptor.symbolicTraits.contains(.bold))
        XCTAssertTrue(try XCTUnwrap(attributes("Corsivo")[.font] as? NSFont).fontDescriptor.symbolicTraits.contains(.italic))
        XCTAssertEqual(attributes("Sottolineato")[.underlineStyle] as? Int, 1)
        XCTAssertEqual(attributes("Barrato")[.strikethroughStyle] as? Int, 1)
        XCTAssertEqual((attributes("Fonte")[.link] as? URL)?.absoluteString, "https://127.0.0.1/nota")
        XCTAssertEqual(try XCTUnwrap(attributes("Fonte")[.font] as? NSFont).pointSize, 13.5)
    }

    @MainActor
    func testSecondaryContentUsesSemanticColorWithoutChangingTextOrFont() throws {
        for content in ["Nota sintetica eliminata", "<p><strong>Nota sintetica</strong> eliminata</p>"] {
            let primary = ClinicalContentRendering.nativeAttributedString(from: content)
            let secondary = ClinicalContentRendering.nativeAttributedString(from: content, foregroundStyle: .secondary)
            XCTAssertEqual(primary.string, secondary.string)
            let range = NSRange(location: 0, length: secondary.length)
            secondary.enumerateAttributes(in: range) { attributes, range, _ in
                XCTAssertEqual(attributes[.foregroundColor] as? NSColor, .secondaryLabelColor)
                XCTAssertEqual(primary.attribute(.foregroundColor, at: range.location, effectiveRange: nil) as? NSColor, .labelColor)
                XCTAssertEqual(attributes[.font] as? NSFont, primary.attribute(.font, at: range.location, effectiveRange: nil) as? NSFont)
                XCTAssertEqual(attributes[.paragraphStyle] as? NSParagraphStyle, primary.attribute(.paragraphStyle, at: range.location, effectiveRange: nil) as? NSParagraphStyle)
            }
        }
    }

    @MainActor
    private func glyphRect(_ text: String, in view: ClinicalContentNativeTextView) throws -> CGRect {
        let manager = try XCTUnwrap(view.layoutManager)
        let container = try XCTUnwrap(view.textContainer)
        let range = (view.string as NSString).range(of: text)
        XCTAssertNotEqual(range.location, NSNotFound)
        let glyphs = manager.glyphRange(forCharacterRange: range, actualCharacterRange: nil)
        return manager.boundingRect(forGlyphRange: glyphs, in: container)
    }
    #endif

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
