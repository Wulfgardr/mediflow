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

// Fixture sintetiche (mai documenti reali): PDF muto, scansione simulata, testo clinico Mario Rossi.
const SYNTHETIC_EMPTY_PDF_TEXT = '';
const SYNTHETIC_SCAN_NOISE = 'scan scan scan scan scan scan scan scan scan scan scan scan';
const SYNTHETIC_SHORT_TEXT = 'Referto ORL';
const SYNTHETIC_CLINICAL_TEXT = 'Paziente Mario Rossi. Diagnosi: scompenso cardiaco cronico. Terapia: furosemide 25 mg al giorno.';

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

test('inspection stop reasons remain explicit in the OCR queue', () => {
    assert.deepEqual(
        evaluateDocumentOcrQueueCandidate({ inputKind: 'pdf', extractedText: '', extractionFailure: 'parser_failed' }),
        { queued: true, state: 'pending', reason: 'parser_failed' },
    );
    assert.deepEqual(
        evaluateDocumentOcrQueueCandidate({ inputKind: 'pdf', extractedText: '', extractionFailure: 'resource_limit' }),
        { queued: true, state: 'pending', reason: 'resource_limit' },
    );
});

test('Italian UI vocabulary matches the agreed queue labels', () => {
    assert.equal(DOCUMENT_OCR_QUEUE_STATE_LABELS_IT.pending, 'in attesa');
    assert.equal(DOCUMENT_OCR_QUEUE_STATE_LABELS_IT.processing, 'in elaborazione');
    assert.equal(DOCUMENT_OCR_QUEUE_STATE_LABELS_IT.ocr_failed, 'OCR fallito');
    assert.equal(DOCUMENT_OCR_QUEUE_STATE_LABELS_IT.manual_review, 'revisione manuale');
    assert.equal(
        describeDocumentOcrQueueEntry('pending', 'text_layer_absent'),
        `in attesa · ${DOCUMENT_OCR_QUEUE_REASON_LABELS_IT.text_layer_absent}`,
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
