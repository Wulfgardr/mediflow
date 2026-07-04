/* @Codex */
import { createHash } from 'node:crypto';
/* @Codex */
import {
    applyDocumentDecisionGuardrails,
    buildDocumentDecision,
    createDocumentDecisionEvidenceRef,
    type DocumentDecision,
    type DocumentDecisionSource,
} from './document-decision';

/* @Codex */
export const DOCUMENT_OCR_REPLAY_SCHEMA_VERSION = 'mediflow.document_ocr_replay.v1';

/* @Codex */
export type DocumentOcrReplayStatus = 'ready_for_review' | 'blocked_no_text';

/* @Codex */
export interface BuildOcrNeededDocumentDecisionInput {
    source: Omit<DocumentDecisionSource, 'textState' | 'ocrStatus'> & Partial<Pick<DocumentDecisionSource, 'textState' | 'ocrStatus'>>;
    rationale?: string;
    generatedAt?: string;
}

/* @Codex */
export interface BuildPostOcrReplayArtifactInput {
    originalDecision: DocumentDecision;
    ocrText: string;
    generatedAt?: string;
}

/* @Codex */
export interface DocumentOcrReplayArtifact {
    schemaVersion: typeof DOCUMENT_OCR_REPLAY_SCHEMA_VERSION;
    idempotencyKey: string;
    documentId: string;
    sourceSha256?: string;
    ocrTextSha256: string;
    status: DocumentOcrReplayStatus;
    decision: DocumentDecision;
    generatedAt: string;
}

function sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

function normalizeOcrText(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
}

function replayKey(documentId: string, sourceSha256: string | undefined, ocrTextSha256: string): string {
    return sha256([
        DOCUMENT_OCR_REPLAY_SCHEMA_VERSION,
        documentId,
        sourceSha256 ?? 'no-source-sha',
        ocrTextSha256,
    ].join('|'));
}

/* @Codex */
export function buildOcrNeededDocumentDecision(input: BuildOcrNeededDocumentDecisionInput): DocumentDecision {
    const source: DocumentDecisionSource = {
        ...input.source,
        textState: input.source.textState ?? 'text_absent',
        ocrStatus: input.source.ocrStatus ?? 'needed',
    };
    const rationale = input.rationale ?? 'Documento senza testo clinico utilizzabile: richiede OCR e review prima di ogni interpretazione.';

    return applyDocumentDecisionGuardrails(buildDocumentDecision({
        source,
        classification: {
            type: 'mute_or_scanned',
            family: 'unknown',
            confidence: 'blocked',
            rationale,
            evidenceRefs: ['ocr:needed'],
        },
        evidenceRefs: [
            createDocumentDecisionEvidenceRef('ocr:needed', rationale, source.documentId),
        ],
        domains: {
            ocrNeeded: [{
                id: `ocr-needed:${source.documentId}`,
                label: 'OCR richiesto',
                action: 'queue_ocr',
                confidence: 'blocked',
                evidenceRefs: ['ocr:needed'],
                rationale,
            }],
        },
        proposedActions: [{
            id: `action:queue-ocr:${source.documentId}`,
            kind: 'queue_ocr',
            target: source.documentId,
            evidenceRefs: ['ocr:needed'],
            confidence: 'blocked',
            rationale,
        }],
        humanRequiredFor: ['ocr_review'],
        model: {
            recognitionMode: 'deterministic',
            generatedAt: input.generatedAt,
        },
    }));
}

/* @Codex */
export function buildPostOcrReplayArtifact(input: BuildPostOcrReplayArtifactInput): DocumentOcrReplayArtifact {
    const normalizedText = normalizeOcrText(input.ocrText);
    const generatedAt = input.generatedAt ?? new Date().toISOString();
    const ocrTextSha256 = sha256(normalizedText);
    const status: DocumentOcrReplayStatus = normalizedText ? 'ready_for_review' : 'blocked_no_text';
    const source: DocumentDecisionSource = {
        ...input.originalDecision.source,
        textState: normalizedText ? 'text_present' : 'text_absent',
        ocrStatus: normalizedText ? 'completed' : 'failed',
    };
    const rationale = normalizedText
        ? 'OCR completato: replay deterministico disponibile per nuova review, senza write clinici automatici.'
        : 'OCR completato senza testo utilizzabile: il documento resta bloccato per review/OCR.';

    const decision = applyDocumentDecisionGuardrails(buildDocumentDecision({
        source,
        classification: {
            type: normalizedText ? 'unknown' : 'mute_or_scanned',
            family: 'unknown',
            confidence: normalizedText ? 'low' : 'blocked',
            rationale,
            evidenceRefs: normalizedText ? ['ocr:completed'] : ['ocr:failed'],
        },
        evidenceRefs: [
            createDocumentDecisionEvidenceRef(normalizedText ? 'ocr:completed' : 'ocr:failed', rationale, source.documentId),
        ],
        proposedActions: normalizedText ? [] : [{
            id: `action:queue-ocr:${source.documentId}`,
            kind: 'queue_ocr',
            target: source.documentId,
            evidenceRefs: ['ocr:failed'],
            confidence: 'blocked',
            rationale,
        }],
        humanRequiredFor: ['ocr_review'],
        model: {
            recognitionMode: 'deterministic',
            generatedAt,
        },
    }));

    return {
        schemaVersion: DOCUMENT_OCR_REPLAY_SCHEMA_VERSION,
        idempotencyKey: replayKey(source.documentId, source.sha256, ocrTextSha256),
        documentId: source.documentId,
        sourceSha256: source.sha256,
        ocrTextSha256,
        status,
        decision,
        generatedAt,
    };
}
