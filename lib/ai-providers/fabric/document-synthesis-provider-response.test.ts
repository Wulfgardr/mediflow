/* @Codex */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { types } from 'node:util';

import { normalizeDocumentSynthesisProviderResponse } from './document-synthesis-provider-response.ts';

const output = () => ({
    schemaVersion: 'mediflow.ai.extract.v1', task: 'document_synthesis', summary: 'Synthetic document review.',
    data: {
        qualityLevel: 'green', medications: ['Synthetic medicine'], diagnoses: [], problemStatements: [], therapyCandidates: [], servicePrescriptions: [],
    },
});
const response = (content = JSON.stringify(output())) => ({ content });
const ObjectDefineProperty = Object.defineProperty;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;

function denied(value: unknown): void {
    const result = normalizeDocumentSynthesisProviderResponse(value);
    assert.deepEqual({ ...result }, {
        status: 'denied', code: 'output_invalid', value: null, reviewOnly: true, writesPerformed: 0, applyPolicy: 'none',
    });
    assert.equal(Object.getPrototypeOf(result), null);
    assert.equal(Object.isFrozen(result), true);
}

test('normalizes one bounded provider content record through the canonical output contract', () => {
    const source = readFileSync(new URL('./document-synthesis-provider-response.ts', import.meta.url), 'utf8');
    assert.match(source, /^import 'server-only';\n/u);
    assert.match(source, /normalizeDocumentSynthesisOutput/u);
    assert.doesNotMatch(source, /(?:fetch\(|\.chat\(|sqlite|database|receipt|provenance|sourceId|prompt|patient|document identity)/iu);
    const result = normalizeDocumentSynthesisProviderResponse(response());
    assert.equal(result.status, 'available');
    if (result.status !== 'available') return;
    assert.equal(result.value.summary, 'Synthetic document review.');
    assert.equal(result.reviewOnly, true);
    assert.equal(result.writesPerformed, 0);
    assert.equal(result.applyPolicy, 'none');
    assert.equal(Object.getPrototypeOf(result), null);
    assert.equal(Object.getPrototypeOf(result.value), null);
    assert.equal(Object.getPrototypeOf(result.value.data), null);
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.value), true);
    assert.equal(Object.isFrozen(result.value.data), true);
    assert.equal(Object.isFrozen(result.value.data.medications), true);
    assert.throws(() => { (result.value.data.medications as string[]).push('mutation'); });
});

test('rejects malformed, empty, oversize, multiple, trailing, duplicate, incomplete, and non-contract JSON', () => {
    const oversized = ' '.repeat(262_145);
    for (const content of [
        '', '   ', oversized, '{', '{"schemaVersion":"mediflow.ai.extract.v1"}',
        `${JSON.stringify(output())}${JSON.stringify(output())}`, `${JSON.stringify(output())} trailing`,
        '{"schemaVersion":"mediflow.ai.extract.v1","schemaVersion":"mediflow.ai.extract.v1","task":"document_synthesis","summary":"Synthetic document review.","data":{"qualityLevel":"green","medications":[],"diagnoses":[],"problemStatements":[],"therapyCandidates":[],"servicePrescriptions":[]}}',
        JSON.stringify({ ...output(), extra: true }), JSON.stringify({ ...output(), data: { ...output().data, qualityLevel: 'blue' } }),
        JSON.stringify({ ...output(), data: { ...output().data, medications: [null] } }),
        '{"schemaVersion":"mediflow.ai.extract.v1","task":"document_synthesis","summary":"Synthetic document review.","data":{"qualityLevel":"green","medications":[,],"diagnoses":[],"problemStatements":[],"therapyCandidates":[],"servicePrescriptions":[]}}',
        JSON.stringify({ schemaVersion: 'mediflow.ai.extract.v1', task: 'document_synthesis', summary: 'Synthetic document review.' }),
]) denied(response(content));
});

test('rejects canonical JSON whose raw provider content exceeds the bound only through whitespace framing', () => {
    const canonical = JSON.stringify(output());
    const padding = ' '.repeat(262_145 - canonical.length);
    for (const content of [
        `${canonical}${padding}`,
        `${padding}${canonical}`,
        `${padding.slice(0, Math.floor(padding.length / 2))}${canonical}${padding.slice(Math.floor(padding.length / 2))}`,
    ]) denied(response(content));

    const source = readFileSync(new URL('./document-synthesis-provider-response.ts', import.meta.url), 'utf8');
    const parseOneJsonObject = source.indexOf('function parseOneJsonObject');
    const rawSizeGuard = source.indexOf('if (content.length > MAX_CONTENT_CHARS) return null;', parseOneJsonObject);
    assert.ok(rawSizeGuard > parseOneJsonObject);
    for (const operation of ['const trimmed =', 'duplicateJsonKeys(trimmed)', 'ReflectApply(JSONParse, JSON_OBJECT, [trimmed])']) {
        assert.ok(rawSizeGuard < source.indexOf(operation, parseOneJsonObject));
    }
});

test('rejects non-data-only response records before accessors, proxies, symbols, prototypes, arrays, or thenables run', () => {
    let traps = 0;
    const accessor = {}; Object.defineProperty(accessor, 'content', { enumerable: true, get() { traps += 1; return JSON.stringify(output()); } });
    const nonEnumerable = response(); Object.defineProperty(nonEnumerable, 'content', { enumerable: false });
    const symbolic = { ...response(), [Symbol('synthetic')]: true };
    const custom = Object.assign(Object.create({ inherited: true }), response());
    const transparent = new Proxy(response(), {});
    const throwing = new Proxy(response(), { ownKeys() { traps += 1; throw new Error('trap'); } });
    const revoked = Proxy.revocable(response(), {}); revoked.revoke();
    const thenable = response(); Object.defineProperty(thenable, 'then', { enumerable: true, get() { traps += 1; throw new Error('then'); } });
    for (const value of [null, [], { content: 1 }, accessor, nonEnumerable, symbolic, custom, transparent, throwing, revoked.proxy, thenable]) denied(value);
    assert.equal(traps, 0);
});

test('has no ambient async work or post-return drift for hostile inputs', async () => {
    let traps = 0;
    const hostile = { content: JSON.stringify(output()) };
    Object.defineProperty(hostile, 'then', { enumerable: true, get() { traps += 1; throw new Error('ambient then'); } });
    const unhandled: unknown[] = [];
    const observe = (reason: unknown) => { unhandled.push(reason); };
    process.on('unhandledRejection', observe);
    try {
        denied(hostile);
        await new Promise<void>((resolve) => setImmediate(resolve));
    } finally { process.off('unhandledRejection', observe); }
    assert.equal(traps, 0);
    assert.deepEqual(unhandled, []);
});

test('rejects a transparent provider-response proxy without traps after types.isProxy is poisoned post-import', () => {
    const descriptor = Object.getOwnPropertyDescriptor(types, 'isProxy');
    assert.ok(descriptor);
    let traps = 0;
    const transparent = new Proxy(response(), {
        getOwnPropertyDescriptor(target, key) { traps += 1; return Reflect.getOwnPropertyDescriptor(target, key); },
        ownKeys(target) { traps += 1; return Reflect.ownKeys(target); },
        getPrototypeOf(target) { traps += 1; return Reflect.getPrototypeOf(target); },
    });
    Object.defineProperty(types, 'isProxy', { ...descriptor, value: () => false });
    try {
        denied(transparent);
    } finally {
        Object.defineProperty(types, 'isProxy', descriptor);
    }
    assert.equal(traps, 0);
});

test('uses captured parser intrinsics after post-import poisoning without traps or deferred work', async () => {
    const original = response();
    let hostileCalls = 0;
    const poison = () => { hostileCalls += 1; throw new Error('post-import intrinsic'); };
    const targets: readonly [object, PropertyKey][] = [
        [types, 'isProxy'],
        [Object, 'create'], [Object, 'defineProperty'], [Object, 'freeze'], [Object, 'getOwnPropertyDescriptor'], [Object, 'getPrototypeOf'], [Object, 'hasOwn'],
        [Reflect, 'apply'], [Reflect, 'ownKeys'], [Array, 'isArray'], [Array.prototype, 'at'], [Array.prototype, 'map'], [Array.prototype, 'pop'], [Array.prototype, 'push'],
        [String.prototype, 'slice'], [String.prototype, 'trim'], [RegExp.prototype, 'test'], [JSON, 'parse'], [Set.prototype, 'add'], [Set.prototype, 'has'],
    ];
    const descriptors: Array<readonly [object, PropertyKey, PropertyDescriptor]> = [];
    for (let index = 0; index < targets.length; index += 1) {
        const [target, key] = targets[index]!;
        const descriptor = ObjectGetOwnPropertyDescriptor(target, key);
        assert.ok(descriptor);
        descriptors[index] = [target, key, descriptor];
    }
    for (let index = 0; index < descriptors.length; index += 1) {
        const [target, key, descriptor] = descriptors[index]!;
        ObjectDefineProperty(target, key, { ...descriptor, value: poison });
    }
    let result: ReturnType<typeof normalizeDocumentSynthesisProviderResponse> | undefined;
    const unhandled: unknown[] = [];
    const observe = (reason: unknown) => { unhandled[unhandled.length] = reason; };
    process.on('unhandledRejection', observe);
    try {
        result = normalizeDocumentSynthesisProviderResponse(original);
    } finally {
        for (let index = descriptors.length - 1; index >= 0; index -= 1) {
            const [target, key, descriptor] = descriptors[index]!;
            ObjectDefineProperty(target, key, descriptor);
        }
    }
    try { await new Promise<void>((resolve) => setImmediate(resolve)); } finally { process.off('unhandledRejection', observe); }
    assert.equal(hostileCalls, 0);
    assert.deepEqual(unhandled, []);
    assert.equal(result?.status, 'available');
});

test('returns an inert JSON-safe output after Object and Array prototype toJSON poisoning', () => {
    const baseline = normalizeDocumentSynthesisProviderResponse(response());
    assert.equal(baseline.status, 'available');
    const expected = JSON.stringify(baseline);
    const objectToJson = ObjectGetOwnPropertyDescriptor(Object.prototype, 'toJSON');
    const arrayToJson = ObjectGetOwnPropertyDescriptor(Array.prototype, 'toJSON');
    let reads = 0;
    ObjectDefineProperty(Object.prototype, 'toJSON', { configurable: true, get() { reads += 1; throw new Error('object toJSON'); } });
    ObjectDefineProperty(Array.prototype, 'toJSON', { configurable: true, get() { reads += 1; throw new Error('array toJSON'); } });
    let rendered: string | undefined;
    try {
        rendered = JSON.stringify(baseline);
    } finally {
        if (objectToJson) ObjectDefineProperty(Object.prototype, 'toJSON', objectToJson); else Reflect.deleteProperty(Object.prototype, 'toJSON');
        if (arrayToJson) ObjectDefineProperty(Array.prototype, 'toJSON', arrayToJson); else Reflect.deleteProperty(Array.prototype, 'toJSON');
    }
    assert.equal(reads, 0);
    assert.equal(rendered, expected);
});

test('does not read a post-import Array iterator in an isolated runtime', () => {
    const moduleUrl = new URL('./document-synthesis-provider-response.ts', import.meta.url).href;
    const loaderUrl = new URL('../../../scripts/register-strip-types-loader.mjs', import.meta.url).pathname;
    const content = JSON.stringify(output());
    const program = [
        `const module = await import(${JSON.stringify(moduleUrl)});`,
        'const descriptor = Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator);',
        'let reads = 0;',
        "Object.defineProperty(Array.prototype, Symbol.iterator, { ...descriptor, value() { reads += 1; throw new Error('iterator poison'); } });",
        'let result;',
        `try { result = module.normalizeDocumentSynthesisProviderResponse({ content: ${JSON.stringify(content)} }); } finally { Object.defineProperty(Array.prototype, Symbol.iterator, descriptor); }`,
        "if (result.status !== 'available' || reads !== 0) process.exitCode = 1;",
    ].join('\n');
    const child = spawnSync(process.execPath, ['--experimental-strip-types', '--import', loaderUrl, '--input-type=module', '--eval', program], { encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr || child.stdout);
});
