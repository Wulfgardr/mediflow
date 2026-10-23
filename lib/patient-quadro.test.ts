import test from 'node:test';
import assert from 'node:assert/strict';
import type { Observation } from './db';
import { projectQuadroMeasures } from './patient-quadro';

const observation = (id: string, overrides: Partial<Observation> = {}): Observation => ({
    id, patientId: 'synthetic', codeSystem: 'LOINC', code: 'SYN', display: 'Misura sintetica', unitSystem: 'UCUM', unitCode: 'kg', value: 70,
    observedAt: new Date('2026-10-01'), createdAt: new Date('2026-10-01'), ...overrides,
});
test('conserva zero, uno e molti parametri senza limite', () => {
    for (const count of [0, 1, 12]) assert.equal(projectQuadroMeasures(Array.from({ length: count }, (_, n) => observation(String(n), { code: `SYN${n}` }))).length, count);
});
test('una riga per parametro: ultimo valore, data e delta con storico lungo e non ordinato', () => {
    const history = Array.from({ length: 200 }, (_, n) => observation(`weight-${n}`, {
        value: n, observedAt: new Date(Date.UTC(2025, 0, n + 1)),
    }));
    const records = [
        observation('deleted-latest', { value: 999, observedAt: new Date('2026-10-02'), deletedAt: new Date() }),
        ...history.toReversed(),
        observation('glucose-old', { code: 'GLU', unitCode: 'mg/dL', value: 90, observedAt: new Date('2026-09-01') }),
        observation('grams-old', { unitCode: 'g', value: 70000, observedAt: new Date('2026-09-01') }),
        observation('other-code-system', { codeSystem: 'LOCAL', value: 1 }),
        observation('other-unit-system', { unitSystem: 'LOCAL', value: 2 }),
        observation('grams-latest', { unitCode: 'g', value: 71000 }),
        observation('glucose-latest', { code: 'GLU', unitCode: 'mg/dL', value: 95 }),
        observation('deleted-only', { code: 'DELETED', deletedAt: new Date() }),
    ];
    const originalIds = records.map(item => item.id);
    const rows = projectQuadroMeasures(records);
    assert.equal(rows.length, 5);
    assert.deepEqual(new Set(rows.map(row => row.id)), new Set(['weight-199', 'grams-latest', 'glucose-latest', 'other-code-system', 'other-unit-system']));
    const weight = rows.find(row => row.id === 'weight-199')!;
    assert.equal(weight.valueLabel, '199 kg');
    assert.deepEqual(weight.date, history[199].observedAt);
    assert.equal(weight.delta, `+1 kg dal ${history[198].observedAt.toLocaleDateString('it-IT')}`);
    assert.equal(rows.find(row => row.id === 'grams-latest')?.delta, `+1000 g dal ${new Date('2026-09-01').toLocaleDateString('it-IT')}`);
    assert.equal(rows.find(row => row.id === 'glucose-latest')?.delta, `+5 mg/dL dal ${new Date('2026-09-01').toLocaleDateString('it-IT')}`);
    assert.equal(rows.find(row => row.id === 'other-code-system')?.delta, undefined);
    assert.equal(rows.find(row => row.id === 'other-unit-system')?.delta, undefined);
    assert.deepEqual(records.map(item => item.id), originalIds);
});
test('delta solo verso una misura precedente dello stesso codice e unità', () => {
    const records = [observation('old', { value: 68, observedAt: new Date('2026-09-01') }), observation('different-unit', { unitCode: 'g', value: 100, observedAt: new Date('2026-09-30') }), observation('different-code', { code: 'OTHER', value: 99, observedAt: new Date('2026-09-30') }), observation('new', { value: 70 }), observation('deleted', { value: 60, observedAt: new Date('2026-09-29'), deletedAt: new Date() })];
    const rows = projectQuadroMeasures(records);
    assert.equal(rows.length, 3);
    assert.equal(rows[0].id, 'new');
    assert.equal(rows[0].delta, `+2 kg dal ${new Date('2026-09-01').toLocaleDateString('it-IT')}`);
    assert.equal(rows[1].delta, undefined);
    assert.equal(rows[2].delta, undefined);
});
test('non inventa delta per valore testuale, stessa data o range assente', () => {
    const rows = projectQuadroMeasures([observation('a', { value: 'non rilevabile' }), observation('b'), observation('c', { observedAt: new Date('2026-09-01'), value: 'assente' })]);
    assert.equal(rows[0].valueLabel, 'non rilevabile kg');
    assert.ok(rows.every(row => row.delta === undefined && row.outOfRange === null));
});

test('trova il precedente strettamente più vecchio in ogni ordine, escludendo pari data e cancellati', () => {
    const records = [
        observation('latest', { value: 74 }),
        observation('tie', { value: 74 }),
        observation('previous', { value: 72, observedAt: new Date('2026-09-20') }),
        observation('old', { value: 60, observedAt: new Date('2026-09-01') }),
        observation('deleted-previous', { value: 99, observedAt: new Date('2026-09-30'), deletedAt: new Date() }),
    ];
    for (let offset = 0; offset < records.length; offset++) {
        const ordered = [...records.slice(offset), ...records.slice(0, offset)];
        for (const input of [ordered, ordered.toReversed()]) {
            const rows = projectQuadroMeasures(input);
            assert.equal(rows.length, 1);
            assert.equal(rows[0].valueLabel, '74 kg');
            assert.equal(rows[0].delta, `+2 kg dal ${new Date('2026-09-20').toLocaleDateString('it-IT')}`);
        }
    }
});
test('non confonde tuple contenenti separatori', () => {
    assert.equal(projectQuadroMeasures([
        observation('a', { codeSystem: 'A|B', code: 'C' }),
        observation('b', { codeSystem: 'A', code: 'B|C' }),
    ]).length, 2);
});
