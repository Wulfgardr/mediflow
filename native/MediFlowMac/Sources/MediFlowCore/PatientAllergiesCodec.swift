import Foundation

public struct PatientAllergy: Codable, Equatable, Sendable {
    public let substance: String
    public let reaction: String?
    public let severity: String?
}

/// Reads ADR 0182 without inferring allergies from free text.
public enum PatientAllergiesCodec {
    public static func decodeResult(_ raw: String?) -> StructuredFieldRead<[PatientAllergy]> {
        guard let raw, !raw.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return .absent }
        guard let data = raw.data(using: .utf8),
              let values = try? JSONDecoder().decode([PatientAllergy].self, from: data),
              values.allSatisfy({ !$0.substance.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                  && ($0.severity.map { ["mild", "moderate", "severe"].contains($0) } ?? true) }) else {
            return .unreadable
        }
        return values.isEmpty ? .absent : .present(values)
    }
}
