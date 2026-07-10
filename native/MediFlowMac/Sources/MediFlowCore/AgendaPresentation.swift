import Foundation

/* @Codex */
public enum AgendaPill: String, Equatable, Sendable {
    case coral
    case yellow
    case blue
    case green
    case muted
}

/* @Codex */
public struct AgendaPillPresentation: Equatable, Sendable {
    public let pill: AgendaPill
    public let label: String

    public init(pill: AgendaPill, label: String) {
        self.pill = pill
        self.label = label
    }
}

/* @Codex */
public struct AgendaCheckup: Identifiable, Equatable, Sendable {
    public let id: String
    public let patientId: String
    public let date: Date
    public let status: String?

    public init(id: String, patientId: String, date: Date, status: String?) {
        self.id = id
        self.patientId = patientId
        self.date = date
        self.status = status
    }
}

/* @Codex */
public enum AgendaPresentation {
    public static func classifyCheckupPill(
        date: Date,
        status: String?,
        now: Date,
        calendar: Calendar = .current
    ) -> AgendaPillPresentation {
        switch status ?? "pending" {
        case "completed": return AgendaPillPresentation(pill: .green, label: "Completato")
        case "cancelled": return AgendaPillPresentation(pill: .muted, label: "Annullato")
        default: break
        }

        if date < now && !calendar.isDate(date, inSameDayAs: now) {
            return AgendaPillPresentation(pill: .coral, label: "Scaduto")
        }
        if calendar.isDate(date, inSameDayAs: now) {
            return AgendaPillPresentation(pill: .yellow, label: "Oggi")
        }
        return AgendaPillPresentation(pill: .blue, label: "Pianificato")
    }

    public static func countTodayCheckups(
        _ checkups: [AgendaCheckup],
        now: Date,
        calendar: Calendar = .current
    ) -> Int {
        checkups.count { checkup in
            isActive(checkup) && calendar.isDate(checkup.date, inSameDayAs: now)
        }
    }

    public static func countPlannedCheckups(
        _ checkups: [AgendaCheckup],
        now: Date,
        calendar: Calendar = .current
    ) -> Int {
        let startOfToday = calendar.startOfDay(for: now)
        return checkups.count { isActive($0) && $0.date >= startOfToday }
    }

    public static func agendaCandidates(
        from checkups: [AgendaCheckup],
        now: Date,
        calendar: Calendar = .current
    ) -> [AgendaCheckup] {
        let startOfToday = calendar.startOfDay(for: now)
        return checkups.enumerated()
            .filter { isActive($0.element) && $0.element.date >= startOfToday }
            .sorted { left, right in
                left.element.date == right.element.date ? left.offset < right.offset : left.element.date < right.element.date
            }
            .prefix(6)
            .map(\.element)
    }

    private static func isActive(_ checkup: AgendaCheckup) -> Bool {
        checkup.status != "cancelled" && checkup.status != "completed"
    }
}
