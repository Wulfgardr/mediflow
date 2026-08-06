import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildClinicalResultImportEnvelope,
  buildClinicalResultSeries,
  proposePrescriptionLink,
  type RawClinicalResult,
} from './clinical-result-import';

const base: RawClinicalResult = {
  analyte: 'Emoglobina', value: '13,4', unit: 'g/dL', referenceRange: '12,0 - 16,0',
  observedAt: '2026-07-01T08:00:00+02:00', reportId: 'R-001', specimen: 'Sangue',
};
const terminology = [{ analyte: 'Emoglobina', loinc: '718-7', unit: 'g/dL', ucum: 'g/dL', verified: true as const }];
const envelope = (deterministic: RawClinicalResult[], provider?: { lane: 'local' | 'cloud'; results: RawClinicalResult[] }) =>
  buildClinicalResultImportEnvelope({ patientId: 'synthetic-patient', documentHash: 'sha256:synthetic', deterministic, provider, terminology });

test('normalizza un nuovo referto e conserva provenienza, range e terminologie verificate', () => {
  const result = envelope([base]).candidates[0];
  assert.equal(result.value, '13.4');
  assert.deepEqual(result.referenceRange, { original: '12,0 - 16,0', low: 12, high: 16 });
  assert.equal(result.analyte.loinc, '718-7');
  assert.equal(result.provenance.lane, 'deterministic');
});

test('deduplica lo stesso referto ma conserva stessa analisi in date, unità e range diversi', () => {
  const rows = [
    envelope([base]).candidates[0],
    envelope([base]).candidates[0],
    envelope([{ ...base, observedAt: '2026-06-01T08:00:00Z' }]).candidates[0],
    envelope([{ ...base, unit: 'g/L', value: 134 }]).candidates[0],
    envelope([{ ...base, referenceRange: '11 - 15', reportId: 'R-002' }]).candidates[0],
  ];
  const series = buildClinicalResultSeries('synthetic-patient', rows);
  assert.equal(series.length, 1);
  assert.equal(series[0].all.length, 4);
});

test('non inventa LOINC quando il mapping manca', () => {
  const result = buildClinicalResultImportEnvelope({
    patientId: 'synthetic-patient', documentHash: 'sha256:x',
    deterministic: [{ ...base, analyte: 'Test locale non codificato' }],
  }).candidates[0];
  assert.equal(result.analyte.loinc, undefined);
  assert.equal(result.analyte.original, 'Test locale non codificato');
});

test('provider locale e cloud non sovrascrivono fatti deterministici', () => {
  const conflict = { ...base, value: '99' };
  for (const lane of ['local', 'cloud'] as const) {
    const result = envelope([base], { lane, results: [conflict] });
    assert.equal(result.candidates[0].value, '13.4');
    assert.equal(result.candidates.length, 1);
    assert.equal(result.issues.length, 1);
  }
  assert.deepEqual(envelope([base]).candidates[0], envelope([base], { lane: 'local', results: [base] }).candidates[0]);
});

test('propone link unico, blocca link ambiguo e lascia non collegato senza evidenza', () => {
  const result = envelope([base]).candidates[0];
  const one = [{ id: 'p1', code: '718-7', description: 'Emoglobina', prescribedAt: '2026-06-20T00:00:00Z' }];
  assert.equal(proposePrescriptionLink(result, one).state, 'collegato');
  assert.equal(proposePrescriptionLink(result, [...one, { ...one[0], id: 'p2' }]).state, 'ambiguo');
  assert.equal(proposePrescriptionLink(result, []).state, 'non_collegato');
});

test('collassa lo storico a ultimi 3 più massimo uno per anno precedente senza cancellare dati', () => {
  const rows = Array.from({ length: 9 }, (_, index) =>
    envelope([{ ...base, reportId: `R-${index}`, observedAt: `${2026 - Math.floor(index / 2)}-0${(index % 2) + 1}-01T08:00:00Z` }]).candidates[0]);
  const series = buildClinicalResultSeries('synthetic-patient', rows)[0];
  assert.equal(series.all.length, 9);
  assert.equal(series.collapsed.length, 6);
  assert.equal(new Set(series.collapsed.slice(3).map(item => item.observedAt.slice(0, 4))).size, 3);
});
