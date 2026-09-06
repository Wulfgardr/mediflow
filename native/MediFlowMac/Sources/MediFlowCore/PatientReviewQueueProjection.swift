// @Codex
import Foundation

/// Presentation of already-read patient data. This is not a server aggregate,
/// a clinical action queue or evidence that a host AI/OCR job is current.
public enum PatientReviewDocumentReadState: Equatable, Sendable {
    case idle, loading, loaded, failed, unavailable
}

public struct PatientReviewQueueRow: Identifiable, Equatable, Sendable {
    public enum Kind: String, Equatable, Sendable {
        case evidence, followups, documents
    }

    public let id: Kind
    public let title: String
    public let detail: String
    public let count: Int?
    public let isLowerBound: Bool
}

public struct PatientReviewQueueSummary: Equatable, Sendable {
    public let rows: [PatientReviewQueueRow]
    public let coverageNote: String?
}

public enum PatientReviewQueueProjection {
    /// Mirrors the web evidence rule (every non-green quality needs review),
    /// using the existing, filtered follow-up projection supplied by the caller.
    /// Missing text, stale AI output and Smart Import readiness cannot be inferred
    /// from these inputs and deliberately have no row (ADR 0076 Classes C/D).
    public static func project(
        patientID: String,
        insights: [ClinicalDocumentInsight],
        followups: [FollowupSuggestion],
        followupsAtLimit: Bool,
        documentReadState: PatientReviewDocumentReadState,
        documentsPatientID: String?,
        attachments: [HomeBaseAttachmentSummary]
    ) -> PatientReviewQueueSummary {
        var rows: [PatientReviewQueueRow] = []
        let evidenceCount = insights.filter { $0.qualityLevel != "green" }.count
        if evidenceCount > 0 {
            let critical = insights.filter { $0.qualityLevel == "red" }.count
            let noun = evidenceCount == 1 ? "referto" : "referti"
            let criticalNote = critical > 0 ? " · \(critical) con qualità critica" : ""
            rows.append(PatientReviewQueueRow(
                id: .evidence, title: "Qualità delle evidenze",
                detail: "\(evidenceCount) \(noun) da verificare\(criticalNote)",
                count: evidenceCount, isLowerBound: false
            ))
        }

        if !followups.isEmpty {
            let number = "\(followups.count)\(followupsAtLimit ? "+" : "")"
            let noun = followups.count == 1 && !followupsAtLimit ? "spunto" : "spunti"
            rows.append(PatientReviewQueueRow(
                id: .followups, title: "Spunti di follow-up",
                detail: "\(number) \(noun) dai documenti, da valutare",
                count: followups.count, isLowerBound: followupsAtLimit
            ))
        }

        // A loaded array from another patient is still unread for this patient.
        let state: PatientReviewDocumentReadState = documentReadState == .loaded && documentsPatientID != patientID
            ? .idle : documentReadState
        switch state {
        case .loaded:
            // Only explicit persisted states count. No inference from a missing
            // summarySnapshot, pending job, filename, MIME type or opaque text.
            let count = attachments.filter {
                $0.patientId == patientID && ($0.ocrQueueState == .ocrFailed || $0.ocrQueueState == .manualReview)
            }.count
            if count > 0 {
                let noun = count == 1 ? "allegato" : "allegati"
                rows.append(PatientReviewQueueRow(
                    id: .documents, title: "Allegati da verificare",
                    detail: "\(count) \(noun) con revisione manuale o estrazione non riuscita",
                    count: count, isLowerBound: false
                ))
            }
        case .failed, .unavailable:
            rows.append(PatientReviewQueueRow(
                id: .documents, title: "Lettura dei documenti",
                detail: state == .failed
                    ? "Lettura non riuscita. Apri Documenti per riprovare."
                    : "Lettura non disponibile. Apri Documenti per verificarne lo stato.",
                count: nil, isLowerBound: false
            ))
        case .idle, .loading:
            break
        }

        guard !rows.isEmpty else { return PatientReviewQueueSummary(rows: [], coverageNote: nil) }
        var notes: [String] = []
        if !followups.isEmpty && followupsAtLimit {
            notes.append("Spunti: elenco parziale, fino a \(PatientFollowupProjection.defaultMax) visibili.")
        }
        switch state {
        case .idle: notes.append("Archivio documenti non ancora letto.")
        case .loading: notes.append("Archivio documenti in caricamento.")
        case .loaded, .failed, .unavailable: break
        }
        return PatientReviewQueueSummary(rows: rows, coverageNote: notes.isEmpty ? nil : notes.joined(separator: " "))
    }
}
