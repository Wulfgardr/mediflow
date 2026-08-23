/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createDocumentSynthesisHostBoundary,
    type DocumentSynthesisDisposition,
} from './document-synthesis-host-boundary';

const freshness = '2026-08-23T12:00:00.000Z';
const handle = 'dsh_0123456789abcdef0123456789abcdef';

function boundary(disposition: DocumentSynthesisDisposition, now = Date.parse('2026-08-23T11:00:00.000Z')) {
    return createDocumentSynthesisHostBoundary({
        document: { handle, revision: 4, freshness },
        disposition,
        provenanceRef: 'provenance_0123456789abcdef',
        receiptRef: 'receipt_0123456789abcdef',
        now: () => now,
    });
}

function presentation(overrides: Record<string, unknown> = {}) {
    return { documentHandle: handle, revision: 4, freshness, ...overrides };
}

test('deterministic and generative dispositions use the same review-only host boundary', () => {
    for (const disposition of ['deterministic', 'generative'] as const) {
        const result = boundary(disposition).present(presentation());

        assert.equal(result.status, 'available');
        assert.equal(result.writesPerformed, 0);
        assert.equal(result.applyPolicy, 'none');
        assert.equal(result.metadata?.disposition, disposition);
        assert.equal(result.metadata?.review, 'review_only');
        assert.equal(result.metadata?.provenanceRef, 'provenance_0123456789abcdef');
        assert.equal(result.metadata?.receiptRef, 'receipt_0123456789abcdef');
        assert.equal(Object.isFrozen(result), true);
        assert.equal(Object.isFrozen(result.metadata), true);
        assert.equal(Object.isFrozen(result.metadata?.document), true);
    }
});

test('the boundary denies stale, mismatched revision, and expired document presentations', () => {
    const current = boundary('deterministic');

    assert.deepEqual(current.present(presentation({ revision: 3 })), {
        status: 'denied', code: 'revision_mismatch', metadata: null, writesPerformed: 0, applyPolicy: 'none',
    });
    assert.deepEqual(current.present(presentation({ freshness: '2026-08-23T11:59:00.000Z' })), {
        status: 'denied', code: 'freshness_mismatch', metadata: null, writesPerformed: 0, applyPolicy: 'none',
    });
    assert.deepEqual(boundary('generative', Date.parse(freshness)).present(presentation()), {
        status: 'denied', code: 'handle_expired', metadata: null, writesPerformed: 0, applyPolicy: 'none',
    });
});

test('raw content, prompt, attachment, patient, provider, and authority injection are denied', () => {
    const host = boundary('deterministic');
    const injections = [
        { rawText: 'synthetic source text' },
        { attachmentId: 'synthetic-attachment' },
        { patientId: 'synthetic-patient' },
        { prompt: 'summarize this' },
        { provider: 'local-model' },
        { disposition: 'generative' },
        { authority: ['review_only', 'apply'] },
        { applyPolicy: 'apply' },
    ];

    for (const injection of injections) {
        const result = host.present(presentation(injection));
        assert.equal(result.status, 'denied');
        assert.equal(result.code, 'input_invalid');
        assert.equal(result.metadata, null);
        assert.equal(result.applyPolicy, 'none');
    }
});

test('the caller cannot bypass the branch or mutate review-only metadata', () => {
    const host = boundary('deterministic');
    assert.equal('deterministic' in host, false);
    assert.equal('generative' in host, false);
    assert.equal(host.present(presentation({ disposition: 'generative' })).code, 'input_invalid');

    const result = host.present(presentation());
    assert.equal(result.status, 'available');
    const forged = result as { metadata: { review: string; provenanceRef: string }; applyPolicy: string };
    assert.throws(() => { forged.metadata.review = 'apply'; }, TypeError);
    assert.throws(() => { forged.metadata.provenanceRef = 'forged'; }, TypeError);
    assert.throws(() => { forged.applyPolicy = 'apply'; }, TypeError);
    assert.equal(result.metadata?.review, 'review_only');
    assert.equal(result.applyPolicy, 'none');
});
