/* @Codex */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { types } from 'node:util';
import { createDocumentSynthesisOutputContract, normalizeDocumentSynthesisOutput } from './document-synthesis-output-contract';

const baseOutput = () => ({
    schemaVersion: 'mediflow.ai.extract.v1',
    task: 'document_synthesis',
    summary: 'Synthetic document review.',
    data: {
        qualityLevel: 'green',
        qualityReason: 'Synthetic source is legible.',
        medications: ['Synthetic medicine'],
        diagnoses: [{ code: 'SYN-1', description: 'Synthetic finding', system: 'ICD-11', evidence: 'Synthetic source', confidence: 'high' }],
        problemStatements: [{ label: 'Synthetic problem', icdQuery: 'SYN-1', confidence: 'medium', evidence: 'Synthetic source', sourceId: 'source.synthetic.1' }],
        therapyCandidates: [{ drugMention: 'Synthetic medicine', drugQuery: 'synthetic', confidence: 'low', evidence: 'Synthetic source', sourceId: 'source.synthetic.1' }],
        servicePrescriptions: [],
    },
});

const denied = (value: unknown) => {
    const result = createDocumentSynthesisOutputContract().normalize(value);
    assert.equal(result.status, 'denied');
    assert.equal(result.code, 'output_invalid');
    assert.equal(result.value, null);
    assert.equal(result.reviewOnly, true);
    assert.equal(result.writesPerformed, 0);
    assert.equal(result.applyPolicy, 'none');
    assert.equal(Object.getPrototypeOf(result), null);
};

test('normalizes deterministic and generative outputs to one immutable review envelope', () => {
    const source = readFileSync(new URL('./document-synthesis-output-contract.ts', import.meta.url), 'utf8');
    assert.match(source, /^import 'server-only';\n/u);
    assert.doesNotMatch(source, /(?:fetch\(|invoke\(|route|sqlite|database)/iu);
    const contract = createDocumentSynthesisOutputContract();
    const deterministic = contract.normalize(baseOutput());
    const generative = contract.normalize(structuredClone(baseOutput()));
    assert.equal(deterministic.status, 'available');
    assert.deepEqual(generative, deterministic);
    if (deterministic.status === 'available') {
        assert.equal(deterministic.value.schemaVersion, 'mediflow.ai.extract.v1');
        assert.equal(deterministic.value.task, 'document_synthesis');
        assert.equal(deterministic.reviewOnly, true);
        assert.equal(Object.isFrozen(deterministic.value), true);
        assert.equal(Object.isFrozen(deterministic.value.data), true);
        assert.equal(Object.isFrozen(deterministic.value.data.diagnoses), true);
        assert.equal(deterministic.value.data.diagnoses[0]?.code, 'SYN-1');
        assert.equal(Object.getPrototypeOf(deterministic), null);
        assert.equal(Object.getPrototypeOf(deterministic.value), null);
        assert.equal(Object.getPrototypeOf(deterministic.value.data), null);
        assert.equal(Object.getPrototypeOf(deterministic.value.data.diagnoses[0]!), null);
        assert.equal(Object.getOwnPropertyDescriptor(deterministic.value.data.diagnoses, 'toJSON')?.value, null);
    }
});

test('rejects legacy, repaired, ambiguous, unknown, provider and authority shapes', () => {
    for (const extra of [
        { legacyContract: true }, { repairedTruncation: true }, { provider: 'ollama' },
        { authority: 'host' }, { applyPolicy: 'apply' }, { writesPerformed: 1 }, { prompt: 'free prompt' },
        { disposition: 'generative' }, { data: { ...baseOutput().data, unknown: true } },
    ]) denied({ ...baseOutput(), ...extra });
    for (const text of [
        JSON.stringify(baseOutput()) + JSON.stringify(baseOutput()),
        '{"task":"document_synthesis","task":"smart_import"}',
        '{"schemaVersion":"mediflow.ai.extract.v1","task":"document_synthesis","data":',
    ]) denied(text);
    denied({ ...baseOutput(), schemaVersion: 'mediflow.ai.extract.v0' });
    denied({ ...baseOutput(), task: 'smart_import' });
});

test('rejects hostile records and arrays before getter or proxy effects', () => {
    let reads = 0;
    const accessor = baseOutput();
    Object.defineProperty(accessor, 'summary', { enumerable: true, get() { reads += 1; return 'unsafe'; } });
    const extraAccessor = baseOutput();
    Object.defineProperty(extraAccessor, 'provider', { enumerable: true, get() { reads += 1; return 'unsafe'; } });
    const proxy = new Proxy(baseOutput(), { get() { reads += 1; throw new Error('trap'); }, ownKeys() { reads += 1; throw new Error('trap'); } });
    const custom = Object.assign(Object.create({ inherited: true }), baseOutput());
    const sparse = baseOutput(); delete sparse.data.medications[0];
    const nonEnumerable = baseOutput(); Object.defineProperty(nonEnumerable.data, 'provider', { value: 'x' });
    const symbol = baseOutput(); (symbol as Record<PropertyKey, unknown>)[Symbol('extra')] = true;
    const thenable = baseOutput(); Object.defineProperty(thenable, 'then', { enumerable: true, get() { reads += 1; return Promise.resolve(); } });
    for (const value of [accessor, extraAccessor, proxy, custom, sparse, nonEnumerable, symbol, thenable]) denied(value);
    assert.equal(reads, 0);
});

test('rejects nested hostile, sparse and out-of-contract values', () => {
    const nestedAccessor = baseOutput();
    Object.defineProperty(nestedAccessor.data.diagnoses[0]!, 'description', { enumerable: true, get() { throw new Error('read'); } });
    const nestedProxy = baseOutput(); nestedProxy.data.problemStatements[0] = new Proxy(nestedProxy.data.problemStatements[0]!, {});
    const nestedExtra = baseOutput(); (nestedExtra.data.therapyCandidates[0] as Record<string, unknown>).authority = 'x';
    const invalidConfidence = baseOutput(); invalidConfidence.data.diagnoses[0]!.confidence = 'unknown' as never;
    const invalidArray = baseOutput(); invalidArray.data.servicePrescriptions = Array.from({ length: 65 }, () => ({})) as never;
    for (const value of [nestedAccessor, nestedProxy, nestedExtra, invalidConfidence, invalidArray]) denied(value);
});

test('captures proxy detection before post-import poisoning with zero transparent proxy traps', () => {
    const descriptor = Object.getOwnPropertyDescriptor(types, 'isProxy');
    assert.ok(descriptor?.configurable);
    let traps = 0;
    const transparent = new Proxy(baseOutput(), {
        getOwnPropertyDescriptor() { traps += 1; return undefined; },
        getPrototypeOf() { traps += 1; return Object.prototype; },
        ownKeys() { traps += 1; return []; },
    });
    try {
        Object.defineProperty(types, 'isProxy', { ...descriptor, value: () => false });
        denied(transparent);
        Object.defineProperty(types, 'isProxy', { ...descriptor, value: () => { throw new Error('poisoned'); } });
        denied(transparent);
    } finally {
        Object.defineProperty(types, 'isProxy', descriptor);
    }
    assert.equal(traps, 0);
});

test('never reads inherited toJSON or JSON stringify while producing a stable canonical envelope', () => {
    const objectToJson = Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON');
    const stringify = Object.getOwnPropertyDescriptor(JSON, 'stringify');
    const capturedStringify = JSON.stringify;
    let reads = 0;
    try {
        Object.defineProperty(Object.prototype, 'toJSON', { configurable: true, get() { reads += 1; return () => 'poison'; } });
        Object.defineProperty(JSON, 'stringify', { ...stringify, value: () => { throw new Error('JSON poison'); } });
        const result = normalizeDocumentSynthesisOutput(baseOutput());
        assert.equal(result.status, 'available');
        assert.equal(reads, 0);
        if (result.status === 'available') {
            assert.equal(Object.getPrototypeOf(result.value), null);
            assert.equal(Object.getPrototypeOf(result.value.data), null);
            assert.equal(Object.getOwnPropertyDescriptor(result.value.data.medications, 'toJSON')?.value, null);
            assert.match(capturedStringify(result.value), /Synthetic medicine/u);
        }
    } finally {
        if (objectToJson) Object.defineProperty(Object.prototype, 'toJSON', objectToJson); else delete (Object.prototype as Record<string, unknown>).toJSON;
        if (stringify) Object.defineProperty(JSON, 'stringify', stringify);
    }
    assert.equal(reads, 0);
});

test('snapshots accepted values without post-return mutation or thenable work', async () => {
    const source = baseOutput();
    const result = normalizeDocumentSynthesisOutput(source);
    assert.equal(result.status, 'available');
    source.summary = 'Mutated after normalization';
    source.data.diagnoses[0]!.description = 'Mutated after normalization';
    let unhandled = 0;
    const listener = () => { unhandled += 1; };
    process.on('unhandledRejection', listener);
    try {
        await new Promise<void>((resolve) => setImmediate(resolve));
    } finally {
        process.off('unhandledRejection', listener);
    }
    assert.equal(unhandled, 0);
    assert.equal(result.status, 'available');
    if (result.status === 'available') {
        assert.equal(result.value.summary, 'Synthetic document review.');
        assert.equal(result.value.data.diagnoses[0]?.description, 'Synthetic finding');
    }
});
