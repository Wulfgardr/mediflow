import test from 'node:test';
import assert from 'node:assert/strict';
import {
    DOCUMENT_OCR_QUEUE_REASON_LABELS_IT,
    DOCUMENT_OCR_QUEUE_STATE_LABELS_IT,
    canTransitionDocumentOcrQueueState,
    describeDocumentOcrQueueEntry,
    evaluateDocumentOcrQueueCandidate,
    hasUsableDocumentOcrText,
    isDocumentOcrQueueReason,
    isDocumentOcrQueueState,
} from './document-ocr-queue';
import {
    applyDocumentOcrReplay,
    parseDocumentOcrReplayArtifactSnapshot,
} from './document-ocr-replay';

// Fixture sintetiche (mai documenti reali): PDF muto, scansione simulata, testo clinico Mario Rossi.
const SYNTHETIC_EMPTY_PDF_TEXT = '';
const SYNTHETIC_SCAN_NOISE = 'scan scan scan scan scan scan scan scan scan scan scan scan';
const SYNTHETIC_SHORT_TEXT = 'Referto ORL';
const SYNTHETIC_CLINICAL_TEXT = 'Paziente Mario Rossi. Diagnosi: scompenso cardiaco cronico. Terapia: furosemide 25 mg al giorno.';
const SYNTHETIC_DOCUMENT_SHA256 = 'a'.repeat(64);

test('empty PDF (synthetic) is queued as pending with text_layer_absent', () => {
    const candidate = evaluateDocumentOcrQueueCandidate({
        inputKind: 'pdf',
        extractedText: SYNTHETIC_EMPTY_PDF_TEXT,
    });

    assert.deepEqual(candidate, { queued: true, state: 'pending', reason: 'text_layer_absent' });
});

test('simulated scan image with low-signal OCR noise is queued as image_or_scan', () => {
    const candidate = evaluateDocumentOcrQueueCandidate({
        inputKind: 'image',
        extractedText: SYNTHETIC_SCAN_NOISE,
    });

    assert.deepEqual(candidate, { queued: true, state: 'pending', reason: 'image_or_scan' });
});

test('PDF with too little text is queued as text_too_short', () => {
    const candidate = evaluateDocumentOcrQueueCandidate({
        inputKind: 'pdf',
        extractedText: SYNTHETIC_SHORT_TEXT,
    });

    assert.deepEqual(candidate, { queued: true, state: 'pending', reason: 'text_too_short' });
});

test('PDF with long but low-signal noise is queued as text_too_short', () => {
    const candidate = evaluateDocumentOcrQueueCandidate({
        inputKind: 'pdf',
        extractedText: SYNTHETIC_SCAN_NOISE,
    });

    assert.deepEqual(candidate, { queued: true, state: 'pending', reason: 'text_too_short' });
});

test('document with sufficient synthetic clinical text is not queued', () => {
    assert.equal(hasUsableDocumentOcrText(SYNTHETIC_CLINICAL_TEXT), true);
    assert.deepEqual(
        evaluateDocumentOcrQueueCandidate({ inputKind: 'pdf', extractedText: SYNTHETIC_CLINICAL_TEXT }),
        { queued: false },
    );
});

test('extraction failures map to corrupted_pdf and password_protected reasons', () => {
    assert.deepEqual(
        evaluateDocumentOcrQueueCandidate({ inputKind: 'pdf', extractedText: '', extractionFailure: 'corrupted_pdf' }),
        { queued: true, state: 'pending', reason: 'corrupted_pdf' },
    );
    assert.deepEqual(
        evaluateDocumentOcrQueueCandidate({ inputKind: 'pdf', extractedText: '', extractionFailure: 'password_protected' }),
        { queued: true, state: 'pending', reason: 'password_protected' },
    );
});

test('Italian UI vocabulary matches the agreed queue labels', () => {
    assert.equal(DOCUMENT_OCR_QUEUE_STATE_LABELS_IT.pending, 'in attesa');
    assert.equal(DOCUMENT_OCR_QUEUE_STATE_LABELS_IT.processing, 'in elaborazione');
    assert.equal(DOCUMENT_OCR_QUEUE_STATE_LABELS_IT.ocr_failed, 'OCR fallito');
    assert.equal(DOCUMENT_OCR_QUEUE_STATE_LABELS_IT.manual_review, 'revisione manuale');
    assert.equal(
        describeDocumentOcrQueueEntry('pending', 'text_layer_absent'),
        `in attesa — ${DOCUMENT_OCR_QUEUE_REASON_LABELS_IT.text_layer_absent}`,
    );
    assert.equal(describeDocumentOcrQueueEntry('processing'), 'in elaborazione');
});

test('queue state machine allows only the minimal operational transitions', () => {
    assert.equal(canTransitionDocumentOcrQueueState('pending', 'processing'), true);
    assert.equal(canTransitionDocumentOcrQueueState('pending', 'manual_review'), true);
    assert.equal(canTransitionDocumentOcrQueueState('processing', 'ocr_done'), true);
    assert.equal(canTransitionDocumentOcrQueueState('processing', 'ocr_failed'), true);
    assert.equal(canTransitionDocumentOcrQueueState('ocr_failed', 'processing'), true);
    assert.equal(canTransitionDocumentOcrQueueState('ocr_failed', 'manual_review'), true);
    assert.equal(canTransitionDocumentOcrQueueState('manual_review', 'processing'), true);
    // Idempotent re-set of the same state is allowed.
    assert.equal(canTransitionDocumentOcrQueueState('processing', 'processing'), true);
    // ocr_done is terminal; no shortcut from pending to done.
    assert.equal(canTransitionDocumentOcrQueueState('ocr_done', 'processing'), false);
    assert.equal(canTransitionDocumentOcrQueueState('pending', 'ocr_done'), false);
});

test('state and reason guards accept enum values only', () => {
    assert.equal(isDocumentOcrQueueState('manual_review'), true);
    assert.equal(isDocumentOcrQueueState('done'), false);
    assert.equal(isDocumentOcrQueueReason('image_or_scan'), true);
    assert.equal(isDocumentOcrQueueReason('unreadable'), false);
});

test('replay without sufficient OCR text fails the queue entry and allows no clinical proposal', () => {
    const replay = applyDocumentOcrReplay({
        attachmentId: 'synthetic-attachment-1',
        documentSha256: SYNTHETIC_DOCUMENT_SHA256,
        ocrText: SYNTHETIC_SCAN_NOISE,
        generatedAt: '2026-06-10T10:00:00.000Z',
    });

    assert.equal(replay.outcome, 'applied');
    assert.equal(replay.nextState, 'ocr_failed');
    assert.equal(replay.sufficientText, false);
    assert.equal(replay.artifact.status, 'blocked_no_text');
    assert.deepEqual(
        replay.artifact.decision.writePlan.allowedActions.map((action) => action.kind),
        ['queue_ocr'],
    );
});

test('replay with sufficient OCR text completes the queue entry without automatic clinical writes', () => {
    const replay = applyDocumentOcrReplay({
        attachmentId: 'synthetic-attachment-2',
        documentSha256: SYNTHETIC_DOCUMENT_SHA256,
        ocrText: SYNTHETIC_CLINICAL_TEXT,
        generatedAt: '2026-06-10T10:00:00.000Z',
    });

    assert.equal(replay.outcome, 'applied');
    assert.equal(replay.nextState, 'ocr_done');
    assert.equal(replay.sufficientText, true);
    assert.equal(replay.artifact.status, 'ready_for_review');
    assert.equal(replay.artifact.decision.writePlan.allowedActions.length, 0);
    assert.ok(replay.artifact.decision.humanRequiredFor.includes('ocr_review'));
    // Lo snapshot persistito lato server non deve contenere PHI (niente fileName).
    assert.equal(replay.artifact.decision.source.fileName, undefined);
    const parsed = parseDocumentOcrReplayArtifactSnapshot(replay.artifactSnapshot);
    assert.equal(parsed?.idempotencyKey, replay.artifact.idempotencyKey);
});

test('replay is idempotent: same document hash and same normalized OCR text never duplicates the artifact', () => {
    const first = applyDocumentOcrReplay({
        attachmentId: 'synthetic-attachment-3',
        documentSha256: SYNTHETIC_DOCUMENT_SHA256,
        ocrText: ` ${SYNTHETIC_CLINICAL_TEXT} `,
        generatedAt: '2026-06-10T10:00:00.000Z',
    });
    const second = applyDocumentOcrReplay({
        attachmentId: 'synthetic-attachment-3',
        documentSha256: SYNTHETIC_DOCUMENT_SHA256,
        ocrText: SYNTHETIC_CLINICAL_TEXT.replace(/\s+/g, '  '),
        previousArtifactSnapshot: first.artifactSnapshot,
        generatedAt: '2026-06-10T11:00:00.000Z',
    });

    assert.equal(first.outcome, 'applied');
    assert.equal(second.outcome, 'duplicate');
    assert.equal(second.artifact.idempotencyKey, first.artifact.idempotencyKey);
    assert.equal(second.artifactSnapshot, first.artifactSnapshot);
    assert.equal(second.nextState, 'ocr_done');
});

test('failed replays with different unusable noise collapse onto the same idempotency key', () => {
    const first = applyDocumentOcrReplay({
        attachmentId: 'synthetic-attachment-4',
        documentSha256: SYNTHETIC_DOCUMENT_SHA256,
        ocrText: SYNTHETIC_SCAN_NOISE,
    });
    const second = applyDocumentOcrReplay({
        attachmentId: 'synthetic-attachment-4',
        documentSha256: SYNTHETIC_DOCUMENT_SHA256,
        ocrText: '1.2.3.4.5.6.7.8.9.10.11.12.',
        previousArtifactSnapshot: first.artifactSnapshot,
    });

    assert.equal(second.outcome, 'duplicate');
    assert.equal(second.nextState, 'ocr_failed');
    assert.equal(second.sufficientText, false);
});

test('replay with new usable OCR text after a failure produces a new artifact', () => {
    const failed = applyDocumentOcrReplay({
        attachmentId: 'synthetic-attachment-5',
        documentSha256: SYNTHETIC_DOCUMENT_SHA256,
        ocrText: '',
    });
    const recovered = applyDocumentOcrReplay({
        attachmentId: 'synthetic-attachment-5',
        documentSha256: SYNTHETIC_DOCUMENT_SHA256,
        ocrText: SYNTHETIC_CLINICAL_TEXT,
        previousArtifactSnapshot: failed.artifactSnapshot,
    });

    assert.equal(failed.nextState, 'ocr_failed');
    assert.equal(recovered.outcome, 'applied');
    assert.equal(recovered.nextState, 'ocr_done');
    assert.notEqual(recovered.artifact.idempotencyKey, failed.artifact.idempotencyKey);
});

test('replay artifact snapshot parsing rejects invalid payloads', () => {
    assert.equal(parseDocumentOcrReplayArtifactSnapshot(null), null);
    assert.equal(parseDocumentOcrReplayArtifactSnapshot('not-json'), null);
    assert.equal(parseDocumentOcrReplayArtifactSnapshot(JSON.stringify({ schemaVersion: 'other.v1', idempotencyKey: 'x' })), null);
    assert.equal(parseDocumentOcrReplayArtifactSnapshot(JSON.stringify({ schemaVersion: 'mediflow.document_ocr_replay.v1' })), null);
});
