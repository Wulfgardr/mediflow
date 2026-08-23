/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createDocumentSynthesisAuthorityHandle,
    type DocumentSynthesisDisposition,
} from './document-synthesis-authority-handle';
import {
    DOCUMENT_SYNTHESIS_HOST_PROJECTION_SCHEMA_VERSION,
    DocumentSynthesisHostProjectionError,
    resolveDocumentSynthesisHostProjection,
} from './document-synthesis-host-projection';

function source(overrides: Record<string, unknown> = {}) {
    return { sourceKind: 'native_text', sourceText: '  Referto\r\n  sintetico  ', ...overrides };
}

function reject(value: unknown) {
    assert.throws(
        () => resolveDocumentSynthesisHostProjection(value),
        (error: unknown) => error instanceof DocumentSynthesisHostProjectionError
            && error.code === 'projection_invalid'
            && error.message === 'Document synthesis host projection rejected: projection_invalid',
    );
}

test('returns the exact minimal projection with bounded normalized host text', () => {
    const projection = resolveDocumentSynthesisHostProjection(source());

    assert.deepEqual(projection, {
        schemaVersion: DOCUMENT_SYNTHESIS_HOST_PROJECTION_SCHEMA_VERSION,
        sourceKind: 'native_text',
        sourceText: 'Referto\n  sintetico',
        classification: 'review_required',
        rationale: 'native_text_normalized',
    });
    assert.deepEqual(Reflect.ownKeys(projection), [
        'schemaVersion', 'sourceKind', 'sourceText', 'classification', 'rationale',
    ]);
    assert.equal(Object.isFrozen(projection), true);
});

test('gives deterministic and generative branches the same pure review projection', () => {
    const expected = resolveDocumentSynthesisHostProjection(source());
    for (const disposition of ['deterministic', 'generative'] as const) {
        const authority = createDocumentSynthesisAuthorityHandle({
            patientRef: 'patient.synthetic-1234567890',
            document: { revision: 1, freshness: '2026-08-23T12:00:00.000Z' },
            disposition: disposition as DocumentSynthesisDisposition,
            provenanceRef: 'provenance_0123456789abcdef',
            receiptRef: 'receipt_0123456789abcdef',
        }, {
            clock: () => Date.parse('2026-08-23T11:00:00.000Z'),
            entropy: () => Uint8Array.from({ length: 16 }, (_, index) => index),
        });
        const issued = authority.issue();
        const consumed = authority.consume({ documentHandle: issued.documentHandle });

        assert.equal(consumed.status, 'available');
        assert.equal(consumed.metadata?.disposition, disposition);
        assert.deepEqual(resolveDocumentSynthesisHostProjection(source()), expected);
    }
});

test('copies a frozen result so later host-record mutation cannot affect it', () => {
    const input = source();
    const projection = resolveDocumentSynthesisHostProjection(input);
    input.sourceKind = 'ocr_text';
    input.sourceText = 'changed synthetic text';

    assert.equal(projection.sourceKind, 'native_text');
    assert.equal(projection.sourceText, 'Referto\n  sintetico');
    assert.throws(() => { (projection as { sourceText: string }).sourceText = 'forged'; }, TypeError);
});

test('classifies each closed source kind without branch, provider, or authority input', () => {
    assert.deepEqual(resolveDocumentSynthesisHostProjection({ sourceKind: 'ocr_text', sourceText: ' OCR sintetico ' }), {
        schemaVersion: DOCUMENT_SYNTHESIS_HOST_PROJECTION_SCHEMA_VERSION,
        sourceKind: 'ocr_text',
        sourceText: 'OCR sintetico',
        classification: 'review_required',
        rationale: 'ocr_text_normalized',
    });
    reject(source({ sourceKind: 'unknown' }));
});

test('rejects empty, control, and oversized source text before projection', () => {
    for (const sourceText of ['', ' \t\r\n ', 'safe\u0000text', 'x'.repeat(12_001)]) {
        reject(source({ sourceText }));
    }
});

test('rejects every forbidden authority, identity, provider, and lifecycle field', () => {
    const forbidden = [
        'patientId', 'patientRef', 'attachmentId', 'documentId', 'fullName', 'taxCode', 'email', 'phone',
        'rawPrompt', 'prompt', 'provider', 'model', 'venue', 'egress', 'authority', 'role', 'write', 'apply',
        'route', 'session', 'lease', 'review', 'store',
    ];
    for (const field of forbidden) reject({ ...source(), [field]: 'synthetic injection' });
});

test('rejects extra, symbol, accessor, prototype, sparse, and proxy-trap inputs without details', () => {
    reject({ ...source(), extra: 'synthetic injection' });
    const symbol = Symbol('synthetic');
    reject({ ...source(), [symbol]: 'synthetic injection' });

    const accessor = source();
    Object.defineProperty(accessor, 'sourceText', { get() { return 'synthetic accessor'; }, enumerable: true });
    reject(accessor);
    reject(Object.create(source()));
    reject(new Array(2));
    reject(new Proxy(source(), { ownKeys() { throw new Error('synthetic ownKeys trap'); } }));
    reject(new Proxy(source(), { getPrototypeOf() { throw new Error('synthetic prototype trap'); } }));
    reject(new Proxy(source(), { getOwnPropertyDescriptor() { throw new Error('synthetic descriptor trap'); } }));
});
