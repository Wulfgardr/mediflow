// A5 parity: client-side type filter for the clinical diary. Pure logic over the
// live HomeBaseEntrySummary so it is unit-testable independently of the UI.
import Foundation

public enum EntryTypeFilter: String, CaseIterable, Identifiable {
    case all
    case note
    case visit
    case phone
    case other

    public var id: String { rawValue }

    // Filter labels are intentionally distinct from the row's type chip labels
    // (Nota/Visita) so accessibility queries stay unambiguous.
    public var title: String {
        switch self {
        case .all: return "Tutte"
        case .note: return "Note"
        case .visit: return "Visite"
        case .phone: return "Telefoniche"
        case .other: return "Altre"
        }
    }

    var matchingType: PairedDiaryEntryType? {
        switch self {
        case .all: return nil
        case .note: return .note
        case .visit: return .visit
        case .phone: return .phone
        case .other: return .other
        }
    }
}

public enum EntryFiltering {
    public static func apply(_ entries: [HomeBaseEntrySummary], filter: EntryTypeFilter) -> [HomeBaseEntrySummary] {
        guard let target = filter.matchingType else { return entries }
        return entries.filter { entry in
            PairedDiaryEntryType(rawValue: entry.type)?.rawValue == target.rawValue
        }
    }
}
