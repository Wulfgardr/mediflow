import Foundation

/// S7 (Wave 5, D10/D11): a structural block editor model bound to the
/// `ClinicalRichText` transcoder. This is the declared FALLBACK from D11: rather
/// than binding a SwiftUI `TextEditor` directly to an `AttributedString` (whose
/// bidirectional support for list/heading/blockquote paragraph structure is not
/// reliable enough to trust for a clinical record without an interactive
/// simulator to verify it), the toolbar operates on this typed model and the
/// HTML the operator sees as a live preview is always
/// `ClinicalRichText.render(document:)` of the SAME model that gets sealed.
/// There is no code path that saves anything other than that render output:
/// this is what satisfies the D11 sanitize-before-seal invariant.
///
/// Each editable block carries exactly one styled run (bold/italic/underline/
/// strikethrough are toggled for the WHOLE block, not per character). This is
/// a real, declared reduction from full inline mixed-style editing; content
/// that cannot be represented this way (mixed inline styles inside a single
/// paragraph, multi-paragraph list items, nested lists/blockquotes, heading
/// level 1, or the transcoder's own lossless `sanitizedFragment`) is preserved
/// verbatim as an opaque, non-editable block instead of being silently
/// corrupted or dropped. That is the "degraded ma sicura" mode the spec asks
/// for when opening existing entries.
public struct ClinicalRichTextEditorBlock: Identifiable, Equatable, Sendable {
    public enum EditableKind: Equatable, Hashable, Sendable, CaseIterable {
        case paragraph
        case heading2
        case heading3
        case bulletItem
        case numberedItem
        case blockquote
    }

    public enum Storage: Equatable, Sendable {
        case editable(kind: EditableKind, span: ClinicalRichTextTextRun)
        // Keeps the ORIGINAL parsed AST node so it can be written back to the
        // outgoing document unchanged: no re-parsing, no re-rendering, no risk
        // of drifting from what was actually stored.
        case preserved(ClinicalRichTextBlock)
    }

    public let id: UUID
    public var storage: Storage

    public init(id: UUID = UUID(), kind: EditableKind, span: ClinicalRichTextTextRun) {
        self.id = id
        self.storage = .editable(kind: kind, span: span)
    }

    public init(id: UUID = UUID(), preserving block: ClinicalRichTextBlock) {
        self.id = id
        self.storage = .preserved(block)
    }

    /// A safe, honest, literal-text preview of a preserved block's content, for
    /// display only (never re-parsed, never re-saved from this string).
    public var preservedPreviewText: String? {
        guard case .preserved(let block) = storage else { return nil }
        return ClinicalRichText.render(document: ClinicalRichTextDocument(blocks: [block]))
    }

    public var isPreserved: Bool {
        if case .preserved = storage { return true }
        return false
    }
}

public struct ClinicalRichTextEditorDocument: Equatable, Sendable {
    public var blocks: [ClinicalRichTextEditorBlock]

    public init(blocks: [ClinicalRichTextEditorBlock] = []) {
        self.blocks = blocks
    }

    /// Empty means: no blocks, or every editable block's text is blank and no
    /// preserved (real, stored) content exists. A preserved block always counts
    /// as content: it represents something a previous save actually persisted.
    public var isEffectivelyEmpty: Bool {
        blocks.allSatisfy { block in
            switch block.storage {
            case .editable(_, let span):
                return span.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            case .preserved:
                return false
            }
        }
    }

    public mutating func appendNewBlock(kind: ClinicalRichTextEditorBlock.EditableKind) {
        blocks.append(ClinicalRichTextEditorBlock(kind: kind, span: ClinicalRichTextTextRun(text: "")))
    }

    public mutating func removeBlock(id: UUID) {
        blocks.removeAll { $0.id == id }
    }

    public mutating func updateText(id: UUID, text: String) {
        guard let index = blocks.firstIndex(where: { $0.id == id }),
              case .editable(let kind, let span) = blocks[index].storage else { return }
        blocks[index].storage = .editable(kind: kind, span: ClinicalRichTextTextRun(
            text: text,
            isBold: span.isBold,
            isItalic: span.isItalic,
            isUnderlined: span.isUnderlined,
            isStruckThrough: span.isStruckThrough
        ))
    }

    public mutating func setKind(id: UUID, kind: ClinicalRichTextEditorBlock.EditableKind) {
        guard let index = blocks.firstIndex(where: { $0.id == id }),
              case .editable(_, let span) = blocks[index].storage else { return }
        blocks[index].storage = .editable(kind: kind, span: span)
    }

    public mutating func toggleBold(id: UUID) { toggle(id: id) { $0.isBold.toggle() } }
    public mutating func toggleItalic(id: UUID) { toggle(id: id) { $0.isItalic.toggle() } }
    public mutating func toggleUnderline(id: UUID) { toggle(id: id) { $0.isUnderlined.toggle() } }
    public mutating func toggleStrikethrough(id: UUID) { toggle(id: id) { $0.isStruckThrough.toggle() } }

    private mutating func toggle(id: UUID, _ apply: (inout ClinicalRichTextTextRun) -> Void) {
        guard let index = blocks.firstIndex(where: { $0.id == id }),
              case .editable(let kind, var span) = blocks[index].storage else { return }
        apply(&span)
        blocks[index].storage = .editable(kind: kind, span: span)
    }

    /// Builds the AST the transcoder renders. Consecutive `bulletItem`/
    /// `numberedItem` blocks of the SAME orderedness collapse into one
    /// `<ul>`/`<ol>`, matching how a list actually renders; everything else
    /// passes through as its own top-level block. List items and a
    /// blockquote's single child use `.fragment`/`.paragraph` exactly like the
    /// canonical shapes already covered by the ClinicalRichText fixtures.
    public func toRichTextDocument() -> ClinicalRichTextDocument {
        var result: [ClinicalRichTextBlock] = []
        var index = 0
        while index < blocks.count {
            switch blocks[index].storage {
            case .preserved(let original):
                result.append(original)
                index += 1

            case .editable(let kind, let span):
                switch kind {
                case .paragraph:
                    result.append(.paragraph(Self.inlines(from: span)))
                    index += 1
                case .heading2:
                    result.append(.heading(level: .two, content: Self.inlines(from: span)))
                    index += 1
                case .heading3:
                    result.append(.heading(level: .three, content: Self.inlines(from: span)))
                    index += 1
                case .blockquote:
                    result.append(.blockquote([.paragraph(Self.inlines(from: span))]))
                    index += 1
                case .bulletItem, .numberedItem:
                    var items: [ClinicalRichTextListItem] = []
                    while index < blocks.count,
                          case .editable(let innerKind, let innerSpan) = blocks[index].storage,
                          innerKind == kind {
                        items.append(ClinicalRichTextListItem(blocks: [.fragment(Self.inlines(from: innerSpan))]))
                        index += 1
                    }
                    result.append(.list(ClinicalRichTextList(isOrdered: kind == .numberedItem, items: items)))
                }
            }
        }
        return ClinicalRichTextDocument(blocks: result)
    }

    /// The single, non-negotiable source of truth for what gets sealed: always
    /// the transcoder's render of this document, never the raw operator input.
    public var renderedHTML: String {
        ClinicalRichText.render(document: toRichTextDocument())
    }

    public static func load(html: String) -> ClinicalRichTextEditorDocument {
        load(document: ClinicalRichText.parse(html: html))
    }

    /// Flattens a parsed document into editor blocks. A `.list` block expands
    /// into one editor block PER item (when every item reduces to a single
    /// uniformly-styled run) so multi-item lists stay individually editable;
    /// everything else maps one-to-one, degrading to `.preserved` whenever the
    /// content cannot be represented losslessly by this editor's simpler model.
    public static func load(document: ClinicalRichTextDocument) -> ClinicalRichTextEditorDocument {
        ClinicalRichTextEditorDocument(blocks: document.blocks.flatMap(flatten))
    }

    // MARK: - Flatten (parse -> editor), degrading safely to `.preserved`

    private static func flatten(_ block: ClinicalRichTextBlock) -> [ClinicalRichTextEditorBlock] {
        switch block {
        case .fragment(let content), .paragraph(let content):
            if let run = mergedRun(from: content) {
                return [ClinicalRichTextEditorBlock(kind: .paragraph, span: run)]
            }
            return [ClinicalRichTextEditorBlock(preserving: block)]

        case .heading(let level, let content):
            switch level {
            case .two, .three:
                if let run = mergedRun(from: content) {
                    return [ClinicalRichTextEditorBlock(kind: level == .two ? .heading2 : .heading3, span: run)]
                }
                return [ClinicalRichTextEditorBlock(preserving: block)]
            case .one:
                // D11's toolbar only offers h2/h3: an existing h1 is preserved,
                // not silently retyped as something the toolbar can create.
                return [ClinicalRichTextEditorBlock(preserving: block)]
            }

        case .blockquote(let inner):
            if inner.isEmpty {
                return [ClinicalRichTextEditorBlock(kind: .blockquote, span: ClinicalRichTextTextRun(text: ""))]
            }
            if inner.count == 1, let content = singleChildInlines(inner[0]), let run = mergedRun(from: content) {
                return [ClinicalRichTextEditorBlock(kind: .blockquote, span: run)]
            }
            return [ClinicalRichTextEditorBlock(preserving: block)]

        case .list(let list):
            guard !list.items.isEmpty else { return [ClinicalRichTextEditorBlock(preserving: block)] }
            var runs: [ClinicalRichTextTextRun] = []
            for item in list.items {
                if item.blocks.isEmpty {
                    runs.append(ClinicalRichTextTextRun(text: ""))
                    continue
                }
                guard item.blocks.count == 1,
                      let content = singleChildInlines(item.blocks[0]),
                      let run = mergedRun(from: content) else {
                    return [ClinicalRichTextEditorBlock(preserving: block)]
                }
                runs.append(run)
            }
            let kind: ClinicalRichTextEditorBlock.EditableKind = list.isOrdered ? .numberedItem : .bulletItem
            return runs.map { ClinicalRichTextEditorBlock(kind: kind, span: $0) }

        case .sanitizedFragment:
            return [ClinicalRichTextEditorBlock(preserving: block)]
        }
    }

    private static func singleChildInlines(_ block: ClinicalRichTextBlock) -> [ClinicalRichTextInline]? {
        switch block {
        case .fragment(let inlines), .paragraph(let inlines):
            return inlines
        default:
            return nil
        }
    }

    /// Merges a run of inline content into ONE styled run if every `.text`
    /// element shares identical style flags (line breaks become "\n" in the
    /// merged text). Returns nil when styles differ, which is the signal to
    /// preserve the containing block opaquely instead of losing or misapplying
    /// style.
    private static func mergedRun(from inlines: [ClinicalRichTextInline]) -> ClinicalRichTextTextRun? {
        var combinedText = ""
        var style: (bold: Bool, italic: Bool, underlined: Bool, struckThrough: Bool)?
        for inline in inlines {
            switch inline {
            case .lineBreak:
                combinedText += "\n"
            case .text(let run):
                let runStyle = (run.isBold, run.isItalic, run.isUnderlined, run.isStruckThrough)
                if let style, style != runStyle { return nil }
                style = runStyle
                combinedText += run.text
            }
        }
        let resolved = style ?? (false, false, false, false)
        return ClinicalRichTextTextRun(
            text: combinedText,
            isBold: resolved.bold,
            isItalic: resolved.italic,
            isUnderlined: resolved.underlined,
            isStruckThrough: resolved.struckThrough
        )
    }

    /// Builds inline content from one styled run, splitting on "\n" into
    /// `.lineBreak` inlines so multi-line block text (manual line breaks, or
    /// visit-draft lines joined below) round-trips through the transcoder.
    private static func inlines(from span: ClinicalRichTextTextRun) -> [ClinicalRichTextInline] {
        guard !span.text.isEmpty else { return [] }
        let lines = span.text.components(separatedBy: "\n")
        var result: [ClinicalRichTextInline] = []
        for (index, line) in lines.enumerated() {
            if index > 0 { result.append(.lineBreak) }
            if !line.isEmpty {
                result.append(.text(ClinicalRichTextTextRun(
                    text: line,
                    isBold: span.isBold,
                    isItalic: span.isItalic,
                    isUnderlined: span.isUnderlined,
                    isStruckThrough: span.isStruckThrough
                )))
            }
        }
        return result
    }
}

public extension ClinicalRichTextEditorDocument {
    /// D5/D11: turns a computed visit draft's S/O/A/P section lines into
    /// appendable paragraph blocks (one per non-empty section, lines joined by
    /// a manual line break, labeled like the existing SOAP template). Only the
    /// lines go through the transcoder here; medications and safety stay
    /// display-only in the review UI, never inserted automatically.
    static func blocksFromVisitDraftSections(_ sections: HomeBaseVisitDraftResponse.Sections) -> [ClinicalRichTextEditorBlock] {
        let labeled: [(label: String, lines: [String])] = [
            ("S", sections.subjective),
            ("O", sections.objective),
            ("A", sections.assessment),
            ("P", sections.plan),
        ]
        var blocks: [ClinicalRichTextEditorBlock] = []
        for (label, lines) in labeled {
            let cleaned = lines.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
            guard !cleaned.isEmpty else { continue }
            let text = "\(label): " + cleaned.joined(separator: "\n")
            blocks.append(ClinicalRichTextEditorBlock(kind: .paragraph, span: ClinicalRichTextTextRun(text: text)))
        }
        return blocks
    }
}
