// A19 (cross-cutting): turn a typed 409 VERSION_CONFLICT into honest, localized
// reconciliation copy. Pure and unit-tested: given the contract payload it
// produces the banner title/detail, so the view only renders. The guidance is
// deliberately reload-then-reapply (never auto-overwrite), which is the
// optimistic-concurrency-safe resolution: the operator sees the current value
// before deciding, so a concurrent edit is not silently clobbered.
import Foundation

public struct VersionConflictPresentation: Equatable {
    public let title: String
    public let detail: String
    public let entityLabel: String

    public init(payload: VersionConflictPayload) {
        let label = Self.entityLabel(payload.entity)
        self.entityLabel = label
        self.title = "Conflitto di versione: \(label)"

        let current = payload.currentVersion.map(String.init) ?? "piu recente"
        var lines = [
            "La tua versione \(payload.expectedVersion) e superata dalla versione \(current) sull'home-base."
        ]
        if let day = Self.dayPrefix(payload.currentUpdatedAt) {
            lines.append("Aggiornata il \(day).")
        }
        lines.append("Ricarica i dati aggiornati, poi riapplica la modifica.")
        self.detail = lines.joined(separator: "\n")
    }

    /// Human label for the conflicting record. The five paired entities share the
    /// 409 payload shape; an unknown entity falls back to its raw code.
    static func entityLabel(_ entity: String) -> String {
        switch entity {
        case "patient": return "anagrafica paziente"
        case "entry": return "voce di diario"
        case "therapy": return "terapia"
        case "checkup": return "controllo"
        case "observation": return "osservazione"
        default: return entity
        }
    }

    /// The YYYY-MM-DD prefix of an ISO 8601 timestamp, or nil when absent/too
    /// short. Pure string slicing so the copy stays locale and timezone neutral.
    static func dayPrefix(_ iso: String?) -> String? {
        guard let iso, iso.count >= 10 else { return nil }
        let day = Array(iso.prefix(10))
        // Shape must be YYYY-MM-DD: dashes at index 4 and 7, ASCII digits elsewhere.
        for (index, ch) in day.enumerated() {
            if index == 4 || index == 7 {
                if ch != "-" { return nil }
            } else if !(ch.isASCII && ch.isNumber) {
                return nil
            }
        }
        return String(day)
    }
}
