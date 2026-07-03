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

// ADR 0071 Fase 2: status value canonicalization, 1:1 with lib/status-normalization.ts
// (THERAPY_STATUS_MAP / CHECKUP_STATUS_MAP + clean). The web does NOT just validate the
// status enum on write - it CANONICALIZES it (trim + lowercase, then alias-collapse:
// paused->suspended, stopped/interrupted->completed; done->completed, canceled->cancelled),
// so the stored token is canonical regardless of the client's casing/alias. The write
// stores collapse here too (one core).
public enum ClinicalStatusNormalization {
    private static let therapyMap: [String: String] = [
        "active": "active", "suspended": "suspended", "paused": "suspended",
        "completed": "completed", "stopped": "completed", "interrupted": "completed",
    ]
    private static let checkupMap: [String: String] = [
        "pending": "pending", "completed": "completed", "done": "completed",
        "cancelled": "cancelled", "canceled": "cancelled",
    ]

    /// trim + lowercase, nil/empty -> nil (matches the web `clean`).
    private static func clean(_ value: String?) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return trimmed.isEmpty ? nil : trimmed
    }

    /// Canonical therapy status: known aliases collapse; an unknown token passes through
    /// cleaned (the web would 400, but the typed payload only sends valid values);
    /// nil/empty -> fallback ("active").
    public static func therapyStatus(_ value: String?, fallback: String = "active") -> String {
        guard let key = clean(value) else { return fallback }
        return therapyMap[key] ?? key
    }

    /// Canonical checkup status; nil/empty -> fallback ("pending").
    public static func checkupStatus(_ value: String?, fallback: String = "pending") -> String {
        guard let key = clean(value) else { return fallback }
        return checkupMap[key] ?? key
    }
}
