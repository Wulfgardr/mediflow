/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { normalizeDocumentSynthesisProviderResponse } from './document-synthesis-provider-response.ts';

const output = () => ({
    schemaVersion: 'mediflow.ai.extract.v1', task: 'document_synthesis', summary: 'Synthetic document review.',
    data: {
        qualityLevel: 'green', medications: ['Synthetic medicine'], diagnoses: [], problemStatements: [], therapyCandidates: [], servicePrescriptions: [],
    },
});
const response = (content = JSON.stringify(output())) => ({ content });

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
    for (const operation of ['const trimmed = content.trim();', 'duplicateJsonKeys(trimmed)', 'JSON.parse(trimmed)']) {
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
