// A9 (partial): a deterministic plain-text summary of a patient's therapies for
// sharing. This is explicitly a "riepilogo", NOT a ricetta/prescription: it emits
// no SISS/impegnativa and makes no prescriptive claim. Pure and unit-tested; the
// view only wraps the output in a ShareLink. The date label is passed in so the
// output stays deterministic for tests.
import Foundation

public enum TherapyPlanDocument {
    private static let statusOrder = ["active", "suspended", "completed"]

    public static func plainText(
        patientName: String,
        therapies: [HomeBaseTherapySummary],
        dateLabel: String
    ) -> String {
        var lines = [
            "Piano terapeutico (riepilogo)",
            "Paziente: \(patientName)",
            "Generato: \(dateLabel)",
            "",
        ]

        let live = therapies.filter { $0.deletedAt == nil }
        if live.isEmpty {
            lines.append("Nessuna terapia registrata.")
            return lines.joined(separator: "\n")
        }

        for status in statusOrder {
            let group = live.filter { $0.status == status }
            guard !group.isEmpty else { continue }
            lines.append(statusHeader(status))
            for therapy in group.sorted(by: { $0.drugName < $1.drugName }) {
                lines.append(therapyLine(therapy))
            }
            lines.append("")
        }

        let known = Set(statusOrder)
        let others = live.filter { !known.contains($0.status) }.sorted { $0.drugName < $1.drugName }
        if !others.isEmpty {
            lines.append("Altro")
            for therapy in others {
                lines.append(therapyLine(therapy))
            }
            lines.append("")
        }

        return lines.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func statusHeader(_ status: String) -> String {
        switch status {
        case "active": return "In corso"
        case "suspended": return "Sospese"
        case "completed": return "Concluse"
        default: return status
        }
    }

    static func therapyLine(_ therapy: HomeBaseTherapySummary) -> String {
        var parts = ["- \(therapy.drugName)"]
        if let principle = therapy.activePrinciple?.trimmedOrNil {
            parts.append("(\(principle))")
        }
        let dosage = therapy.dosage.trimmingCharacters(in: .whitespacesAndNewlines)
        if !dosage.isEmpty {
            parts.append(dosage)
        }
        if let motivation = therapy.motivation?.trimmedOrNil {
            parts.append("- \(motivation)")
        }
        return parts.joined(separator: " ")
    }
}
