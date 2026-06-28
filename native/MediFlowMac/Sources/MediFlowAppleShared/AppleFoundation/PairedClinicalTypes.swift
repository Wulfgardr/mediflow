import SwiftUI
#if os(macOS)
import AppKit
#else
import UIKit
#endif

enum PairedDiaryEntryType: String, CaseIterable, Identifiable {
    case note
    case visit
    case phone
    case other

    var id: String { rawValue }

    var title: String {
        switch self {
        case .note:
            return "Nota"
        case .visit:
            return "Visita"
        case .phone:
            return "Telefono"
        case .other:
            return "Altro"
        }
    }
}

/* @Codex */
enum PairedTherapyStatus: String, CaseIterable, Identifiable {
    case active
    case suspended
    case completed

    var id: String { rawValue }

    var title: String {
        switch self {
        case .active:
            return "Attiva"
        case .suspended:
            return "Sospesa"
        case .completed:
            return "Conclusa"
        }
    }
}

/* @Codex */
enum PairedCheckupStatus: String, CaseIterable, Identifiable {
    case pending
    case completed
    case cancelled

    var id: String { rawValue }

    var title: String {
        switch self {
        case .pending:
            return "Da fare"
        case .completed:
            return "Completato"
        case .cancelled:
            return "Annullato"
        }
    }
}

enum PairedPatientsConnectionState {
    case notLoaded
    case cached
    case pairedOnline
    case pairedOfflineDegraded
    case sessionExpired

    var title: String {
        switch self {
        case .notLoaded:
            return "Non caricato"
        case .cached:
            return "Cache locale"
        case .pairedOnline:
            return "Paired online"
        case .pairedOfflineDegraded:
            return "Offline degradato"
        case .sessionExpired:
            return "Sessione scaduta"
        }
    }

    var symbolName: String {
        switch self {
        case .notLoaded:
            return "circle"
        case .cached:
            return "clock.arrow.circlepath"
        case .pairedOnline:
            return "checkmark.circle.fill"
        case .pairedOfflineDegraded:
            return "exclamationmark.triangle.fill"
        case .sessionExpired:
            return "person.crop.circle.badge.exclamationmark"
        }
    }

    var tintColor: Color {
        switch self {
        case .notLoaded:
            return .secondary
        case .cached:
            return .secondary
        case .pairedOnline:
            return .green
        case .pairedOfflineDegraded:
            return .orange
        case .sessionExpired:
            return .orange
        }
    }
}

extension String {
    var trimmedOrNil: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
