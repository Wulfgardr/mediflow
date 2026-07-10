// Swift port of the Italian labels in lib/domain/documents/document-ocr-queue.ts
// (DOCUMENT_OCR_QUEUE_STATE_LABELS_IT / DOCUMENT_OCR_QUEUE_REASON_LABELS_IT /
// describeDocumentOcrQueueEntry). No new copy: reuse the existing wording so the
// paired archive shows the same queue state the web already communicates.
import Foundation

public extension HomeBaseDocumentOcrQueueState {
    var italianLabel: String {
        switch self {
        case .pending: return "in attesa"
        case .processing: return "in elaborazione"
        case .ocrDone: return "OCR completato"
        case .ocrFailed: return "OCR fallito"
        case .manualReview: return "revisione manuale"
        }
    }
}

public extension HomeBaseDocumentOcrQueueReason {
    var italianLabel: String {
        switch self {
        case .textLayerAbsent: return "testo assente"
        case .textTooShort: return "testo insufficiente"
        case .imageOrScan: return "immagine/scansione"
        case .corruptedPdf: return "PDF corrotto"
        case .passwordProtected: return "PDF protetto da password"
        case .pairedUpload: return "caricato da client di rete"
        }
    }
}

public enum HomeBaseDocumentOcrQueuePresentation {
    /// "<stato> · <motivo>", or just the state label when there is no reason
    /// (mirrors describeDocumentOcrQueueEntry). nil when the document is not
    /// queued (both state and reason absent, i.e. OCR already usable inline).
    public static func describe(state: HomeBaseDocumentOcrQueueState?, reason: HomeBaseDocumentOcrQueueReason?) -> String? {
        guard let state else { return nil }
        guard let reason else { return state.italianLabel }
        return "\(state.italianLabel) \u{00B7} \(reason.italianLabel)"
    }
}
