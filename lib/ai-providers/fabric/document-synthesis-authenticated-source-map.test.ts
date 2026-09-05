/* @Codex */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createDocumentSynthesisAuthenticatedSourceMap } from './document-synthesis-authenticated-source-map';

const handle = `dsh_${'a'.repeat(32)}`; const freshness = '2026-08-25T10:00:00.000Z';
const output = () => ({ schemaVersion: 'mediflow.ai.extract.v1', task: 'document_synthesis', summary: 'Synthetic summary.', data: { qualityLevel: 'green', qualityReason: 'Synthetic reason.', medications: ['Synthetic one', 'Synthetic two'], diagnoses: [{ code: 'SYN-1', description: 'Synthetic diagnosis', system: 'ICD-11' }], problemStatements: [{ label: 'Synthetic problem', icdQuery: 'SYN-2', confidence: 'high', evidence: 'Synthetic evidence' }], therapyCandidates: [{ drugMention: 'Synthetic therapy', drugQuery: 'synthetic', confidence: 'medium', evidence: 'Synthetic evidence' }], servicePrescriptions: [{ serviceName: 'Synthetic service', confidence: 'low', evidence: 'Synthetic evidence', items: [{ serviceName: 'Synthetic item', confidence: 'high', evidence: 'Synthetic evidence' }] }] } });
const paths = ['summary', 'data.qualityLevel', 'data.qualityReason', 'data.medications[0]', 'data.medications[1]', 'data.diagnoses[0]', 'data.problemStatements[0]', 'data.therapyCandidates[0]', 'data.servicePrescriptions[0]', 'data.servicePrescriptions[0].items[0]'];
const configuration = () => ({ document: { handle, revision: 7, freshness }, sources: [1, 2, 3].map((number) => ({ sourceId: `source.synthetic.${number}`, sourceRef: `document_source_synthetic_${String(number).padStart(16, '0')}`, digestSha256: String(number).repeat(64) })) });
const candidate = () => { const value = output(); return { documentHandle: handle, revision: 7, freshness, output: value, outputSha256: createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex'), citations: paths.map((claimPath, index) => ({ claimPath, sourceIds: index === 0 ? ['source.synthetic.2', 'source.synthetic.1'] : [`source.synthetic.${index % 3 + 1}`] })) }; };
const deny = (service: ReturnType<typeof createDocumentSynthesisAuthenticatedSourceMap>, value: unknown, code?: string) => { const result = service.map(value); assert.equal(result.status, 'denied'); assert.equal(result.sourceMap, null); assert.equal(result.binding, null); if (code) assert.equal(result.code, code); };

test('composes C0 claim order with the exact S1 owner binding', () => {
    const service = createDocumentSynthesisAuthenticatedSourceMap(configuration()); const result = service.map(candidate());
    assert.equal(result.status, 'available'); if (result.status !== 'available') return;
    assert.deepEqual(result.sourceMap.claims.map((claim) => claim.claimPath), paths);
    assert.deepEqual(result.sourceMap.claims[0]!.sourceIds, ['source.synthetic.2', 'source.synthetic.1']);
    assert.deepEqual(result.binding.sources.map((source) => source.sourceId), ['source.synthetic.2', 'source.synthetic.1', 'source.synthetic.3']);
    for (const value of [service, result, result.sourceMap, result.binding, ...result.sourceMap.claims, ...result.binding.sources]) { assert.equal(Object.getPrototypeOf(value), null); assert.equal(Object.isFrozen(value), true); }
    for (const value of [result.sourceMap.claims, result.binding.sources, result.sourceMap.claims[0]!.sourceIds]) assert.equal(Object.isFrozen(value), true);
    assert.equal('token' in service, false); assert.equal('token' in result, false);
    assert.equal(result.reviewOnly, true); assert.equal(result.writesPerformed, 0); assert.equal(result.applyPolicy, 'none');
});

test('denies reordered C0 claims, unknown or duplicate sources, document drift, stale digest and terminal disposal', () => {
    const service = createDocumentSynthesisAuthenticatedSourceMap(configuration()); const reordered = candidate(); reordered.citations.reverse(); deny(service, reordered);
    const unknown = candidate(); unknown.citations[0]!.sourceIds = ['source.synthetic.unknown']; deny(service, unknown, 'source_unknown');
    const duplicate = candidate(); duplicate.citations[0]!.sourceIds = ['source.synthetic.1', 'source.synthetic.1']; deny(service, duplicate);
    for (const [key, value, code] of [['documentHandle', 'dsh_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'document_mismatch'], ['revision', 8, 'revision_mismatch'], ['freshness', '2026-08-25T10:01:00.000Z', 'freshness_mismatch']] as const) { const drift = candidate() as Record<string, unknown>; drift[key] = value; deny(service, drift, code); }
    const stale = candidate(); stale.outputSha256 = '0'.repeat(64); deny(service, stale); service.dispose(); deny(service, candidate(), 'binding_disposed');
});

test('isolates configuration and rejects forged, ambient and hostile candidate shapes without reads or traps', () => {
    const config = configuration(); const service = createDocumentSynthesisAuthenticatedSourceMap(config); config.document.revision = 8; config.sources[0]!.sourceId = 'source.synthetic.changed'; assert.equal(service.map(candidate()).status, 'available');
    const forged = { ...candidate(), token: {}, binding: {} }; deny(service, forged);
    for (const key of ['authority', 'provider', 'venue', 'egress', 'apply', 'inputContent', 'rawSource']) { const value = candidate() as Record<string, unknown>; value[key] = 'forbidden'; deny(service, value); }
    let reads = 0; const accessor = candidate(); Object.defineProperty(accessor, 'output', { enumerable: true, get() { reads += 1; return output(); } });
    const proxy = new Proxy(candidate(), { ownKeys() { reads += 1; throw new Error('trap'); } }); const custom = Object.assign(Object.create({ inherited: true }), candidate());
    const hidden = candidate(); Object.defineProperty(hidden, 'output', { enumerable: false, value: output() }); const symbol = candidate(); (symbol as Record<PropertyKey, unknown>)[Symbol('x')] = true; const sparse = candidate(); delete sparse.citations[0];
    for (const value of [accessor, proxy, custom, hidden, symbol, sparse]) deny(service, value); assert.equal(reads, 0);
});
