/* @Codex */
import test from 'node:test';
/* @Codex */
import assert from 'node:assert/strict';
/* @Codex */
import {
    applyDocumentDecisionGuardrails,
    buildDocumentDecision,
    createDocumentDecisionEvidenceRef,
} from './document-decision';
/* @Codex */
import {
    DOCUMENT_OCR_REPLAY_SCHEMA_VERSION,
    buildOcrNeededDocumentDecision,
    buildPostOcrReplayArtifact,
} from './document-ocr-decision';

const baseSource = {
    documentId: 'synthetic-muted-document',
    sha256: 'synthetic-muted-sha256',
    mimeType: 'application/pdf',
    pageCount: 2,
};

test('OCR-needed decision queues OCR and does not propose clinical structured writes', () => {
    const decision = buildOcrNeededDocumentDecision({
        source: baseSource,
        generatedAt: '2026-05-08T12:00:00.000Z',
    });

    assert.equal(decision.source.textState, 'text_absent');
    assert.equal(decision.source.ocrStatus, 'needed');
    assert.equal(decision.classification.type, 'mute_or_scanned');
    assert.deepEqual(decision.writePlan.allowedActions.map((action) => action.kind), ['queue_ocr']);
    assert.deepEqual(decision.writePlan.forbiddenActions, []);
    assert.ok(decision.humanRequiredFor.includes('ocr_review'));
    assert.equal(decision.humanRequiredFor.includes('clinical_write'), false);
});

test('OCR-needed guardrails forbid structured clinical writes before OCR review', () => {
    const decision = buildDocumentDecision({
        source: {
            ...baseSource,
            textState: 'text_absent',
            ocrStatus: 'needed',
        },
        classification: {
            type: 'mute_or_scanned',
            family: 'unknown',
            confidence: 'blocked',
            rationale: 'Documento muto sintetico.',
            evidenceRefs: ['ocr:needed'],
        },
        evidenceRefs: [createDocumentDecisionEvidenceRef('ocr:needed', 'Documento muto sintetico.')],
        proposedActions: [{
            id: 'action:bad-diagnosis',
            kind: 'create_diagnosis_candidate',
            target: 'synthetic-diagnosis',
            evidenceRefs: ['ocr:needed'],
            confidence: 'medium',
            rationale: 'Adversarial structured write before OCR.',
        }],
    });

    const guarded = applyDocumentDecisionGuardrails(decision);
    assert.ok(guarded.negativeAssertions.includes('ocr_required'));
    assert.equal(guarded.writePlan.forbiddenActions[0].blockedReason, 'ocr_required');
});

test('post-OCR replay artifact is idempotent for same document and normalized OCR text', () => {
    const originalDecision = buildOcrNeededDocumentDecision({ source: baseSource });
    const first = buildPostOcrReplayArtifact({
        originalDecision,
        ocrText: ' Testo OCR sintetico con prescrizione di visita ORL. ',
        generatedAt: '2026-05-08T12:00:00.000Z',
    });
    const second = buildPostOcrReplayArtifact({
        originalDecision,
        ocrText: 'Testo OCR sintetico con   prescrizione di visita ORL.',
        generatedAt: '2026-05-08T12:05:00.000Z',
    });

    assert.equal(first.schemaVersion, DOCUMENT_OCR_REPLAY_SCHEMA_VERSION);
    assert.equal(first.idempotencyKey, second.idempotencyKey);
    assert.equal(first.ocrTextSha256, second.ocrTextSha256);
    assert.equal(first.status, 'ready_for_review');
    assert.equal(first.decision.source.ocrStatus, 'completed');
    assert.equal(first.decision.writePlan.allowedActions.length, 0);
    assert.ok(first.decision.humanRequiredFor.includes('ocr_review'));
});

test('post-OCR replay key changes when OCR text changes', () => {
    const originalDecision = buildOcrNeededDocumentDecision({ source: baseSource });
    const first = buildPostOcrReplayArtifact({
        originalDecision,
        ocrText: 'Testo OCR sintetico A.',
    });
    const second = buildPostOcrReplayArtifact({
        originalDecision,
        ocrText: 'Testo OCR sintetico B.',
    });

    assert.notEqual(first.idempotencyKey, second.idempotencyKey);
});

test('empty post-OCR replay remains blocked and can only queue OCR again', () => {
    const originalDecision = buildOcrNeededDocumentDecision({ source: baseSource });
    const replay = buildPostOcrReplayArtifact({
        originalDecision,
        ocrText: '   ',
        generatedAt: '2026-05-08T12:00:00.000Z',
    });

    assert.equal(replay.status, 'blocked_no_text');
    assert.equal(replay.decision.source.textState, 'text_absent');
    assert.equal(replay.decision.source.ocrStatus, 'failed');
    assert.deepEqual(replay.decision.writePlan.allowedActions.map((action) => action.kind), ['queue_ocr']);
    assert.deepEqual(replay.decision.writePlan.forbiddenActions, []);
});
