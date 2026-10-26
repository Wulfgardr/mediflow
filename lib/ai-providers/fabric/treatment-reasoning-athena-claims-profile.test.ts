import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { athenaClaimsProfileV1 as profile } from './treatment-reasoning-athena-claims-profile';
import { createTreatmentReasoningAthenaOutputContractV2 } from './treatment-reasoning-athena-output-contract-v2';

const fixture = JSON.parse(readFileSync(new URL('../../../scripts/fixtures/athena-fabric-output-contract.json', import.meta.url), 'utf8'));
const config = { allowedEvidenceRefs: fixture.allowedEvidenceRefs, attestation: { schema: 'mediflow.ai.treatment-reasoning-athena-attestation.v1', readiness: 'available_unqualified', provider: 'athena_mlx', venue: 'local_process', egress: 'none', receiptRef: 'receipt.synthetic', provenanceRef: 'provenance.synthetic' } };
function producer() {
    const value = structuredClone(fixture.expectedOutput);
    const pair = (path: string) => { const binding = value.sourceBindings.find((item: { claimPath: string }) => item.claimPath === path)!; return { claim: binding.claim, evidenceRefs: binding.evidenceRefs }; };
    return { schemaVersion: profile.id, task: value.task, summary: pair('summary'), data: { ...value.data,
        recommendation: pair('data.recommendation'), reasoning: value.data.reasoning.map((_: unknown, i: number) => pair(`data.reasoning.${i}`)), caveats: value.data.caveats.map((_: unknown, i: number) => pair(`data.caveats.${i}`)) } };
}
const decode = (value: unknown) => profile.normalize(JSON.stringify(value), config);
const deny = (value: unknown) => { const result = decode(value); assert.equal(result.status, 'denied'); assert.equal(result.value, null); assert.equal(result.sourceBindings, null); assert.equal(result.writesPerformed, 0); };

test('maps every field and binding exactly to the frozen V2 expectation, preserving text, order and authority', () => {
    const expected = createTreatmentReasoningAthenaOutputContractV2(config).normalize(fixture.expectedOutput);
    assert.equal(expected.status, 'accepted'); assert.deepEqual(decode(producer()), expected);
    const value = producer(); value.data.reasoning.push({ claim: 'Secondo ragionamento indipendente.', evidenceRefs: [fixture.allowedEvidenceRefs[1]] });
    value.data.caveats.push({ claim: 'Secondo limite indipendente.', evidenceRefs: [fixture.allowedEvidenceRefs[0]] });
    const actual = decode(value); assert.equal(actual.status, 'accepted');
    if (actual.status === 'accepted') {
        assert.deepEqual(actual.value.data.reasoning, value.data.reasoning.map((x: { claim: string }) => x.claim));
        assert.deepEqual(actual.sourceBindings.map(x => x.evidenceRefs), [value.summary, value.data.recommendation, ...value.data.reasoning, ...value.data.caveats].map(x => x.evidenceRefs));
        assert.deepEqual(actual.sourceBindings.map(x => x.claimPath), ['summary', 'data.recommendation', 'data.reasoning.0', 'data.reasoning.1', 'data.caveats.0', 'data.caveats.1']);
    }
});

test('preserves maximum cardinalities and effective claim limits without truncation', () => {
    const value = producer();
    value.summary.claim = 'é'.repeat(400); value.data.recommendation.claim = 'R'.repeat(400);
    value.data.reasoning = Array.from({ length: 8 }, (_, i) => ({ claim: `Ragionamento ${i}`, evidenceRefs: [fixture.allowedEvidenceRefs[0]] }));
    value.data.caveats = Array.from({ length: 8 }, (_, i) => ({ claim: `Limite ${i}`, evidenceRefs: [fixture.allowedEvidenceRefs[1]] }));
    for (const [key, count] of [['keyEvidence', 10], ['safetyFlags', 8], ['suggestedActions', 8]] as const) value.data[key] = Array.from({ length: count }, (_, i) => ({ ...value.data[key][0], id: `synthetic.item.${i}` }));
    value.data.trace.limitations = Array.from({ length: 8 }, (_, i) => `Limite ${i}`);
    const result = decode(value); assert.equal(result.status, 'accepted');
    if (result.status === 'accepted') {
        assert.equal(result.sourceBindings.length, 18); assert.equal(result.value.summary.length, 400);
        for (const key of ['reasoning', 'caveats', 'safetyFlags', 'suggestedActions'] as const) assert.equal(result.value.data[key].length, 8);
        assert.equal(result.value.data.keyEvidence.length, 10);
    }
    for (const key of ['reasoning', 'caveats', 'keyEvidence', 'safetyFlags', 'suggestedActions'] as const) {
        const over = structuredClone(value); over.data[key].push(over.data[key][0]); deny(over);
    }
    value.summary.claim += 'x'; deny(value);
});

test('denies missing, extra, foreign or duplicated refs and producer authority; same ref across claims is valid', () => {
    assert.equal(decode(producer()).status, 'accepted');
    const mutations: ((v: ReturnType<typeof producer>) => void)[] = [
        v => { delete v.summary.evidenceRefs; }, v => { v.summary.evidenceRefs = []; },
        v => { v.summary.evidenceRefs = ['foreign.reference']; }, v => { v.summary.evidenceRefs.push(v.summary.evidenceRefs[0]); },
        v => { v.data.reasoning[0] = null; }, v => { v.data.caveats = null; }, v => { delete v.data.trace; },
        v => { Object.assign(v, { schemaVersion: 'mediflow.treatment_reasoning.v1' }); }, v => { v.task = 'other'; },
        v => { Object.assign(v, { sourceBindings: fixture.expectedOutput.sourceBindings }); }, v => { Object.assign(v, { receiptRef: 'receipt.forged' }); },
        v => { Object.assign(v.summary, { claimPath: 'summary' }); }, v => { v.data.extra = true; }, v => { v.data.trace.mode = 'remote'; },
        v => { v.data.trace.extra = true; }, v => { v.data.keyEvidence[0].extra = true; },
        v => { v.data.safetyFlags[0].severity = 'safe'; }, v => { v.data.suggestedActions[0].intent = 'auto_apply'; },
        v => { v.data.suggestedActions[0].writePolicy = 'auto_apply'; }, v => { v.data.suggestedActions[0].prefill = {}; },
    ];
    for (const mutate of mutations) { const value = producer(); mutate(value); deny(value); }
    deny(fixture.rejectedReviewShape); deny(fixture.expectedOutput);
});

test('rejects every V2 text normalization instead of silently repairing any field', () => {
    const setters: ((v: ReturnType<typeof producer>, s: string) => void)[] = [
        (v,s) => { v.summary.claim = s; }, (v,s) => { v.data.recommendation.claim = s; },
        (v,s) => { v.data.reasoning[0].claim = s; }, (v,s) => { v.data.caveats[0].claim = s; },
        (v,s) => { v.data.keyEvidence[0].statement = s; }, (v,s) => { v.data.safetyFlags[0].label = s; },
        (v,s) => { v.data.safetyFlags[0].rationale = s; }, (v,s) => { v.data.suggestedActions[0].label = s; },
        (v,s) => { v.data.suggestedActions[0].rationale = s; }, (v,s) => { v.data.trace.limitations[0] = s; },
    ];
    for (const set of setters) for (const text of ['', ' a', 'a ', 'a  b', 'a\nb', 'a\u0000b', 'a\u007fb', 'a\u00a0b']) {
        const value = producer(); set(value, text); deny(value);
    }
    for (const set of setters) { const value = producer(); set(value, 'x'.repeat(401)); deny(value); }
});

test('scans complete raw JSON, duplicates, escaped keys, finite numbers, depth/nodes and 64000 JS units', () => {
    const json = JSON.stringify(producer());
    for (const text of [json + '{}', json.slice(0,-1), '```json\n'+json+'\n```', '<think>x</think>'+json, json+'trailing',
        json+'\nmx.metal.device_info is deprecated', json.replace('"task":', '"task":"treatment_reasoning","task":'),
        json.replace('"task":', '"ta\\u0073k":"treatment_reasoning","task":'), json.replace('"task":', '"extra":1e999,"task":'),
        '{"x":'+ '['.repeat(66)+'0'+']'.repeat(66)+'}', '{"x":['+Array(16385).fill('0').join(',')+']}',
        json.replace('"task":', '"extra":NaN,"task":'), json.replace('"task":', '"extra":Infinity,"task":')]) assert.equal(profile.normalize(text, config).status, 'denied');
    const accented = producer(); accented.summary.claim = 'é'.repeat(400);
    const unicode = JSON.stringify(accented); assert.ok(Buffer.byteLength(unicode) > unicode.length);
    assert.equal(profile.normalize(unicode.padEnd(64_000, ' '), config).status, 'accepted');
    assert.equal(profile.normalize(unicode.padEnd(64_001, ' '), config).status, 'denied');
    assert.equal(profile.normalize(json+'\n', config).status, 'accepted');
});

test('accepts only intact string stdout, without evaluating objects, proxies or getters', () => {
    let reads = 0;
    const hostile = new Proxy({}, { get() { reads++; throw new Error('forbidden'); }, getPrototypeOf() { reads++; throw new Error('forbidden'); } });
    const getter = { get schemaVersion() { reads++; throw new Error('forbidden'); } };
    for (const value of [producer(), Object.create(null), hostile, getter, null, [], undefined]) assert.equal(profile.normalize(value, config).status, 'denied');
    assert.equal(reads, 0);
});
