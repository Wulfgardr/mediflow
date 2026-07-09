import Foundation

/* @Codex */
public struct ScaleHistoryItem: Identifiable, Equatable, Sendable {
    public let id: String
    public let date: Date
    public let title: String
    public let scoreLabel: String?
    public let interpretation: String?
    public let content: String

    public init(
        id: String,
        date: Date,
        title: String,
        scoreLabel: String?,
        interpretation: String?,
        content: String
    ) {
        self.id = id
        self.date = date
        self.title = title
        self.scoreLabel = scoreLabel
        self.interpretation = interpretation
        self.content = content
    }
}

/* @Codex */
public enum ScaleHistoryPresentation {
    public static func items(from entries: [HomeBaseEntrySummary]) -> [ScaleHistoryItem] {
        entries
            .compactMap(item(from:))
            .sorted { $0.date > $1.date }
    }

    public static func item(from entry: HomeBaseEntrySummary) -> ScaleHistoryItem? {
        guard entry.type == "scale", entry.deletedAt == nil else { return nil }

        let metadata = decodedMetadata(from: entry.metadata)
        let title = metadata?.title?.trimmedOrNil ?? entry.title.trimmedOrNil ?? "Scala clinica"
        let scoreLabel = scoreLabel(metadata: metadata) ?? fallbackLineValue(prefix: "Punteggio:", in: entry.content)
        let interpretation = metadata?.interpretation?.trimmedOrNil
            ?? fallbackLineValue(prefix: "Interpretazione:", in: entry.content)

        return ScaleHistoryItem(
            id: entry.id,
            date: entry.date,
            title: title,
            scoreLabel: scoreLabel,
            interpretation: interpretation,
            content: entry.content
        )
    }

    private static func decodedMetadata(from raw: String?) -> ScaleMetadata? {
        guard let raw = raw?.trimmedOrNil, let data = raw.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(ScaleMetadata.self, from: data)
    }

    private static func scoreLabel(metadata: ScaleMetadata?) -> String? {
        guard let metadata, let score = metadata.score else { return nil }
        guard
            let scaleId = metadata.scaleId?.trimmedOrNil,
            let definition = ClinicalScales.all.first(where: { $0.id == scaleId })
        else {
            return "\(score)"
        }
        return "\(score)/\(definition.maxScore)"
    }

    private static func fallbackLineValue(prefix: String, in content: String) -> String? {
        content
            .split(whereSeparator: \.isNewline)
            .map(String.init)
            .first { $0.localizedCaseInsensitiveContains(prefix) }?
            .replacingOccurrences(of: prefix, with: "", options: [.caseInsensitive])
            .trimmedOrNil
    }

    private struct ScaleMetadata: Decodable {
        let title: String?
        let scaleId: String?
        let score: Int?
        let interpretation: String?
    }
}
