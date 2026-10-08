import Foundation

/// Interpretation policy for new results, not instrument validation or permission.
/// Historical entries are never passed through this policy. See CREDITS.md.
public enum ClinicalScaleInterpretation {
    public static let mmseVersion = "mediflow.mmse.screening-limits.v1"
    public static let gdsVersion = "mediflow.gds15.screening-limits.v1"

    public static func recordedVersion(_ value: String?) -> String? {
        guard let value else { return nil }
        let bytes = Array(value.utf8)
        func alphanumeric(_ byte: UInt8) -> Bool {
            (48...57).contains(byte) || (65...90).contains(byte) || (97...122).contains(byte)
        }
        guard let first = bytes.first, alphanumeric(first), bytes.count <= 96,
              bytes.allSatisfy({ alphanumeric($0) || [45, 46, 95].contains($0) }) else { return nil }
        return value
    }

    public static func current(scaleId: String, score: Int) -> (text: String, version: String)? {
        switch scaleId {
        case "mmse":
            return ("Punteggio grezzo MMSE: \(score)/30. Screening cognitivo: il punteggio da solo non conferma né esclude una demenza. Interpretazione clinica richiesta; nessuna correzione per età, scolarità o lingua applicata.", mmseVersion)
        case "gds":
            return ("Punteggio grezzo GDS-15: \(score)/15. Screening dei sintomi depressivi: il punteggio non formula una diagnosi né stabilisce la gravità. Valutazione clinica richiesta; versione italiana e periodo di riferimento da verificare.", gdsVersion)
        default:
            return nil
        }
    }
}
