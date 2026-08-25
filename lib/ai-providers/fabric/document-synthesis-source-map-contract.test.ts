/* @Codex */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createDocumentSynthesisSourceMapContract } from './document-synthesis-source-map-contract';

const output = () => ({
    schemaVersion: 'mediflow.ai.extract.v1', task: 'document_synthesis', summary: 'Synthetic summary.',
    data: {
        qualityLevel: 'green', qualityReason: 'Synthetic quality reason.', medications: ['Synthetic medicine', 'Synthetic medicine two'],
        diagnoses: [{ code: 'SYN-1', description: 'Synthetic diagnosis', system: 'ICD-11' }],
        problemStatements: [{ label: 'Synthetic problem', icdQuery: 'SYN-2', confidence: 'high', evidence: 'Synthetic evidence' }],
        therapyCandidates: [{ drugMention: 'Synthetic therapy', drugQuery: 'synthetic', confidence: 'medium', evidence: 'Synthetic evidence' }],
        servicePrescriptions: [{ serviceName: 'Synthetic service', confidence: 'low', evidence: 'Synthetic evidence', items: [{ serviceName: 'Synthetic item', confidence: 'high', evidence: 'Synthetic evidence' }] }],
    },
});
const paths = ['summary', 'data.qualityLevel', 'data.qualityReason', 'data.medications[0]', 'data.medications[1]', 'data.diagnoses[0]', 'data.problemStatements[0]', 'data.therapyCandidates[0]', 'data.servicePrescriptions[0]', 'data.servicePrescriptions[0].items[0]'];
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
const request = () => {
    const value = output();
    return { output: value, outputSha256: hash(value), citations: paths.map((claimPath, index) => ({ claimPath, sourceIds: [`source.synthetic.${index + 1}`] })) };
};
const deny = (value: unknown) => {
    const result = createDocumentSynthesisSourceMapContract().map(value);
    assert.equal(result.status, 'denied'); assert.equal(result.code, 'input_invalid'); assert.equal(result.sourceMap, null);
    assert.equal(result.reviewOnly, true); assert.equal(result.writesPerformed, 0); assert.equal(result.applyPolicy, 'none'); assert.equal(Object.getPrototypeOf(result), null);
};

test('maps every normalized document-synthesis claim to one immutable review-only citation list', () => {
    const source = readFileSync(new URL('./document-synthesis-source-map-contract.ts', import.meta.url), 'utf8');
    assert.match(source, /^import 'server-only';\n/u);
    const result = createDocumentSynthesisSourceMapContract().map(request());
    assert.equal(result.status, 'available');
    if (result.status !== 'available') return;
    assert.deepEqual(result.sourceMap.claims.map((item) => item.claimPath), paths);
    assert.equal(result.sourceMap.outputSha256, request().outputSha256);
    assert.equal(result.sourceMap.schemaVersion, 'mediflow.document-synthesis.source-map.v1');
    assert.equal(result.reviewOnly, true); assert.equal(result.writesPerformed, 0); assert.equal(result.applyPolicy, 'none');
    for (const value of [result, result.sourceMap, ...result.sourceMap.claims]) assert.equal(Object.getPrototypeOf(value), null);
    assert.equal(Object.isFrozen(result.sourceMap.claims[0]!.sourceIds), true);
});

test('denies missing, extra, duplicate, invalid, empty and stale citation bindings', () => {
    const reordered = request(); reordered.citations.reverse(); deny(reordered);
    const missing = request(); missing.citations.pop(); deny(missing);
    const extra = request(); extra.citations.push({ claimPath: 'data.unknown', sourceIds: ['source.synthetic.extra'] }); deny(extra);
    const duplicate = request(); duplicate.citations[1] = { claimPath: 'summary', sourceIds: ['source.synthetic.2'] }; deny(duplicate);
    const badSource = request(); badSource.citations[0]!.sourceIds = ['source.invalid', 'source.invalid']; deny(badSource);
    const empty = request(); empty.citations[0]!.sourceIds = []; deny(empty);
    const stale = request(); stale.output.data.medications.reverse(); deny(stale);
    const changed = request(); changed.output.summary = 'Changed synthetic summary.'; deny(changed);
});

test('denies unrecognized authority, raw source and execution fields', () => {
    for (const key of ['provider', 'model', 'venue', 'egress', 'prompt', 'authority', 'writesPerformed', 'applyPolicy', 'patientId', 'rawSource', 'binding', 'token']) {
        const value = request() as Record<string, unknown>; value[key] = 'forbidden'; deny(value);
    }
    const nested = request(); (nested.citations[0] as Record<string, unknown>).sourceRef = 'raw'; deny(nested);
});

test('denies hostile inputs before getter, proxy, symbol, sparse or ambient-then observation', () => {
    let reads = 0;
    const accessor = request(); Object.defineProperty(accessor, 'output', { enumerable: true, get() { reads += 1; return output(); } });
    const proxy = new Proxy(request(), { ownKeys() { reads += 1; throw new Error('trap'); } });
    const custom = Object.assign(Object.create({ inherited: true }), request());
    const sparse = request(); delete sparse.citations[0];
    const hidden = request(); Object.defineProperty(hidden.citations[0]!, 'sourceIds', { enumerable: false, value: ['source.synthetic.1'] });
    const symbol = request(); (symbol as Record<PropertyKey, unknown>)[Symbol('x')] = true;
    for (const value of [accessor, proxy, custom, sparse, hidden, symbol]) deny(value);
    const prior = Object.getOwnPropertyDescriptor(Object.prototype, 'then');
    try { Object.defineProperty(Object.prototype, 'then', { configurable: true, get() { reads += 1; return undefined; } }); deny({ ...request(), outputSha256: '0'.repeat(64) }); }
    finally { if (prior) Object.defineProperty(Object.prototype, 'then', prior); else delete (Object.prototype as { then?: unknown }).then; }
    assert.equal(reads, 0);
});
