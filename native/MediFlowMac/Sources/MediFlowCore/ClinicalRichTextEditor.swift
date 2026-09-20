import Foundation

/* @Codex: Typed inline editing; persistence remains the existing transcoder render. */
public struct ClinicalRichTextEditorBlock: Identifiable, Equatable, Sendable {
    public enum EditableKind: Equatable, Hashable, Sendable, CaseIterable {
        case paragraph, heading2, heading3, bulletItem, numberedItem, blockquote
    }

    public enum Storage: Equatable, Sendable {
        // Retained for existing callers creating a uniform paragraph.
        case editable(kind: EditableKind, span: ClinicalRichTextTextRun)
        case inline(kind: EditableKind, runs: [ClinicalRichTextTextRun])
        case preserved(ClinicalRichTextBlock)
    }

    public let id: UUID
    public var storage: Storage

    public init(id: UUID = UUID(), kind: EditableKind, span: ClinicalRichTextTextRun) {
        self.id = id
        self.storage = .editable(kind: kind, span: span)
    }

    public init(id: UUID = UUID(), kind: EditableKind, runs: [ClinicalRichTextTextRun]) {
        self.id = id
        let runs = ClinicalInlineEditing.coalesced(runs)
        self.storage = runs.count <= 1
            ? .editable(kind: kind, span: runs.first ?? ClinicalRichTextTextRun(text: ""))
            : .inline(kind: kind, runs: runs)
    }

    public init(id: UUID = UUID(), preserving block: ClinicalRichTextBlock) {
        self.id = id
        self.storage = .preserved(block)
    }

    public var editableKind: EditableKind? {
        switch storage {
        case .editable(let kind, _), .inline(let kind, _): kind
        case .preserved: nil
        }
    }

    public var runs: [ClinicalRichTextTextRun]? {
        switch storage {
        case .editable(_, let span): [span]
        case .inline(_, let runs): runs
        case .preserved: nil
        }
    }

    public var preservedPreviewText: String? {
        guard case .preserved(let block) = storage else { return nil }
        return ClinicalRichText.render(document: ClinicalRichTextDocument(blocks: [block]))
    }

    public var isPreserved: Bool {
        if case .preserved = storage { return true }
        return false
    }
}

/* @Codex */
public struct ClinicalRichTextEditorDocument: Equatable, Sendable {
    public var blocks: [ClinicalRichTextEditorBlock]
    // A no-op save (including a style change undone by the user) retains the
    // original sanitized representation, including list/inline tag grouping.
    private var originalDocument: ClinicalRichTextDocument?
    private var originalBlocks: [ClinicalRichTextEditorBlock]?

    public init(blocks: [ClinicalRichTextEditorBlock] = []) {
        self.blocks = blocks
    }

    public var isEffectivelyEmpty: Bool {
        blocks.allSatisfy { block in
            guard let runs = block.runs else { return false }
            return ClinicalInlineEditing.plainText(runs).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
    }

    public mutating func appendNewBlock(kind: ClinicalRichTextEditorBlock.EditableKind) {
        blocks.append(ClinicalRichTextEditorBlock(kind: kind, span: ClinicalRichTextTextRun(text: "")))
    }

    public mutating func removeBlock(id: UUID) {
        blocks.removeAll { $0.id == id }
    }

    // Compatibility for uniform callers. Rich native input uses updateRuns,
    // never replaces a mixed paragraph through a plain-string binding.
    public mutating func updateText(id: UUID, text: String) {
        guard let block = blocks.first(where: { $0.id == id }), let runs = block.runs else { return }
        let before = ClinicalInlineEditing.plainText(runs)
        guard text != before else { return }
        // Keep attributes around the actual replacement, including when an
        // existing retained plain-text binding observes a now-mixed block.
        let old = Array(before), new = Array(text)
        var prefix = 0
        while prefix < min(old.count, new.count), old[prefix] == new[prefix] { prefix += 1 }
        var suffix = 0
        while suffix < min(old.count - prefix, new.count - prefix),
              old[old.count - 1 - suffix] == new[new.count - 1 - suffix] { suffix += 1 }
        let location = String(old.prefix(prefix)).utf16.count
        let removed = String(old[prefix..<(old.count - suffix)]).utf16.count
        var replacement = runs.first ?? ClinicalRichTextTextRun(text: "")
        if location > 0 {
            replacement = ClinicalInlineEditing.slice(runs, range: NSRange(location: location - 1, length: 1)).first ?? replacement
        }
        replacement.text = String(new[prefix..<(new.count - suffix)])
        _ = replaceText(id: id, range: NSRange(location: location, length: removed), with: [replacement])
    }

    @discardableResult
    public mutating func updateRuns(
        id: UUID, runs: [ClinicalRichTextTextRun], expecting expected: [ClinicalRichTextTextRun]? = nil
    ) -> Bool {
        guard let index = blocks.firstIndex(where: { $0.id == id }),
              let kind = blocks[index].editableKind, let current = blocks[index].runs,
              expected == nil || ClinicalInlineEditing.coalesced(current) == ClinicalInlineEditing.coalesced(expected!) else { return false }
        blocks[index] = ClinicalRichTextEditorBlock(id: id, kind: kind, runs: runs)
        return true
    }

    @discardableResult
    public mutating func replaceText(id: UUID, range: NSRange, with runs: [ClinicalRichTextTextRun]) -> Bool {
        guard let current = blocks.first(where: { $0.id == id })?.runs,
              let edited = ClinicalInlineEditing.replacing(current, range: range, with: runs) else { return false }
        return updateRuns(id: id, runs: edited, expecting: current)
    }

    @discardableResult
    public mutating func toggleStyle(id: UUID, style: ClinicalInlineStyle, range: NSRange) -> Bool {
        guard let current = blocks.first(where: { $0.id == id })?.runs,
              let edited = ClinicalInlineEditing.toggling(style, in: current, range: range) else { return false }
        return updateRuns(id: id, runs: edited, expecting: current)
    }

    public mutating func setKind(id: UUID, kind: ClinicalRichTextEditorBlock.EditableKind) {
        guard let index = blocks.firstIndex(where: { $0.id == id }), let runs = blocks[index].runs else { return }
        blocks[index] = ClinicalRichTextEditorBlock(id: id, kind: kind, runs: runs)
    }

    public mutating func toggleBold(id: UUID) { toggleWholeBlock(id: id, style: .bold) }
    public mutating func toggleItalic(id: UUID) { toggleWholeBlock(id: id, style: .italic) }
    public mutating func toggleUnderline(id: UUID) { toggleWholeBlock(id: id, style: .underline) }
    public mutating func toggleStrikethrough(id: UUID) { toggleWholeBlock(id: id, style: .strikethrough) }

    private mutating func toggleWholeBlock(id: UUID, style: ClinicalInlineStyle) {
        guard let current = blocks.first(where: { $0.id == id })?.runs else { return }
        let length = ClinicalInlineEditing.plainText(current).utf16.count
        if length > 0 {
            _ = toggleStyle(id: id, style: style, range: NSRange(location: 0, length: length))
        } else {
            var empty = current.first ?? ClinicalRichTextTextRun(text: "")
            style.apply(!style.isApplied(to: empty), to: &empty)
            guard let index = blocks.firstIndex(where: { $0.id == id }),
                  let kind = blocks[index].editableKind else { return }
            blocks[index] = ClinicalRichTextEditorBlock(id: id, kind: kind, span: empty)
        }
    }

    public func toRichTextDocument() -> ClinicalRichTextDocument {
        if blocks == originalBlocks, let originalDocument { return originalDocument }
        var result: [ClinicalRichTextBlock] = []
        var index = 0
        while index < blocks.count {
            let block = blocks[index]
            guard let kind = block.editableKind, let runs = block.runs else {
                if case .preserved(let original) = block.storage { result.append(original) }
                index += 1
                continue
            }
            switch kind {
            case .paragraph:
                result.append(.paragraph(Self.inlines(from: runs)))
                index += 1
            case .heading2, .heading3:
                result.append(.heading(level: kind == .heading2 ? .two : .three, content: Self.inlines(from: runs)))
                index += 1
            case .blockquote:
                result.append(.blockquote([.paragraph(Self.inlines(from: runs))]))
                index += 1
            case .bulletItem, .numberedItem:
                var items: [ClinicalRichTextListItem] = []
                while index < blocks.count, blocks[index].editableKind == kind, let itemRuns = blocks[index].runs {
                    items.append(ClinicalRichTextListItem(blocks: [.fragment(Self.inlines(from: itemRuns))]))
                    index += 1
                }
                result.append(.list(ClinicalRichTextList(isOrdered: kind == .numberedItem, items: items)))
            }
        }
        return ClinicalRichTextDocument(blocks: result)
    }

    public var renderedHTML: String { ClinicalRichText.render(document: toRichTextDocument()) }

    public static func load(html: String) -> ClinicalRichTextEditorDocument {
        load(document: ClinicalRichText.parse(html: html))
    }

    public static func load(document: ClinicalRichTextDocument) -> ClinicalRichTextEditorDocument {
        var editor = ClinicalRichTextEditorDocument(blocks: document.blocks.flatMap { original in
            if let projection = ClinicalRichText.inlineEditorProjection(original) {
                let projected = projection.blocks.flatMap(flatten)
                // Projection must not normalize an unsupported fragment when
                // a different, editable block is changed later.
                return projected.contains(where: \.isPreserved)
                    ? [ClinicalRichTextEditorBlock(preserving: original)] : projected
            }
            return flatten(original)
        })
        editor.originalDocument = document
        editor.originalBlocks = editor.blocks
        return editor
    }

    private static func flatten(_ block: ClinicalRichTextBlock) -> [ClinicalRichTextEditorBlock] {
        func editable(_ kind: ClinicalRichTextEditorBlock.EditableKind, _ content: [ClinicalRichTextInline]) -> [ClinicalRichTextEditorBlock] {
            guard let runs = ClinicalInlineEditing.decodedRuns(content) else {
                return [ClinicalRichTextEditorBlock(preserving: block)]
            }
            return [ClinicalRichTextEditorBlock(kind: kind, runs: runs)]
        }
        switch block {
        case .fragment(let content), .paragraph(let content):
            return editable(.paragraph, content)
        case .heading(let level, let content):
            guard level != .one else { return [ClinicalRichTextEditorBlock(preserving: block)] }
            return editable(level == .two ? .heading2 : .heading3, content)
        case .blockquote(let inner):
            if inner.isEmpty { return editable(.blockquote, []) }
            if inner.count == 1, let content = singleChildInlines(inner[0]) { return editable(.blockquote, content) }
            return [ClinicalRichTextEditorBlock(preserving: block)]
        case .list(let list):
            guard !list.items.isEmpty else { return [ClinicalRichTextEditorBlock(preserving: block)] }
            var items: [[ClinicalRichTextTextRun]] = []
            for item in list.items {
                if item.blocks.isEmpty { items.append([]); continue }
                guard item.blocks.count == 1, let content = singleChildInlines(item.blocks[0]),
                      let runs = ClinicalInlineEditing.decodedRuns(content) else {
                    return [ClinicalRichTextEditorBlock(preserving: block)]
                }
                items.append(runs)
            }
            return items.map { ClinicalRichTextEditorBlock(kind: list.isOrdered ? .numberedItem : .bulletItem, runs: $0) }
        case .sanitizedFragment:
            return [ClinicalRichTextEditorBlock(preserving: block)]
        }
    }

    private static func singleChildInlines(_ block: ClinicalRichTextBlock) -> [ClinicalRichTextInline]? {
        switch block {
        case .fragment(let inlines), .paragraph(let inlines): inlines
        default: nil
        }
    }

    private static func inlines(from runs: [ClinicalRichTextTextRun]) -> [ClinicalRichTextInline] {
        var result: [ClinicalRichTextInline] = []
        for run in ClinicalInlineEditing.coalesced(runs) {
            for (index, line) in run.text.components(separatedBy: "\n").enumerated() {
                if index > 0 { result.append(.lineBreak) }
                if !line.isEmpty {
                    var escaped = run
                    escaped.text = line.replacingOccurrences(of: "&", with: "&amp;")
                    result.append(.text(escaped))
                }
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
