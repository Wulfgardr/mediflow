/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { types } from 'node:util';

import { parseDocumentSynthesisProviderEnvelope, resolveDocumentSynthesisProviderEnvelope } from './document-synthesis-provider-envelope.ts';

const body = (value: Record<string, unknown> = {}) => JSON.stringify({ output: { summary: 'synthetic' }, citations: [{ ref: 'S1' }], claims: { safe: true }, ...value });
const response = (content = body()) => ({ content });
function denied(value: unknown): void { const result = parseDocumentSynthesisProviderEnvelope(value); assert.deepEqual({ ...result }, { status: 'denied', code: 'response_invalid', token: null, reviewOnly: true, writesPerformed: 0, applyPolicy: 'none' }); }

function deepFrozenNull(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    assert.equal(Object.isFrozen(value), true); assert.equal(Object.getPrototypeOf(value), null);
    if (Array.isArray(value)) for (let index = 0; index < value.length; index += 1) deepFrozenNull(value[index]);
    else for (const key of Object.keys(value)) deepFrozenNull((value as Record<string, unknown>)[key]);
}

test('frames one exact raw provider object into an opaque review-only token', () => {
    const source = readFileSync(new URL('./document-synthesis-provider-envelope.ts', import.meta.url), 'utf8');
    assert.match(source, /^import 'server-only';\n/u); assert.doesNotMatch(source, /(?:fetch\(|sqlite|database|receipt|provenance|sourceSet|prompt|patient)/iu);
    const result = parseDocumentSynthesisProviderEnvelope(response()); assert.equal(result.status, 'available'); if (result.status !== 'available') return;
    assert.deepEqual({ ...result, token: undefined }, { status: 'available', code: null, token: undefined, reviewOnly: true, writesPerformed: 0, applyPolicy: 'none' });
    assert.equal(Object.getPrototypeOf(result), null); assert.equal(Object.isFrozen(result), true); assert.equal(Object.getPrototypeOf(result.token), null); assert.equal(Object.isFrozen(result.token), true);
    const snapshot = resolveDocumentSynthesisProviderEnvelope(result.token); assert.equal(JSON.stringify(snapshot), body()); deepFrozenNull(snapshot); assert.throws(() => { Object.defineProperty(snapshot!, 'output', { value: null }); });
});

test('rejects malformed framing, duplicate keys at every depth, root drift, and hostile sizes', () => {
    const duplicateEscaped = '{"output":{},"citations":[],"claims":{"x":1,"\\u0078":2}}';
    const nested = '{"output":{"a":{"x":1,"x":2}},"citations":[],"claims":{}}';
    for (const content of ['', ' ', '{', '[]', 'null', `${body()}${body()}`, `${body()} trailing`, 'leading ' + body(), duplicateEscaped, nested,
        '{"output":{},"output":{},"citations":[],"claims":{}}', body({ extra: true }), JSON.stringify({ output: {}, citations: [] }), ' '.repeat(262_145), body({ output: Array.from({ length: 16_385 }, () => 0) })]) denied(response(content));
});

test('rejects accessors, inherited/custom/null prototypes, symbols, proxies, arrays, thenables, and does not trigger traps', () => {
    let traps = 0; const accessor = {}; Object.defineProperty(accessor, 'content', { enumerable: true, get() { traps += 1; return body(); } });
    const nonEnumerable = response(); Object.defineProperty(nonEnumerable, 'content', { enumerable: false }); const custom = Object.assign(Object.create({ inherited: true }), response());
    const thenable = response(); Object.defineProperty(thenable, 'then', { enumerable: true, get() { traps += 1; throw new Error('then'); } });
    const throwing = new Proxy(response(), { ownKeys() { traps += 1; throw new Error('trap'); } });
    for (const value of [null, [], accessor, nonEnumerable, custom, Object.assign(Object.create(null), response()), { ...response(), [Symbol('x')]: true }, new Proxy(response(), {}), throwing, thenable]) denied(value);
    assert.equal(traps, 0);
});

test('accepts no forged, cloned, spread, structured-cloned, proxied, or cross-module token', async () => {
    const result = parseDocumentSynthesisProviderEnvelope(response()); assert.equal(result.status, 'available'); if (result.status !== 'available') return;
    for (const token of [{}, { ...result.token }, structuredClone(result.token), new Proxy(result.token, {}), Object.create(null)]) assert.equal(resolveDocumentSynthesisProviderEnvelope(token), null);
    const source = readFileSync(new URL('./document-synthesis-provider-envelope.ts', import.meta.url), 'utf8').replace("import 'server-only';", ''); const typescript = await import('typescript');
    const code = typescript.transpileModule(source, { compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext } }).outputText; const foreign = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`); const foreignResult = foreign.parseDocumentSynthesisProviderEnvelope(response());
    assert.equal(foreignResult.status, 'available'); if (foreignResult.status === 'available') { assert.equal(resolveDocumentSynthesisProviderEnvelope(foreignResult.token), null); assert.equal(foreign.resolveDocumentSynthesisProviderEnvelope(result.token), null); }
    assert.notEqual(resolveDocumentSynthesisProviderEnvelope(result.token), null);
});

test('keeps the resolved snapshot inert under inherited toJSON and iterator poisons', () => {
    const result = parseDocumentSynthesisProviderEnvelope(response()); assert.equal(result.status, 'available'); if (result.status !== 'available') return;
    const objectToJson = Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON'); const iterator = Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator); let reads = 0;
    Object.defineProperty(Object.prototype, 'toJSON', { configurable: true, get() { reads += 1; throw new Error('toJSON'); } }); Object.defineProperty(Array.prototype, Symbol.iterator, { ...iterator, value() { reads += 1; throw new Error('iterator'); } });
    let rendered: string | undefined; try { rendered = JSON.stringify(resolveDocumentSynthesisProviderEnvelope(result.token)); } finally { if (objectToJson) Object.defineProperty(Object.prototype, 'toJSON', objectToJson); else Reflect.deleteProperty(Object.prototype, 'toJSON'); Object.defineProperty(Array.prototype, Symbol.iterator, iterator!); }
    assert.equal(reads, 0); assert.equal(rendered, body());
});

test('uses captured parser and token intrinsics after poisoning without getter, trap, then, or post-return work', async () => {
    const targets: readonly [object, PropertyKey][] = [[types, 'isProxy'], [Object, 'create'], [Object, 'defineProperty'], [Object, 'freeze'], [Object, 'getOwnPropertyDescriptor'], [Object, 'getPrototypeOf'], [Object, 'hasOwn'], [Object, 'setPrototypeOf'], [Reflect, 'apply'], [Reflect, 'ownKeys'], [Array, 'isArray'], [JSON, 'parse'], [String.prototype, 'slice'], [Set.prototype, 'add'], [Set.prototype, 'has']];
    const defineProperty = Object.defineProperty; const descriptors = targets.map(([target, key]) => [target, key, Object.getOwnPropertyDescriptor(target, key)!] as const); let reads = 0; const poison = () => { reads += 1; throw new Error('ambient poison'); };
    for (const [target, key, descriptor] of descriptors) defineProperty(target, key, { ...descriptor, value: poison });
    let result: ReturnType<typeof parseDocumentSynthesisProviderEnvelope>; try { result = parseDocumentSynthesisProviderEnvelope(response()); } finally { for (let index = descriptors.length - 1; index >= 0; index -= 1) defineProperty(descriptors[index]![0], descriptors[index]![1], descriptors[index]![2]); }
    await new Promise<void>((resolve) => setImmediate(resolve)); assert.equal(reads, 0); assert.equal(result!.status, 'available');
});
