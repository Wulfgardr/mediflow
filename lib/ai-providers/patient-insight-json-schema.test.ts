import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateGenerativeJson } from './generative-json-validation';

/* Synthetic responses. The local model fills the schema it receives; the host then
 * discards any claim without a [Sx] or [DATI-INCOMPLETI] marker, summary included. */
const response = (summary: string, currentState: string[] = ['Condizione cronica attiva [S2].']) => JSON.stringify({
    schemaVersion: 'mediflow.ai.extract.v1', task: 'patient_insight', summary,
    data: { currentState, alerts: [], nextSteps: [], gaps: [] },
});

test('Patient Insight schema refuses a summary without a source marker', () => {
    assert.throws(() => validateGenerativeJson('patient_insight', response('Paziente in follow-up per condizione cronica.')));
});

test('Patient Insight schema refuses a list item without a source marker', () => {
    assert.throws(() => validateGenerativeJson('patient_insight', response('Follow-up in corso [S1].', ['Eventi recenti stabili [S3-S10].'])));
});

test('Patient Insight schema accepts cited claims and incomplete-data markers', () => {
    assert.doesNotThrow(() => validateGenerativeJson('patient_insight', response('Follow-up della condizione cronica [S1, S2].')));
    assert.doesNotThrow(() => validateGenerativeJson('patient_insight', response('Dati recenti insufficienti [DATI-INCOMPLETI].')));
});
