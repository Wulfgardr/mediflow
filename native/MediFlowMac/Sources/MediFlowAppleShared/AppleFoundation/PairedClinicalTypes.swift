import SwiftUI
#if os(macOS)
import AppKit
#else
import UIKit
#endif

// ADR 0071 Fase 1: the Vetro Clinico presentation for the clinical status enums.
// The domain enums (PairedDiaryEntryType/PairedTherapyStatus/PairedCheckupStatus)
// live in MediFlowCore; their tone (a presentation concern, VetroTone) stays here
// in the Apple UI layer.

extension PairedTherapyStatus {
    /// Vetro Clinico status tone for a therapy.
    var tone: VetroTone {
        switch self {
        case .active:
            return .positive
        case .suspended:
            return .attention
        case .completed:
            return .neutral
        }
    }
}

extension PairedCheckupStatus {
    /// Vetro Clinico status tone for a checkup.
    var tone: VetroTone {
        switch self {
        case .pending:
            return .info
        case .completed:
            return .positive
        case .cancelled:
            return .neutral
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
