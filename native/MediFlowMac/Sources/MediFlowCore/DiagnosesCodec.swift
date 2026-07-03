// A14/A3: decode the patient `diagnoses` field for display. The persisted shape
// (lib/db.ts Diagnosis) is a JSON array of { code, description, system, date }.
// This is READ-ONLY on purpose: writing diagnoses must round-trip every field
// (including system/date) to avoid dropping clinical data, so the edit path is a
// separate, round-trip-tested slice. Here we only parse for the detail view.
import Foundation

public struct ClinicalDiagnosis: Equatable, Sendable {
    public let code: String
    public let description: String
    public let system: String?
    /// The original ISO date string, preserved verbatim so a decode -> edit ->
    /// encode round-trip does not rewrite an existing diagnosis date. nil for a
    /// diagnosis added on-device (encode then stamps it with the default date).
    public let date: String?

    public init(code: String, description: String, system: String?, date: String? = nil) {
        self.code = code
        self.description = description
        self.system = system
        self.date = date
    }

    /// "code - description", or whichever side is present.
    public var displayText: String {
        switch (code.isEmpty, description.isEmpty) {
        case (false, false): return "\(code) - \(description)"
        case (false, true): return code
        case (true, false): return description
        case (true, true): return ""
        }
    }
}

public enum DiagnosesCodec {
    private struct Entry: Codable {
        let code: String?
        let description: String?
        let system: String?
        let date: String?
    }

    public static func decode(_ raw: String?) -> [ClinicalDiagnosis] {
        guard let raw else { return [] }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let data = trimmed.data(using: .utf8) else { return [] }
        guard let entries = try? JSONDecoder().decode([Entry].self, from: data) else { return [] }
        return entries.compactMap { entry in
            let code = (entry.code ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            let description = (entry.description ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            guard !code.isEmpty || !description.isEmpty else { return nil }
            return ClinicalDiagnosis(
                code: code, description: description,
                system: entry.system?.trimmedOrNil, date: entry.date?.trimmedOrNil
            )
        }
    }

    /// Re-encode the canonical {code, description, system, date} array. Existing
    /// diagnoses keep their original date; ones added on-device (date == nil) are
    /// stamped with `defaultDate`. Returns nil for an empty list (clears the field).
    public static func encode(_ diagnoses: [ClinicalDiagnosis], defaultDate: String) -> String? {
        let cleaned = diagnoses.filter { !$0.code.isEmpty || !$0.description.isEmpty }
        guard !cleaned.isEmpty else { return nil }
        let entries = cleaned.map { diagnosis in
            Entry(
                code: diagnosis.code,
                description: diagnosis.description,
                system: diagnosis.system ?? "",
                date: diagnosis.date ?? defaultDate
            )
        }
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.withoutEscapingSlashes]
        guard let data = try? encoder.encode(entries) else { return nil }
        return String(data: data, encoding: .utf8)
    }
}
