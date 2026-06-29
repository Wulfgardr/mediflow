// A6 parity: a clinically neutral trend indicator for clinical observations.
// "Rising" carries no good/bad valence (a rising blood pressure and a rising
// weight are not comparable), so the UI shows a direction arrow, never red/green.
// The computation is pure and unit-tested; the view only renders the result.
import Foundation

public enum ObservationTrend: String, Sendable {
    case rising
    case falling
    case steady
    case none
}

public enum ObservationTrendComputer {
    /// Leading numeric magnitude of an observation value, or nil when the value
    /// is not a single scalar. Accepts an Italian decimal comma ("120,5") or a
    /// dot, and a leading sign. Composite values (blood pressure "120/80",
    /// ratios) return nil on purpose: a single arrow would misrepresent them.
    static func numericValue(_ raw: String) -> Double? {
        let trimmed = raw.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return nil }
        // Non-scalar values must not get a single directional arrow, which would
        // misrepresent them: blood pressure "120/80", titers "1:40", ranges "5-7"
        // (an interior dash). For those the trend stays silent.
        if trimmed.contains("/") || trimmed.contains(":") { return nil }
        if let dash = trimmed.firstIndex(of: "-"), dash != trimmed.startIndex { return nil }
        // Mixed decimal separators ("1.250,5") are locale-ambiguous: no arrow.
        if trimmed.contains(".") && trimmed.contains(",") { return nil }

        var chars: [Character] = []
        for (index, ch) in trimmed.enumerated() {
            if ch.isASCII && ch.isNumber {
                chars.append(ch)
            } else if ch == "," || ch == "." {
                chars.append(".")
            } else if (ch == "-" || ch == "+") && index == 0 {
                chars.append(ch)
            } else {
                break
            }
        }
        let candidate = String(chars)
        guard candidate.filter({ $0 == "." }).count <= 1 else { return nil }
        // A single dot followed by exactly three digits is, in the it/IT locale, a
        // thousands separator ("1.250" = 1250, "150.000" = 150000), not a decimal.
        // The magnitude is ambiguous, so the trend stays silent rather than invert.
        if isLocaleAmbiguousThousands(candidate) { return nil }
        return Double(candidate)
    }

    /// True when `candidate` looks like "<nonzero integer>.<exactly three digits>",
    /// i.e. an it/IT thousands grouping rather than a decimal fraction.
    private static func isLocaleAmbiguousThousands(_ candidate: String) -> Bool {
        guard let dot = candidate.firstIndex(of: ".") else { return false }
        let integerDigits = candidate[..<dot].drop { $0 == "-" || $0 == "+" }
        let fraction = candidate[candidate.index(after: dot)...]
        return !integerDigits.isEmpty
            && integerDigits != "0"
            && fraction.count == 3
            && fraction.allSatisfy { $0.isASCII && $0.isNumber }
    }

    /// For each non-deleted observation, the trend of its numeric value versus the
    /// nearest earlier non-deleted observation sharing its codeSystem+code.
    /// Returned as a map keyed by observation id; ids absent from the map (the
    /// first reading of a code, a non-numeric reading, or a deleted one) are `.none`.
    public static func compute(_ observations: [HomeBaseObservationSummary]) -> [String: ObservationTrend] {
        var result: [String: ObservationTrend] = [:]
        let live = observations.filter { $0.deletedAt == nil }
        let groups = Dictionary(grouping: live) { CodeKey(system: $0.codeSystem, code: $0.code) }
        for group in groups.values {
            // Chronological order; tie-break by id so equal timestamps are deterministic.
            let sorted = group.sorted {
                $0.observedAt != $1.observedAt ? $0.observedAt < $1.observedAt : $0.id < $1.id
            }
            var previousNumeric: Double?
            for observation in sorted {
                let current = numericValue(observation.value)
                if let current, let previousNumeric {
                    if current > previousNumeric {
                        result[observation.id] = .rising
                    } else if current < previousNumeric {
                        result[observation.id] = .falling
                    } else {
                        result[observation.id] = .steady
                    }
                }
                // Advance the baseline only on a numeric reading, so a non-numeric
                // value in the middle does not erase the comparable history.
                if let current { previousNumeric = current }
            }
        }
        return result
    }

    private struct CodeKey: Hashable {
        let system: String
        let code: String
    }
}
