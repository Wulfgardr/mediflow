/* @Codex */
import test from 'node:test';
import assert from 'node:assert/strict';
import { LAB_RESULT_ARTIFACT_SCHEMA_VERSION, readLabResultArtifact } from './lab-result-artifact.ts';

const fact = (id = 'lab_result:1:1') => ({
    id, kind: 'lab_result', label: 'Synthetic: 1 mg/dL', excerpt: 'Synthetic 1 mg/dL 0-2', sourceId: 'synthetic-doc', temporality: 'current', status: 'active', origin: 'documented', code: '1234-5', system: 'LOINC',
    labResult: { analyte: 'Synthetic', value: '1', unit: 'mg/dL', referenceRange: { text: '0-2', low: '0', high: '2' }, flag: 'alto', lineNumber: 1, sourceLine: 'Synthetic 1 mg/dL 0-2' },
    observationProposal: { requestId: 'lab_result:1:1234-5', codeSystem: 'LOINC', code: '1234-5', display: 'Synthetic', unitCode: 'mg/dL', value: '1', refLow: '0', refHigh: '2' },
});
const legacy = (facts: unknown[] = [fact('lab_result:1:1'), { kind: 'problem' }, fact('lab_result:2:1')]) => ({ schemaVersion: 'mediflow.document_evidence_pack.v2', source: { documentInsightId: 'synthetic-doc', fileName: 'synthetic.txt', documentDate: '2026-01-01', qualityLevel: 'green' }, facts });

test('reads v1 and normalizes ordered legacy lab facts with source and nested proposal', () => {
    const v1 = { schemaVersion: LAB_RESULT_ARTIFACT_SCHEMA_VERSION, reviewStatus: 'review_only', source: legacy().source, facts: [fact()] };
    assert.equal(readLabResultArtifact(v1)?.schemaVersion, LAB_RESULT_ARTIFACT_SCHEMA_VERSION);
    const artifact = readLabResultArtifact(legacy());
    assert.deepEqual(artifact?.facts.map((item) => item.id), ['lab_result:1:1', 'lab_result:2:1']);
    assert.deepEqual(artifact?.source, legacy().source);
    assert.deepEqual(artifact?.facts[0].observationProposal, fact().observationProposal);
});

test('fails closed for invalid versions, empty or malformed review material', () => {
    const cases: unknown[] = [
        { ...legacy(), schemaVersion: undefined }, { ...legacy(), schemaVersion: 'v9' }, legacy([]), { schemaVersion: LAB_RESULT_ARTIFACT_SCHEMA_VERSION, reviewStatus: 'review_only', source: legacy().source, facts: [fact(), { kind: 'problem' }] }, legacy([{ ...fact(), persistence: 'automatic' }]), legacy([{ ...fact(), labResult: {} }]), legacy([{ ...fact(), observationProposal: {} }]), legacy([{ ...fact(), kind: 'unknown' }]), legacy([{ ...fact(), observationProposal: { ...fact().observationProposal, code: 'other' } }]),
    ];
    for (const value of cases) assert.equal(readLabResultArtifact(value), undefined);
});

for (const [name, mutate] of [
    ['sourceId', (item: ReturnType<typeof fact>) => { item.sourceId = 'other-doc'; }],
    ['value', (item: ReturnType<typeof fact>) => { item.observationProposal.value = '2'; }],
    ['unitCode', (item: ReturnType<typeof fact>) => { item.observationProposal.unitCode = 'mmol/L'; }],
    ['refLow different', (item: ReturnType<typeof fact>) => { item.observationProposal.refLow = '1'; }],
    ['refLow extra', (item: ReturnType<typeof fact>) => { Reflect.deleteProperty(item.labResult.referenceRange, 'low'); }],
    ['refLow missing', (item: ReturnType<typeof fact>) => { Reflect.deleteProperty(item.observationProposal, 'refLow'); }],
    ['refHigh different', (item: ReturnType<typeof fact>) => { item.observationProposal.refHigh = '3'; }],
    ['refHigh extra', (item: ReturnType<typeof fact>) => { Reflect.deleteProperty(item.labResult.referenceRange, 'high'); }],
    ['refHigh missing', (item: ReturnType<typeof fact>) => { Reflect.deleteProperty(item.observationProposal, 'refHigh'); }],
    ['requestId', (item: ReturnType<typeof fact>) => { item.observationProposal.requestId = 'other'; }],
] as const) test(`rejects a mismatched proposal ${name}`, () => {
    const item = fact();
    mutate(item);
    assert.equal(readLabResultArtifact({ schemaVersion: LAB_RESULT_ARTIFACT_SCHEMA_VERSION, reviewStatus: 'review_only', source: legacy().source, facts: [item] }), undefined);
});

test('accepts a non-empty proposal display different from the analyte', () => {
    const item = fact();
    item.observationProposal.display = 'Synthetic clinical display';
    assert.notEqual(readLabResultArtifact({ schemaVersion: LAB_RESULT_ARTIFACT_SCHEMA_VERSION, reviewStatus: 'review_only', source: legacy().source, facts: [item] }), undefined);
});

test('exports no automatic write API', async () => {
    const artifactModule = await import('./lab-result-artifact.ts');
    assert.equal(Object.keys(artifactModule).some((name) => /(?:write|save|persist)/i.test(name)), false);
});
