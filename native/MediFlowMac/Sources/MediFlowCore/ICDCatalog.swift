// A14 (in-house, per ADR 0070): an in-app ICD-10 catalog + search so the paired
// app codes diagnoses WITHOUT depending on the external ICD-11 Docker proxy. This
// is a deliberately curated subset of common diagnoses (declared partial, not the
// full ICD-11), expandable; the shape is 1:1 with the web Diagnosis { code,
// description, system } so a coded diagnosis round-trips through DiagnosesCodec.
import Foundation

public struct ICDCode: Equatable, Sendable, Identifiable {
    public let code: String
    public let description: String
    public let system: String
    public var id: String { "\(system):\(code)" }

    public init(code: String, description: String, system: String = "ICD-10") {
        self.code = code
        self.description = description
        self.system = system
    }
}

public enum ICDCatalog {
    /// Curated common diagnoses (Italian). Expandable; not the full ICD-11.
    public static let codes: [ICDCode] = [
        ICDCode(code: "E11.9", description: "Diabete mellito tipo 2 senza complicanze"),
        ICDCode(code: "E10.9", description: "Diabete mellito tipo 1 senza complicanze"),
        ICDCode(code: "E78.5", description: "Iperlipidemia non specificata"),
        ICDCode(code: "E03.9", description: "Ipotiroidismo non specificato"),
        ICDCode(code: "E66.9", description: "Obesita non specificata"),
        ICDCode(code: "I10", description: "Ipertensione essenziale (primaria)"),
        ICDCode(code: "I25.10", description: "Cardiopatia ischemica aterosclerotica"),
        ICDCode(code: "I48.91", description: "Fibrillazione atriale non specificata"),
        ICDCode(code: "I50.9", description: "Insufficienza cardiaca non specificata"),
        ICDCode(code: "I63.9", description: "Ictus ischemico non specificato"),
        ICDCode(code: "I70.90", description: "Aterosclerosi non specificata"),
        ICDCode(code: "J44.9", description: "Broncopneumopatia cronica ostruttiva (BPCO)"),
        ICDCode(code: "J45.909", description: "Asma non specificata"),
        ICDCode(code: "J18.9", description: "Polmonite non specificata"),
        ICDCode(code: "N18.3", description: "Malattia renale cronica, stadio 3"),
        ICDCode(code: "N39.0", description: "Infezione delle vie urinarie, sede non specificata"),
        ICDCode(code: "K21.9", description: "Malattia da reflusso gastroesofageo senza esofagite"),
        ICDCode(code: "K59.00", description: "Stipsi non specificata"),
        ICDCode(code: "M17.9", description: "Gonartrosi non specificata"),
        ICDCode(code: "M54.5", description: "Lombalgia"),
        ICDCode(code: "M81.0", description: "Osteoporosi senza frattura patologica"),
        ICDCode(code: "F03.90", description: "Demenza non specificata senza disturbi comportamentali"),
        ICDCode(code: "F32.9", description: "Episodio depressivo non specificato"),
        ICDCode(code: "F41.9", description: "Disturbo d'ansia non specificato"),
        ICDCode(code: "G20", description: "Malattia di Parkinson"),
        ICDCode(code: "G30.9", description: "Malattia di Alzheimer non specificata"),
        ICDCode(code: "G40.909", description: "Epilessia non specificata"),
        ICDCode(code: "D64.9", description: "Anemia non specificata"),
        ICDCode(code: "C50.919", description: "Neoplasia maligna della mammella, non specificata"),
        ICDCode(code: "C34.90", description: "Neoplasia maligna del polmone, non specificata"),
        ICDCode(code: "C18.9", description: "Neoplasia maligna del colon, non specificata"),
        ICDCode(code: "C61", description: "Neoplasia maligna della prostata"),
        ICDCode(code: "Z79.4", description: "Uso a lungo termine di insulina"),
        ICDCode(code: "Z79.01", description: "Uso a lungo termine di anticoagulanti"),
        ICDCode(code: "R51.9", description: "Cefalea non specificata"),
        ICDCode(code: "R07.9", description: "Dolore toracico non specificato"),
        ICDCode(code: "R42", description: "Vertigine e capogiro"),
        ICDCode(code: "R10.9", description: "Dolore addominale non specificato"),
        ICDCode(code: "E86.0", description: "Disidratazione"),
        ICDCode(code: "I95.9", description: "Ipotensione non specificata"),
    ]

    /// Rank: exact code, then code prefix, then description substring. Case and
    /// accent insensitive enough for clinical search; capped to `limit`.
    public static func search(_ query: String, in catalog: [ICDCode] = codes, limit: Int = 20) -> [ICDCode] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return [] }
        let needle = trimmed.lowercased()
        let codeNeedle = trimmed.uppercased()

        let ranked: [(Int, ICDCode)] = catalog.compactMap { entry in
            let code = entry.code.uppercased()
            if code == codeNeedle { return (0, entry) }
            if code.hasPrefix(codeNeedle) { return (1, entry) }
            if entry.description.lowercased().contains(needle) { return (2, entry) }
            if code.lowercased().contains(needle) { return (3, entry) }
            return nil
        }
        return ranked
            .sorted { $0.0 != $1.0 ? $0.0 < $1.0 : $0.1.code < $1.1.code }
            .prefix(limit)
            .map(\.1)
    }
}
