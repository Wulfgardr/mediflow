/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createDocumentSynthesisAuthorityHandle,
    DocumentSynthesisAuthorityHandleConfigurationError,
    type DocumentSynthesisDisposition,
} from './document-synthesis-authority-handle';

const FRESHNESS = '2026-08-23T12:00:00.000Z';
const PATIENT_REF = 'patient.canonical-1234567890';

function authority(disposition: DocumentSynthesisDisposition, overrides: Record<string, unknown> = {}) {
    return { patientRef: PATIENT_REF, document: { revision: 4, freshness: FRESHNESS }, disposition,
        provenanceRef: 'provenance_0123456789abcdef', receiptRef: 'receipt_0123456789abcdef', ...overrides };
}

function host(
    disposition: DocumentSynthesisDisposition,
    now = Date.parse('2026-08-23T11:00:00.000Z'),
    entropy = () => Uint8Array.from({ length: 16 }, (_, index) => index),
) {
    return createDocumentSynthesisAuthorityHandle(authority(disposition), {
        clock: () => now,
        entropy,
    });
}

test('issues an opaque handle and consumes it through the same host boundary for both branches', () => {
    for (const disposition of ['deterministic', 'generative'] as const) {
        const boundary = host(disposition);
        const issued = boundary.issue();
        assert.equal(issued.status, 'issued');
        assert.match(issued.documentHandle ?? '', /^dsh_[a-f0-9]{32}$/u);

        const consumed = boundary.consume({ documentHandle: issued.documentHandle });
        assert.equal(consumed.status, 'available');
        assert.equal(consumed.metadata?.disposition, disposition);
        assert.deepEqual({ ...consumed.metadata?.document }, { documentHandle: issued.documentHandle, revision: 4, freshness: FRESHNESS });
        assert.equal(JSON.stringify(consumed).includes(PATIENT_REF), false);
        assert.equal(Object.isFrozen(consumed), true);
    }
});

test('binds a handle to the host patient, revision, and freshness without caller authority', () => {
    const first = host('deterministic');
    const second = createDocumentSynthesisAuthorityHandle(authority('generative', {
        patientRef: 'patient.canonical-0987654321', document: { revision: 5, freshness: FRESHNESS },
    }), { clock: () => Date.parse('2026-08-23T11:00:00.000Z'), entropy: () => Uint8Array.from({ length: 16 }, (_, index) => index) });
    const issued = first.issue();
    const competing = second.issue();

    assert.equal(second.consume({ documentHandle: issued.documentHandle }).code, 'handle_invalid');
    assert.equal(first.consume({ documentHandle: issued.documentHandle }).metadata?.document.revision, 4);
    assert.equal(second.consume({ documentHandle: competing.documentHandle }).metadata?.document.revision, 5);
});

test('denies expiry and replay fail closed', () => {
    let now = Date.parse(FRESHNESS);
    const expired = createDocumentSynthesisAuthorityHandle(authority('generative'), {
        clock: () => now, entropy: () => Uint8Array.from({ length: 16 }, (_, index) => index),
    });
    const expiredHandle = expired.issue();
    assert.equal(expired.consume({ documentHandle: expiredHandle.documentHandle }).code, 'handle_expired');
    now -= 60_000;
    assert.equal(expired.consume({ documentHandle: expiredHandle.documentHandle }).code, 'handle_expired');

    const boundary = host('deterministic');
    const issued = boundary.issue();
    assert.equal(boundary.consume({ documentHandle: issued.documentHandle }).status, 'available');
    assert.equal(boundary.consume({ documentHandle: issued.documentHandle }).code, 'handle_consumed');
});

test('rejects caller-selected prompt, provider, venue, egress, authority, and document accessors', () => {
    const boundary = host('deterministic');
    const issued = boundary.issue();
    for (const injection of [{ prompt: 'summarize synthetic text' }, { provider: 'local-model' }, { venue: 'cloud' },
        { egress: 'enabled' }, { patientRef: 'patient.caller-1234567890' }, { revision: 99 },
        { freshness: '2026-08-24T12:00:00.000Z' }, { rawDocument: 'synthetic source text' }]) {
        assert.equal(boundary.consume({ documentHandle: issued.documentHandle, ...injection }).code, 'input_invalid');
    }

    const accessor = {} as { documentHandle: string };
    Object.defineProperty(accessor, 'documentHandle', { get() { return issued.documentHandle; } });
    assert.equal(boundary.consume(accessor).code, 'input_invalid');
    assert.equal(boundary.consume(new Proxy({}, { getPrototypeOf() { throw new Error('synthetic proxy trap'); } })).code, 'input_invalid');
});

test('rejects hostile host inputs and host source failures without exposing them', () => {
    assert.throws(
        () => createDocumentSynthesisAuthorityHandle(
            new Proxy({}, { getPrototypeOf() { throw new Error('synthetic authority trap'); } }),
        ),
        DocumentSynthesisAuthorityHandleConfigurationError,
    );
    const sourceTrap = new Proxy({}, { ownKeys() { throw new Error('synthetic source trap'); } });
    assert.throws(
        () => createDocumentSynthesisAuthorityHandle(authority('deterministic'), sourceTrap),
        DocumentSynthesisAuthorityHandleConfigurationError,
    );

    const entropyFailure = createDocumentSynthesisAuthorityHandle(authority('deterministic'), {
        clock: () => Date.parse('2026-08-23T11:00:00.000Z'),
        entropy: () => { throw new Error('synthetic entropy trap'); },
    });
    assert.deepEqual({ ...entropyFailure.issue() }, { status: 'denied', code: 'entropy_unavailable', documentHandle: null });

    const clockFailure = createDocumentSynthesisAuthorityHandle(authority('deterministic'), {
        clock: () => { throw new Error('synthetic clock trap'); },
        entropy: () => Uint8Array.from({ length: 16 }, (_, index) => index),
    });
    const issued = clockFailure.issue();
    assert.equal(clockFailure.consume({ documentHandle: issued.documentHandle }).code, 'handle_expired');
});

test('poisons a reentrant issue or consume turn without publishing an available result', () => {
    let issuing: ReturnType<typeof host> | null = null;
    issuing = createDocumentSynthesisAuthorityHandle(authority('deterministic'), {
        clock: () => Date.parse('2026-08-23T11:00:00.000Z'),
        entropy: () => {
            assert.equal(issuing?.issue().status, 'denied');
            return Uint8Array.from({ length: 16 }, (_, index) => index);
        },
    });
    assert.deepEqual({ ...issuing.issue() }, { status: 'denied', code: 'entropy_unavailable', documentHandle: null });
    assert.equal(issuing.issue().documentHandle, null);

    let consuming: ReturnType<typeof host> | null = null;
    consuming = createDocumentSynthesisAuthorityHandle(authority('generative'), {
        clock: () => {
            assert.equal(consuming?.consume({ documentHandle: consuming.issue().documentHandle }).status, 'denied');
            return Date.parse('2026-08-23T11:00:00.000Z');
        },
        entropy: () => Uint8Array.from({ length: 16 }, (_, index) => index),
    });
    const issued = consuming.issue();
    assert.equal(consuming.consume({ documentHandle: issued.documentHandle }).status, 'denied');
    assert.equal(consuming.consume({ documentHandle: issued.documentHandle }).status, 'denied');
});

test('rejects proxy, accessor, non-enumerable, symbol, extra, and custom-prototype inputs before reads', () => {
    const boundary = host('deterministic');
    const issued = boundary.issue();
    let reads = 0;
    const accessor = {};
    Object.defineProperty(accessor, 'documentHandle', { enumerable: true, get() { reads += 1; return issued.documentHandle; } });
    const nonEnumerable = { documentHandle: issued.documentHandle };
    Object.defineProperty(nonEnumerable, 'documentHandle', { enumerable: false });
    const symbolic = { documentHandle: issued.documentHandle, [Symbol('synthetic')]: true };
    const customPrototype = Object.create({ synthetic: true }) as { documentHandle: string };
    customPrototype.documentHandle = issued.documentHandle ?? '';
    for (const value of [accessor, nonEnumerable, symbolic, { documentHandle: issued.documentHandle, extra: true }, customPrototype,
        new Proxy({ documentHandle: issued.documentHandle }, {})]) {
        assert.equal(boundary.consume(value).code, 'input_invalid');
    }
    assert.equal(reads, 0);
});

test('rejects hostile entropy without observing byteLength, constructor, or Object.prototype.then', async () => {
    const originalThen = Object.getOwnPropertyDescriptor(Object.prototype, 'then');
    let thenReads = 0;
    Object.defineProperty(Object.prototype, 'then', { configurable: true, get() { thenReads += 1; return undefined; } });
    try {
        for (const entropy of [
            () => new Proxy(Uint8Array.from({ length: 16 }, (_, index) => index), {}),
            () => new (class SyntheticEntropy extends Uint8Array {})(16),
            () => new DataView(new ArrayBuffer(16)),
            () => {
                const bytes = new Uint8Array(16);
                Object.defineProperty(bytes, 'byteLength', { get() { throw new Error('must not read byteLength'); } });
                return bytes;
            },
            () => {
                const bytes = new Uint8Array(16);
                Object.defineProperty(bytes, 'constructor', { get() { throw new Error('must not read constructor'); } });
                return bytes;
            },
            () => Promise.reject(new Error('synthetic rejected entropy')),
            () => ({ then() { throw new Error('must not assimilate'); } }),
        ]) {
            const boundary = createDocumentSynthesisAuthorityHandle(authority('deterministic'), {
                clock: () => Date.parse('2026-08-23T11:00:00.000Z'), entropy,
            });
            assert.equal(boundary.issue().status, 'denied');
        }
        assert.throws(() => createDocumentSynthesisAuthorityHandle(authority('deterministic'), {
            clock: () => Date.parse('2026-08-23T11:00:00.000Z'),
            entropy: async () => Uint8Array.from({ length: 16 }, (_, index) => index),
        }), DocumentSynthesisAuthorityHandleConfigurationError);
        assert.equal(thenReads, 0);
    } finally {
        if (originalThen) Object.defineProperty(Object.prototype, 'then', originalThen);
        else delete (Object.prototype as { then?: unknown }).then;
    }
    await new Promise((resolve) => setImmediate(resolve));
});

test('all authority-handle outputs are frozen null-prototype records', () => {
    const boundary = host('deterministic');
    const issued = boundary.issue();
    const available = boundary.consume({ documentHandle: issued.documentHandle });
    for (const value of [issued, available]) {
        assert.equal(Object.isFrozen(value), true);
        assert.equal(Object.getPrototypeOf(value), null);
    }
    assert.equal(Object.getPrototypeOf(available.metadata ?? {}), null);
    assert.equal(Object.getPrototypeOf(available.metadata?.document ?? {}), null);
});
