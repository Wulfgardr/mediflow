import Foundation

// ADR 0071 Fase 1: domain enums for clinical entry/therapy/checkup status. These
// are platform-free (raw values + Italian titles + Picker conformances). The
// Vetro Clinico presentation (tone: VetroTone) is an extension that stays in the
// Apple UI layer, since VetroTone is a presentation concern.

public enum PairedDiaryEntryType: String, CaseIterable, Identifiable {
    case note
    case visit
    case phone
    case other

    public var id: String { rawValue }

    public var title: String {
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
public enum PairedTherapyStatus: String, CaseIterable, Identifiable {
    case active
    case suspended
    case completed

    public var id: String { rawValue }

    public var title: String {
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
public enum PairedCheckupStatus: String, CaseIterable, Identifiable {
    case pending
    case completed
    case cancelled

    public var id: String { rawValue }

    public var title: String {
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
