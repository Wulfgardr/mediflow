// @Codex
import Foundation

/* @Codex */
enum PatientListViewMode: String, CaseIterable {
    case active
    case archived
}

/* @Codex */
enum PatientListSortMode: String, CaseIterable {
    case recent
    case alpha
}

/* @Codex */
enum PatientsFiltering {
    static func apply(
        patients: [PatientSummary],
        query: String,
        viewMode: PatientListViewMode,
        sortMode: PatientListSortMode
    ) -> [PatientSummary] {
        let normalizedQuery = query
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
        let terms = normalizedQuery.split(whereSeparator: { $0.isWhitespace }).map(String.init)

        let statusFiltered = patients.filter { patient in
            switch viewMode {
            case .active:
                return patient.isArchived != true
            case .archived:
                return patient.isArchived == true
            }
        }

        let searchFiltered = statusFiltered.filter { patient in
            guard !terms.isEmpty else { return true }
            let searchableText = "\(patient.lastName) \(patient.firstName) \(patient.taxCode)".lowercased()
            return terms.allSatisfy { searchableText.contains($0) }
        }

        switch sortMode {
        case .alpha:
            return searchFiltered.sorted { lhs, rhs in
                let lastNameOrder = lhs.lastName.localizedCaseInsensitiveCompare(rhs.lastName)
                if lastNameOrder != .orderedSame { return lastNameOrder == .orderedAscending }

                let firstNameOrder = lhs.firstName.localizedCaseInsensitiveCompare(rhs.firstName)
                if firstNameOrder != .orderedSame { return firstNameOrder == .orderedAscending }

                return lhs.taxCode.localizedCaseInsensitiveCompare(rhs.taxCode) == .orderedAscending
            }
        case .recent:
            return searchFiltered.sorted { lhs, rhs in
                let lhsDate = lhs.updatedAt ?? Date.distantPast
                let rhsDate = rhs.updatedAt ?? Date.distantPast
                if lhsDate != rhsDate { return lhsDate > rhsDate }

                let lastNameOrder = lhs.lastName.localizedCaseInsensitiveCompare(rhs.lastName)
                if lastNameOrder != .orderedSame { return lastNameOrder == .orderedAscending }

                return lhs.firstName.localizedCaseInsensitiveCompare(rhs.firstName) == .orderedAscending
            }
        }
    }
}
