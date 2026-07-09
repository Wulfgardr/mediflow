import Foundation

/* @Codex */
public struct GlobalDiaryPatient: Identifiable, Equatable, Sendable {
    public let id: String
    public let name: String
    public let code: String

    public init(id: String, name: String, code: String) {
        self.id = id
        self.name = name
        self.code = code
    }
}

/* @Codex */
public struct GlobalDiaryEntry: Identifiable, Equatable, Sendable {
    public let id: String
    public let patientId: String
    public let title: String
    public let content: String?
    public let deletedAt: Date?

    public init(id: String, patientId: String, title: String, content: String?, deletedAt: Date?) {
        self.id = id
        self.patientId = patientId
        self.title = title
        self.content = content
        self.deletedAt = deletedAt
    }
}

/* @Codex */
public struct GlobalDiaryItem: Equatable, Sendable {
    public let id: String
    public let patientId: String
    public let patientName: String
    public let patientCode: String
    public let title: String
    public let preview: String
    public let deleted: Bool

    public init(id: String, patientId: String, patientName: String, patientCode: String, title: String, preview: String, deleted: Bool) {
        self.id = id
        self.patientId = patientId
        self.patientName = patientName
        self.patientCode = patientCode
        self.title = title
        self.preview = preview
        self.deleted = deleted
    }
}

/* @Codex */
public struct GlobalDiaryState: Equatable, Sendable {
    public let entries: [GlobalDiaryItem]
    public let activeCount: Int
    public let patientCount: Int

    public init(entries: [GlobalDiaryItem], activeCount: Int, patientCount: Int) {
        self.entries = entries
        self.activeCount = activeCount
        self.patientCount = patientCount
    }
}

/* @Codex */
public enum GlobalDiaryPresentation {
    public static func compactClinicalText(_ value: String?) -> String {
        let plain = (value ?? "")
            .replacingOccurrences(of: "<[^>]*>", with: " ", options: .regularExpression)
            .replacingOccurrences(of: "&nbsp;", with: " ")
            .replacingOccurrences(of: "&amp;", with: "&")
            .replacingOccurrences(of: "&lt;", with: "<")
            .replacingOccurrences(of: "&gt;", with: ">")
            .components(separatedBy: .whitespacesAndNewlines)
            .filter { !$0.isEmpty }
            .joined(separator: " ")

        guard !plain.isEmpty else { return "Voce senza testo clinico." }
        guard plain.utf16.count > 180 else { return plain }
        return "\(String(plain.prefix(177)))…"
    }

    public static func buildState(entries: [GlobalDiaryEntry], patients: [GlobalDiaryPatient]) -> GlobalDiaryState {
        let patientById = Dictionary(patients.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        let recentEntries = entries.prefix(50)
        var activeCount = 0
        var patientIds = Set<String>()
        let mappedEntries = recentEntries.map { entry -> GlobalDiaryItem in
            let patient = patientById[entry.patientId]
            let deleted = entry.deletedAt != nil
            if !deleted { activeCount += 1 }
            patientIds.insert(entry.patientId)
            return GlobalDiaryItem(
                id: entry.id,
                patientId: entry.patientId,
                patientName: patient?.name ?? "Paziente non trovato",
                patientCode: patient?.code ?? "CF non disponibile",
                title: entry.title.isEmpty ? "Voce diario" : entry.title,
                preview: compactClinicalText(entry.content),
                deleted: deleted
            )
        }
        return GlobalDiaryState(entries: mappedEntries, activeCount: activeCount, patientCount: patientIds.count)
    }
}
