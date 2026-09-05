/* @Codex */
import Foundation

extension HeadlessSoapEntryH4Codec {
    static func decodeContent(_ content: String) throws -> Sections {
        var remainder = content[...]
        var decoded: [String] = []
        for label in ["S", "O", "A", "P"] {
            let prefix = "<p>\(label):"
            guard remainder.hasPrefix(prefix) else { throw CodecError.invalidContent }
            remainder.removeFirst(prefix.count)
            if remainder.hasPrefix("</p>") {
                decoded.append("")
                remainder.removeFirst(4)
                continue
            }
            guard remainder.hasPrefix(" ") else { throw CodecError.invalidContent }
            remainder.removeFirst()
            guard let close = remainder.range(of: "</p>") else { throw CodecError.invalidContent }
            decoded.append(try decodeEscapedContent(remainder[..<close.lowerBound]))
            remainder = remainder[close.upperBound...]
        }
        guard remainder.isEmpty, decoded.count == 4 else { throw CodecError.invalidContent }
        let result = Sections(
            subjective: decoded[0],
            objective: decoded[1],
            assessment: decoded[2],
            plan: decoded[3]
        )
        guard byteEqual(encodeContent(result), content) else { throw CodecError.invalidContent }
        return result
    }

    static func canonicalDate(_ milliseconds: Int64) throws -> String {
        let maximum = Int64(253_402_300_799_999)
        guard milliseconds >= 0,
              milliseconds <= 9_007_199_254_740_991,
              milliseconds <= maximum else { throw CodecError.invalidDate }
        let seconds = milliseconds / 1_000
        let days = seconds / 86_400
        let time = seconds % 86_400
        let hour = time / 3_600
        let minute = (time % 3_600) / 60
        let second = time % 60

        let shifted = days + 719_468
        let era = shifted / 146_097
        let dayOfEra = shifted - era * 146_097
        let yearOfEra = (dayOfEra - dayOfEra / 1_460 + dayOfEra / 36_524 - dayOfEra / 146_096) / 365
        var year = yearOfEra + era * 400
        let dayOfYear = dayOfEra - (365 * yearOfEra + yearOfEra / 4 - yearOfEra / 100)
        let monthPrime = (5 * dayOfYear + 2) / 153
        let day = dayOfYear - (153 * monthPrime + 2) / 5 + 1
        let month = monthPrime + (monthPrime < 10 ? 3 : -9)
        year += month <= 2 ? 1 : 0
        guard year >= 0, year <= 9_999 else { throw CodecError.invalidDate }
        return String(format: "%04lld-%02lld-%02lldT%02lld:%02lld:%02lld.000Z", year, month, day, hour, minute, second)
    }

    static func encodeContent(_ sections: Sections) -> String {
        [
            contentBlock("S", sections.subjective),
            contentBlock("O", sections.objective),
            contentBlock("A", sections.assessment),
            contentBlock("P", sections.plan),
        ].joined()
    }

    private static func contentBlock(_ label: String, _ value: String) -> String {
        value.isEmpty ? "<p>\(label):</p>" : "<p>\(label): \(escapeContent(value))</p>"
    }

    private static func escapeContent(_ value: String) -> String {
        var output = ""
        for scalar in value.unicodeScalars {
            switch scalar.value {
            case 38: output += "&amp;"
            case 60: output += "&lt;"
            case 62: output += "&gt;"
            case 34: output += "&quot;"
            case 39: output += "&#39;"
            case 10: output += "<br>"
            default: output.unicodeScalars.append(scalar)
            }
        }
        return output
    }

    private static func decodeEscapedContent(_ input: Substring) throws -> String {
        var remainder = input
        var output = ""
        while !remainder.isEmpty {
            if remainder.hasPrefix("<br>") {
                output += "\n"
                remainder.removeFirst(4)
            } else if remainder.hasPrefix("&amp;") {
                output += "&"
                remainder.removeFirst(5)
            } else if remainder.hasPrefix("&lt;") {
                output += "<"
                remainder.removeFirst(4)
            } else if remainder.hasPrefix("&gt;") {
                output += ">"
                remainder.removeFirst(4)
            } else if remainder.hasPrefix("&quot;") {
                output += "\""
                remainder.removeFirst(6)
            } else if remainder.hasPrefix("&#39;") {
                output += "'"
                remainder.removeFirst(5)
            } else {
                guard let character = remainder.first, character != "<", character != "&" else {
                    throw CodecError.invalidContent
                }
                output.append(character)
                remainder.removeFirst()
            }
        }
        return output
    }
}
