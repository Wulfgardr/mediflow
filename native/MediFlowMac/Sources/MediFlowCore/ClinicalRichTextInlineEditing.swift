import Foundation

/* @Codex: Platform-independent inline operations. Ranges use native UTF-16 offsets. */
public enum ClinicalInlineStyle: String, CaseIterable, Sendable {
    case bold, italic, underline, strikethrough

    public func isApplied(to run: ClinicalRichTextTextRun) -> Bool {
        switch self {
        case .bold: run.isBold
        case .italic: run.isItalic
        case .underline: run.isUnderlined
        case .strikethrough: run.isStruckThrough
        }
    }

    public func apply(_ enabled: Bool, to run: inout ClinicalRichTextTextRun) {
        switch self {
        case .bold: run.isBold = enabled
        case .italic: run.isItalic = enabled
        case .underline: run.isUnderlined = enabled
        case .strikethrough: run.isStruckThrough = enabled
        }
    }
}

/* @Codex */
public enum ClinicalInlineEditing {
    public static func plainText(_ runs: [ClinicalRichTextTextRun]) -> String {
        runs.map(\.text).joined()
    }

    public static func coalesced(_ runs: [ClinicalRichTextTextRun]) -> [ClinicalRichTextTextRun] {
        var result: [ClinicalRichTextTextRun] = []
        for run in runs where !run.text.isEmpty {
            if let last = result.last, sameStyle(last, run) {
                result[result.count - 1].text += run.text
            } else {
                result.append(run)
            }
        }
        return result
    }

    public static func sameStyle(_ lhs: ClinicalRichTextTextRun, _ rhs: ClinicalRichTextTextRun) -> Bool {
        ClinicalInlineStyle.allCases.allSatisfy { $0.isApplied(to: lhs) == $0.isApplied(to: rhs) }
    }

    public static func valid(_ range: NSRange, in runs: [ClinicalRichTextTextRun]) -> Bool {
        let text = plainText(runs)
        guard range.location >= 0, range.length >= 0,
              range.location <= text.utf16.count,
              range.length <= text.utf16.count - range.location else { return false }
        // A native selection may not split a surrogate pair or a composed character.
        var boundaries: Set<Int> = [0]
        var offset = 0
        for character in text {
            offset += String(character).utf16.count
            boundaries.insert(offset)
        }
        return boundaries.contains(range.location) && boundaries.contains(range.location + range.length)
    }

    public static func slice(_ runs: [ClinicalRichTextTextRun], range: NSRange) -> [ClinicalRichTextTextRun] {
        let length = plainText(runs).utf16.count
        guard range.location >= 0, range.length >= 0, range.location <= length,
              range.length <= length - range.location else { return [] }
        var offset = 0
        var result: [ClinicalRichTextTextRun] = []
        for run in runs {
            let length = run.text.utf16.count
            let start = max(offset, range.location)
            let end = min(offset + length, range.location + range.length)
            if start < end {
                var part = run
                part.text = (run.text as NSString).substring(with: NSRange(location: start - offset, length: end - start))
                result.append(part)
            }
            offset += length
        }
        return result
    }

    public static func replacing(
        _ runs: [ClinicalRichTextTextRun], range: NSRange, with replacement: [ClinicalRichTextTextRun]
    ) -> [ClinicalRichTextTextRun]? {
        guard valid(range, in: runs) else { return nil }
        let end = range.location + range.length
        return coalesced(
            slice(runs, range: NSRange(location: 0, length: range.location))
            + replacement
            + slice(runs, range: NSRange(location: end, length: plainText(runs).utf16.count - end))
        )
    }

    public static func toggling(
        _ style: ClinicalInlineStyle, in runs: [ClinicalRichTextTextRun], range: NSRange
    ) -> [ClinicalRichTextTextRun]? {
        guard range.length > 0, valid(range, in: runs) else { return nil }
        var selected = slice(runs, range: range)
        let enable = !selected.allSatisfy { style.isApplied(to: $0) }
        for index in selected.indices { style.apply(enable, to: &selected[index]) }
        return replacing(runs, range: range, with: selected)
    }

    // The transcoder preserves lexical entities. The native editor displays their
    // characters, while rendering edits escapes ampersands before the transcoder
    // escapes angle brackets. Unknown entities stay opaque instead of changing meaning.
    static func decoded(_ source: String) -> String? {
        let named = [
            "nbsp": "\u{00a0}", "amp": "&", "lt": "<", "gt": ">", "quot": "\"", "apos": "'",
            "agrave": "à", "egrave": "è", "eacute": "é", "igrave": "ì", "ograve": "ò", "ugrave": "ù",
            "Agrave": "À", "Egrave": "È", "Eacute": "É", "Igrave": "Ì", "Ograve": "Ò", "Ugrave": "Ù"
        ]
        let pattern = #"&(#(?:[xX][0-9a-fA-F]+|[0-9]+)|[a-zA-Z][a-zA-Z0-9]+);"#
        guard let expression = try? NSRegularExpression(pattern: pattern) else { return nil }
        let original = source as NSString
        var result = source
        for match in expression.matches(in: source, range: NSRange(location: 0, length: original.length)).reversed() {
            let entity = original.substring(with: match.range(at: 1))
            let replacement: String
            if let value = named[entity] {
                replacement = value
            } else if entity.hasPrefix("#") {
                let hex = entity.hasPrefix("#x") || entity.hasPrefix("#X")
                guard let value = UInt32(entity.dropFirst(hex ? 2 : 1), radix: hex ? 16 : 10),
                      value != 0, let scalar = UnicodeScalar(value) else { return nil }
                replacement = String(scalar)
            } else { return nil }
            guard let range = Range(match.range, in: result) else { return nil }
            result.replaceSubrange(range, with: replacement)
        }
        return result
    }

    static func decodedRuns(_ inlines: [ClinicalRichTextInline]) -> [ClinicalRichTextTextRun]? {
        var result: [ClinicalRichTextTextRun] = []
        for inline in inlines {
            switch inline {
            case .lineBreak:
                var run = result.last ?? ClinicalRichTextTextRun(text: "")
                run.text = "\n"
                result.append(run)
            case .text(var run):
                guard let text = decoded(run.text) else { return nil }
                run.text = text
                result.append(run)
            }
        }
        return coalesced(result)
    }
}
