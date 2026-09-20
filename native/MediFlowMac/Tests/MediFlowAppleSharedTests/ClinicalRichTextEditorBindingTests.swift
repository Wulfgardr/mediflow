/* @Codex */
import Foundation
import SwiftUI
import XCTest
@testable import MediFlowAppleShared

@MainActor
final class ClinicalRichTextEditorBindingTests: XCTestCase {
    func testRetainedBindingReadsIncrementalInputWithoutViewRerender() {
        let block = ClinicalRichTextEditorBlock(kind: .paragraph, span: ClinicalRichTextTextRun(text: ""))
        let box = DocumentBox(blocks: [block])
        let editor = ClinicalRichTextEditorView(document: box.binding, accessibilityPrefix: "binding-test")
        let retainedBinding = editor.textBinding(for: block.id)
        XCTAssertEqual(retainedBinding.wrappedValue, "")

        // Keep the same view and binding: no body evaluation, delay or run-loop
        // turn may refresh a captured span between a write and its next read.
        var input = ""
        for character in "Testo sintetico da conservare nel diario" {
            input.append(character)
            retainedBinding.wrappedValue = input
            XCTAssertEqual(retainedBinding.wrappedValue, input,
                           "The retained getter must reflect all \(input.count) characters immediately")
        }
        XCTAssertEqual(box.document.blocks, [ClinicalRichTextEditorBlock(
            id: block.id, kind: .paragraph, span: ClinicalRichTextTextRun(text: input)
        )])

        for replacement in ["Testo", "", "Nuovo testo sintetico\nSeconda riga"] {
            retainedBinding.wrappedValue = replacement
            XCTAssertEqual(retainedBinding.wrappedValue, replacement,
                           "Deletion and replacement must not restore the previous text")
            XCTAssertEqual(box.document.blocks, [ClinicalRichTextEditorBlock(
                id: block.id, kind: .paragraph, span: ClinicalRichTextTextRun(text: replacement)
            )])
        }
    }

    func testRetainedBindingUsesCurrentBlockAndPreservesItsKindAndStyles() {
        let block = ClinicalRichTextEditorBlock(kind: .paragraph, span: ClinicalRichTextTextRun(text: "Iniziale"))
        let neighbor = ClinicalRichTextEditorBlock(kind: .blockquote, span: ClinicalRichTextTextRun(text: "Altro blocco"))
        let box = DocumentBox(blocks: [block, neighbor])
        let editor = ClinicalRichTextEditorView(document: box.binding, accessibilityPrefix: "binding-test")
        let retainedBinding = editor.textBinding(for: block.id)

        // Simulate other editor controls changing the canonical document while
        // the text input still holds its original binding.
        box.document.setKind(id: block.id, kind: .heading2)
        box.document.toggleBold(id: block.id)
        box.document.toggleItalic(id: block.id)
        box.document.toggleUnderline(id: block.id)
        box.document.toggleStrikethrough(id: block.id)
        box.document.updateText(id: block.id, text: "Aggiornamento dal documento")
        box.document.blocks.swapAt(0, 1)
        XCTAssertEqual(retainedBinding.wrappedValue, "Aggiornamento dal documento")

        retainedBinding.wrappedValue = "Testo rivisto"
        XCTAssertEqual(retainedBinding.wrappedValue, "Testo rivisto")
        XCTAssertEqual(box.document.blocks, [neighbor, ClinicalRichTextEditorBlock(
            id: block.id,
            kind: .heading2,
            span: ClinicalRichTextTextRun(
                text: "Testo rivisto", isBold: true, isItalic: true,
                isUnderlined: true, isStruckThrough: true
            )
        )], "Editing follows the block UUID and preserves current formatting and neighboring content")
    }

    func testRetainedBindingCannotResurrectRemovedBlockOrEditItsReplacement() {
        let block = ClinicalRichTextEditorBlock(kind: .paragraph, span: ClinicalRichTextTextRun(text: "Da rimuovere"))
        let neighbor = ClinicalRichTextEditorBlock(kind: .paragraph, span: ClinicalRichTextTextRun(text: "Da conservare"))
        let box = DocumentBox(blocks: [block, neighbor])
        let editor = ClinicalRichTextEditorView(document: box.binding, accessibilityPrefix: "binding-test")
        let retainedBinding = editor.textBinding(for: block.id)
        XCTAssertEqual(retainedBinding.wrappedValue, "Da rimuovere")

        box.document.removeBlock(id: block.id)
        XCTAssertEqual(retainedBinding.wrappedValue, "")
        retainedBinding.wrappedValue = "Evento tardivo"
        XCTAssertEqual(box.document.blocks, [neighbor], "A late text event must not recreate a removed block")
        XCTAssertEqual(retainedBinding.wrappedValue, "")

        let replacement = ClinicalRichTextEditorBlock(kind: .paragraph, span: ClinicalRichTextTextRun(text: "Nuovo blocco"))
        box.document.blocks.insert(replacement, at: 0)
        retainedBinding.wrappedValue = "Altro evento tardivo"
        XCTAssertEqual(box.document.blocks, [replacement, neighbor],
                       "Reusing the old position must not redirect an obsolete binding to another UUID")
        XCTAssertEqual(retainedBinding.wrappedValue, "")
    }

    private final class DocumentBox {
        var document: ClinicalRichTextEditorDocument

        init(blocks: [ClinicalRichTextEditorBlock]) {
            document = ClinicalRichTextEditorDocument(blocks: blocks)
        }

        var binding: Binding<ClinicalRichTextEditorDocument> {
            Binding(get: { self.document }, set: { self.document = $0 })
        }
    }
}
