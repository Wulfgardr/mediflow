/* @Codex */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
    captureDocumentSynthesisSourceSet,
    composeDocumentSynthesisProviderProjection,
    normalizeDocumentSynthesisProjection,
} from './document-synthesis-source-set-contract.ts';

const n = (value: number | string) => BigInt(value);
const source = (overrides: Record<string, unknown> = {}) => ({
    documentSourceRef: 'document.synthetic.alpha',
    documentRevision: n(7),
    documentFreshnessEpoch: n(11),
    sourceText: '  Cafe\u0301\rsecond  ',
    ...overrides,
});
const sourceSet = (sources: unknown[] = [source()], overrides: Record<string, unknown> = {}) => ({
    sources,
    sourceSetEpoch: n(13),
    revocationGeneration: n(17),
    ...overrides,
});

function available<T extends { status: string }>(value: T): Extract<T, { status: 'available' }> {
    assert.equal(value.status, 'available');
    if (value.status !== 'available') throw new Error('expected available synthetic result');
    return value as Extract<T, { status: 'available' }>;
}

function denied(value: { status: string; sourceSet?: unknown; projection?: unknown }) {
    assert.equal(value.status, 'denied');
    assert.equal('sourceSet' in value ? value.sourceSet : value.projection, null);
}

test('normalizes the closed projection record and returns immutable raw projection bytes', () => {
    const result = available(normalizeDocumentSynthesisProjection(source()));
    assert.equal(result instanceof Promise, false);
    assert.deepEqual({ ...result.projection, projectionDigestSha256: [...result.projection.projectionDigestSha256] }, {
        documentSourceRef: 'document.synthetic.alpha', documentRevision: n(7), documentFreshnessEpoch: n(11),
        sourceText: 'Caf\u00e9\nsecond', sourceByteLength: 12,
        projectionDigestSha256: [...createHash('sha256').update('Caf\u00e9\nsecond', 'utf8').digest()],
    });
    assert.equal(Object.getPrototypeOf(result), null);
    assert.equal(Object.getPrototypeOf(result.projection), null);
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.projection), true);
    assert.equal(Object.isFrozen(result.projection.projectionDigestSha256), true);
});

test('captures the same set under every input permutation with S1 through Sn byte-wise labels', () => {
    const alpha = source({ documentSourceRef: 'z' });
    const beta = source({ documentSourceRef: 'a', documentRevision: n(9), documentFreshnessEpoch: n(1), sourceText: 'beta' });
    const gamma = source({ documentSourceRef: 'b', documentRevision: n(9), documentFreshnessEpoch: n(2), sourceText: 'gamma' });
    const captured = captureDocumentSynthesisSourceSet(sourceSet([alpha, beta, gamma]));
    assert.equal(captured instanceof Promise, false);
    const left = available(captured).sourceSet;
    const right = available(captureDocumentSynthesisSourceSet(sourceSet([gamma, alpha, beta]))).sourceSet;
    assert.deepEqual(left.sources.map((item) => [item.label, item.documentSourceRef, item.documentRevision, item.documentFreshnessEpoch]), [
        ['S1', 'a', n(9), n(1)], ['S2', 'b', n(9), n(2)], ['S3', 'z', n(7), n(11)],
    ]);
    assert.deepEqual(left.sourceSetDigestSha256, right.sourceSetDigestSha256);
    assert.deepEqual(left.digestPayloadBytes, right.digestPayloadBytes);
});

test('matches the frozen binary codec golden payload and an independently computed SHA-256', () => {
    const result = available(captureDocumentSynthesisSourceSet(sourceSet([source({ documentSourceRef: 'a', documentRevision: n(1), documentFreshnessEpoch: n(2), sourceText: 'x' })], { sourceSetEpoch: n(3), revocationGeneration: n(4) }))).sourceSet;
    const expected = Buffer.from('000000306d656469666c6f772e646f63756d656e742d73796e7468657369732e736f757263652d7365742d6469676573742e7631000101000000000000000300000000000000040000000253310000000161000000000000000100000000000000022d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881', 'hex');
    assert.deepEqual(Buffer.from(result.digestPayloadBytes), expected);
    assert.deepEqual(result.sourceSetDigestSha256, [...createHash('sha256').update(expected).digest()]);
});

test('changes both projection and source-set digests when any bound field changes', () => {
    const baseline = available(captureDocumentSynthesisSourceSet(sourceSet())).sourceSet;
    for (const value of [
        sourceSet([source({ documentSourceRef: 'document.synthetic.beta' })]),
        sourceSet([source({ documentRevision: n(8) })]), sourceSet([source({ documentFreshnessEpoch: n(12) })]),
        sourceSet([source({ sourceText: 'different' })]), sourceSet(undefined, { sourceSetEpoch: n(14) }),
        sourceSet(undefined, { revocationGeneration: n(18) }),
    ]) assert.notDeepEqual(available(captureDocumentSynthesisSourceSet(value)).sourceSet.sourceSetDigestSha256, baseline.sourceSetDigestSha256);
});

test('accepts the exact source-count and UTF-16/UTF-8 aggregate boundaries without truncation', () => {
    const maximum = Array.from({ length: 32 }, (_, index) => source({ documentSourceRef: `document.synthetic.${index}`, sourceText: '\u20ac'.repeat(12_000) }));
    const result = available(captureDocumentSynthesisSourceSet(sourceSet(maximum))).sourceSet;
    assert.equal(result.sources.length, 32);
    assert.equal(result.sources[31]?.label, 'S32');
    assert.equal(result.sources[0]?.sourceByteLength, 36_000);
    assert.equal(result.sources.reduce((total, item) => total + item.sourceByteLength, 0), 1_152_000);
});

test('denies exact-shape, Unicode, size, duplicate, sparse, and raw-versus-hex violations', () => {
    for (const value of [
        null, {}, source({ documentRevision: 7 }), source({ documentRevision: -n(1) }), source({ documentRevision: n('18446744073709551616') }),
        source({ documentSourceRef: '' }), source({ sourceText: '' }), source({ sourceText: 'x\ud800' }), source({ sourceText: 'x\u0001' }),
        source({ sourceText: 'x'.repeat(12_001) }), source({ sourceText: '\u20ac'.repeat(12_001) }), source({ projectionDigestSha256: 'a'.repeat(64) }),
    ]) denied(normalizeDocumentSynthesisProjection(value));
    const tooMany = Array.from({ length: 33 }, (_, index) => source({ documentSourceRef: `ref-${index}` }));
    const sparse = [source(), , source()];
    for (const value of [sourceSet([]), sourceSet(tooMany), sourceSet(sparse), sourceSet([source(), source()]), sourceSet([source()], { sourceSetEpoch: '13' }), sourceSet([source()], { extra: true })]) denied(captureDocumentSynthesisSourceSet(value));
});

test('rejects accessors, proxies, symbols, non-enumerables, custom prototypes, thenables, and ambient then without reads', () => {
    let reads = 0; let traps = 0;
    const accessor = source(); Object.defineProperty(accessor, 'sourceText', { enumerable: true, get() { reads += 1; return 'x'; } });
    denied(normalizeDocumentSynthesisProjection(accessor));
    const proxied = new Proxy(source(), { ownKeys() { traps += 1; return []; }, get() { traps += 1; return null; }, getPrototypeOf() { traps += 1; return Object.prototype; } });
    denied(normalizeDocumentSynthesisProjection(proxied));
    denied(normalizeDocumentSynthesisProjection(Object.assign(Object.create(null), source())));
    denied(normalizeDocumentSynthesisProjection({ ...source(), [Symbol('x')]: true }));
    const hidden = source(); Object.defineProperty(hidden, 'hidden', { enumerable: false, value: true }); denied(normalizeDocumentSynthesisProjection(hidden));
    denied(normalizeDocumentSynthesisProjection({ ...source(), then() {} }));
    const prior = Object.getOwnPropertyDescriptor(Object.prototype, 'then');
    try { Object.defineProperty(Object.prototype, 'then', { configurable: true, get() { reads += 1; return undefined; } }); available(captureDocumentSynthesisSourceSet(sourceSet())); }
    finally { if (prior) Object.defineProperty(Object.prototype, 'then', prior); else delete (Object.prototype as { then?: unknown }).then; }
    assert.equal(reads, 0); assert.equal(traps, 0);
});

test('projects one and thirty-two authentic sources into the fixed minimal provider schema in captured order', () => {
    const one = available(captureDocumentSynthesisSourceSet(sourceSet())).sourceSet;
    const oneProjection = composeDocumentSynthesisProviderProjection(one);
    assert.deepEqual({ ...oneProjection, sources: oneProjection?.sources.map((item) => ({ ...item })) }, {
        schemaVersion: 'mediflow.document-synthesis.provider-projection.v1',
        sources: [{ label: 'S1', sourceText: 'Caf\u00e9\nsecond' }],
    });
    const maximum = Array.from({ length: 32 }, (_, index) => source({ documentSourceRef: `ref-${String(32 - index).padStart(2, '0')}`, sourceText: `text-${index}` }));
    const projection = composeDocumentSynthesisProviderProjection(available(captureDocumentSynthesisSourceSet(sourceSet(maximum))).sourceSet);
    assert.deepEqual(projection?.sources.map((item) => [item.label, item.sourceText]), Array.from({ length: 32 }, (_, index) => [`S${index + 1}`, `text-${31 - index}`]));
});

test('projects only labels and normalized source text, with no source-set metadata or provenance recursively', () => {
    const projection = composeDocumentSynthesisProviderProjection(available(captureDocumentSynthesisSourceSet(sourceSet())).sourceSet);
    assert.ok(projection);
    const forbidden = new Set(['documentSourceRef', 'documentRevision', 'documentFreshnessEpoch', 'sourceSetEpoch', 'revocationGeneration', 'sourceByteLength', 'projectionDigestSha256', 'sourceSetDigestSha256', 'digestPayloadBytes', 'receipt', 'provenance', 'patient', 'session', 'provider', 'venue', 'egress', 'authority', 'apply']);
    const visit = (value: unknown): void => {
        if (!value || typeof value !== 'object') return;
        for (const key of Reflect.ownKeys(value)) {
            if (typeof key !== 'string') assert.fail('provider projection must not contain symbols');
            assert.equal(forbidden.has(key), false, `forbidden key ${key}`);
            visit((value as Record<string, unknown>)[key]);
        }
    };
    visit(projection);
});

test('rejects cloned, forged, other-record, and proxy source sets without triggering proxy traps', () => {
    const captured = available(captureDocumentSynthesisSourceSet(sourceSet())).sourceSet;
    let traps = 0;
    const proxy = new Proxy(captured, { get() { traps += 1; return null; }, getPrototypeOf() { traps += 1; return null; }, ownKeys() { traps += 1; return []; } });
    for (const value of [null, {}, { ...captured }, structuredClone({ sourceSetEpoch: 1, sources: [] }), proxy]) assert.equal(composeDocumentSynthesisProviderProjection(value), null);
    assert.equal(traps, 0);
});

test('uses the immutable capture snapshot, deeply freezes a null-prototype output, and does no deferred work', () => {
    const raw = source();
    const captured = available(captureDocumentSynthesisSourceSet(sourceSet([raw]))).sourceSet;
    raw.sourceText = 'changed after capture';
    const projection = composeDocumentSynthesisProviderProjection(captured);
    assert.ok(projection);
    assert.equal(projection instanceof Promise, false);
    assert.equal(projection.sources[0]?.sourceText, 'Caf\u00e9\nsecond');
    assert.equal(Object.getPrototypeOf(projection), null);
    assert.equal(Object.getPrototypeOf(projection.sources[0]!), null);
    assert.equal(Object.isFrozen(projection), true);
    assert.equal(Object.isFrozen(projection.sources), true);
    assert.equal(Object.isFrozen(projection.sources[0]!), true);
    assert.throws(() => { (projection.sources as unknown as { push(value: unknown): void }).push({ label: 'S2', sourceText: 'forged' }); }, TypeError);
    assert.throws(() => { (projection.sources[0] as { sourceText: string }).sourceText = 'forged'; }, TypeError);
    const originalThen = Object.getOwnPropertyDescriptor(Object.prototype, 'then');
    let reads = 0;
    try {
        Object.defineProperty(Object.prototype, 'then', { configurable: true, get() { reads += 1; return undefined; } });
        assert.equal(composeDocumentSynthesisProviderProjection(captured) instanceof Promise, false);
    } finally { if (originalThen) Object.defineProperty(Object.prototype, 'then', originalThen); else delete (Object.prototype as { then?: unknown }).then; }
    assert.equal(reads, 0);
});
