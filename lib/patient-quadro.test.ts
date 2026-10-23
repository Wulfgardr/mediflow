import test from 'node:test';
import assert from 'node:assert/strict';
import type { Observation } from './db';
import { projectQuadroMeasures } from './patient-quadro';

const observation = (id: string, overrides: Partial<Observation> = {}): Observation => ({
    id, patientId: 'synthetic', codeSystem: 'LOINC', code: 'SYN', display: 'Misura sintetica', unitSystem: 'UCUM', unitCode: 'kg', value: 70,
    observedAt: new Date('2026-10-01'), createdAt: new Date('2026-10-01'), ...overrides,
});
test('conserva zero, una e molte misure senza selezione o limite', () => {
    for (const count of [0, 1, 12]) assert.equal(projectQuadroMeasures(Array.from({ length: count }, (_, n) => observation(String(n)))).length, count);
});
test('delta solo verso una misura precedente dello stesso codice e unità', () => {
    const records = [observation('old', { value: 68, observedAt: new Date('2026-09-01') }), observation('different-unit', { unitCode: 'g', value: 100, observedAt: new Date('2026-09-30') }), observation('different-code', { code: 'OTHER', value: 99, observedAt: new Date('2026-09-30') }), observation('new', { value: 70 }), observation('deleted', { value: 60, observedAt: new Date('2026-09-29'), deletedAt: new Date() })];
    const rows = projectQuadroMeasures(records);
    assert.equal(rows.length, 4);
    assert.equal(rows[0].id, 'new');
    assert.equal(rows[0].delta, `+2 kg dal ${new Date('2026-09-01').toLocaleDateString('it-IT')}`);
    assert.equal(rows[1].delta, undefined);
    assert.equal(rows[2].delta, undefined);
    assert.equal(rows[3].delta, undefined);
});
test('non inventa delta per valore testuale, stessa data o range assente', () => {
    const rows = projectQuadroMeasures([observation('a', { value: 'non rilevabile' }), observation('b'), observation('c', { observedAt: new Date('2026-09-01'), value: 'assente' })]);
    assert.equal(rows[0].valueLabel, 'non rilevabile kg');
    assert.ok(rows.every(row => row.delta === undefined && row.outOfRange === null));
});
