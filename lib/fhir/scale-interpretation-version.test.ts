import test from 'node:test';
import assert from 'node:assert/strict';
import { toFhirObservation } from './clinical-adapter.ts';
import { prepareScaleSubmission } from '../scale-submission.ts';

test('FHIR carries new stored interpretation and its policy version without rewriting legacy', async () => {
    const { SCALES } = await import('../scale-definitions.ts');
    for (const id of ['gds', 'adl', 'iadl', 'tinetti-poma28-v1']) {
        const submission = prepareScaleSubmission(id, Object.fromEntries(SCALES[id].questions.map(q => [q.id, 0])));
        const current = { id: 'synthetic-scale', patientId: 'synthetic-patient', type: 'scale' as const,
            date: '2026-10-08T00:00:00Z', ...submission };
        const legacy = { ...current, content: 'Originale: Depressione Lieve (6-10)',
            metadata: { title: 'GDS-15 sintetica', scaleId: 'gds', score: 6, interpretation: 'Depressione Lieve (6-10)' } };
        for (const entry of [current, legacy]) {
            const before = JSON.stringify(entry);
            const observation = toFhirObservation(entry, 'Patient/synthetic-patient');
            assert.ok(observation);
            assert.deepEqual(observation.interpretation, [{ text: entry.metadata.interpretation }]);
            assert.deepEqual(observation.note, [{ text: entry.content }]);
            assert.equal(JSON.stringify(entry), before);
        }
        assert.ok(toFhirObservation(current, 'Patient/synthetic-patient')!.note![0].text.includes(submission.metadata.interpretationVersion!));
        assert.doesNotMatch(JSON.stringify(toFhirObservation(legacy, 'Patient/synthetic-patient')), /screening-limits|Versione interpretazione/);
    }
});
