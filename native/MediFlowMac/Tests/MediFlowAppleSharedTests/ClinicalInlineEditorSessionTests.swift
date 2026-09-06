import SwiftUI
import XCTest
@testable import MediFlowAppleShared

/* @Codex: Native text storage + actual document binding; no app, DB or simulator. */
@MainActor
final class ClinicalInlineEditorSessionTests: XCTestCase {
    #if os(macOS)
    func testNativeSelectedWordFormattingAndUndoRestoreOriginalHTML() throws {
        let box = Box("<p>Prima parola dopo</p>")
        let controller = ClinicalInlineEditorController()
        let id = try XCTUnwrap(box.document.blocks.first?.id)
        let session = ClinicalInlineEditorSession(document: box.binding, blockID: id, controller: controller)
        let native = ClinicalNativeTextView(frame: .zero)
        session.attach(native)
        native.selection = NSRange(location: 6, length: 6)
        session.activate()
        native.inlineUndoManager.groupsByEvent = false
        native.inlineUndoManager.beginUndoGrouping()
        controller.toggle(.bold)
        native.inlineUndoManager.endUndoGrouping()
        XCTAssertEqual(box.document.renderedHTML, "<p>Prima <strong>parola</strong> dopo</p>")
        XCTAssertEqual(native.attributedContent.string, "Prima parola dopo")
        XCTAssertEqual(native.selection, NSRange(location: 6, length: 6))
        XCTAssertTrue(controller.styles.contains(.bold))
        XCTAssertEqual(ClinicalInlineAttributedText.runs(native.attributedContent), box.document.blocks[0].runs)
        native.inlineUndoManager.undo()
        XCTAssertEqual(box.document.renderedHTML, "<p>Prima parola dopo</p>")
        native.inlineUndoManager.redo()
        XCTAssertEqual(box.document.renderedHTML, "<p>Prima <strong>parola</strong> dopo</p>")
        session.detach()
    }

    func testCaretStyleChangesOnlySubsequentNativeInput() throws {
        let box = Box("<p>Alpha</p>")
        let controller = ClinicalInlineEditorController()
        let id = try XCTUnwrap(box.document.blocks.first?.id)
        let session = ClinicalInlineEditorSession(document: box.binding, blockID: id, controller: controller)
        let native = ClinicalNativeTextView(frame: .zero)
        session.attach(native)
        native.selection = NSRange(location: 5, length: 0)
        session.activate()
        controller.toggle(.italic)
        XCTAssertEqual(box.document.renderedHTML, "<p>Alpha</p>", "A caret toggle does not restyle existing text")
        native.textStorage?.append(NSAttributedString(string: " beta", attributes: native.typingStyle))
        native.selection = NSRange(location: 10, length: 0)
        session.textChanged()
        XCTAssertEqual(box.document.renderedHTML, "<p>Alpha<em> beta</em></p>")
        session.detach()
    }

    func testRetainedNativeDelegateCannotOverwriteExternalUpdateOrReplacementUUID() throws {
        let box = Box("<p>Prima</p>")
        let controller = ClinicalInlineEditorController()
        let id = try XCTUnwrap(box.document.blocks.first?.id)
        let session = ClinicalInlineEditorSession(document: box.binding, blockID: id, controller: controller)
        let native = ClinicalNativeTextView(frame: .zero)
        session.attach(native)
        box.document.updateText(id: id, text: "Corrente")
        native.attributedContent = NSAttributedString(string: "Callback vecchia")
        session.textChanged()
        XCTAssertEqual(box.document.renderedHTML, "<p>Corrente</p>")
        XCTAssertEqual(native.attributedContent.string, "Corrente")
        box.document = .load(html: "<p>Altra voce</p>")
        native.attributedContent = NSAttributedString(string: "Non deve ricomparire")
        session.textChanged()
        XCTAssertEqual(box.document.renderedHTML, "<p>Altra voce</p>")
        XCTAssertEqual(native.attributedContent.string, "")
        XCTAssertFalse(native.isEditable)
        session.detach()
    }
    #endif

    func testCompositionEchoDoesNotReplaceNativeStorageAndDisabledInputCannotPublish() throws {
        let box = Box("<p>A</p>")
        let id = try XCTUnwrap(box.document.blocks.first?.id)
        let controller = ClinicalInlineEditorController()
        let session = ClinicalInlineEditorSession(document: box.binding, blockID: id, controller: controller)
        let surface = CompositionSurface()
        session.attach(surface)
        surface.isComposing = true
        surface.attributedContent = NSAttributedString(string: "Aé", attributes: surface.typingStyle)
        session.textChanged()
        let writes = surface.storageWrites
        session.synchronize(document: box.binding, enabled: true)
        XCTAssertEqual(surface.storageWrites, writes, "SwiftUI echo must leave marked text in its native storage")
        XCTAssertTrue(surface.isComposing)
        XCTAssertEqual(box.document.renderedHTML, "<p>Aé</p>")
        session.synchronize(document: box.binding, enabled: false)
        surface.attributedContent = NSAttributedString(string: "Tentativo disabilitato")
        session.textChanged()
        XCTAssertEqual(box.document.renderedHTML, "<p>Aé</p>")
        session.detach()
    }

    func testPlainTextBindingPreservesMixedStylesOutsideReplacedRange() throws {
        let box = Box("<p><strong>Uno</strong> due <em>tre</em></p>")
        let id = try XCTUnwrap(box.document.blocks.first?.id)
        let editor = ClinicalRichTextEditorView(document: box.binding, accessibilityPrefix: "inline-binding")
        let binding = editor.textBinding(for: id)
        binding.wrappedValue = "Uno DUE tre"
        XCTAssertEqual(binding.wrappedValue, "Uno DUE tre")
        XCTAssertEqual(box.document.renderedHTML, "<p><strong>Uno</strong> DUE <em>tre</em></p>")
    }

    @MainActor private final class Box {
        var document: ClinicalRichTextEditorDocument
        init(_ html: String) { document = .load(html: html) }
        var binding: Binding<ClinicalRichTextEditorDocument> {
            Binding(get: { self.document }, set: { self.document = $0 })
        }
    }

    private final class CompositionSurface: ClinicalInlineEditingSurface {
        var storageWrites = 0
        var attributedContent = NSAttributedString(string: "") { didSet { storageWrites += 1 } }
        var selection = NSRange(location: 0, length: 0)
        var typingStyle: [NSAttributedString.Key: Any] = [:]
        var isEditable = true
        var isComposing = false
        let inlineUndoManager = UndoManager()
        func focusEditor() {}
        func finishComposition() { isComposing = false }
        func invalidateEditorSize() {}
    }
}
