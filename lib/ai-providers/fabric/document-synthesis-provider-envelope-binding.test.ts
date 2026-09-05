/* @Codex */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { types } from 'node:util';

import { bindDocumentSynthesisProviderEnvelope } from './document-synthesis-provider-envelope-binding';
import { parseDocumentSynthesisProviderEnvelope, resolveDocumentSynthesisProviderEnvelope } from './document-synthesis-provider-envelope';
import { captureDocumentSynthesisSourceSet } from './document-synthesis-source-set-contract';

const encoder = new TextEncoder();
const sha = (value: string) => createHash('sha256').update(encoder.encode(value)).digest('hex');
const output = (extra: Record<string, unknown> = {}) => ({ schemaVersion: 'mediflow.ai.extract.v1', task: 'document_synthesis', summary: 'Synthetic summary', data: { qualityLevel: 'green', medications: [], diagnoses: [], problemStatements: [], therapyCandidates: [], servicePrescriptions: [] }, ...extra });
const source = (ref: string, sourceText: string) => ({ documentSourceRef: ref, documentRevision: BigInt(1), documentFreshnessEpoch: BigInt(2), sourceText });
function sourceSet(second = 'Beta') {
    const result = captureDocumentSynthesisSourceSet({ sources: [source('a', 'Alpha'), source('b', second)], sourceSetEpoch: BigInt(3), revocationGeneration: BigInt(4) });
    assert.equal(result.status, 'available');
    return result.sourceSet!;
}
function body(extra: Record<string, unknown> = {}) {
    return JSON.stringify({ output: output(), citations: [
        { label: 'S1', quote: 'Alpha', startByte: 0, endByte: 5, quoteSha256: sha('Alpha') },
        { label: 'S2', quote: 'Beta', startByte: 0, endByte: 4, quoteSha256: sha('Beta') },
    ], claims: [{ claimPath: 'summary', labels: ['S1'] }, { claimPath: 'data.qualityLevel', labels: ['S2'] }], ...extra });
}
function token(content = body()) {
    const result = parseDocumentSynthesisProviderEnvelope({ content });
    assert.equal(result.status, 'available');
    return result.token!;
}
function available(value: unknown) {
    const result = bindDocumentSynthesisProviderEnvelope(value);
    assert.equal(result.status, 'available');
    return result;
}
function denied(value: unknown) {
    const result = bindDocumentSynthesisProviderEnvelope(value);
    assert.deepEqual({ ...result }, { status: 'denied', code: 'input_invalid', output: null, outputSha256: null, citations: null, claims: null, reviewOnly: true, writesPerformed: 0, applyPolicy: 'none' });
    assert.equal(Object.getPrototypeOf(result), null);
    assert.equal(Object.isFrozen(result), true);
}

test('binds only an authentic C3d2a token with the authentic C3c2 source-set and preserves the accepted inert result', () => {
    const sources = sourceSet(); const providerToken = token(); const result = available({ sourceSet: sources, envelopeToken: providerToken });
    const bindingSource = readFileSync(new URL('./document-synthesis-provider-envelope-binding.ts', import.meta.url), 'utf8'); assert.ok(bindingSource.indexOf('const envelope = resolveDocumentSynthesisProviderEnvelope') < bindingSource.indexOf('ReflectApply(StructuredClone'));
    assert.equal(result.reviewOnly, true); assert.equal(result.writesPerformed, 0); assert.equal(result.applyPolicy, 'none');
    assert.equal(Object.getPrototypeOf(result), null); assert.equal(Object.isFrozen(result), true); assert.equal(Object.isFrozen(result.citations), true); assert.equal(result.citations[0]!.quote, 'Alpha');
    assert.throws(() => { (result.claims as unknown as unknown[]).push(null); });
    denied({ sourceSet: sources, envelopeToken: {} }); denied({ sourceSet: sources, envelopeToken: { ...providerToken } }); denied({ sourceSet: sources, envelopeToken: structuredClone(providerToken) }); denied({ sourceSet: sources, envelopeToken: new Proxy(providerToken, {}) }); denied({ sourceSet: sources, envelopeToken: resolveDocumentSynthesisProviderEnvelope(providerToken) });
    denied({ sourceSet: { ...sources }, envelopeToken: providerToken }); denied({ sourceSet: structuredClone(sources), envelopeToken: providerToken }); denied({ sourceSet: new Proxy(sources, {}), envelopeToken: providerToken });
    denied({ sourceSet: sourceSet('Gamma'), envelopeToken: providerToken });
    const changed = body({ citations: [{ label: 'S2', quote: 'Beta', startByte: 0, endByte: 4, quoteSha256: sha('Beta') }, { label: 'S1', quote: 'Alpha', startByte: 0, endByte: 5, quoteSha256: sha('Alpha') }] });
    for (const content of [changed, body({ citations: JSON.parse(body()).citations.slice(0, 1) }), body({ citations: [...JSON.parse(body()).citations, JSON.parse(body()).citations[1]] }), body({ claims: JSON.parse(body()).claims.reverse() }), body({ claims: JSON.parse(body()).claims.slice(0, 1) }), body({ output: output({ data: { qualityLevel: 'green', medications: [], diagnoses: [], problemStatements: [{ label: 'Synthetic', icdQuery: 'synthetic', confidence: 'low', evidence: 'Synthetic', sourceId: 'forged' }], therapyCandidates: [], servicePrescriptions: [] } }), claims: [{ claimPath: 'summary', labels: ['S1'] }, { claimPath: 'data.qualityLevel', labels: ['S2'] }, { claimPath: 'data.problemStatements[0]', labels: ['S1'] }] })]) denied({ sourceSet: sources, envelopeToken: token(content) });
    const proto = body().replace('"output":{', '"output":{"__proto__":{"polluted":true},'); denied({ sourceSet: sources, envelopeToken: token(proto) }); assert.equal(({} as { polluted?: boolean }).polluted, undefined);
    const raw = { content: body() }; const parsed = parseDocumentSynthesisProviderEnvelope(raw); raw.content = body({ citations: [] }); assert.equal(parsed.status, 'available'); if (parsed.status === 'available') available({ sourceSet: sources, envelopeToken: parsed.token });
});

test('rejects hostile descriptors before reads or traps and stays synchronous under intrinsic poisoning', async () => {
    const sources = sourceSet(); const providerToken = token(); let reads = 0; let traps = 0;
    const accessor = {}; Object.defineProperty(accessor, 'sourceSet', { enumerable: true, get() { reads += 1; return sources; } }); Object.defineProperty(accessor, 'envelopeToken', { enumerable: true, value: providerToken });
    const nonEnumerable = { sourceSet: sources, envelopeToken: providerToken }; Object.defineProperty(nonEnumerable, 'sourceSet', { enumerable: false });
    const custom = Object.assign(Object.create({ inherited: true }), { sourceSet: sources, envelopeToken: providerToken }); const proxy = new Proxy({ sourceSet: sources, envelopeToken: providerToken }, { ownKeys() { traps += 1; return []; } });
    for (const value of [null, [], accessor, nonEnumerable, custom, { sourceSet: sources, envelopeToken: providerToken, extra: true }, { sourceSet: sources, envelopeToken: providerToken, [Symbol('x')]: true }, proxy, { sourceSet: sources, envelopeToken: providerToken, then() { reads += 1; } }]) denied(value);
    assert.equal(reads, 0); assert.equal(traps, 0);
    const define = Object.defineProperty; const get = Object.getOwnPropertyDescriptor; const targets = [[Object, 'create'], [Object, 'freeze'], [Object, 'getOwnPropertyDescriptor'], [Object, 'getPrototypeOf'], [Object, 'hasOwn'], [Reflect, 'ownKeys'], [types, 'isProxy'], [WeakMap.prototype, 'get'], [globalThis, 'structuredClone']] as const;
    const descriptors = targets.map(([target, key]) => [target, key, get(target, key)!] as const); const iterator = get(Array.prototype, Symbol.iterator)!; const priorThen = get(Object.prototype, 'then'); const poison = () => { reads += 1; throw new Error('ambient poison'); };
    for (let index = 0; index < descriptors.length; index += 1) define(descriptors[index]![0], descriptors[index]![1], { ...descriptors[index]![2], value: poison }); define(Array.prototype, Symbol.iterator, { ...iterator, value: poison }); define(Object.prototype, 'then', { configurable: true, get() { reads += 1; throw new Error('then'); } });
    let result: ReturnType<typeof bindDocumentSynthesisProviderEnvelope>; const unhandled: unknown[] = []; const listener = (reason: unknown) => { unhandled[unhandled.length] = reason; }; process.on('unhandledRejection', listener);
    try { result = bindDocumentSynthesisProviderEnvelope({ sourceSet: sources, envelopeToken: providerToken }); } finally { for (let index = descriptors.length - 1; index >= 0; index -= 1) define(descriptors[index]![0], descriptors[index]![1], descriptors[index]![2]); define(Array.prototype, Symbol.iterator, iterator); if (priorThen) define(Object.prototype, 'then', priorThen); else Reflect.deleteProperty(Object.prototype, 'then'); }
    await new Promise<void>((resolve) => setImmediate(resolve)); process.off('unhandledRejection', listener);
    assert.equal(result!.status, 'available'); assert.equal(reads, 0); assert.deepEqual(unhandled, []); assert.equal(result instanceof Promise, false);
});
