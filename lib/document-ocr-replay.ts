import {
    DOCUMENT_OCR_REPLAY_SCHEMA_VERSION,
    buildOcrNeededDocumentDecision,
    buildPostOcrReplayArtifact,
    type DocumentOcrReplayArtifact,
} from './document-ocr-decision';
import { hasUsableDocumentOcrText } from './document-ocr-queue';

export interface ApplyDocumentOcrReplayInput {
    attachmentId: string;
    /** Hash del contenuto documento: la chiave di idempotenza del replay. */
    documentSha256: string;
    ocrText: string;
    previousArtifactSnapshot?: string | null;
    generatedAt?: string;
}

export interface DocumentOcrReplayApplication {
    outcome: 'applied' | 'duplicate';
    nextState: 'ocr_done' | 'ocr_failed';
    artifact: DocumentOcrReplayArtifact;
    artifactSnapshot: string;
    /** Nessuna proposta clinica finché questo non è true. */
    sufficientText: boolean;
}

export function parseDocumentOcrReplayArtifactSnapshot(snapshot: string | null | undefined): DocumentOcrReplayArtifact | null {
    if (!snapshot) return null;
    try {
        const parsed = JSON.parse(snapshot) as DocumentOcrReplayArtifact;
        if (parsed?.schemaVersion !== DOCUMENT_OCR_REPLAY_SCHEMA_VERSION) return null;
        if (typeof parsed.idempotencyKey !== 'string' || !parsed.idempotencyKey) return null;
        return parsed;
    } catch {
        return null;
    }
}

function stateFromArtifact(artifact: DocumentOcrReplayArtifact): 'ocr_done' | 'ocr_failed' {
    return artifact.status === 'ready_for_review' ? 'ocr_done' : 'ocr_failed';
}

/**
 * Applica un replay documentale post-OCR in modo idempotente: lo stesso hash
 * documento con lo stesso testo OCR normalizzato non produce mai un nuovo
 * artifact (outcome 'duplicate', snapshot invariato). Nota: niente fileName
 * nella source, così lo snapshot resta privo di PHI e persistibile lato server.
 */
export function applyDocumentOcrReplay(input: ApplyDocumentOcrReplayInput): DocumentOcrReplayApplication {
    const sufficientText = hasUsableDocumentOcrText(input.ocrText);
    const originalDecision = buildOcrNeededDocumentDecision({
        source: {
            documentId: input.attachmentId,
            attachmentId: input.attachmentId,
            sha256: input.documentSha256,
        },
        generatedAt: input.generatedAt,
    });
    const artifact = buildPostOcrReplayArtifact({
        originalDecision,
        ocrText: sufficientText ? input.ocrText : '',
        generatedAt: input.generatedAt,
    });

    const previous = parseDocumentOcrReplayArtifactSnapshot(input.previousArtifactSnapshot);
    if (previous && previous.idempotencyKey === artifact.idempotencyKey) {
        return {
            outcome: 'duplicate',
            nextState: stateFromArtifact(previous),
            artifact: previous,
            artifactSnapshot: input.previousArtifactSnapshot as string,
            sufficientText: previous.status === 'ready_for_review',
        };
    }

    return {
        outcome: 'applied',
        nextState: stateFromArtifact(artifact),
        artifact,
        artifactSnapshot: JSON.stringify(artifact),
        sufficientText,
    };
}
