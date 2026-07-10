// S6 (Wave 5, D13): decode the patient `documentInsights` field for read-only
// display. The persisted shape (lib/db.ts DocumentInsight[], serialized via
// JSON.stringify) is a JSON array of insights produced by the web OCR/synthesis
// pipeline; this client never generates or edits them (ADR 0076 Classe C: the
// client shows them read-only, curation stays web/host). Dates are kept as the
// raw ISO strings the web serializes (Date.toISOString()) rather than decoded
// into Date, exactly like DiagnosesCodec: this is read-only display, so a lossy
// or unparseable date should never fail the whole decode, only the sort order.
import Foundation

public struct ClinicalDocumentDiagnosisSuggestion: Equatable, Sendable {
    public let code: String
    public let description: String
    public let system: String?

    public init(code: String, description: String, system: String?) {
        self.code = code
        self.description = description
        self.system = system
    }
}

public struct ClinicalDocumentEvidenceFact: Equatable, Sendable {
    public let id: String
    public let kind: String
    public let label: String
    public let excerpt: String
    public let sourceId: String
    public let temporality: String
    public let status: String
    public let origin: String

    public init(id: String, kind: String, label: String, excerpt: String, sourceId: String, temporality: String, status: String, origin: String) {
        self.id = id
        self.kind = kind
        self.label = label
        self.excerpt = excerpt
        self.sourceId = sourceId
        self.temporality = temporality
        self.status = status
        self.origin = origin
    }
}

public struct ClinicalDocumentEvidencePack: Equatable, Sendable {
    public let documentInsightId: String
    public let fileName: String
    public let documentDate: String?
    public let facts: [ClinicalDocumentEvidenceFact]

    public init(documentInsightId: String, fileName: String, documentDate: String?, facts: [ClinicalDocumentEvidenceFact]) {
        self.documentInsightId = documentInsightId
        self.fileName = fileName
        self.documentDate = documentDate
        self.facts = facts
    }
}

public struct ClinicalDocumentInsight: Identifiable, Equatable, Sendable {
    public let id: String
    public let fileName: String
    /// Raw ISO date string as serialized by the web (Date.toISOString()).
    public let date: String
    public let summary: String
    public let qualityLevel: String?
    public let qualityReason: String?
    public let extractedDiagnoses: [ClinicalDocumentDiagnosisSuggestion]
    public let extractedMedications: [String]
    public let appliedDiagnoses: [String]
    public let routedClassification: String?
    public let documentDate: String?
    public let evidencePack: ClinicalDocumentEvidencePack?

    public init(
        id: String,
        fileName: String,
        date: String,
        summary: String,
        qualityLevel: String?,
        qualityReason: String?,
        extractedDiagnoses: [ClinicalDocumentDiagnosisSuggestion],
        extractedMedications: [String],
        appliedDiagnoses: [String],
        routedClassification: String?,
        documentDate: String?,
        evidencePack: ClinicalDocumentEvidencePack?
    ) {
        self.id = id
        self.fileName = fileName
        self.date = date
        self.summary = summary
        self.qualityLevel = qualityLevel
        self.qualityReason = qualityReason
        self.extractedDiagnoses = extractedDiagnoses
        self.extractedMedications = extractedMedications
        self.appliedDiagnoses = appliedDiagnoses
        self.routedClassification = routedClassification
        self.documentDate = documentDate
        self.evidencePack = evidencePack
    }

    /// Mirrors patient-followup-projection.ts `insightTime`: prefer the evidence
    /// pack's source date, fall back to the insight date, epoch 0 when neither
    /// parses (so an unparseable date sorts oldest rather than crashing sort).
    public var sortTimestamp: TimeInterval {
        let raw = evidencePack?.documentDate ?? documentDate ?? date
        guard let parsed = HomeBaseDateCoding.parseISO8601(raw) else { return 0 }
        return parsed.timeIntervalSince1970
    }
}

public enum DocumentInsightsCodec {
    private struct FactEntry: Decodable {
        let id: String?
        let kind: String?
        let label: String?
        let excerpt: String?
        let sourceId: String?
        let temporality: String?
        let status: String?
        let origin: String?
    }

    private struct EvidencePackSourceEntry: Decodable {
        let documentInsightId: String?
        let fileName: String?
        let documentDate: String?
    }

    private struct EvidencePackEntry: Decodable {
        let source: EvidencePackSourceEntry?
        let facts: [FactEntry]?
    }

    private struct QualityEntry: Decodable {
        let level: String?
        let reason: String?
    }

    private struct DiagnosisSuggestionEntry: Decodable {
        let code: String?
        let description: String?
        let system: String?
    }

    private struct ExtractedDataEntry: Decodable {
        let medications: [String]?
        let diagnoses: [DiagnosisSuggestionEntry]?
    }

    private struct AutofillEntry: Decodable {
        let appliedDiagnoses: [String]?
    }

    private struct RoutedClassEntry: Decodable {
        let classification: String?
    }

    private struct Entry: Decodable {
        let id: String?
        let date: String?
        let fileName: String?
        let summary: String?
        let evidencePack: EvidencePackEntry?
        let quality: QualityEntry?
        let extractedData: ExtractedDataEntry?
        let autofill: AutofillEntry?
        let routedClass: RoutedClassEntry?
        let documentDate: String?
    }

    public static func decode(_ raw: String?) -> [ClinicalDocumentInsight] {
        guard let raw else { return [] }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let data = trimmed.data(using: .utf8) else { return [] }
        guard let entries = try? JSONDecoder().decode([Entry].self, from: data) else { return [] }
        return entries.compactMap { entry in
            guard let id = entry.id?.trimmedOrNil, let fileName = entry.fileName?.trimmedOrNil else { return nil }
            let facts = (entry.evidencePack?.facts ?? []).compactMap { fact -> ClinicalDocumentEvidenceFact? in
                guard let factId = fact.id?.trimmedOrNil else { return nil }
                return ClinicalDocumentEvidenceFact(
                    id: factId,
                    kind: fact.kind ?? "",
                    label: fact.label ?? "",
                    excerpt: fact.excerpt ?? "",
                    sourceId: fact.sourceId ?? "",
                    temporality: fact.temporality ?? "",
                    status: fact.status ?? "",
                    origin: fact.origin ?? ""
                )
            }
            let evidencePack: ClinicalDocumentEvidencePack? = entry.evidencePack.map { pack in
                ClinicalDocumentEvidencePack(
                    documentInsightId: pack.source?.documentInsightId ?? id,
                    fileName: pack.source?.fileName ?? fileName,
                    documentDate: pack.source?.documentDate,
                    facts: facts
                )
            }
            let extractedDiagnoses = (entry.extractedData?.diagnoses ?? []).compactMap { diagnosis -> ClinicalDocumentDiagnosisSuggestion? in
                guard let code = diagnosis.code?.trimmedOrNil, let description = diagnosis.description?.trimmedOrNil else { return nil }
                return ClinicalDocumentDiagnosisSuggestion(code: code, description: description, system: diagnosis.system)
            }
            return ClinicalDocumentInsight(
                id: id,
                fileName: fileName,
                date: entry.date ?? "",
                summary: entry.summary ?? "",
                qualityLevel: entry.quality?.level,
                qualityReason: entry.quality?.reason?.trimmedOrNil,
                extractedDiagnoses: extractedDiagnoses,
                extractedMedications: (entry.extractedData?.medications ?? []).compactMap { $0.trimmedOrNil },
                appliedDiagnoses: (entry.autofill?.appliedDiagnoses ?? []).compactMap { $0.trimmedOrNil },
                routedClassification: entry.routedClass?.classification?.trimmedOrNil,
                documentDate: entry.documentDate?.trimmedOrNil,
                evidencePack: evidencePack
            )
        }
    }
}
