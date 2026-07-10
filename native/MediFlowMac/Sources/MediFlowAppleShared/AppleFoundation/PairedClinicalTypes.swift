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

/* @Codex */
enum PairedServicePrescriptionStatus: String, CaseIterable, Identifiable {
    case prescribed
    case booked
    case performed
    case reportReceived = "report_received"
    case cancelled

    var id: String { rawValue }

    var title: String {
        switch self {
        case .prescribed: "Prescritta"
        case .booked: "Prenotata"
        case .performed: "Eseguita"
        case .reportReceived: "Referto ricevuto"
        case .cancelled: "Annullata"
        }
    }

    var tone: VetroTone {
        switch self {
        case .prescribed: .info
        case .booked: .attention
        case .performed: .positive
        case .reportReceived: .positive
        case .cancelled: .neutral
        }
    }

    static func title(for rawValue: String) -> String {
        PairedServicePrescriptionStatus(rawValue: rawValue)?.title ?? rawValue
    }

    static func tone(for rawValue: String) -> VetroTone {
        PairedServicePrescriptionStatus(rawValue: rawValue)?.tone ?? .neutral
    }
}

/* @Codex */
enum PairedServicePrescriptionCategory: String, CaseIterable, Identifiable {
    case specialistica
    case laboratorio
    case diagnostica
    case riabilitazione
    case altro

    var id: String { rawValue }

    var title: String {
        switch self {
        case .specialistica: "Specialistica"
        case .laboratorio: "Laboratorio"
        case .diagnostica: "Diagnostica"
        case .riabilitazione: "Riabilitazione"
        case .altro: "Altro"
        }
    }
}

/* @Codex */
enum PairedServicePrescriptionPriority: String, CaseIterable, Identifiable {
    case u
    case b
    case d
    case p

    var id: String { rawValue }

    var title: String {
        switch self {
        case .u: "U"
        case .b: "B"
        case .d: "D"
        case .p: "P"
        }
    }
}

/* @Codex */
enum PairedPrescriptionSource: String, CaseIterable, Identifiable {
    case manual
    case importato
    case integrazione

    var id: String { rawValue }

    var title: String {
        switch self {
        case .manual: "Manuale"
        case .importato: "Importato"
        case .integrazione: "Integrazione"
        }
    }
}

/* @Codex */
enum PairedProstheticPrescriptionStatus: String, CaseIterable, Identifiable {
    case prescribed
    case ordered
    case delivered
    case tested
    case cancelled

    var id: String { rawValue }

    var title: String {
        switch self {
        case .prescribed: "Prescritta"
        case .ordered: "Ordinata"
        case .delivered: "Consegnata"
        case .tested: "Collaudata"
        case .cancelled: "Annullata"
        }
    }

    var tone: VetroTone {
        switch self {
        case .prescribed: .info
        case .ordered: .attention
        case .delivered: .positive
        case .tested: .positive
        case .cancelled: .neutral
        }
    }

    static func title(for rawValue: String) -> String {
        PairedProstheticPrescriptionStatus(rawValue: rawValue)?.title ?? rawValue
    }

    static func tone(for rawValue: String) -> VetroTone {
        PairedProstheticPrescriptionStatus(rawValue: rawValue)?.tone ?? .neutral
    }
}

/* @Codex */
enum PairedProstheticPrescriptionCategory: String, CaseIterable, Identifiable {
    case protesi
    case ortesi
    case ausilio
    case altro

    var id: String { rawValue }

    var title: String {
        switch self {
        case .protesi: "Protesi"
        case .ortesi: "Ortesi"
        case .ausilio: "Ausilio"
        case .altro: "Altro"
        }
    }
}

/* @Codex */
struct ClinicalSignalCount: Equatable, Sendable {
    let count: Int
    let atCap: Bool

    var displayText: String {
        atCap ? "\(count)+" : "\(count)"
    }

    static func exact(_ count: Int) -> ClinicalSignalCount {
        ClinicalSignalCount(count: max(0, count), atCap: false)
    }

    static func fromLoadedList(
        count: Int,
        loadedCount: Int,
        limit: Int = HomeBaseClinicalListLimit.boundaryMaximum
    ) -> ClinicalSignalCount {
        ClinicalSignalCount(count: max(0, count), atCap: loadedCount >= max(1, limit))
    }
}

enum PairedPatientsConnectionState: Equatable {
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
