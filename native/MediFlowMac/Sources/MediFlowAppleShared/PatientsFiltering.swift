// A2 parity: client-side search / filter / sort for the paired patient list.
// Pure logic over the live HomeBasePatientSummary (rebound from the retired Mac
// PatientSummary), so it is unit-testable and reused by the universal app.
import Foundation

enum PatientListViewMode: String, CaseIterable {
    case active
    case archived
}

enum PatientListSortMode: String, CaseIterable {
    case recent
    case alpha
}

enum PatientsFiltering {
    static func apply(
        patients: [HomeBasePatientSummary],
        query: String,
        viewMode: PatientListViewMode,
        sortMode: PatientListSortMode
    ) -> [HomeBasePatientSummary] {
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

                let firstNameOrder = lhs.firstName.localizedCaseInsensitiveCompare(rhs.firstName)
                if firstNameOrder != .orderedSame { return firstNameOrder == .orderedAscending }

                // Final tie-breaker so the order is fully deterministic when
                // updatedAt, lastName and firstName all match.
                return lhs.taxCode.localizedCaseInsensitiveCompare(rhs.taxCode) == .orderedAscending
            }
        }
    }
}
