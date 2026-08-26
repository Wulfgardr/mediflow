/* @Codex */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { types } from 'node:util';

import { digestDocumentSynthesisClaimCitations } from './document-synthesis-claim-citations-digest';

const encoder = new TextEncoder();
function seal<T extends object>(value: T): Readonly<T> { return Object.freeze(Object.assign(Object.create(null), value)); }
function list<T>(values: readonly T[]): readonly T[] { const copy = [...values]; Object.defineProperty(copy, 'toJSON', { value: null, enumerable: false, configurable: false, writable: false }); return Object.freeze(copy); }
const sha = (value: string) => createHash('sha256').update(encoder.encode(value)).digest('hex');
function value() { const citations = list([seal({ label: 'S1', quote: 'Caf\u00e9', startByte: 0, endByte: 5, quoteSha256: sha('Caf\u00e9') }), seal({ label: 'S2', quote: 'Beta', startByte: 5, endByte: 9, quoteSha256: sha('Beta') })]); return Object.freeze({ citations, claims: list([seal({ claimPath: 'summary', labels: list(['S1', 'S2']) }), seal({ claimPath: 'data.qualityLevel', labels: list(['S2']) })]) }); }
function denied(input: unknown): void { assert.equal(digestDocumentSynthesisClaimCitations(input), null); }

test('encodes the frozen ordered U0-retained pair as raw32 SHA-256', () => {
    const input = value(); const actual = digestDocumentSynthesisClaimCitations(input); assert.ok(actual); assert.equal(Object.isFrozen(actual), true); assert.equal(Object.getOwnPropertyDescriptor(actual, 'toJSON')?.value, null);
    const p: number[] = []; const put = (v: number[]) => p.push(...v); const u32 = (v: number) => put([(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]); const u64 = (v: number) => { const n = BigInt(v); for (let i = 7; i >= 0; i -= 1) p.push(Number((n >> BigInt(i * 8)) & BigInt(255))); }; const hex = (s: string) => Array.from({ length: 32 }, (_, i) => Number.parseInt(s.slice(i * 2, i * 2 + 2), 16)); const text = (s: string) => { const b = [...encoder.encode(s)]; u32(b.length); put(b); };
    text('mediflow.document-synthesis.claim-citations-digest.v1'); put([0, 1, 0, 2]); text('S1'); text('Caf\u00e9'); u64(0); u64(5); put(hex(sha('Caf\u00e9'))); text('S2'); text('Beta'); u64(5); u64(9); put(hex(sha('Beta'))); put([0, 2]); text('summary'); put([0, 2]); text('S1'); text('S2'); text('data.qualityLevel'); put([0, 1]); text('S2');
    assert.deepEqual(actual, [...createHash('sha256').update(Uint8Array.from(p)).digest()]);
    const u0 = seal({ status: 'available', code: null, schemaVersion: 'mediflow.document-synthesis.claim-citations.v1', output: seal({}), outputSha256: sha('output'), citations: input.citations, claims: input.claims, reviewOnly: true, writesPerformed: 0, applyPolicy: 'none', sourceSetDigestSha256: list(Array.from({ length: 32 }, () => 0)) }); assert.deepEqual(digestDocumentSynthesisClaimCitations(u0), actual);
});

test('denies drift before hashing: authority fields, order, duplicates, sparse arrays, descriptors, Unicode, and numeric coercion', () => {
    const input = value(); const pair = (citations: unknown, claims: unknown) => Object.freeze({ citations, claims }); const reordered = pair(list([input.citations[1]!, input.citations[0]!]), input.claims); assert.notDeepEqual(digestDocumentSynthesisClaimCitations(reordered), digestDocumentSynthesisClaimCitations(input)); denied({ ...input }); denied(Object.freeze({ citations: input.citations, claims: input.claims, authority: 'forged' })); denied(pair(list([seal({ label: 'S1', quote: 'Beta', startByte: 0, endByte: 4, quoteSha256: sha('Beta') }), input.citations[0]!]), input.claims)); denied(pair(input.citations, list([seal({ claimPath: 'summary', labels: list(['S2', 'S1']) }), input.claims[1]!]))); denied(pair(input.citations, list([input.claims[0]!, seal({ claimPath: 'summary', labels: list(['S2']) })]))); denied(pair(list([seal({ label: 'S1', quote: '\ud800', startByte: 0, endByte: 0, quoteSha256: '0'.repeat(64) })]), list([seal({ claimPath: 'summary', labels: list(['S1']) })]))); denied(pair(list([seal({ label: 'S1', quote: 'A', startByte: 0.5, endByte: 1, quoteSha256: sha('A').toUpperCase() })]), list([seal({ claimPath: 'summary', labels: list(['S1']) })])));
    const sparse = [input.citations[0]!, input.citations[1]!]; Object.defineProperty(sparse, 'toJSON', { value: null, enumerable: false }); delete sparse[1]; denied(pair(Object.freeze(sparse), input.claims)); const accessor = Object.create(null); Object.defineProperty(accessor, 'citations', { enumerable: true, get() { throw new Error('read'); } }); Object.defineProperty(accessor, 'claims', { enumerable: true, value: input.claims }); denied(Object.freeze(accessor)); denied(new Proxy(value(), {}));
});

test('remains synchronous and deterministic after ambient intrinsic poisoning', () => {
    const input = value(); const baseline = digestDocumentSynthesisClaimCitations(input); const define = Object.defineProperty; const get = Object.getOwnPropertyDescriptor; const probe = createHash('sha256'); const proto = Object.getPrototypeOf(probe); const targets = [[Object, 'create'], [Object, 'freeze'], [Object, 'getOwnPropertyDescriptor'], [Object, 'getPrototypeOf'], [Object, 'hasOwn'], [Object, 'isFrozen'], [Reflect, 'apply'], [Reflect, 'ownKeys'], [Array, 'isArray'], [TextEncoder.prototype, 'encode'], [types, 'isProxy'], [proto, 'update'], [proto, 'digest']] as const; const saved = targets.map(([o, k]) => [o, k, get(o, k)!] as const); const poison = () => { throw new Error('poison'); }; let actual: ReturnType<typeof digestDocumentSynthesisClaimCitations>;
    try { for (const [o, k, d] of saved) define(o, k, { ...d, value: poison }); actual = digestDocumentSynthesisClaimCitations(input); } finally { for (const [o, k, d] of saved) define(o, k, d); }
    assert.deepEqual(actual!, baseline); assert.equal(actual! instanceof Promise, false);
});
