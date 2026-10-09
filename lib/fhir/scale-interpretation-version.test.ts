import test from 'node:test';
import assert from 'node:assert/strict';
import { toFhirObservation } from './clinical-adapter.ts';
import { prepareScaleSubmission } from '../scale-submission.ts';

test('FHIR carries new stored interpretation and its policy version without rewriting legacy', () => {
    const submission = prepareScaleSubmission('gds', {
        g1: 1, g2: 1, g3: 1, g4: 1, g5: 1, g6: 1, g7: 0, g8: 0,
        g9: 0, g10: 0, g11: 0, g12: 0, g13: 0, g14: 0, g15: 0,
    });
    const current = { id: 'synthetic-scale', patientId: 'synthetic-patient', type: 'scale' as const,
        date: '2026-10-08T00:00:00Z', ...submission };
    const legacy = { ...current, content: 'Originale: Depressione Lieve (6-10)',
        metadata: { scaleId: 'gds', score: 6, interpretation: 'Depressione Lieve (6-10)' } };
    for (const entry of [current, legacy]) {
        const before = JSON.stringify(entry);
        const observation = toFhirObservation(entry, 'Patient/synthetic-patient');
        assert.ok(observation);
        assert.deepEqual(observation.interpretation, [{ text: entry.metadata.interpretation }]);
        assert.deepEqual(observation.note, [{ text: entry.content }]);
        assert.equal(JSON.stringify(entry), before);
    }
    assert.ok(toFhirObservation(current, 'Patient/synthetic-patient')!.note![0].text.includes('mediflow.gds15.screening-limits.v1'));
    assert.doesNotMatch(JSON.stringify(toFhirObservation(legacy, 'Patient/synthetic-patient')), /screening-limits|Versione interpretazione/);
});
