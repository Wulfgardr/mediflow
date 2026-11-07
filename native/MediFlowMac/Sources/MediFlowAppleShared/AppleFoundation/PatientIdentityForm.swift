import Foundation

enum PatientIdentityForm {
    static let identifierTypes = ["cf", "stp", "eni", "passport", "other", "none"]
    static func label(_ type: String) -> String {
        switch type {
        case "stp": return "Codice STP"
        case "eni": return "Codice ENI"
        case "passport": return "Documento estero"
        case "other": return "Altro identificativo"
        case "none": return "Nessun identificativo per ora"
        default: return "Codice fiscale"
        }
    }
    static func inferredType(_ value: String) -> String {
        let code = value.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        if matches(code, "^STP[0-9]{13}$") { return "stp" }
        if matches(code, "^ENI[0-9]{13}$") { return "eni" }
        return code.isEmpty ? "none" : "cf"
    }
    static func normalized(_ value: String, type: String) -> String {
        if type == "none" { return "" }
        let value = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return ["cf", "stp", "eni"].contains(type) ? value.uppercased() : value
    }
    static func identifierError(type: String, value: String) -> String? {
        guard identifierTypes.contains(type) else { return "Scegli il tipo di identificativo." }
        if type == "none" { return nil }
        let code = normalized(value, type: type)
        guard !code.isEmpty else { return "Inserisci l’identificativo del paziente." }
        if type == "cf" {
            return validCF(code) ? nil : "Controlla il codice fiscale: formato o carattere finale non corretto."
        }
        if type == "stp" || type == "eni" {
            let prefix = type.uppercased()
            return matches(code, "^\(prefix)[0-9]{13}$") ? nil : "Il codice \(prefix) deve avere il prefisso \(prefix) seguito da 13 cifre."
        }
        return code.utf16.count <= 128 && !value.unicodeScalars.contains(where: { $0.value < 32 || $0.value == 127 })
            ? nil : "L’identificativo deve contenere al massimo 128 caratteri, senza caratteri di controllo."
    }
    static func birthError(type: String, precision: String, date: Date?, year: String) -> String? {
        switch precision {
        case "exact":
            guard let date, date <= Date() else { return "Inserisci una data di nascita valida, non futura." }
        case "estimated":
            let currentYear = Calendar(identifier: .gregorian).component(.year, from: Date())
            guard let number = Int(year), (1850...currentYear).contains(number) else {
                return "Inserisci un anno di nascita stimato valido, non futuro."
            }
        default:
            if type == "none" { return "Senza identificativo serve la data di nascita oppure l’anno stimato." }
        }
        return nil
    }
    private static func matches(_ value: String, _ pattern: String) -> Bool {
        value.range(of: pattern, options: .regularExpression) != nil
    }
    private static func validCF(_ code: String) -> Bool {
        guard matches(code, "^[A-Z]{6}[0-9LMNPQRSTUV]{2}[ABCDEHLMPRST][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$") else { return false }
        let bytes = Array(code.utf8)
        let substitute = Array("LMNPQRSTUV".utf8)
        func digit(_ byte: UInt8) -> Int { substitute.firstIndex(of: byte) ?? Int(byte - 48) }
        let day = digit(bytes[9]) * 10 + digit(bytes[10])
        guard (1...31).contains(day) || (41...71).contains(day) else { return false }
        let odd = [1, 0, 5, 7, 9, 13, 15, 17, 19, 21, 2, 4, 18, 20, 11, 3, 6, 8, 12, 14, 16, 10, 22, 25, 24, 23]
        let sum = bytes.prefix(15).enumerated().reduce(0) { sum, pair in
            let n = Int(pair.element >= 65 ? pair.element - 65 : pair.element - 48)
            return sum + (pair.offset % 2 == 0 ? odd[n] : n)
        }
        return bytes[15] == UInt8(65 + sum % 26)
    }
}
