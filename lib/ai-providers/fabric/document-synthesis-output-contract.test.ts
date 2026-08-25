/* @Codex */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDocumentSynthesisOutputContract } from './document-synthesis-output-contract';

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
    assert.deepEqual(createDocumentSynthesisOutputContract().normalize(value), {
        status: 'denied', code: 'output_invalid', value: null, reviewOnly: true, writesPerformed: 0, applyPolicy: 'none',
    });
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
