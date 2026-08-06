/* @Codex WUL-327 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { toFhirObservation } from './clinical-adapter';
import type { FhirClinicalEntryInput } from './types';

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
