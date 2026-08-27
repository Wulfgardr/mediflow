/* @Codex */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { captureDocumentSynthesisSourceSet } from '../ai-providers/fabric/document-synthesis-source-set-contract.ts';
import { digestDocumentSynthesisSourceSet } from './document-synthesis-source-set-digest.ts';

const n = (value: number | string) => BigInt(value);
const raw32 = (text = 'x') => [...createHash('sha256').update(text, 'utf8').digest()];
const source = (overrides: Record<string, unknown> = {}) => ({
    label: 'S1', documentSourceRef: 'document.synthetic.alpha', documentRevision: n(7), documentFreshnessEpoch: n(11), sourceByteLength: 12, projectionDigestSha256: raw32('Caf\u00e9\nsecond'), ...overrides,
});
const input = (sources: unknown[] = [source()], overrides: Record<string, unknown> = {}) => ({ sources, sourceSetEpoch: n(13), revocationGeneration: n(17), ...overrides });
const available = <T extends { status: string }>(value: T): Extract<T, { status: 'available' }> => { assert.equal(value.status, 'available'); if (value.status !== 'available') throw new Error('expected available'); return value as Extract<T, { status: 'available' }>; };
const denied = (value: { status: string; digestPayloadBytes?: unknown; sourceSetDigestSha256?: unknown }) => { assert.equal(value.status, 'denied'); assert.equal(value.digestPayloadBytes, null); assert.equal(value.sourceSetDigestSha256, null); };

test('retains the exact ADR 0102 payload and digest bytes from the Fabric source-set contract', () => {
    const fabric = available(captureDocumentSynthesisSourceSet({
        sources: [{ documentSourceRef: 'a', documentRevision: n(1), documentFreshnessEpoch: n(2), sourceText: 'x' }], sourceSetEpoch: n(3), revocationGeneration: n(4),
    })).sourceSet;
    const sources = fabric.sources.map((item) => ({ label: item.label, documentSourceRef: item.documentSourceRef, documentRevision: item.documentRevision, documentFreshnessEpoch: item.documentFreshnessEpoch, sourceByteLength: item.sourceByteLength, projectionDigestSha256: item.projectionDigestSha256 }));
    const value = available(digestDocumentSynthesisSourceSet({ sourceSetEpoch: fabric.sourceSetEpoch, revocationGeneration: fabric.revocationGeneration, sources }));
    const expected = Buffer.from('000000306d656469666c6f772e646f63756d656e742d73796e7468657369732e736f757263652d7365742d6469676573742e7631000101000000000000000300000000000000040000000253310000000161000000000000000100000000000000022d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881', 'hex');
    assert.deepEqual(Buffer.from(value.digestPayloadBytes), expected);
    assert.deepEqual(value.digestPayloadBytes, fabric.digestPayloadBytes);
    assert.deepEqual(value.sourceSetDigestSha256, fabric.sourceSetDigestSha256);
    assert.deepEqual(Reflect.ownKeys(value), ['status', 'code', 'digestPayloadBytes', 'sourceSetDigestSha256']);
    assert.equal(Object.isFrozen(value), true); assert.equal(Object.isFrozen(value.digestPayloadBytes), true); assert.equal(Object.isFrozen(value.sourceSetDigestSha256), true);
    assert.equal('sourceText' in value || 'sourceSetEpoch' in value || 'revocationGeneration' in value, false);
});

test('denies invalid counters, raw32 input, limits, labels, duplicate or unordered sources', () => {
    const second = source({ label: 'S2', documentSourceRef: 'document.synthetic.beta', projectionDigestSha256: raw32('b') });
    for (const value of [
        input([], {}), input([source()], { sourceSetEpoch: -n(1) }), input([source()], { revocationGeneration: n('18446744073709551616') }),
        input([source({ projectionDigestSha256: raw32().slice(0, 31) })]), input([source({ projectionDigestSha256: Array(32).fill(256) })]),
        input([source({ label: 'S2' })]), input([source({ sourceByteLength: 36_001 })]), input([source({ documentSourceRef: '' })]),
        input([second, source()]), input([source(), source({ documentRevision: n(8) })]), input(Array.from({ length: 33 }, (_, index) => source({ label: `S${index + 1}`, documentSourceRef: `document.synthetic.${index}`, projectionDigestSha256: raw32(String(index)) }))),
    ]) denied(digestDocumentSynthesisSourceSet(value));
});

test('denies accessors, proxies, custom prototypes, symbols, thenables, and never observes them', async () => {
    let reads = 0; let traps = 0;
    const accessor = input(); Object.defineProperty(accessor, 'sources', { enumerable: true, get() { reads += 1; return [source()]; } });
    const proxy = new Proxy(input(), { get() { traps += 1; return null; }, getPrototypeOf() { traps += 1; return Object.prototype; }, ownKeys() { traps += 1; return []; } });
    const custom = Object.assign(Object.create(null), input());
    for (const value of [accessor, proxy, custom, { ...input(), [Symbol('x')]: true }, { ...input(), then() {} }]) denied(digestDocumentSynthesisSourceSet(value));
    const prior = Object.getOwnPropertyDescriptor(Object.prototype, 'then');
    try { Object.defineProperty(Object.prototype, 'then', { configurable: true, get() { reads += 1; return undefined; } }); assert.equal(digestDocumentSynthesisSourceSet(input()) instanceof Promise, false); }
    finally { if (prior) Object.defineProperty(Object.prototype, 'then', prior); else delete (Object.prototype as { then?: unknown }).then; }
    assert.equal(reads, 0); assert.equal(traps, 0);
    let unhandled = 0; const listener = () => { unhandled += 1; }; process.on('unhandledRejection', listener);
    try { await new Promise<void>((resolve) => setImmediate(resolve)); } finally { process.off('unhandledRejection', listener); }
    assert.equal(unhandled, 0);
});

test('uses captured intrinsics after import and returns data-only raw32 outputs', () => {
    const entries = [[Object, 'create'], [Object, 'freeze'], [Object, 'getOwnPropertyDescriptor'], [Object, 'getPrototypeOf'], [Object, 'hasOwn'], [Reflect, 'ownKeys'], [Reflect, 'apply']] as const;
    const descriptors = entries.map(([target, key]) => [target, key, Object.getOwnPropertyDescriptor(target, key)] as const); const poison = () => { throw new Error('poison'); };
    let value: ReturnType<typeof digestDocumentSynthesisSourceSet> | undefined;
    try { for (const [target, key, descriptor] of descriptors) Object.defineProperty(target, key, { ...descriptor, value: poison }); value = digestDocumentSynthesisSourceSet(input()); }
    finally { for (const [target, key, descriptor] of descriptors) Object.defineProperty(target, key, descriptor!); }
    const result = available(value!);
    assert.equal(result.sourceSetDigestSha256.length, 32); assert.equal(result.digestPayloadBytes.length > 0, true);
});
