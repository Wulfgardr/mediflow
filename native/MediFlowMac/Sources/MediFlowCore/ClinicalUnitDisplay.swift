import Foundation

/// Unità di misura come le legge un medico. Il codice UCUM registrato non cambia:
/// cambia solo la lettura. Stessa regola di `formatUnitForDisplay` in
/// `lib/terminology.ts`; i casi condivisi stanno in `ClinicalUnitDisplayTests`.
public enum ClinicalUnitDisplay {
    private static let catalog: [String: String] = [
        "mm[Hg]": "mmHg",
        "/min": "/min",
        "%": "%",
        "Cel": "°C",
        "kg": "kg",
        "mg/dL": "mg/dL",
        "g/dL": "g/dL",
        "mmol/L": "mmol/L",
        "U/L": "U/L",
        "fL": "fL",
        "pg": "pg",
        "10*3/uL": "×10³/µL",
        "10*6/uL": "×10⁶/µL",
    ]

    private static let superscript: [Character: Character] = [
        "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴",
        "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "-": "⁻",
    ]

    public static func unit(_ unitCode: String?) -> String {
        let code = (unitCode ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if code.isEmpty { return "" }
        if let known = catalog[code] { return known }
        var text = code
        // annotazioni {…}: tolte le graffe, «_» come spazio, virgola decimale
        text = replace(text, #"\{([^}]*)\}"#) { groups in
            replace(groups[1].replacingOccurrences(of: "_", with: " "), #"(\d)\.(\d)"#) { "\($0[1]),\($0[2])" }
        }
        text = replace(text, #"\[([^\]]*)\]"#) { $0[1] }
        text = replace(text, #"10\*(-?\d+)"#) { "×10" + String($0[1].map { superscript[$0] ?? $0 }) }
        text = replace(text, #"([a-zA-Z])(\d)(?![\d.,])"#) { $0[1] + String(superscript[Character($0[2])] ?? Character($0[2])) }
        text = replace(text, #"\bu(?=[gLlm]\b|[gLlm]/)"#) { _ in "µ" }
        return text == "Cel" ? "°C" : text
    }

    /// Valore con unità leggibile. Un valore senza cifre («non rilevabile») non
    /// riceve unità; uno con cifre la conserva anche se non è un numero solo
    /// («130/80»). La virgola decimale vale solo per i numeri singoli.
    public static func value(_ value: String, unitCode: String?) -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return "" }
        guard trimmed.range(of: #"\d"#, options: .regularExpression) != nil else { return value }
        let isSingleNumber = trimmed.range(of: #"^-?\d+(?:[.,]\d+)?$"#, options: .regularExpression) != nil
        let number = isSingleNumber ? trimmed.replacingOccurrences(of: ".", with: ",") : trimmed
        let unitText = unit(unitCode)
        return unitText.isEmpty ? number : "\(number) \(unitText)"
    }

    private static func replace(_ input: String, _ pattern: String, _ transform: ([String]) -> String) -> String {
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return input }
        let ns = input as NSString
        var result = ""
        var cursor = 0
        for match in regex.matches(in: input, range: NSRange(location: 0, length: ns.length)) {
            result += ns.substring(with: NSRange(location: cursor, length: match.range.location - cursor))
            let groups = (0..<match.numberOfRanges).map { index -> String in
                let range = match.range(at: index)
                return range.location == NSNotFound ? "" : ns.substring(with: range)
            }
            result += transform(groups)
            cursor = match.range.location + match.range.length
        }
        result += ns.substring(from: cursor)
        return result
    }
}
