// @Codex
import Foundation

/* @Codex */
public enum ExemptionCodesCodec {
    public static func decode(_ raw: String?) -> [String] {
        guard let raw else { return [] }

        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return [] }

        if let data = trimmed.data(using: .utf8),
           let decoded = try? JSONDecoder().decode([String].self, from: data) {
            return normalizedCodes(decoded)
        }

        if trimmed.contains(",") {
            return normalizedCodes(trimmed.split(separator: ",").map(String.init))
        }

        return normalizedCodes([trimmed])
    }

    public static func encode(_ codes: [String]) -> String? {
        let normalized = normalizedCodes(codes)
        guard !normalized.isEmpty else { return nil }

        guard let data = try? JSONEncoder().encode(normalized) else {
            return nil
        }
        return String(data: data, encoding: .utf8)
    }

    public static func normalizedCode(_ code: String) -> String {
        code.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
    }

    public static func normalizedCodes(_ codes: [String]) -> [String] {
        var seen = Set<String>()
        var normalized: [String] = []

        for code in codes {
            let cleaned = normalizedCode(code)
            guard !cleaned.isEmpty, !seen.contains(cleaned) else { continue }
            seen.insert(cleaned)
            normalized.append(cleaned)
        }

        return normalized
    }
}
