import Foundation

/// Interpretation policy for new results, not instrument validation or permission.
/// Historical entries are never passed through this policy. See CREDITS.md.
public enum ClinicalScaleInterpretation {
    public static let mmseVersion = "mediflow.mmse.screening-limits.v2"
    public static let gdsVersion = "mediflow.gds15.screening-limits.v2"
    public static let adlVersion = "mediflow.adl.local-interpretation.v2"
    public static let iadlVersion = "mediflow.iadl.local-interpretation.v2"
    public static let pomaVersion = "mediflow.poma28.nonclassification.v1"

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

    public static func current(scaleId: String, score: Int, existingInterpretation: () -> String) -> (text: String, version: String)? {
        switch scaleId {
        case "adl":
            return ("Punteggio ADL locale: \(score)/6. Risposte ai sei domini di autonomia, senza attribuzione di una classe di gravità. Fonte della versione locale e adattamento italiano da verificare. Interpretare considerando osservazione clinica, contesto e informazioni della persona o dell’informante.", adlVersion)
        case "iadl":
            return ("Punteggio IADL locale: \(score)/8. Otto domini per ogni persona, indipendentemente dal sesso. Definizione locale con ancoraggi semplificati; equivalenza a una versione validata non verificata. Attività mai svolte e contesto istituzionale limitano l’interpretazione; nessuna imputazione o riduzione automatica del denominatore.", iadlVersion)
        case "mmse":
            return ("Punteggio grezzo MMSE: \(score)/30. Screening cognitivo: il punteggio da solo non conferma né esclude una demenza. Definizione locale: edizione e variante italiana non identificate. Interpretazione clinica richiesta; nessuna correzione normativa applicata.", mmseVersion)
        case "gds":
            return ("Punteggio grezzo GDS-15: \(score)/15. Screening dei sintomi depressivi: il punteggio non formula una diagnosi né stabilisce la gravità. Definizione locale: fonte della traduzione italiana e periodo di riferimento non identificati. Valutare comprensione e attendibilità delle risposte, con particolare cautela nella compromissione cognitiva grave. Valutazione clinica richiesta.", gdsVersion)
        case "tinetti-poma28-v1": return (existingInterpretation(), pomaVersion)
        default:
            return nil
        }
    }
}
