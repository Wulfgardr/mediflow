/* @Codex */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { types } from 'node:util';

import { captureDocumentSynthesisSourceSet } from './document-synthesis-source-set-contract';
import { validateDocumentSynthesisProviderCitations } from './document-synthesis-provider-citations';

const bytes = (value: string) => new TextEncoder().encode(value);
const sha = (value: string) => createHash('sha256').update(bytes(value)).digest('hex');
function available<T extends { status: string }>(value: T): Extract<T, { status: 'available' }> { assert.equal(value.status, 'available'); return value as Extract<T, { status: 'available' }>; }
function source(ref: string, sourceText: string) { return { documentSourceRef: ref, documentRevision: BigInt(1), documentFreshnessEpoch: BigInt(2), sourceText }; }
function authentic() { return available(captureDocumentSynthesisSourceSet({ sources: [source('b', 'Secondo: €uro'), source('a', 'Caf\u0065\u0301\r\nprimo')], sourceSetEpoch: BigInt(3), revocationGeneration: BigInt(4) })).sourceSet; }
function valid(sourceSet = authentic()) { return { sourceSet, citations: [
    { label: 'S1', quote: 'Café', startByte: 0, endByte: 5, quoteSha256: sha('Café') },
    { label: 'S2', quote: '€uro', startByte: 9, endByte: 15, quoteSha256: sha('€uro') },
] }; }
function single(sourceText: string, quote: string, startByte: number, endByte: number) {
    const sourceSet = available(captureDocumentSynthesisSourceSet({ sources: [source('a', sourceText)], sourceSetEpoch: BigInt(3), revocationGeneration: BigInt(4) })).sourceSet;
    return { sourceSet, citations: [{ label: 'S1', quote, startByte, endByte, quoteSha256: sha(quote) }] };
}
function denied(value: unknown) { const result = validateDocumentSynthesisProviderCitations(value); assert.equal(result.status, 'denied'); assert.equal(result.citations, null); }

test('binds ordered S1..Sn provider citations to an authentic normalized private projection', () => {
    const result = available(validateDocumentSynthesisProviderCitations(valid()));
    assert.deepEqual(result.citations.map((item) => ({ ...item })), valid().citations);
    assert.equal(result instanceof Promise, false); assert.equal(Object.getPrototypeOf(result), null); assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.getPrototypeOf(result.citations[0]!), null); assert.equal(Object.isFrozen(result.citations), true);
    assert.equal(result.reviewOnly, true); assert.equal(result.writesPerformed, 0); assert.equal(result.applyPolicy, 'none');
});

test('denies reordered, missing, duplicate, unknown, ambiguous, quote, offset, and digest mismatches', () => {
    const input = valid();
    const cases: unknown[] = [
        { ...input, citations: [input.citations[1], input.citations[0]] }, { ...input, citations: [input.citations[0]] },
        { ...input, citations: [input.citations[0], { ...input.citations[0], label: 'S2' }] }, { ...input, citations: [{ ...input.citations[0], label: 'S3' }, input.citations[1]] },
        { ...input, citations: [{ ...input.citations[0], quote: 'prima', startByte: 6, endByte: 11, quoteSha256: sha('prima') }, input.citations[1]] },
        { ...input, citations: [{ ...input.citations[0], startByte: 1, endByte: 6 }, input.citations[1]] }, { ...input, citations: [{ ...input.citations[0], quoteSha256: '0'.repeat(64) }, input.citations[1]] },
        { ...input, citations: [{ ...input.citations[0], quote: 'e', startByte: 3, endByte: 4, quoteSha256: sha('e') }, input.citations[1]] },
    ];
    for (const value of cases) denied(value);
});

test('denies lone surrogate aliases before UTF-8 hashing and preserves a valid astral scalar quote', () => {
    for (const [sourceText, quote] of [['\ufffd', '\ud800'], ['\ufffd', '\udc00'], ['x\ufffdy', 'x\ud800y'], ['x\ufffdy', 'x\udc00y']] as const) denied(single(sourceText, quote, 0, bytes(sourceText).length));
    available(validateDocumentSynthesisProviderCitations(single('🙂', '🙂', 0, 4)));
});

test('denies forged source sets, forbidden authority fields, mutation, hostile shapes, and ambient then without reads', () => {
    const input = valid(); const forged = { ...input.sourceSet };
    denied({ ...input, sourceSet: forged }); denied({ ...input, patientRef: 'synthetic' });
    const output = available(validateDocumentSynthesisProviderCitations(input)); input.citations[0]!.quote = 'forged'; assert.equal(output.citations[0]!.quote, 'Café');
    let reads = 0; let traps = 0;
    const accessor = valid(); Object.defineProperty(accessor.citations[0]!, 'quote', { enumerable: true, get() { reads += 1; return 'Café'; } }); denied(accessor);
    const proxy = new Proxy(valid(), { ownKeys() { traps += 1; return []; }, get() { traps += 1; return null; } }); denied(proxy);
    const nonEnumerable = valid(); Object.defineProperty(nonEnumerable.citations[0]!, 'quote', { enumerable: false, value: 'Café' }); denied(nonEnumerable);
    const before = Object.getOwnPropertyDescriptor(Object.prototype, 'then'); const freeze = Object.freeze; const create = Object.create; const includes = Array.prototype.includes; const charCodeAt = String.prototype.charCodeAt; const isProxy = types.isProxy; const frozenInput = valid(); const transparentInput = valid();
    try {
        Object.defineProperty(Object.prototype, 'then', { configurable: true, get() { reads += 1; return undefined; } });
        (Object as { freeze: typeof Object.freeze }).freeze = (() => { throw new Error('poison'); }) as typeof Object.freeze;
        (Object as { create: typeof Object.create }).create = (() => { throw new Error('poison'); }) as typeof Object.create;
        (Array.prototype as { includes: typeof Array.prototype.includes }).includes = (() => { throw new Error('poison'); }) as typeof Array.prototype.includes;
        (String.prototype as { charCodeAt: typeof String.prototype.charCodeAt }).charCodeAt = (() => { throw new Error('poison'); }) as typeof String.prototype.charCodeAt;
        (types as { isProxy: typeof types.isProxy }).isProxy = (() => false) as typeof types.isProxy;
        const poisonedProxy = new Proxy(transparentInput, { ownKeys() { traps += 1; return []; }, get() { traps += 1; return null; } }); denied(poisonedProxy);
        (types as { isProxy: typeof types.isProxy }).isProxy = (() => { throw new Error('poison'); }) as typeof types.isProxy;
        available(validateDocumentSynthesisProviderCitations(frozenInput));
    } finally {
        (Object as { freeze: typeof Object.freeze }).freeze = freeze; (Object as { create: typeof Object.create }).create = create;
        (Array.prototype as { includes: typeof Array.prototype.includes }).includes = includes; (String.prototype as { charCodeAt: typeof String.prototype.charCodeAt }).charCodeAt = charCodeAt;
        (types as { isProxy: typeof types.isProxy }).isProxy = isProxy;
        if (before) Object.defineProperty(Object.prototype, 'then', before); else delete (Object.prototype as { then?: unknown }).then;
    }
    assert.equal(reads, 0); assert.equal(traps, 0);
});

test('captures Array, Object, Reflect, String, encoder, JSON, proxy, and prototype intrinsics without deferred observation', async () => {
    const define = Object.defineProperty; const get = Object.getOwnPropertyDescriptor;
    const targets = [
        [Object, 'create'], [Object, 'freeze'], [Object, 'getOwnPropertyDescriptor'], [Object, 'getPrototypeOf'], [Object, 'hasOwn'],
        [Reflect, 'ownKeys'], [Reflect, 'apply'], [Array, 'isArray'], [Array.prototype, 'includes'], [Array.prototype, Symbol.iterator],
        [String.prototype, 'charCodeAt'], [TextEncoder.prototype, 'encode'], [JSON, 'stringify'], [types, 'isProxy'],
    ] as const;
    const descriptors = targets.map(([target, key]) => [target, key, get(target, key)] as const);
    const globalString = get(globalThis, 'String'); const globalTextEncoder = get(globalThis, 'TextEncoder');
    const previousToJson = get(Object.prototype, 'toJSON'); const previousThen = get(Object.prototype, 'then');
    assert.ok(globalString?.configurable); assert.ok(globalTextEncoder?.configurable);
    const input = valid(); const baseline = available(validateDocumentSynthesisProviderCitations(input));
    let reads = 0; let traps = 0; const poison = () => { reads += 1; throw new Error('ambient intrinsic poisoned after import'); };
    const transparent = new Proxy(valid(), { ownKeys() { traps += 1; return []; }, get() { traps += 1; return null; }, getPrototypeOf() { traps += 1; return Object.prototype; } });
    let captured: ReturnType<typeof validateDocumentSynthesisProviderCitations> | undefined;
    try {
        for (let index = 0; index < descriptors.length; index += 1) define(descriptors[index]![0], descriptors[index]![1], { ...descriptors[index]![2], value: poison });
        define(globalThis, 'String', { ...globalString, value: false }); define(globalThis, 'TextEncoder', { ...globalTextEncoder, value: false });
        define(Object.prototype, 'toJSON', { configurable: true, get() { reads += 1; return poison; } });
        define(Object.prototype, 'then', { configurable: true, get() { reads += 1; return poison; } });
        define(types, 'isProxy', { ...get(types, 'isProxy'), value: () => false });
        denied(transparent);
        define(types, 'isProxy', { ...get(types, 'isProxy'), value: poison });
        captured = validateDocumentSynthesisProviderCitations(input);
    } finally {
        for (let index = 0; index < descriptors.length; index += 1) define(descriptors[index]![0], descriptors[index]![1], descriptors[index]![2]!);
        define(globalThis, 'String', globalString!); define(globalThis, 'TextEncoder', globalTextEncoder!);
        if (previousToJson) define(Object.prototype, 'toJSON', previousToJson); else delete (Object.prototype as Record<string, unknown>).toJSON;
        if (previousThen) define(Object.prototype, 'then', previousThen); else delete (Object.prototype as Record<string, unknown>).then;
    }
    const result = available(captured!);
    assert.deepEqual(result.citations.map((item) => ({ ...item })), baseline.citations.map((item) => ({ ...item })));
    assert.equal(reads, 0); assert.equal(traps, 0); assert.equal(result instanceof Promise, false);
    let unhandled = 0; const listener = () => { unhandled += 1; }; process.on('unhandledRejection', listener);
    try { await new Promise<void>((resolve) => setImmediate(resolve)); } finally { process.off('unhandledRejection', listener); }
    assert.equal(unhandled, 0);
});
