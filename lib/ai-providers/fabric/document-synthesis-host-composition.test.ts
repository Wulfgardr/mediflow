/* @Codex */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
    createDocumentSynthesisHostComposition,
    DocumentSynthesisHostCompositionConfigurationError,
} from './document-synthesis-host-composition';

const freshness = '2026-08-25T12:00:00.000Z';
const paths = ['summary', 'data.qualityLevel', 'data.qualityReason', 'data.medications[0]', 'data.medications[1]', 'data.diagnoses[0]', 'data.problemStatements[0]', 'data.therapyCandidates[0]', 'data.servicePrescriptions[0]', 'data.servicePrescriptions[0].items[0]'];
const output = () => ({ schemaVersion: 'mediflow.ai.extract.v1', task: 'document_synthesis', summary: 'Synthetic summary.', data: { qualityLevel: 'green', qualityReason: 'Synthetic reason.', medications: ['Synthetic one', 'Synthetic two'], diagnoses: [{ code: 'SYN-1', description: 'Synthetic diagnosis', system: 'ICD-11' }], problemStatements: [{ label: 'Synthetic problem', icdQuery: 'SYN-2', confidence: 'high', evidence: 'Synthetic evidence' }], therapyCandidates: [{ drugMention: 'Synthetic therapy', drugQuery: 'synthetic', confidence: 'medium', evidence: 'Synthetic evidence' }], servicePrescriptions: [{ serviceName: 'Synthetic service', confidence: 'low', evidence: 'Synthetic evidence', items: [{ serviceName: 'Synthetic item', confidence: 'high', evidence: 'Synthetic evidence' }] }] } });
const candidate = () => { const value = output(); return { output: value, outputSha256: createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex'), citations: paths.map((claimPath, index) => ({ claimPath, sourceIds: [`source.synthetic.${index % 3 + 1}`] })) }; };

function composition(disposition: 'deterministic' | 'generative', current = () => ({ revision: 7, freshness, disposition })) {
    return createDocumentSynthesisHostComposition({
        authority: { patientRef: 'patient.canonical-1234567890', document: { revision: 7, freshness }, disposition, provenanceRef: 'provenance_0123456789abcdef', receiptRef: 'receipt_0123456789abcdef' },
        currentness: current,
        sources: [1, 2, 3].map((number) => ({ sourceId: `source.synthetic.${number}`, sourceRef: `document_source_synthetic_${String(number).padStart(16, '0')}`, digestSha256: String(number).repeat(64) })),
        clock: () => Date.parse('2026-08-25T11:00:00.000Z'), entropy: () => Uint8Array.from({ length: 16 }, (_, index) => index),
    });
}

test('both dispositions stage C1 then publish one frozen review-only host result', () => {
    for (const disposition of ['deterministic', 'generative'] as const) {
        const service = composition(disposition); const issued = service.issue(); const result = service.consumeAndMap(candidate());
        assert.equal(issued.status, 'issued'); assert.equal(result.status, 'available'); if (result.status !== 'available') continue;
        assert.equal(result.metadata.disposition, disposition); assert.equal(result.metadata.review, 'review_only'); assert.equal(result.reviewOnly, true);
        assert.equal(result.writesPerformed, 0); assert.equal(result.applyPolicy, 'none'); assert.equal(JSON.stringify(result).includes('patient.canonical'), false);
        for (const value of [service, issued, result, result.metadata, result.sourceMap, result.binding, ...result.sourceMap.claims, ...result.binding.sources]) { assert.equal(Object.isFrozen(value), true); assert.equal(Object.getPrototypeOf(value), null); }
    }
});

test('a C1 denial does not consume authority; stale currentness is terminal and never publishes', () => {
    let calls = 0; const service = composition('deterministic', () => { calls += 1; return { revision: 7, freshness, disposition: 'deterministic' as const }; }); service.issue();
    const invalid = candidate(); invalid.outputSha256 = '0'.repeat(64); assert.equal(service.consumeAndMap(invalid).code, 'input_invalid'); assert.equal(calls, 0);
    assert.equal(service.consumeAndMap(candidate()).status, 'available');
    const stale = composition('generative', () => ({ revision: 8, freshness, disposition: 'generative' as const })); stale.issue();
    assert.equal(stale.consumeAndMap(candidate()).code, 'currentness_mismatch'); assert.equal(stale.consumeAndMap(candidate()).code, 'handle_consumed');
});

test('denies caller identity, raw execution, forged, accessor, proxy, thenable, reentry, replay, and disposal', () => {
    const service = composition('deterministic'); service.issue();
    for (const key of ['patientRef', 'documentHandle', 'revision', 'freshness', 'rawText', 'prompt', 'provider', 'model', 'venue', 'egress', 'authority', 'applyPolicy']) {
        assert.equal(service.consumeAndMap({ ...candidate(), [key]: 'forbidden' }).code, 'input_invalid');
    }
    let reads = 0; const accessor = candidate(); Object.defineProperty(accessor, 'output', { enumerable: true, get() { reads += 1; return output(); } });
    for (const value of [accessor, new Proxy(candidate(), {}), Promise.resolve(candidate()), { ...candidate(), then() { return undefined; } }]) assert.equal(service.consumeAndMap(value).code, 'input_invalid');
    assert.equal(reads, 0); assert.equal(service.consumeAndMap(candidate()).status, 'available'); assert.equal(service.consumeAndMap(candidate()).code, 'handle_consumed');
    const disposed = composition('generative'); disposed.issue(); disposed.dispose(); assert.equal(disposed.consumeAndMap(candidate()).code, 'handle_consumed');
    let reentrant: ReturnType<typeof composition> | null = null; reentrant = composition('generative', () => { assert.equal(reentrant?.consumeAndMap(candidate()).code, 'handle_consumed'); return { revision: 7, freshness, disposition: 'generative' as const }; }); reentrant.issue(); assert.equal(reentrant.consumeAndMap(candidate()).code, 'handle_consumed');
});

test('rejects hostile host configuration before it can become authority', () => {
    assert.throws(() => createDocumentSynthesisHostComposition(new Proxy({}, { ownKeys() { throw new Error('synthetic trap'); } })), DocumentSynthesisHostCompositionConfigurationError);
});
