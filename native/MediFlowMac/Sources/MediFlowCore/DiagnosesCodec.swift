// Decode/encode the existing encrypted patient diagnoses JSON. Optional WHO
// provenance is retained as data during native edits; this codec does no lookup.
import Foundation

public struct ClinicalDiagnosis: Equatable, Sendable {
    public let code: String
    public let description: String
    public let system: String?
    /// The original ISO date string, preserved verbatim so a decode -> edit ->
    /// encode round-trip does not rewrite an existing diagnosis date. nil for a
    /// diagnosis added on-device (encode then stamps it with the default date).
    public let date: String?
    /* optional additions do not change the encoded shape of legacy rows. */
    public let canonicalUri: String?
    public let reference: HomeBaseJSONValue?

    public init(code: String, description: String, system: String?, date: String? = nil,
                canonicalUri: String? = nil, reference: HomeBaseJSONValue? = nil) {
        self.code = code
        self.description = description
        self.system = system
        self.date = date
        self.canonicalUri = canonicalUri
        self.reference = reference
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

public enum StructuredFieldRead<Value: Collection & Sendable>: Sendable {
    case absent
    case present(Value)
    case unreadable

    public var count: Int? {
        switch self {
        case .absent: return 0
        case .present(let values): return values.count
        case .unreadable: return nil
        }
    }

    public var values: Value? {
        if case .present(let values) = self { return values }
        return nil
    }

    public var isUnreadable: Bool {
        if case .unreadable = self { return true }
        return false
    }
}

extension StructuredFieldRead: Equatable where Value: Equatable {}

public enum DiagnosesCodec {
    private struct Entry: Codable {
        let code: String?
        let description: String?
        let system: String?
        let date: String?
        let canonicalUri: String?
        let reference: HomeBaseJSONValue?
    }

    public static func decodeResult(_ raw: String?) -> StructuredFieldRead<[ClinicalDiagnosis]> {
        guard let raw, !raw.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return .absent }
        guard let data = raw.data(using: .utf8),
              let entries = try? JSONDecoder().decode([Entry].self, from: data) else { return .unreadable }
        if entries.isEmpty { return .absent }
        let values = decode(raw)
        guard values.count == entries.count else { return .unreadable }
        return .present(values)
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
                system: entry.system?.trimmedOrNil, date: entry.date?.trimmedOrNil,
                canonicalUri: entry.canonicalUri, reference: entry.reference
            )
        }
    }

    /// Re-encode the existing array, retaining optional URI/reference verbatim. Existing
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
                date: diagnosis.date ?? defaultDate,
                canonicalUri: diagnosis.canonicalUri, reference: diagnosis.reference
            )
        }
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.withoutEscapingSlashes]
        guard let data = try? encoder.encode(entries) else { return nil }
        return String(data: data, encoding: .utf8)
    }
}
