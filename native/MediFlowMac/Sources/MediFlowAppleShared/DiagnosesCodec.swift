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

    public init(code: String, description: String, system: String?) {
        self.code = code
        self.description = description
        self.system = system
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
    private struct Entry: Decodable {
        let code: String?
        let description: String?
        let system: String?
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
            return ClinicalDiagnosis(code: code, description: description, system: entry.system?.trimmedOrNil)
        }
    }
}
