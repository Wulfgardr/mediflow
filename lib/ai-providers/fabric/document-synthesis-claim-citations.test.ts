/* @Codex */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { types } from 'node:util';

import { captureDocumentSynthesisSourceSet } from './document-synthesis-source-set-contract';
import { bindDocumentSynthesisClaimsToCitations } from './document-synthesis-claim-citations';

const encoder = new TextEncoder(); const sha = (value: string) => createHash('sha256').update(encoder.encode(value)).digest('hex');
function available<T extends { status: string }>(value: T): Extract<T, { status: 'available' }> { assert.equal(value.status, 'available'); return value as Extract<T, { status: 'available' }>; }
function source(ref: string, sourceText: string) { return { documentSourceRef: ref, documentRevision: BigInt(1), documentFreshnessEpoch: BigInt(2), sourceText }; }
function output(extra: Record<string, unknown> = {}) { return { schemaVersion: 'mediflow.ai.extract.v1', task: 'document_synthesis', summary: 'Synthetic summary', data: { qualityLevel: 'green', medications: [], diagnoses: [], problemStatements: [], therapyCandidates: [], servicePrescriptions: [] }, ...extra }; }
function sources(count: number) { return available(captureDocumentSynthesisSourceSet({ sources: Array.from({ length: count }, (_, index) => source(`document.synthetic.${String(index + 1).padStart(2, '0')}`, index === 0 ? 'Caf\u0065\u0301\r\nfirst' : index === 1 ? 'Secondo: €uro' : `🙂-${index + 1}`)), sourceSetEpoch: BigInt(3), revocationGeneration: BigInt(4) })).sourceSet; }
function candidate(count = 2) { const sourceSet = sources(count); const citations = Array.from({ length: count }, (_, index) => { const quote = index === 0 ? 'Café' : index === 1 ? '€uro' : `🙂-${index + 1}`; const startByte = index === 1 ? 9 : 0; return { label: `S${index + 1}`, quote, startByte, endByte: startByte + encoder.encode(quote).length, quoteSha256: sha(quote) }; }); return { sourceSet, output: output(), citations, claims: [{ claimPath: 'summary', labels: ['S1'] }, { claimPath: 'data.qualityLevel', labels: [`S${count}`] }] }; }
function denied(value: unknown) { const result = bindDocumentSynthesisClaimsToCitations(value); assert.equal(result.status, 'denied'); assert.equal(result.output, null); assert.equal(result.outputSha256, null); assert.equal(result.citations, null); assert.equal(result.claims, null); }

test('binds every canonical claim once to C3c4-validated labels for one and thirty-two synthetic sources', () => {
    for (const count of [1, 32]) { const result = available(bindDocumentSynthesisClaimsToCitations(candidate(count))); assert.deepEqual(result.claims.map((item) => ({ ...item, labels: [...item.labels] })), candidate(count).claims); assert.equal(result.outputSha256, sha(JSON.stringify(output()))); assert.equal(Object.getPrototypeOf(result), null); assert.equal(Object.getPrototypeOf(result.output), null); assert.equal(Object.isFrozen(result.output), true); assert.equal(Object.isFrozen(result.claims), true); assert.equal(result.reviewOnly, true); assert.equal(result.writesPerformed, 0); assert.equal(result.applyPolicy, 'none'); }
});

test('denies uncited, missing, extra, reordered, duplicate, unknown, and invalid locator mappings', () => {
    const input = candidate(); const cases: unknown[] = [
        { ...input, claims: [input.claims[1], input.claims[0]] }, { ...input, claims: [input.claims[0]] }, { ...input, claims: [...input.claims, input.claims[0]] },
        { ...input, claims: [{ ...input.claims[0], labels: [] }, input.claims[1]] }, { ...input, claims: [{ ...input.claims[0], labels: ['S1', 'S1'] }, input.claims[1]] }, { ...input, claims: [{ ...input.claims[0], labels: ['S2', 'S1'] }, input.claims[1]] }, { ...input, claims: [{ ...input.claims[0], labels: ['S3'] }, input.claims[1]] },
        { ...input, citations: [{ ...input.citations[0], quoteSha256: '0'.repeat(64) }, input.citations[1]] }, { ...input, sourceSet: { ...input.sourceSet } },
    ]; for (const value of cases) denied(value);
});

test('denies raw source identity and hostile caller shapes without publication or mutation', () => {
    const input = candidate(); const withSource = output({ data: { qualityLevel: 'green', medications: [], diagnoses: [], problemStatements: [{ label: 'Synthetic', icdQuery: 'synthetic', confidence: 'low', evidence: 'Synthetic', sourceId: 'source.synthetic.1' }], therapyCandidates: [], servicePrescriptions: [] } });
    denied({ ...input, output: withSource, claims: [...input.claims, { claimPath: 'data.problemStatements[0]', labels: ['S1'] }] }); for (const key of ['patientRef', 'authority', 'provider', 'venue', 'egress', 'apply', 'prompt', 'rawIdentity']) denied({ ...input, [key]: 'synthetic' });
    const result = available(bindDocumentSynthesisClaimsToCitations(input)); input.claims[0]!.labels[0] = 'S2'; assert.deepEqual(result.claims[0]!.labels, ['S1']);
    let reads = 0; let traps = 0; const accessor = candidate(); Object.defineProperty(accessor.claims[0]!, 'labels', { enumerable: true, get() { reads += 1; return ['S1']; } }); denied(accessor);
    const proxy = new Proxy(candidate(), { ownKeys() { traps += 1; return []; }, get() { traps += 1; return null; } }); denied(proxy); const hidden = candidate(); Object.defineProperty(hidden.claims[0]!, 'labels', { enumerable: false, value: ['S1'] }); denied(hidden); const symbol = candidate(); (symbol as Record<PropertyKey, unknown>)[Symbol('synthetic')] = true; denied(symbol); const sparse = candidate(); delete sparse.claims[0]; denied(sparse); assert.equal(reads, 0); assert.equal(traps, 0);
});

test('returns deep inert arrays and copies validated citations without aliases after return', () => {
    const input = candidate(); const result = available(bindDocumentSynthesisClaimsToCitations(input)); const arrays = [result.citations, result.claims, result.claims[0]!.labels, result.output.data.medications, result.output.data.diagnoses, result.output.data.problemStatements, result.output.data.therapyCandidates, result.output.data.servicePrescriptions];
    for (let index = 0; index < arrays.length; index += 1) { const descriptor = Object.getOwnPropertyDescriptor(arrays[index]!, 'toJSON'); assert.equal(descriptor?.value, null); assert.equal(descriptor?.enumerable, false); assert.equal(descriptor?.configurable, false); assert.equal(descriptor?.writable, false); assert.equal(Object.isFrozen(arrays[index]!), true); }
    assert.notEqual(result.citations[0], input.citations[0]); const retained = result.citations[0]!.quote; input.citations[0]!.quote = 'forged'; assert.equal(result.citations[0]!.quote, retained);
    const define = Object.defineProperty; const objectToJson = Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON'); const arrayToJson = Object.getOwnPropertyDescriptor(Array.prototype, 'toJSON'); let reads = 0; const poison = () => { reads += 1; throw new Error('inherited toJSON must not run'); }; const baseline = JSON.stringify(result); let data: string | undefined; let objectGetter: string | undefined; let arrayGetter: string | undefined;
    try {
        define(Object.prototype, 'toJSON', { configurable: true, value: poison }); data = JSON.stringify(result);
        define(Object.prototype, 'toJSON', { configurable: true, get() { reads += 1; return poison; } }); objectGetter = JSON.stringify(result);
        define(Array.prototype, 'toJSON', { configurable: true, get() { reads += 1; return poison; } }); arrayGetter = JSON.stringify(result);
    } finally {
        if (objectToJson) define(Object.prototype, 'toJSON', objectToJson); else delete (Object.prototype as Record<string, unknown>).toJSON;
        if (arrayToJson) define(Array.prototype, 'toJSON', arrayToJson); else delete (Array.prototype as unknown as Record<string, unknown>).toJSON;
    }
    assert.equal(data, baseline); assert.equal(objectGetter, baseline); assert.equal(arrayGetter, baseline); assert.equal(reads, 0);
});

test('keeps the end-to-end source-set to claim digest invariant under post-import intrinsic poisoning', async () => {
    const define = Object.defineProperty; const get = Object.getOwnPropertyDescriptor;
    const targets = [[Object, 'create'], [Object, 'freeze'], [Object, 'getOwnPropertyDescriptor'], [Object, 'getPrototypeOf'], [Object, 'hasOwn'], [Reflect, 'ownKeys'], [Reflect, 'apply'], [Array, 'isArray'], [Array.prototype, 'includes'], [Array.prototype, Symbol.iterator], [String.prototype, 'charCodeAt'], [TextEncoder.prototype, 'encode'], [JSON, 'stringify'], [types, 'isProxy']] as const;
    const descriptors = targets.map(([target, key]) => [target, key, get(target, key)] as const); const globalString = get(globalThis, 'String'); const globalTextEncoder = get(globalThis, 'TextEncoder'); const priorToJson = get(Object.prototype, 'toJSON'); const priorThen = get(Object.prototype, 'then');
    const probe = createHash('sha256'); const hashPrototype = Object.getPrototypeOf(probe); const update = get(hashPrototype, 'update'); const digest = get(hashPrototype, 'digest'); assert.ok(globalString?.configurable); assert.ok(globalTextEncoder?.configurable); assert.ok(update?.configurable); assert.ok(digest?.configurable);
    const input = candidate(); const baseline = available(bindDocumentSynthesisClaimsToCitations(input)); const invalid = { ...candidate(), claims: [{ claimPath: 'summary', labels: ['S3'] }, candidate().claims[1]! ] };
    let reads = 0; let traps = 0; const poison = () => { reads += 1; throw new Error('ambient intrinsic poisoned after import'); }; const transparent = new Proxy(candidate(), { ownKeys() { traps += 1; return []; }, get() { traps += 1; return null; }, getPrototypeOf() { traps += 1; return Object.prototype; } });
    let captured: ReturnType<typeof bindDocumentSynthesisClaimsToCitations> | undefined; let proxyDenied: ReturnType<typeof bindDocumentSynthesisClaimsToCitations> | undefined; let invalidDenied: ReturnType<typeof bindDocumentSynthesisClaimsToCitations> | undefined;
    try {
        for (let index = 0; index < descriptors.length; index += 1) define(descriptors[index]![0], descriptors[index]![1], { ...descriptors[index]![2], value: poison });
        define(globalThis, 'String', { ...globalString, value: false }); define(globalThis, 'TextEncoder', { ...globalTextEncoder, value: false }); define(Object.prototype, 'toJSON', { configurable: true, get() { reads += 1; return poison; } }); define(Object.prototype, 'then', { configurable: true, get() { reads += 1; return poison; } }); define(hashPrototype, 'update', { ...update, value: poison }); define(hashPrototype, 'digest', { ...digest, value: poison });
        define(types, 'isProxy', { ...get(types, 'isProxy'), value: () => false }); proxyDenied = bindDocumentSynthesisClaimsToCitations(transparent);
        define(types, 'isProxy', { ...get(types, 'isProxy'), value: poison }); captured = bindDocumentSynthesisClaimsToCitations(input); invalidDenied = bindDocumentSynthesisClaimsToCitations(invalid);
    } finally {
        for (let index = 0; index < descriptors.length; index += 1) define(descriptors[index]![0], descriptors[index]![1], descriptors[index]![2]!);
        define(globalThis, 'String', globalString!); define(globalThis, 'TextEncoder', globalTextEncoder!); define(hashPrototype, 'update', update!); define(hashPrototype, 'digest', digest!);
        if (priorToJson) define(Object.prototype, 'toJSON', priorToJson); else delete (Object.prototype as Record<string, unknown>).toJSON; if (priorThen) define(Object.prototype, 'then', priorThen); else delete (Object.prototype as Record<string, unknown>).then;
    }
    const result = available(captured!); assert.equal(proxyDenied!.status, 'denied'); assert.equal(invalidDenied!.status, 'denied'); assert.equal(result.outputSha256, baseline.outputSha256); assert.deepEqual(result.claims.map((item) => ({ ...item, labels: [...item.labels] })), baseline.claims.map((item) => ({ ...item, labels: [...item.labels] }))); assert.equal(reads, 0); assert.equal(traps, 0); assert.equal(result instanceof Promise, false);
    let unhandled = 0; const listener = () => { unhandled += 1; }; process.on('unhandledRejection', listener); try { await new Promise<void>((resolve) => setImmediate(resolve)); } finally { process.off('unhandledRejection', listener); } assert.equal(unhandled, 0);
});
