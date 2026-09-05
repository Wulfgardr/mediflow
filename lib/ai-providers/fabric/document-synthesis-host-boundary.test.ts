/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
    createDocumentSynthesisHostBoundary,
    DocumentSynthesisHostBoundaryConfigurationError,
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
    assert.deepEqual({ ...current.present(presentation({ revision: 3 })) }, {
        status: 'denied', code: 'revision_mismatch', metadata: null, writesPerformed: 0, applyPolicy: 'none',
    });
    assert.deepEqual({ ...current.present(presentation({ freshness: '2026-08-23T11:59:00.000Z' })) }, {
        status: 'denied', code: 'freshness_mismatch', metadata: null, writesPerformed: 0, applyPolicy: 'none',
    });
    assert.deepEqual({ ...boundary('generative', Date.parse(freshness)).present(presentation()) }, {
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
test('hostile Proxy traps become typed denials or configuration rejection', () => {
    const host = boundary('deterministic');
    const prototypeTrap = new Proxy(presentation(), {
        getPrototypeOf() { throw new Error('untrusted prototype trap'); },
    });
    const ownKeysTrap = new Proxy(presentation(), {
        ownKeys() { throw new Error('untrusted own keys trap'); },
    });
    for (const value of [prototypeTrap, ownKeysTrap]) {
        assert.deepEqual({ ...host.present(value) }, {
            status: 'denied', code: 'input_invalid', metadata: null, writesPerformed: 0, applyPolicy: 'none',
        });
    }
    for (const configuration of [
        new Proxy({}, { getPrototypeOf() { throw new Error('untrusted configuration prototype trap'); } }),
        new Proxy({}, { ownKeys() { throw new Error('untrusted configuration own keys trap'); } }),
    ]) {
        assert.throws(() => createDocumentSynthesisHostBoundary(configuration), DocumentSynthesisHostBoundaryConfigurationError);
    }
    const nestedReadTrap = new Proxy({ handle, revision: 4, freshness }, {
        get(target, property, receiver) {
            if (property === 'handle') throw new Error('untrusted nested read trap');
            return Reflect.get(target, property, receiver);
        },
    });
    assert.throws(() => createDocumentSynthesisHostBoundary({
        document: nestedReadTrap,
        disposition: 'deterministic',
        provenanceRef: 'provenance_0123456789abcdef',
        receiptRef: 'receipt_0123456789abcdef',
        now: () => Date.parse('2026-08-23T11:00:00.000Z'),
    }), DocumentSynthesisHostBoundaryConfigurationError);
});

test('a throwing host clock fails closed without exposing its error', () => {
    const host = createDocumentSynthesisHostBoundary({
        document: { handle, revision: 4, freshness },
        disposition: 'generative',
        provenanceRef: 'provenance_0123456789abcdef',
        receiptRef: 'receipt_0123456789abcdef',
        now: () => { throw new Error('untrusted clock trap'); },
    });
    assert.deepEqual({ ...host.present(presentation()) }, {
        status: 'denied', code: 'handle_expired', metadata: null, writesPerformed: 0, applyPolicy: 'none',
    });
});

test('rejects transparent proxies and structural hostile values before any property reads', () => {
    const host = boundary('deterministic');
    let reads = 0;
    const accessor = {};
    Object.defineProperty(accessor, 'documentHandle', { enumerable: true, get() { reads += 1; return handle; } });
    const nonEnumerable = presentation();
    Object.defineProperty(nonEnumerable, 'revision', { enumerable: false });
    const symbolic = { ...presentation(), [Symbol('synthetic')]: true };
    const customPrototype = Object.create({ synthetic: true }) as Record<string, unknown>;
    Object.assign(customPrototype, presentation());
    for (const value of [accessor, nonEnumerable, symbolic, { ...presentation(), extra: true }, customPrototype, new Proxy(presentation(), {})]) {
        assert.equal(host.present(value).code, 'input_invalid');
    }
    assert.equal(reads, 0);
});

test('rejects async and Promise-returning clocks without thenable assimilation or leaked rejection', async () => {
    const originalThen = Object.getOwnPropertyDescriptor(Object.prototype, 'then');
    let thenReads = 0;
    Object.defineProperty(Object.prototype, 'then', { configurable: true, get() { thenReads += 1; return undefined; } });
    try {
        for (const now of [
            () => Promise.reject(new Error('synthetic rejected clock')),
            () => ({ then() { throw new Error('must not assimilate'); } }),
        ]) {
            const host = createDocumentSynthesisHostBoundary({
                document: { handle, revision: 4, freshness }, disposition: 'deterministic',
                provenanceRef: 'provenance_0123456789abcdef', receiptRef: 'receipt_0123456789abcdef', now,
            });
            assert.equal(host.present(presentation()).code, 'handle_expired');
        }
        assert.throws(() => createDocumentSynthesisHostBoundary({
            document: { handle, revision: 4, freshness }, disposition: 'deterministic',
            provenanceRef: 'provenance_0123456789abcdef', receiptRef: 'receipt_0123456789abcdef',
            now: async () => Date.parse('2026-08-23T11:00:00.000Z'),
        }), DocumentSynthesisHostBoundaryConfigurationError);
        assert.equal(thenReads, 0);
    } finally {
        if (originalThen) Object.defineProperty(Object.prototype, 'then', originalThen);
        else delete (Object.prototype as { then?: unknown }).then;
    }
    await new Promise((resolve) => setImmediate(resolve));
});

test('all host boundary outputs are frozen null-prototype records', () => {
    const available = boundary('generative').present(presentation());
    const denied = boundary('generative').present({ ...presentation(), extra: true });
    for (const result of [available, denied]) {
        assert.equal(Object.isFrozen(result), true);
        assert.equal(Object.getPrototypeOf(result), null);
    }
    assert.equal(Object.getPrototypeOf(available.metadata ?? {}), null);
    assert.equal(Object.getPrototypeOf(available.metadata?.document ?? {}), null);
});
