import assert from 'node:assert/strict';
import { test } from 'node:test';

/* @Codex */
import { createDocumentSynthesisSourceBindingOwner } from './document-synthesis-source-binding.ts';

const digestA = 'a'.repeat(64);
const digestB = 'b'.repeat(64);
const configuration = () => ({
    document: {
        handle: 'dsh_0123456789abcdef0123456789abcdef',
        revision: 7,
        freshness: '2030-01-01T00:00:00.000Z',
    },
    sources: [
        { sourceId: 'source.synthetic.alpha', sourceRef: 'document_source_0123456789abcdef', digestSha256: digestA },
        { sourceId: 'source.synthetic.beta', sourceRef: 'document_source_fedcba9876543210', digestSha256: digestB },
    ],
});

const request = (extra: Record<string, unknown> = {}) => ({
    documentHandle: 'dsh_0123456789abcdef0123456789abcdef',
    revision: 7,
    freshness: '2030-01-01T00:00:00.000Z',
    sourceIds: ['source.synthetic.beta', 'source.synthetic.alpha'],
    ...extra,
});

test('binds only host-owned opaque sources to the exact document version', () => {
    const owner = createDocumentSynthesisSourceBindingOwner(configuration());
    const result = owner.resolve(owner.token, request());
    assert.equal(result.status, 'available');
    if (result.status !== 'available') return;
    assert.deepEqual({ ...result.binding.document }, configuration().document);
    assert.deepEqual(result.binding.sources.map((item) => ({ ...item })), [configuration().sources[1], configuration().sources[0]]);
    assert.equal(result.reviewOnly, true);
    assert.equal(result.writesPerformed, 0);
    assert.equal(result.applyPolicy, 'none');
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.binding), true);
    assert.equal(Object.isFrozen(result.binding.document), true);
    assert.equal(Object.isFrozen(result.binding.sources), true);
    assert.equal(Object.isFrozen(result.binding.sources[0]), true);
    assert.equal(Object.getPrototypeOf(owner.token), null);
});

test('denies forged tokens, document drift, unknown or duplicate sources, and disposal', () => {
    const owner = createDocumentSynthesisSourceBindingOwner(configuration());
    const denied = (token: unknown, value: unknown, code: string) => {
        const result = owner.resolve(token, value);
        assert.equal(result.status, 'denied');
        assert.equal(result.code, code);
        assert.equal(result.binding, null);
        assert.equal(result.writesPerformed, 0);
        assert.equal(result.applyPolicy, 'none');
    };
    denied({}, request(), 'binding_invalid');
    denied({ ...owner.token }, request(), 'binding_invalid');
    denied(owner.token, request({ documentHandle: 'dsh_ffffffffffffffffffffffffffffffff' }), 'document_mismatch');
    denied(owner.token, request({ revision: 8 }), 'revision_mismatch');
    denied(owner.token, request({ freshness: '2031-01-01T00:00:00.000Z' }), 'freshness_mismatch');
    denied(owner.token, request({ sourceIds: ['source.synthetic.unknown'] }), 'source_unknown');
    denied(owner.token, request({ sourceIds: ['source.synthetic.alpha', 'source.synthetic.alpha'] }), 'input_invalid');
    owner.dispose();
    denied(owner.token, request(), 'binding_disposed');
});

test('rejects hostile records before getters or proxy traps and snapshots configuration', () => {
    let reads = 0;
    let traps = 0;
    const accessor = configuration();
    Object.defineProperty(accessor.sources[0], 'sourceId', {
        enumerable: true,
        get() { reads += 1; return 'source.synthetic.alpha'; },
    });
    assert.throws(() => createDocumentSynthesisSourceBindingOwner(accessor), /configuration rejected/u);
    assert.equal(reads, 0);

    const proxied = new Proxy(configuration(), {
        ownKeys() { traps += 1; return []; },
        getPrototypeOf() { traps += 1; return Object.prototype; },
        get() { traps += 1; return undefined; },
    });
    assert.throws(() => createDocumentSynthesisSourceBindingOwner(proxied), /configuration rejected/u);
    assert.equal(traps, 0);

    const original = configuration();
    const owner = createDocumentSynthesisSourceBindingOwner(original);
    original.document.revision = 99;
    original.sources[0].sourceRef = 'document_source_mutated0000';
    const result = owner.resolve(owner.token, request({ sourceIds: ['source.synthetic.alpha'] }));
    assert.equal(result.status, 'available');
    if (result.status === 'available') {
        assert.equal(result.binding.document.revision, 7);
        assert.equal(result.binding.sources[0].sourceRef, 'document_source_0123456789abcdef');
    }

    const tokenProxy = new Proxy(owner.token, {
        get() { traps += 1; return undefined; },
        getPrototypeOf() { traps += 1; return null; },
    });
    assert.equal(owner.resolve(tokenProxy, request()).code, 'binding_invalid');
    assert.equal(traps, 0);
});

test('forbids identity, content, provider, authority and apply fields', () => {
    const forbidden = ['patientRef', 'patientName', 'taxCode', 'rawText', 'prompt', 'provider', 'venue', 'egress', 'authority', 'applyPolicy'];
    for (const key of forbidden) {
        const value = configuration() as Record<string, unknown>;
        value[key] = key;
        assert.throws(() => createDocumentSynthesisSourceBindingOwner(value), /configuration rejected/u);
    }
    const owner = createDocumentSynthesisSourceBindingOwner(configuration());
    for (const key of forbidden) {
        assert.equal(owner.resolve(owner.token, request({ [key]: key })).code, 'input_invalid');
    }
});

test('does not read ambient then while minting or resolving the opaque binding', () => {
    const prior = Object.getOwnPropertyDescriptor(Object.prototype, 'then');
    let reads = 0;
    try {
        Object.defineProperty(Object.prototype, 'then', { configurable: true, get() { reads += 1; return undefined; } });
        const owner = createDocumentSynthesisSourceBindingOwner(configuration());
        assert.equal(owner.resolve(owner.token, request()).status, 'available');
        owner.dispose();
    } finally {
        if (prior) Object.defineProperty(Object.prototype, 'then', prior);
        else delete (Object.prototype as { then?: unknown }).then;
    }
    assert.equal(reads, 0);
});
