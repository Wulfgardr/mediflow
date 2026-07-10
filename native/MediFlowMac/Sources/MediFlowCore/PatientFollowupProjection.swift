// Port of lib/patient-followup-projection.ts (S6, ADR 0057/0073). Read-only
// projection of the `followup` facts already extracted and persisted inside
// documentInsights[].evidencePack (no new extraction, no DB/network access).
// Feeds a read-only "found in document X, to review" row with source citation.
// NO auto-write: promotion to a checkup happens only behind explicit manual
// review elsewhere (PairedPatientsWorkspaceModel.prefillNewCheckupFromFollowup),
// with semantics `form_prefill_only` (ADR 0073).
//
// Caution (same note as the web module): the `planned` tag comes from fragile
// regex heuristics with an always-planned default, NOT an authoritative clinical
// tag. The UI must present these as "found in documents, to review", never as
// mandated actions. This module only projects; honesty lives in the UI copy.
import Foundation

public struct FollowupSuggestionCitation: Equatable, Sendable {
    public let sourceId: String
    public let documentInsightId: String
    public let fileName: String
    public let documentDate: String?
    public let snippet: String

    public init(sourceId: String, documentInsightId: String, fileName: String, documentDate: String?, snippet: String) {
        self.sourceId = sourceId
        self.documentInsightId = documentInsightId
        self.fileName = fileName
        self.documentDate = documentDate
        self.snippet = snippet
    }
}

public struct FollowupSuggestion: Identifiable, Equatable, Sendable {
    public let id: String
    public let label: String
    public let excerpt: String
    public let status: String
    public let temporality: String
    public let origin: String
    public let citation: FollowupSuggestionCitation

    public init(id: String, label: String, excerpt: String, status: String, temporality: String, origin: String, citation: FollowupSuggestionCitation) {
        self.id = id
        self.label = label
        self.excerpt = excerpt
        self.status = status
        self.temporality = temporality
        self.origin = origin
        self.citation = citation
    }
}

public enum PatientFollowupProjection {
    public static let defaultMax = 4

    private static func normalizeLabel(_ label: String) -> String {
        label
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
    }

    /// Extracts citable planned follow-ups from insight evidence packs. Order:
    /// most recent documents first; dedup by normalized label; capped at `max`.
    public static func project(_ documentInsights: [ClinicalDocumentInsight], max: Int = defaultMax) -> [FollowupSuggestion] {
        guard !documentInsights.isEmpty else { return [] }

        let insights = documentInsights
            .filter { $0.evidencePack?.facts.isEmpty == false }
            .sorted { $0.sortTimestamp > $1.sortTimestamp }

        var seen = Set<String>()
        var suggestions: [FollowupSuggestion] = []

        outer: for insight in insights {
            guard let pack = insight.evidencePack else { continue }
            // Only planned follow-ups; resolved/suspended/historical are tagged
            // upstream and excluded here (no re-invented heuristics, ADR 0057).
            let followups = pack.facts.filter { fact in
                fact.kind == "followup" && (fact.temporality == "planned" || fact.status == "planned")
            }

            for fact in followups {
                let key = normalizeLabel(fact.label)
                guard !key.isEmpty, !seen.contains(key) else { continue }
                seen.insert(key)
                suggestions.append(FollowupSuggestion(
                    id: "\(pack.documentInsightId):\(fact.id)",
                    label: fact.label,
                    excerpt: fact.excerpt,
                    status: fact.status,
                    temporality: fact.temporality,
                    origin: fact.origin,
                    citation: FollowupSuggestionCitation(
                        sourceId: fact.sourceId,
                        documentInsightId: pack.documentInsightId,
                        fileName: pack.fileName,
                        documentDate: pack.documentDate,
                        snippet: fact.excerpt
                    )
                ))
                if suggestions.count >= max { break outer }
            }
        }

        return suggestions
    }
}
