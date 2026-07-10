/* @Codex */
public struct ClinicalRichTextDocument: Equatable, Sendable {
    public var blocks: [ClinicalRichTextBlock]

    public init(blocks: [ClinicalRichTextBlock] = []) {
        self.blocks = blocks
    }
}

public enum ClinicalRichTextHeadingLevel: Int, Equatable, Sendable {
    case one = 1
    case two = 2
    case three = 3
}

public struct ClinicalRichTextTextRun: Equatable, Sendable {
    public var text: String
    public var isBold: Bool
    public var isItalic: Bool
    public var isUnderlined: Bool
    public var isStruckThrough: Bool

    public init(
        text: String,
        isBold: Bool = false,
        isItalic: Bool = false,
        isUnderlined: Bool = false,
        isStruckThrough: Bool = false
    ) {
        self.text = text
        self.isBold = isBold
        self.isItalic = isItalic
        self.isUnderlined = isUnderlined
        self.isStruckThrough = isStruckThrough
    }
}

public enum ClinicalRichTextInline: Equatable, Sendable {
    case text(ClinicalRichTextTextRun)
    case lineBreak
}

public struct ClinicalRichTextListItem: Equatable, Sendable {
    public var blocks: [ClinicalRichTextBlock]

    public init(blocks: [ClinicalRichTextBlock]) {
        self.blocks = blocks
    }
}

public struct ClinicalRichTextList: Equatable, Sendable {
    public var isOrdered: Bool
    public var items: [ClinicalRichTextListItem]

    public init(isOrdered: Bool, items: [ClinicalRichTextListItem]) {
        self.isOrdered = isOrdered
        self.items = items
    }
}

public struct ClinicalRichTextSanitizedFragment: Equatable, Sendable {
    public let html: String

    fileprivate init(html: String) {
        self.html = html
    }
}

public indirect enum ClinicalRichTextBlock: Equatable, Sendable {
    // The web sanitizer preserves plain text outside block tags. A fragment keeps
    // that accepted dialect byte-stable without inventing a paragraph wrapper.
    case fragment([ClinicalRichTextInline])
    case paragraph([ClinicalRichTextInline])
    case heading(level: ClinicalRichTextHeadingLevel, content: [ClinicalRichTextInline])
    case list(ClinicalRichTextList)
    case blockquote([ClinicalRichTextBlock])
    // The web sanitizer is lexical and can preserve unclosed or crossed allowlist
    // tags. Only parse can construct this safe, allowlist-tokenized fallback.
    case sanitizedFragment(ClinicalRichTextSanitizedFragment)
}

public enum ClinicalRichText {
    public static func parse(html: String) -> ClinicalRichTextDocument {
        let tokens = tokenize(html)
        var parser = Parser(tokens: tokens)
        let parsed = ClinicalRichTextDocument(blocks: parser.parseBlocks())
        let losslessSanitizedHTML = tokens.map(render(token:)).joined()

        guard render(document: parsed) != losslessSanitizedHTML else { return parsed }
        return ClinicalRichTextDocument(blocks: [
            .sanitizedFragment(ClinicalRichTextSanitizedFragment(html: losslessSanitizedHTML)),
        ])
    }

    public static func render(document: ClinicalRichTextDocument) -> String {
        document.blocks.map(render(block:)).joined()
    }

    private enum Tag: String {
        case paragraph = "p"
        case lineBreak = "br"
        case strong
        case emphasis = "em"
        case underline = "u"
        case strikethrough = "s"
        case unorderedList = "ul"
        case orderedList = "ol"
        case listItem = "li"
        case heading1 = "h1"
        case heading2 = "h2"
        case heading3 = "h3"
        case blockquote

        var isInlineStyle: Bool {
            switch self {
            case .strong, .emphasis, .underline, .strikethrough:
                true
            default:
                false
            }
        }

        var isBlock: Bool {
            switch self {
            case .paragraph, .unorderedList, .orderedList, .listItem,
                    .heading1, .heading2, .heading3, .blockquote:
                true
            case .lineBreak, .strong, .emphasis, .underline, .strikethrough:
                false
            }
        }
    }

    private enum Token {
        case opening(Tag)
        case closing(Tag)
        case lineBreak
        case text(String)
    }

    private struct Style {
        var isBold = false
        var isItalic = false
        var isUnderlined = false
        var isStruckThrough = false

        func adding(_ tag: Tag) -> Style {
            var copy = self
            switch tag {
            case .strong:
                copy.isBold = true
            case .emphasis:
                copy.isItalic = true
            case .underline:
                copy.isUnderlined = true
            case .strikethrough:
                copy.isStruckThrough = true
            default:
                break
            }
            return copy
        }
    }

    private struct Parser {
        let tokens: [Token]
        var index = 0

        mutating func parseBlocks(until closingTag: Tag? = nil) -> [ClinicalRichTextBlock] {
            var blocks: [ClinicalRichTextBlock] = []

            while index < tokens.count {
                if case .closing(let tag) = tokens[index], tag == closingTag {
                    index += 1
                    return blocks
                }

                switch tokens[index] {
                case .opening(.paragraph):
                    index += 1
                    let content = parseInlineFragment(until: .paragraph)
                    consumeClosing(.paragraph)
                    blocks.append(.paragraph(content))

                case .opening(.heading1):
                    blocks.append(parseHeading(level: .one, tag: .heading1))

                case .opening(.heading2):
                    blocks.append(parseHeading(level: .two, tag: .heading2))

                case .opening(.heading3):
                    blocks.append(parseHeading(level: .three, tag: .heading3))

                case .opening(.unorderedList):
                    index += 1
                    blocks.append(.list(parseList(isOrdered: false, tag: .unorderedList)))

                case .opening(.orderedList):
                    index += 1
                    blocks.append(.list(parseList(isOrdered: true, tag: .orderedList)))

                case .opening(.blockquote):
                    index += 1
                    blocks.append(.blockquote(parseBlocks(until: .blockquote)))

                case .closing:
                    // A sanitized but structurally incomplete dialect can contain a
                    // stray closer. Ignoring it is the safest tolerant parse behavior.
                    index += 1

                default:
                    let start = index
                    let content = parseInlineFragment(until: closingTag)
                    if !content.isEmpty {
                        blocks.append(.fragment(content))
                    } else if index == start {
                        index += 1
                    }
                }
            }

            return blocks
        }

        private mutating func parseHeading(
            level: ClinicalRichTextHeadingLevel,
            tag: Tag
        ) -> ClinicalRichTextBlock {
            index += 1
            let content = parseInlineFragment(until: tag)
            consumeClosing(tag)
            return .heading(level: level, content: content)
        }

        private mutating func parseList(isOrdered: Bool, tag: Tag) -> ClinicalRichTextList {
            var items: [ClinicalRichTextListItem] = []

            while index < tokens.count {
                if case .closing(let closing) = tokens[index], closing == tag {
                    index += 1
                    break
                }

                if case .opening(.listItem) = tokens[index] {
                    index += 1
                    items.append(ClinicalRichTextListItem(blocks: parseBlocks(until: .listItem)))
                } else {
                    index += 1
                }
            }

            return ClinicalRichTextList(isOrdered: isOrdered, items: items)
        }

        private mutating func parseInlineFragment(until closingTag: Tag?) -> [ClinicalRichTextInline] {
            var content: [ClinicalRichTextInline] = []
            let baseStyle = Style()

            while index < tokens.count {
                switch tokens[index] {
                case .text(let value):
                    index += 1
                    content.append(.text(textRun(value, style: baseStyle)))

                case .lineBreak:
                    index += 1
                    content.append(.lineBreak)

                case .opening(let tag) where tag.isInlineStyle:
                    index += 1
                    content.append(contentsOf: parseStyledContent(until: tag, style: baseStyle.adding(tag)))

                case .opening(let tag) where tag.isBlock:
                    return content

                case .closing(let tag):
                    if tag == closingTag || tag.isBlock {
                        return content
                    }
                    index += 1

                default:
                    index += 1
                }
            }

            return content
        }

        private mutating func parseStyledContent(
            until closingTag: Tag,
            style: Style
        ) -> [ClinicalRichTextInline] {
            var content: [ClinicalRichTextInline] = []

            while index < tokens.count {
                switch tokens[index] {
                case .text(let value):
                    index += 1
                    content.append(.text(textRun(value, style: style)))

                case .lineBreak:
                    index += 1
                    content.append(.lineBreak)

                case .opening(let tag) where tag.isInlineStyle:
                    index += 1
                    content.append(contentsOf: parseStyledContent(until: tag, style: style.adding(tag)))

                case .closing(let tag) where tag == closingTag:
                    index += 1
                    return content

                case .opening(let tag) where tag.isBlock:
                    return content

                case .closing(let tag) where tag.isBlock:
                    return content

                default:
                    index += 1
                }
            }

            return content
        }

        private mutating func consumeClosing(_ tag: Tag) {
            guard index < tokens.count,
                  case .closing(let closing) = tokens[index],
                  closing == tag else {
                return
            }
            index += 1
        }

        private func textRun(_ value: String, style: Style) -> ClinicalRichTextTextRun {
            ClinicalRichTextTextRun(
                text: value.replacingOccurrences(of: "&lt;", with: "<"),
                isBold: style.isBold,
                isItalic: style.isItalic,
                isUnderlined: style.isUnderlined,
                isStruckThrough: style.isStruckThrough
            )
        }
    }

    private static func tokenize(_ html: String) -> [Token] {
        var tokens: [Token] = []
        var text = ""
        var cursor = html.startIndex

        func appendText() {
            guard !text.isEmpty else { return }
            tokens.append(.text(text))
            text = ""
        }

        while cursor < html.endIndex {
            guard html[cursor] == "<",
                  let end = html[cursor...].firstIndex(of: ">") else {
                text.append(html[cursor])
                cursor = html.index(after: cursor)
                continue
            }

            let tokenEnd = html.index(after: end)
            let rawToken = String(html[cursor..<tokenEnd])
            guard let token = token(from: rawToken) else {
                text.append(contentsOf: rawToken)
                cursor = tokenEnd
                continue
            }

            appendText()
            tokens.append(token)
            cursor = tokenEnd
        }

        appendText()
        return tokens
    }

    private static func token(from rawToken: String) -> Token? {
        guard rawToken.first == "<", rawToken.last == ">" else { return nil }
        var name = String(rawToken.dropFirst().dropLast()).lowercased()
        let isClosing = name.first == "/"
        if isClosing { name.removeFirst() }
        guard let tag = Tag(rawValue: name) else { return nil }
        if tag == .lineBreak { return .lineBreak }
        return isClosing ? .closing(tag) : .opening(tag)
    }

    private static func render(block: ClinicalRichTextBlock) -> String {
        switch block {
        case .fragment(let content):
            return render(inlines: content)
        case .paragraph(let content):
            return "<p>\(render(inlines: content))</p>"
        case .heading(let level, let content):
            let tag = "h\(level.rawValue)"
            return "<\(tag)>\(render(inlines: content))</\(tag)>"
        case .list(let list):
            let tag = list.isOrdered ? "ol" : "ul"
            let items = list.items.map { "<li>\($0.blocks.map(render(block:)).joined())</li>" }.joined()
            return "<\(tag)>\(items)</\(tag)>"
        case .blockquote(let blocks):
            return "<blockquote>\(blocks.map(render(block:)).joined())</blockquote>"
        case .sanitizedFragment(let fragment):
            return fragment.html
        }
    }

    private static func render(token: Token) -> String {
        switch token {
        case .opening(let tag):
            return "<\(tag.rawValue)>"
        case .closing(let tag):
            return "</\(tag.rawValue)>"
        case .lineBreak:
            return "<br>"
        case .text(let value):
            return value.replacingOccurrences(of: "<", with: "&lt;")
        }
    }

    private static func render(inlines: [ClinicalRichTextInline]) -> String {
        inlines.map { inline in
            switch inline {
            case .lineBreak:
                return "<br>"
            case .text(let run):
                var value = run.text.replacingOccurrences(of: "<", with: "&lt;")
                if run.isStruckThrough { value = "<s>\(value)</s>" }
                if run.isUnderlined { value = "<u>\(value)</u>" }
                if run.isItalic { value = "<em>\(value)</em>" }
                if run.isBold { value = "<strong>\(value)</strong>" }
                return value
            }
        }.joined()
    }
}
