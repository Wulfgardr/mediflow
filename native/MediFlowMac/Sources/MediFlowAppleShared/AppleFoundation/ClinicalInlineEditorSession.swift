import SwiftUI
import MediFlowCore
#if os(macOS)
import AppKit
#else
import UIKit
#endif

/* @Codex: The coordinator owns selection/typing only. The bound document owns text. */
@MainActor
final class ClinicalInlineEditorController: ObservableObject {
    @Published private(set) var focusedBlockID: UUID?
    @Published private(set) var styles: Set<ClinicalInlineStyle> = []
    private var action: ((ClinicalInlineStyle) -> Void)?

    func activate(id: UUID, action: @escaping (ClinicalInlineStyle) -> Void) {
        if focusedBlockID != id { focusedBlockID = id }
        self.action = action
    }

    func update(id: UUID, styles: Set<ClinicalInlineStyle>) {
        if focusedBlockID == id, self.styles != styles { self.styles = styles }
    }

    func detach(id: UUID) {
        guard focusedBlockID == id else { return }
        focusedBlockID = nil
        styles = []
        action = nil
    }

    func toggle(_ style: ClinicalInlineStyle) { action?(style) }
}

/* @Codex */
@MainActor
protocol ClinicalInlineEditingSurface: AnyObject {
    var attributedContent: NSAttributedString { get set }
    var selection: NSRange { get set }
    var typingStyle: [NSAttributedString.Key: Any] { get set }
    var isEditable: Bool { get set }
    var isComposing: Bool { get }
    var inlineUndoManager: UndoManager { get }
    func focusEditor()
    func finishComposition()
    func invalidateEditorSize()
}

/* @Codex */
@MainActor
enum ClinicalInlineAttributedText {
    private static func key(_ style: ClinicalInlineStyle) -> NSAttributedString.Key {
        NSAttributedString.Key("MediFlow.inline." + style.rawValue)
    }

    static func attributes(
        _ run: ClinicalRichTextTextRun, kind: ClinicalRichTextEditorBlock.EditableKind
    ) -> [NSAttributedString.Key: Any] {
        #if os(macOS)
        let size: CGFloat = kind == .heading2 ? 18 : kind == .heading3 ? 16 : NSFont.systemFontSize
        let base = NSFont.systemFont(ofSize: size)
        var traits = base.fontDescriptor.symbolicTraits
        if run.isBold { traits.insert(.bold) }
        if run.isItalic { traits.insert(.italic) }
        let font = NSFont(descriptor: base.fontDescriptor.withSymbolicTraits(traits), size: size) ?? base
        let color = NSColor.labelColor
        #else
        let base = UIFont.preferredFont(forTextStyle: kind == .heading2 ? .title3 : kind == .heading3 ? .headline : .body)
        var traits = base.fontDescriptor.symbolicTraits
        if run.isBold { traits.insert(.traitBold) }
        if run.isItalic { traits.insert(.traitItalic) }
        let font = UIFont(descriptor: base.fontDescriptor.withSymbolicTraits(traits) ?? base.fontDescriptor, size: 0)
        let color = UIColor.label
        #endif
        var attributes: [NSAttributedString.Key: Any] = [
            .font: font, .foregroundColor: color,
            .underlineStyle: run.isUnderlined ? NSUnderlineStyle.single.rawValue : 0,
            .strikethroughStyle: run.isStruckThrough ? NSUnderlineStyle.single.rawValue : 0
        ]
        for style in ClinicalInlineStyle.allCases { attributes[key(style)] = style.isApplied(to: run) }
        return attributes
    }

    static func string(
        _ runs: [ClinicalRichTextTextRun], kind: ClinicalRichTextEditorBlock.EditableKind
    ) -> NSAttributedString {
        let result = NSMutableAttributedString(string: "")
        for run in runs { result.append(NSAttributedString(string: run.text, attributes: attributes(run, kind: kind))) }
        return result
    }

    static func run(text: String, attributes: [NSAttributedString.Key: Any]) -> ClinicalRichTextTextRun {
        #if os(macOS)
        let traits = (attributes[.font] as? NSFont)?.fontDescriptor.symbolicTraits
        let bold = traits?.contains(.bold) ?? false
        let italic = traits?.contains(.italic) ?? false
        #else
        let traits = (attributes[.font] as? UIFont)?.fontDescriptor.symbolicTraits
        let bold = traits?.contains(.traitBold) ?? false
        let italic = traits?.contains(.traitItalic) ?? false
        #endif
        return ClinicalRichTextTextRun(
            text: text,
            isBold: attributes[key(.bold)] as? Bool ?? bold,
            isItalic: attributes[key(.italic)] as? Bool ?? italic,
            isUnderlined: attributes[key(.underline)] as? Bool ?? ((attributes[.underlineStyle] as? Int ?? 0) != 0),
            isStruckThrough: attributes[key(.strikethrough)] as? Bool ?? ((attributes[.strikethroughStyle] as? Int ?? 0) != 0)
        )
    }

    static func runs(_ string: NSAttributedString) -> [ClinicalRichTextTextRun] {
        var result: [ClinicalRichTextTextRun] = []
        string.enumerateAttributes(in: NSRange(location: 0, length: string.length)) { attributes, range, _ in
            result.append(run(text: (string.string as NSString).substring(with: range), attributes: attributes))
        }
        return ClinicalInlineEditing.coalesced(result)
    }
}

/* @Codex */
@MainActor
final class ClinicalInlineEditorSession {
    private var document: Binding<ClinicalRichTextEditorDocument>
    let blockID: UUID
    private let controller: ClinicalInlineEditorController
    private weak var surface: (any ClinicalInlineEditingSurface)?
    private var snapshot: [ClinicalRichTextTextRun]?
    private var kind: ClinicalRichTextEditorBlock.EditableKind = .paragraph
    private var applying = false

    init(document: Binding<ClinicalRichTextEditorDocument>, blockID: UUID, controller: ClinicalInlineEditorController) {
        self.document = document
        self.blockID = blockID
        self.controller = controller
    }

    func attach(_ surface: any ClinicalInlineEditingSurface) {
        self.surface = surface
        synchronize(document: document, enabled: true)
    }

    func synchronize(document: Binding<ClinicalRichTextEditorDocument>, enabled: Bool) {
        self.document = document
        guard let surface else { return }
        guard let block = document.wrappedValue.blocks.first(where: { $0.id == blockID }),
              let blockRuns = block.runs, let currentKind = block.editableKind else {
            applying = true
            surface.isEditable = false
            surface.finishComposition()
            surface.attributedContent = NSAttributedString(string: "")
            surface.inlineUndoManager.removeAllActions()
            applying = false
            snapshot = nil
            return
        }
        surface.isEditable = enabled
        let current = ClinicalInlineEditing.coalesced(blockRuns)
        if current != snapshot || kind != currentKind {
            applying = true
            let range = surface.selection
            surface.finishComposition()
            surface.attributedContent = ClinicalInlineAttributedText.string(current, kind: currentKind)
            surface.selection = ClinicalInlineEditing.valid(range, in: current) ? range : NSRange(location: 0, length: 0)
            surface.typingStyle = ClinicalInlineAttributedText.attributes(current.first ?? ClinicalRichTextTextRun(text: ""), kind: currentKind)
            surface.inlineUndoManager.removeAllActions()
            surface.invalidateEditorSize()
            applying = false
            snapshot = current
            kind = currentKind
        }
    }

    func activate() {
        guard currentRuns() != nil else { return }
        controller.activate(id: blockID) { [weak self] style in self?.toggle(style) }
        selectionChanged()
    }

    func selectionChanged() {
        guard !applying, let surface, let current = currentRuns() else { return }
        let runs = surface.selection.length == 0
            ? [ClinicalInlineAttributedText.run(text: "", attributes: surface.typingStyle)]
            : ClinicalInlineEditing.slice(current, range: surface.selection)
        let styles = Set(ClinicalInlineStyle.allCases.filter { style in
            !runs.isEmpty && runs.allSatisfy { style.isApplied(to: $0) }
        })
        controller.update(id: blockID, styles: styles)
    }

    func textChanged() {
        guard !applying, let surface, surface.isEditable else { return }
        let runs = ClinicalInlineAttributedText.runs(surface.attributedContent)
        // A removed/replaced document or external edit wins over a retained delegate.
        guard publish(runs) else {
            synchronize(document: document, enabled: surface.isEditable)
            return
        }
        // Publishing marked text does not rewrite the native text storage. Echo
        // updates see the same snapshot, preserving IME/dictation composition.
        surface.invalidateEditorSize()
        selectionChanged()
    }

    func toggle(_ style: ClinicalInlineStyle) {
        guard !applying, let surface, surface.isEditable, !surface.isComposing,
              let current = currentRuns(), current == snapshot,
              ClinicalInlineEditing.valid(surface.selection, in: current) else { return }
        if surface.selection.length == 0 {
            var typing = ClinicalInlineAttributedText.run(text: "", attributes: surface.typingStyle)
            style.apply(!style.isApplied(to: typing), to: &typing)
            surface.focusEditor()
            surface.typingStyle = ClinicalInlineAttributedText.attributes(typing, kind: kind)
            selectionChanged()
            return
        }
        guard let edited = ClinicalInlineEditing.toggling(style, in: current, range: surface.selection) else { return }
        replace(edited, undo: current, selection: surface.selection)
        surface.focusEditor()
    }

    private func replace(_ runs: [ClinicalRichTextTextRun], undo: [ClinicalRichTextTextRun], selection: NSRange) {
        guard let surface, publish(runs) else { return }
        applying = true
        surface.attributedContent = ClinicalInlineAttributedText.string(runs, kind: kind)
        surface.selection = selection
        surface.invalidateEditorSize()
        applying = false
        surface.inlineUndoManager.registerUndo(withTarget: self) { target in
            MainActor.assumeIsolated {
                guard target.currentRuns() == ClinicalInlineEditing.coalesced(runs) else { return }
                target.replace(undo, undo: runs, selection: selection)
            }
        }
        selectionChanged()
    }

    private func currentRuns() -> [ClinicalRichTextTextRun]? {
        document.wrappedValue.blocks.first(where: { $0.id == blockID })?.runs.map(ClinicalInlineEditing.coalesced)
    }

    private func publish(_ runs: [ClinicalRichTextTextRun]) -> Bool {
        guard let snapshot else { return false }
        var current = document.wrappedValue
        guard current.updateRuns(id: blockID, runs: runs, expecting: snapshot) else { return false }
        self.snapshot = ClinicalInlineEditing.coalesced(runs)
        document.wrappedValue = current
        return true
    }

    func detach() {
        surface?.inlineUndoManager.removeAllActions()
        surface = nil
        controller.detach(id: blockID)
    }
}
