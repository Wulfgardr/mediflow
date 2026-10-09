/* @Codex WUL-327 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { toFhirCondition, toFhirObservation } from './clinical-adapter';
import type { FhirClinicalEntryInput, FhirDiagnosisInput } from './types';

const diagnosis: FhirDiagnosisInput = {
    id: 'synthetic-diagnosis',
    system: 'ICD-10',
    code: 'SYN-CODE',
    description: '  Descrizione sintetica è conservata  ',
    date: '2026-07-20T12:30:00+02:00',
};

test('toFhirCondition preserves the full legacy output for each exact recognized ICD system', () => {
    for (const [system, uri] of [
        ['ICD-9', 'http://hl7.org/fhir/sid/icd-9'],
        ['ICD-10', 'http://hl7.org/fhir/sid/icd-10'],
        ['ICD-11', 'http://id.who.int/icd/release/11/mms'],
    ]) {
        const input = { ...diagnosis, system };
        const expected = {
            resourceType: 'Condition',
            id: diagnosis.id,
            subject: { reference: 'urn:mediflow:fhir:Patient:synthetic-patient' },
            clinicalStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: 'active' }] },
            code: { coding: [{ system: uri, code: diagnosis.code, display: diagnosis.description }], text: diagnosis.description },
            onsetDateTime: '2026-07-20T10:30:00.000Z',
        };
        assert.deepEqual(toFhirCondition(input, expected.subject.reference, 1), expected);
        assert.deepEqual(toFhirCondition(input, expected.subject.reference, 1), expected);
        assert.deepEqual(input, { ...diagnosis, system });
    }
});

test('toFhirCondition omits unsupported coding and preserves text and all other fields', () => {
    const known = toFhirCondition(diagnosis, 'Patient/synthetic-patient', 1);
    for (const system of ['', '   ', 'SNOMED-CT', 'ICD10', 'icd-11', ' ICD-10 ', 'toString', '__proto__']) {
        const input = { ...diagnosis, system };
        const resource = toFhirCondition(input, 'Patient/synthetic-patient', 1);
        assert.deepEqual(resource, { ...known, code: { text: diagnosis.description } });
        assert.equal(Object.hasOwn(resource.code!, 'coding'), false);
        assert.deepEqual(JSON.parse(JSON.stringify(resource)).code, { text: diagnosis.description });
        assert.deepEqual(input, { ...diagnosis, system });
    }
});

function scaleEntry(score: unknown): FhirClinicalEntryInput {
    return {
        id: 'entry-scale-1',
        patientId: 'patient-1',
        date: '2025-03-11T00:00:00Z',
        type: 'scale',
        content: 'Valutazione di prova',
        metadata: { title: 'PPS', score, interpretation: 'Stabile' },
    };
}

test('toFhirObservation accetta zero e i punteggi numerici validi', () => {
    const cases: Array<[unknown, number]> = [[0, 0], ['0', 0], [27, 27], ['27', 27]];
    for (const [score, expected] of cases) {
        const resource = toFhirObservation(scaleEntry(score), 'Patient/patient-1');
        assert.ok(resource, `score ${JSON.stringify(score)} deve produrre una Observation`);
        assert.equal(resource.valueInteger, expected);
    }
});

test('toFhirObservation tratta come assenti i punteggi vuoti o non numerici senza inventare zero', () => {
    const missing: unknown[] = [null, undefined, '', '   ', Number.NaN, 'abc', Number.POSITIVE_INFINITY];
    for (const score of missing) {
        const resource = toFhirObservation(scaleEntry(score), 'Patient/patient-1');
        assert.equal(resource, null, `score ${JSON.stringify(score)} deve restare assente`);
    }
});

test('toFhirObservation ignora le voci non-scala e i metadata assenti', () => {
    assert.equal(toFhirObservation({ ...scaleEntry(5), type: 'note' }, 'Patient/patient-1'), null);
    assert.equal(toFhirObservation({ ...scaleEntry(0), metadata: undefined }, 'Patient/patient-1'), null);
});

test('toFhirObservation conserva la forma della risorsa per un punteggio valido', () => {
    const resource = toFhirObservation(scaleEntry(27), 'Patient/patient-1');
    assert.ok(resource);
    assert.equal(resource.resourceType, 'Observation');
    assert.equal(resource.status, 'final');
    assert.equal(resource.code?.text, 'PPS');
    assert.deepEqual(resource.subject, { reference: 'Patient/patient-1' });
    assert.equal(resource.effectiveDateTime, new Date('2025-03-11T00:00:00Z').toISOString());
    assert.equal(resource.valueInteger, 27);
    assert.deepEqual(resource.interpretation, [{ text: 'Stabile' }]);
    assert.deepEqual(resource.note, [{ text: 'Valutazione di prova' }]);
});
