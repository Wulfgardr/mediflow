import Foundation

/* Typed inline editing; persistence remains the existing transcoder render. */
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

    public enum Container: Equatable, Sendable {
        case blockquote(UUID)
        case list(UUID, isOrdered: Bool)
        case listItem(UUID)
    }

    public let id: UUID
    public fileprivate(set) var containers: [Container] = []
    fileprivate var usesParagraphWrapper = false
    public var storage: Storage

    public init(id: UUID = UUID(), kind: EditableKind, span: ClinicalRichTextTextRun) {
        self.id = id
        self.storage = .editable(kind: kind, span: span)
        self.usesParagraphWrapper = kind == .paragraph || kind == .blockquote
    }

    public init(id: UUID = UUID(), kind: EditableKind, runs: [ClinicalRichTextTextRun]) {
        self.id = id
        let runs = ClinicalInlineEditing.coalesced(runs)
        self.usesParagraphWrapper = kind == .paragraph || kind == .blockquote
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
        blocks[index].storage = ClinicalRichTextEditorBlock(id: id, kind: kind, runs: runs).storage
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
        guard let index = blocks.firstIndex(where: { $0.id == id }), let runs = blocks[index].runs,
              let currentKind = blocks[index].editableKind, currentKind != kind else { return }
        if currentKind == .bulletItem || currentKind == .numberedItem || currentKind == .blockquote
            || kind == .bulletItem || kind == .numberedItem {
            materializeContainers()
        }
        let oldPath = blocks[index].containers
        var newPath = oldPath
        if let last = newPath.last, case .listItem = last {
            newPath.removeLast()
            if let last = newPath.last, case .list = last { newPath.removeLast() }
        } else if blocks[index].editableKind == .blockquote, let last = newPath.last, case .blockquote = last {
            newPath.removeLast()
        }
        switch kind {
        case .bulletItem, .numberedItem:
            let ordered = kind == .numberedItem
            var followingIndex = index + 1
            while !oldPath.isEmpty, followingIndex < blocks.count,
                  blocks[followingIndex].containers.starts(with: oldPath) { followingIndex += 1 }
            let previous = compatibleList(at: index - 1, parent: newPath, isOrdered: ordered)
            let following = compatibleList(at: followingIndex, parent: newPath, isOrdered: ordered)
            let group = previous ?? following ?? .list(UUID(), isOrdered: ordered)
            if let following, following != group {
                replaceContiguousContainerPrefix(newPath + [following], with: newPath + [group], startingAt: followingIndex)
            }
            newPath += [group, .listItem(id)]
        case .blockquote:
            newPath.append(.blockquote(UUID()))
        default: break
        }
        replaceContainerPrefix(oldPath, with: newPath, startingAt: index)
        blocks[index].storage = ClinicalRichTextEditorBlock(id: id, kind: kind, runs: runs).storage
        blocks[index].usesParagraphWrapper = kind == .paragraph || kind == .blockquote
    }

    public func canIncreaseIndent(id: UUID) -> Bool {
        guard let index = blocks.firstIndex(where: { $0.id == id }), blocks[index].editableKind != nil else { return false }
        var resolved = self
        resolved.materializeContainers()
        if case .listItem = resolved.blocks[index].containers.last {
            return resolved.previousListItem(before: index) != nil
        }
        return true
    }

    public func canDecreaseIndent(id: UUID) -> Bool {
        guard let block = blocks.first(where: { $0.id == id }), let kind = block.editableKind else { return false }
        return !block.containers.isEmpty || kind == .bulletItem || kind == .numberedItem || kind == .blockquote
    }

    @discardableResult
    public mutating func increaseIndent(id: UUID) -> Bool {
        guard canIncreaseIndent(id: id), let index = blocks.firstIndex(where: { $0.id == id }) else { return false }
        materializeContainers()
        let oldPath = blocks[index].containers
        var newPath = oldPath
        if let last = newPath.last, case .listItem = last,
           newPath.count >= 2, case .list(_, let ordered) = newPath[newPath.count - 2] {
            guard let previous = previousListItem(before: index) else { return false }
            let group = compatibleList(at: index - 1, parent: previous, isOrdered: ordered)
                ?? .list(UUID(), isOrdered: ordered)
            newPath = previous + [group, last]
        } else {
            newPath.append(.blockquote(UUID()))
        }
        replaceContainerPrefix(oldPath, with: newPath, startingAt: index)
        return true
    }

    @discardableResult
    public mutating func decreaseIndent(id: UUID) -> Bool {
        guard canDecreaseIndent(id: id), let index = blocks.firstIndex(where: { $0.id == id }) else { return false }
        materializeContainers()
        let oldPath = blocks[index].containers
        var newPath = oldPath
        guard let last = newPath.last else { return false }
        switch last {
        case .blockquote:
            newPath.removeLast()
            if blocks[index].editableKind == .blockquote {
                blocks[index].storage = ClinicalRichTextEditorBlock(kind: .paragraph, runs: blocks[index].runs ?? []).storage
            }
        case .listItem(let itemID):
            guard newPath.count >= 2, case .list = newPath[newPath.count - 2] else { return false }
            let oldListPath = Array(newPath.dropLast())
            let list = newPath[newPath.count - 2]
            newPath.removeLast(2)
            if let parent = newPath.last, case .listItem = parent { newPath.removeLast() }
            if let parent = newPath.last, case .list(_, let ordered) = parent {
                newPath.append(.listItem(itemID))
                if blocks[index].editableKind == .bulletItem || blocks[index].editableKind == .numberedItem {
                    blocks[index].storage = ClinicalRichTextEditorBlock(kind: ordered ? .numberedItem : .bulletItem, runs: blocks[index].runs ?? []).storage
                }
            } else {
                if blocks[index].editableKind == .bulletItem || blocks[index].editableKind == .numberedItem {
                    blocks[index].storage = ClinicalRichTextEditorBlock(kind: .paragraph, runs: blocks[index].runs ?? []).storage
                    blocks[index].usesParagraphWrapper = true
                }
            }
            var cursor = index + 1
            while cursor < blocks.count, blocks[cursor].containers.starts(with: oldListPath) {
                if !blocks[cursor].containers.starts(with: oldPath), newPath.last == .listItem(itemID) {
                    blocks[cursor].containers = newPath + [list] + blocks[cursor].containers.dropFirst(oldListPath.count)
                }
                cursor += 1
            }
        case .list: return false
        }
        replaceContainerPrefix(oldPath, with: newPath, startingAt: index)
        return true
    }

    private mutating func replaceContainerPrefix(
        _ old: [ClinicalRichTextEditorBlock.Container], with new: [ClinicalRichTextEditorBlock.Container], startingAt index: Int
    ) {
        blocks[index].containers = new
        guard let last = old.last, case .listItem = last else { return }
        replaceContiguousContainerPrefix(old, with: new, startingAt: index + 1)
    }

    private mutating func replaceContiguousContainerPrefix(
        _ old: [ClinicalRichTextEditorBlock.Container], with new: [ClinicalRichTextEditorBlock.Container], startingAt index: Int
    ) {
        var cursor = index
        while cursor < blocks.count, blocks[cursor].containers.starts(with: old) {
            blocks[cursor].containers = new + blocks[cursor].containers.dropFirst(old.count)
            cursor += 1
        }
    }

    private func compatibleList(
        at index: Int, parent: [ClinicalRichTextEditorBlock.Container], isOrdered: Bool
    ) -> ClinicalRichTextEditorBlock.Container? {
        guard blocks.indices.contains(index) else { return nil }
        let path = blocks[index].containers
        guard path.starts(with: parent), path.count > parent.count,
              case .list(_, let ordered) = path[parent.count], ordered == isOrdered else { return nil }
        return path[parent.count]
    }

    private func previousListItem(before index: Int) -> [ClinicalRichTextEditorBlock.Container]? {
        let path = blocks[index].containers
        guard path.count >= 2, case .listItem = path.last else { return nil }
        let parent = Array(path.dropLast())
        for candidate in blocks[..<index].reversed() {
            guard candidate.containers.starts(with: parent) else { break }
            if candidate.containers.count >= path.count, case .listItem = candidate.containers[path.count - 1] {
                let itemPath = Array(candidate.containers.prefix(path.count))
                if itemPath != path { return itemPath }
            }
        }
        return nil
    }

    private mutating func materializeContainers() {
        var list: ClinicalRichTextEditorBlock.Container?
        for index in blocks.indices {
            if let container = blocks[index].containers.first {
                if case .list = container { list = container } else { list = nil }
                continue
            }
            guard let kind = blocks[index].editableKind else { list = nil; continue }
            switch kind {
            case .bulletItem, .numberedItem:
                let ordered = kind == .numberedItem
                let group: ClinicalRichTextEditorBlock.Container
                if let previous = list, case .list(_, let previousOrdered) = previous, previousOrdered == ordered {
                    group = previous
                } else {
                    group = .list(blocks[index].id, isOrdered: ordered)
                }
                list = group
                blocks[index].containers = [group, .listItem(blocks[index].id)]
            case .blockquote:
                blocks[index].containers = [.blockquote(blocks[index].id)]
                blocks[index].usesParagraphWrapper = true
                list = nil
            default: list = nil
            }
        }
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
            blocks[index].storage = .editable(kind: kind, span: empty)
        }
    }

    public func toRichTextDocument() -> ClinicalRichTextDocument {
        if blocks == originalBlocks, let originalDocument { return originalDocument }
        var resolved = self
        resolved.materializeContainers()
        var cursor = 0
        func renderBlocks(prefix: [ClinicalRichTextEditorBlock.Container]) -> [ClinicalRichTextBlock] {
            var result: [ClinicalRichTextBlock] = []
            while cursor < resolved.blocks.count, resolved.blocks[cursor].containers.starts(with: prefix) {
                let block = resolved.blocks[cursor]
                if block.containers.count > prefix.count {
                    let container = block.containers[prefix.count]
                    let path = prefix + [container]
                    switch container {
                    case .blockquote:
                        result.append(.blockquote(renderBlocks(prefix: path)))
                    case .list(_, let ordered):
                        var items: [ClinicalRichTextListItem] = []
                        while cursor < resolved.blocks.count, resolved.blocks[cursor].containers.starts(with: path) {
                            let child = resolved.blocks[cursor].containers
                            guard child.count > path.count, case .listItem = child[path.count] else { break }
                            items.append(ClinicalRichTextListItem(blocks: renderBlocks(prefix: path + [child[path.count]])))
                        }
                        result.append(.list(ClinicalRichTextList(isOrdered: ordered, items: items)))
                    case .listItem:
                        result.append(contentsOf: renderBlocks(prefix: path))
                    }
                } else {
                    if let kind = block.editableKind, let runs = block.runs {
                        let content = Self.inlines(from: runs)
                        switch kind {
                        case .heading2, .heading3: result.append(.heading(level: kind == .heading2 ? .two : .three, content: content))
                        case .paragraph, .blockquote:
                            result.append(prefix.isEmpty || block.usesParagraphWrapper ? .paragraph(content) : .fragment(content))
                        case .bulletItem, .numberedItem:
                            result.append(block.usesParagraphWrapper ? .paragraph(content) : .fragment(content))
                        }
                    } else if case .preserved(let original) = block.storage { result.append(original) }
                    cursor += 1
                }
            }
            return result
        }
        return ClinicalRichTextDocument(blocks: renderBlocks(prefix: []))
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
        project(block, containers: [])
    }

    private static func project(
        _ block: ClinicalRichTextBlock, containers: [ClinicalRichTextEditorBlock.Container]
    ) -> [ClinicalRichTextEditorBlock] {
        func editable(_ kind: ClinicalRichTextEditorBlock.EditableKind, _ content: [ClinicalRichTextInline], paragraph: Bool) -> [ClinicalRichTextEditorBlock] {
            guard let runs = ClinicalInlineEditing.decodedRuns(content) else {
                var preserved = ClinicalRichTextEditorBlock(preserving: block)
                preserved.containers = containers
                return [preserved]
            }
            var displayedKind = kind
            if kind == .paragraph, let last = containers.last {
                switch last {
                case .listItem:
                    if containers.count >= 2, case .list(_, let ordered) = containers[containers.count - 2] {
                        displayedKind = ordered ? .numberedItem : .bulletItem
                    }
                case .blockquote: displayedKind = .blockquote
                default: break
                }
            }
            var row = ClinicalRichTextEditorBlock(kind: displayedKind, runs: runs)
            row.containers = containers
            row.usesParagraphWrapper = paragraph
            return [row]
        }
        switch block {
        case .fragment(let content): return editable(.paragraph, content, paragraph: false)
        case .paragraph(let content): return editable(.paragraph, content, paragraph: true)
        case .heading(let level, let content):
            if level != .one { return editable(level == .two ? .heading2 : .heading3, content, paragraph: false) }
        case .blockquote(let inner):
            let path = containers + [.blockquote(UUID())]
            return (inner.isEmpty ? [.paragraph([])] : inner).flatMap { project($0, containers: path) }
        case .list(let list):
            guard !list.items.isEmpty else { break }
            let path = containers + [.list(UUID(), isOrdered: list.isOrdered)]
            return list.items.flatMap { item in
                let itemPath = path + [.listItem(UUID())]
                return (item.blocks.isEmpty ? [.fragment([])] : item.blocks).flatMap { project($0, containers: itemPath) }
            }
        case .sanitizedFragment: break
        }
        var preserved = ClinicalRichTextEditorBlock(preserving: block)
        preserved.containers = containers
        return [preserved]
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
