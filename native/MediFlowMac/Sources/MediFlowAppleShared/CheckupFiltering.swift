// A8 parity: client-side status filter for the checkup list. Pure logic over the
// live HomeBaseCheckupSummary so it is unit-testable independently of the UI.
import Foundation

enum CheckupStatusFilter: String, CaseIterable, Identifiable {
    case all
    case pending
    case completed
    case cancelled

    var id: String { rawValue }

    var title: String {
        switch self {
        case .all: return "Tutti"
        case .pending: return "Da fare"
        case .completed: return "Completati"
        case .cancelled: return "Annullati"
        }
    }

    var matchingStatus: PairedCheckupStatus? {
        switch self {
        case .all: return nil
        case .pending: return .pending
        case .completed: return .completed
        case .cancelled: return .cancelled
        }
    }
}

enum CheckupFiltering {
    static func apply(_ checkups: [HomeBaseCheckupSummary], filter: CheckupStatusFilter) -> [HomeBaseCheckupSummary] {
        guard let target = filter.matchingStatus else { return checkups }
        return checkups.filter { checkup in
            PairedCheckupStatus(rawValue: checkup.status)?.rawValue == target.rawValue
        }
    }
}
