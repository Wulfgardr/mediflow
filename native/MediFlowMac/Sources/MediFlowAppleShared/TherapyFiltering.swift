// A7 parity: client-side status filter for the therapy list. Pure logic over the
// live HomeBaseTherapySummary so it is unit-testable independently of the UI.
import Foundation

enum TherapyStatusFilter: String, CaseIterable, Identifiable {
    case all
    case active
    case suspended
    case completed

    var id: String { rawValue }

    var title: String {
        switch self {
        case .all: return "Tutte"
        case .active: return "Attive"
        case .suspended: return "Sospese"
        case .completed: return "Concluse"
        }
    }

    /// The canonical status this filter matches, or nil for "all".
    var matchingStatus: PairedTherapyStatus? {
        switch self {
        case .all: return nil
        case .active: return .active
        case .suspended: return .suspended
        case .completed: return .completed
        }
    }
}

enum TherapyFiltering {
    static func apply(_ therapies: [HomeBaseTherapySummary], filter: TherapyStatusFilter) -> [HomeBaseTherapySummary] {
        guard let target = filter.matchingStatus else { return therapies }
        // Compare via the canonical raw value so unknown/legacy statuses simply
        // fall out of the specific filters (still visible under "all").
        return therapies.filter { therapy in
            PairedTherapyStatus(rawValue: therapy.status)?.rawValue == target.rawValue
        }
    }
}
