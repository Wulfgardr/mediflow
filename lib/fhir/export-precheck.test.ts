import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { FhirScaleScoreError } from './clinical-adapter';
import { buildFhirBundleFromRecords } from './bundle-mapper';
import { buildFhirDiagnosisWarningMessage, prepareFhirBundleFromRecords, type FhirDiagnosisCodingWarning } from './export-precheck';
import type { FhirBundleInput } from './types';

function fixture(): FhirBundleInput {
    return JSON.parse(readFileSync(new URL('../../native/contracts/fhir-golden-input.v1.json', import.meta.url), 'utf8'));
}

test('recognized diagnoses release the unchanged bundle without a warning prompt', async () => {
    const input = fixture();
    input.patient.diagnoses = ['ICD-9', 'ICD-10', 'ICD-11'].map((system) => ({
        ...input.patient.diagnoses![0], system,
    }));
    const before = structuredClone(input);
    const bundle = await prepareFhirBundleFromRecords(input, () => {
        assert.fail('Recognized systems must not prompt');
    });
    assert.deepEqual(bundle, buildFhirBundleFromRecords(input));
    assert.deepEqual(await prepareFhirBundleFromRecords(input), bundle);
    assert.deepEqual(input, before);
});

test('unknown and blank diagnoses require confirmation and emit only stable local warning details', async () => {
    const input = fixture();
    const source = input.patient.diagnoses![0];
    input.patient.diagnoses = [
        { ...source, id: 'synthetic-unknown', system: 'UNKNOWN-SYNTHETIC' },
        { ...source, id: undefined, system: '' },
        { ...source, id: undefined, system: '   ' },
        { ...source, id: 'synthetic-known', system: 'ICD-11' },
    ];
    const before = structuredClone(input);
    await assert.rejects(prepareFhirBundleFromRecords(input), /FHIR_DIAGNOSIS_WARNINGS_REQUIRE_CONFIRMATION/);
    assert.equal(await prepareFhirBundleFromRecords(input, () => false), null);
    const promptFailure = new Error('Synthetic prompt failure');
    await assert.rejects(prepareFhirBundleFromRecords(input, () => { throw promptFailure; }), promptFailure);

    let observed: readonly FhirDiagnosisCodingWarning[] = [];
    const bundle = await prepareFhirBundleFromRecords(input, async (warnings) => {
        observed = warnings;
        return true;
    });
    assert.ok(bundle);
    const conditions = bundle.entry!.slice(1, 5).map(({ resource }) => {
        assert.equal(resource?.resourceType, 'Condition');
        return resource!;
    });
    assert.deepEqual(observed, input.patient.diagnoses.slice(0, 3).map((diagnosis, index) => ({
        code: 'UNSUPPORTED_DIAGNOSIS_SYSTEM', severity: 'warning', category: 'diagnosis',
        recordId: diagnosis.id || conditions[index].id,
        path: `/patient/diagnoses/${index}/system`,
    })));
    assert.equal(new Set(observed.map(({ recordId }) => recordId)).size, 3);
    for (const condition of conditions.slice(0, 3)) {
        assert.equal(condition.resourceType, 'Condition');
        if (condition.resourceType === 'Condition') assert.deepEqual(condition.code, { text: source.description });
    }
    const baseline = buildFhirBundleFromRecords({ ...input, patient: { ...input.patient, diagnoses: [] } });
    assert.deepEqual([bundle.entry![0], ...bundle.entry!.slice(5)], baseline.entry);
    assert.equal(bundle.timestamp, baseline.timestamp);
    assert.equal(bundle.type, baseline.type);
    assert.deepEqual(await prepareFhirBundleFromRecords(input, () => true), bundle);
    assert.deepEqual(input, before);
    assert.equal(JSON.stringify(observed).includes(source.description), false);
    assert.equal(JSON.stringify(observed).includes(source.code), false);
    assert.equal(buildFhirDiagnosisWarningMessage(observed),
        '3 diagnosi hanno un sistema di codifica non riconosciuto o vuoto. Il file conserverà la descrizione di queste diagnosi senza la codifica. Vuoi proseguire?');
});

test('a patient without diagnoses needs no diagnosis warning confirmation', async () => {
    const input = fixture();
    delete input.patient.diagnoses;
    assert.deepEqual(await prepareFhirBundleFromRecords(input), buildFhirBundleFromRecords(input));
});

for (const score of [1.5, 2147483648, -2147483649, NaN, 'invalid', '', ' ', null, undefined, Infinity, -Infinity, '1.5', '2147483648']) {
    test(`invalid scale score (${typeof score}) ${String(score)} blocks the entire export before warning confirmation`, async () => {
        const input = fixture();
        input.patient.diagnoses![0].system = 'UNKNOWN';
        const entry = { ...input.entries[1], id: 'synthetic-invalid-score', type: 'scale' as const,
            metadata: { title: 'Synthetic scale', score } };
        input.entries.push(entry);
        const before = structuredClone(input);
        const isBlockingScoreError = (error: unknown) => {
            assert.ok(error instanceof FhirScaleScoreError);
            assert.equal(error.code, 'INVALID_SCALE_SCORE');
            assert.equal(error.severity, 'error');
            assert.equal(error.recordId, entry.id);
            return true;
        };
        assert.throws(() => buildFhirBundleFromRecords(input), isBlockingScoreError);
        await assert.rejects(prepareFhirBundleFromRecords(input, () => {
            assert.fail('Blocking errors cannot be bypassed by confirming warnings');
        }), isBlockingScoreError);
        assert.deepEqual(input, before);
    });
}

test('deleted scales with invalid scores are excluded without blocking export', async () => {
    const input = fixture();
    input.entries.push({ ...input.entries[1], id: 'synthetic-deleted-scale', type: 'scale',
        deletedAt: input.generatedAt, metadata: { score: 1.5 } });
    const bundle = await prepareFhirBundleFromRecords(input);
    assert.deepEqual(bundle, buildFhirBundleFromRecords({ ...input, entries: input.entries.slice(0, -1) }));
});
