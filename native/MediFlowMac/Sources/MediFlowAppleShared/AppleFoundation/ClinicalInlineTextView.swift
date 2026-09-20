import SwiftUI
import MediFlowCore

#if os(macOS)
import AppKit

/* @Codex: One native text surface per supported block, with a local undo stack. */
final class ClinicalNativeTextView: NSTextView, ClinicalInlineEditingSurface {
    let inlineUndoManager = UndoManager()
    var onFocus: (() -> Void)?
    var onStyle: ((ClinicalInlineStyle) -> Void)?
    override var undoManager: UndoManager? { inlineUndoManager }
    var attributedContent: NSAttributedString {
        get { attributedString() }
        set { textStorage?.setAttributedString(newValue) }
    }
    var selection: NSRange {
        get { selectedRange() }
        set { setSelectedRange(newValue) }
    }
    var typingStyle: [NSAttributedString.Key: Any] {
        get { typingAttributes }
        set { typingAttributes = newValue }
    }
    var isComposing: Bool { hasMarkedText() }
    func focusEditor() { window?.makeFirstResponder(self) }
    func finishComposition() { if hasMarkedText() { unmarkText() } }
    func invalidateEditorSize() { invalidateIntrinsicContentSize() }
    override func becomeFirstResponder() -> Bool {
        let result = super.becomeFirstResponder()
        if result { onFocus?() }
        return result
    }
    // Paste remains a user action and inserts plain text with the current typing
    // style. No platform HTML importer or arbitrary RTF attributes enter the model.
    override func paste(_ sender: Any?) { pasteAsPlainText(sender) }
    override func pasteAsRichText(_ sender: Any?) { pasteAsPlainText(sender) }
    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        if event.modifierFlags.intersection([.command, .control, .option]) == .command {
            let style: ClinicalInlineStyle?
            switch event.charactersIgnoringModifiers?.lowercased() {
            case "b": style = .bold
            case "i": style = .italic
            case "u": style = .underline
            default: style = nil
            }
            if let style { onStyle?(style); return true }
        }
        return super.performKeyEquivalent(with: event)
    }
}

/* @Codex */
struct ClinicalInlineTextView: NSViewRepresentable {
    @Binding var document: ClinicalRichTextEditorDocument
    let blockID: UUID
    let controller: ClinicalInlineEditorController
    let identifier: String
    @Environment(\.isEnabled) private var isEnabled

    func makeCoordinator() -> Coordinator {
        Coordinator(document: $document, blockID: blockID, controller: controller)
    }

    func makeNSView(context: Context) -> NSScrollView {
        let scroll = NSScrollView()
        scroll.drawsBackground = false
        scroll.hasVerticalScroller = false
        scroll.hasHorizontalScroller = false
        scroll.borderType = .noBorder
        let text = ClinicalNativeTextView(frame: .zero)
        text.isRichText = true
        text.importsGraphics = false
        text.usesFontPanel = false
        text.allowsUndo = true
        text.drawsBackground = false
        text.isVerticallyResizable = true
        text.isHorizontallyResizable = false
        text.autoresizingMask = [.width]
        text.textContainer?.widthTracksTextView = true
        text.textContainer?.heightTracksTextView = false
        text.textContainerInset = NSSize(width: 8, height: 10)
        text.setAccessibilityIdentifier(identifier)
        text.setAccessibilityLabel("Testo del blocco")
        text.delegate = context.coordinator
        text.onFocus = { [weak session = context.coordinator.session] in session?.activate() }
        text.onStyle = { [weak session = context.coordinator.session] style in session?.toggle(style) }
        scroll.documentView = text
        context.coordinator.session.attach(text)
        return scroll
    }

    func updateNSView(_ scroll: NSScrollView, context: Context) {
        context.coordinator.session.synchronize(document: $document, enabled: isEnabled)
    }

    func sizeThatFits(_ proposal: ProposedViewSize, nsView scroll: NSScrollView, context: Context) -> CGSize? {
        guard let text = scroll.documentView as? ClinicalNativeTextView else { return nil }
        let width = proposal.width ?? 320
        let inset = text.textContainerInset
        text.textContainer?.containerSize = NSSize(width: max(1, width - 2 * inset.width), height: .greatestFiniteMagnitude)
        if let container = text.textContainer { text.layoutManager?.ensureLayout(for: container) }
        let height = text.textContainer.flatMap { text.layoutManager?.usedRect(for: $0).height } ?? 0
        return CGSize(width: width, height: max(44, ceil(height + 2 * inset.height)))
    }

    static func dismantleNSView(_ scroll: NSScrollView, coordinator: Coordinator) {
        (scroll.documentView as? ClinicalNativeTextView)?.delegate = nil
        coordinator.session.detach()
    }

    @MainActor final class Coordinator: NSObject, NSTextViewDelegate {
        let session: ClinicalInlineEditorSession
        init(document: Binding<ClinicalRichTextEditorDocument>, blockID: UUID, controller: ClinicalInlineEditorController) {
            session = ClinicalInlineEditorSession(document: document, blockID: blockID, controller: controller)
        }
        func textDidChange(_ notification: Notification) { session.textChanged() }
        func textViewDidChangeSelection(_ notification: Notification) { session.selectionChanged() }
    }
}

#else
import UIKit

/* @Codex */
final class ClinicalNativeTextView: UITextView, ClinicalInlineEditingSurface {
    let inlineUndoManager = UndoManager()
    var onStyle: ((ClinicalInlineStyle) -> Void)?
    override var undoManager: UndoManager? { inlineUndoManager }
    var attributedContent: NSAttributedString {
        get { attributedText ?? NSAttributedString(string: "") }
        set { attributedText = newValue }
    }
    var selection: NSRange {
        get { selectedRange }
        set { selectedRange = newValue }
    }
    var typingStyle: [NSAttributedString.Key: Any] {
        get { typingAttributes }
        set { typingAttributes = newValue }
    }
    var isComposing: Bool { markedTextRange != nil }
    func focusEditor() { becomeFirstResponder() }
    func finishComposition() { if markedTextRange != nil { unmarkText() } }
    func invalidateEditorSize() { invalidateIntrinsicContentSize() }
    // Read the pasteboard only for an explicit standard Paste action.
    override func paste(_ sender: Any?) {
        if let text = UIPasteboard.general.string { insertText(text) }
    }
    override var keyCommands: [UIKeyCommand]? {
        (super.keyCommands ?? []) + [
            UIKeyCommand(input: "b", modifierFlags: .command, action: #selector(requestBold)),
            UIKeyCommand(input: "i", modifierFlags: .command, action: #selector(requestItalic)),
            UIKeyCommand(input: "u", modifierFlags: .command, action: #selector(requestUnderline))
        ]
    }
    @objc private func requestBold() { onStyle?(.bold) }
    @objc private func requestItalic() { onStyle?(.italic) }
    @objc private func requestUnderline() { onStyle?(.underline) }
}

/* @Codex */
struct ClinicalInlineTextView: UIViewRepresentable {
    @Binding var document: ClinicalRichTextEditorDocument
    let blockID: UUID
    let controller: ClinicalInlineEditorController
    let identifier: String
    @Environment(\.isEnabled) private var isEnabled

    func makeCoordinator() -> Coordinator {
        Coordinator(document: $document, blockID: blockID, controller: controller)
    }
    func makeUIView(context: Context) -> ClinicalNativeTextView {
        let text = ClinicalNativeTextView()
        text.backgroundColor = .clear
        text.isScrollEnabled = false
        text.adjustsFontForContentSizeCategory = true
        text.allowsEditingTextAttributes = false
        text.textContainerInset = UIEdgeInsets(top: 10, left: 8, bottom: 10, right: 8)
        text.accessibilityIdentifier = identifier
        text.accessibilityLabel = "Testo del blocco"
        text.delegate = context.coordinator
        text.onStyle = { [weak session = context.coordinator.session] style in session?.toggle(style) }
        context.coordinator.session.attach(text)
        return text
    }
    func updateUIView(_ text: ClinicalNativeTextView, context: Context) {
        context.coordinator.session.synchronize(document: $document, enabled: isEnabled)
    }
    func sizeThatFits(_ proposal: ProposedViewSize, uiView text: ClinicalNativeTextView, context: Context) -> CGSize? {
        let width = proposal.width ?? 320
        let size = text.sizeThatFits(CGSize(width: width, height: CGFloat.greatestFiniteMagnitude))
        return CGSize(width: width, height: max(44, ceil(size.height)))
    }
    static func dismantleUIView(_ text: ClinicalNativeTextView, coordinator: Coordinator) {
        text.delegate = nil
        coordinator.session.detach()
    }
    @MainActor final class Coordinator: NSObject, UITextViewDelegate {
        let session: ClinicalInlineEditorSession
        init(document: Binding<ClinicalRichTextEditorDocument>, blockID: UUID, controller: ClinicalInlineEditorController) {
            session = ClinicalInlineEditorSession(document: document, blockID: blockID, controller: controller)
        }
        func textViewDidBeginEditing(_ textView: UITextView) { session.activate() }
        func textViewDidChange(_ textView: UITextView) { session.textChanged() }
        func textViewDidChangeSelection(_ textView: UITextView) { session.selectionChanged() }
    }
}
#endif
