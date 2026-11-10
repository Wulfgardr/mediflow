import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifyCall } from '../../../scripts/dossier-conformance';
const root = 'native/contracts/dossier-conformance/';
const read = (name: string) => JSON.parse(readFileSync(root + name, 'utf8'));
const ts = read('ts-cases.json');
const calls = [...ts, ...read('banco-cases.json'), ...read('catalog-cases.json')];
const expected = read('expected.json');
function canonical(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, field]) => `${JSON.stringify(key)}:${canonical(field)}`).join(',')}}`;
    return JSON.stringify(value) ?? 'null';
}

test('Web: ogni campo del risultato coincide con le attese rigenerabili del corpus condiviso', () => {
    assert.equal(expected.length, calls.length);
    calls.forEach((call, index) => assert.equal(canonical(JSON.parse(JSON.stringify(verifyCall(call)))), canonical(expected[index]), `caso ${index}: ${call.op}`));
});

test('Web: tutte le dieci falsificazioni sono bloccate dall’identità o dal verificatore dei fatti', () => {
    const mutations = read('banco-index.json').filter((row: { mutation: boolean }) => row.mutation);
    assert.equal(mutations.length, 10);
    for (const mutation of mutations) {
        const identity = verifyCall(calls[ts.length + mutation.identity]) as { blocking: boolean };
        const accepted = mutation.eligible.map((index: number) => verifyCall(calls[ts.length + index]));
        assert.ok(identity.blocking || accepted.every((value: unknown) => value === false), mutation.name);
        assert.ok(accepted.length > 0, `${mutation.name}: controllo non vacuo`);
    }
});

test('GPUI: il worker incorporato nel client è la build corrente delle sue sorgenti', { skip: process.platform === 'win32' && 'i fine riga della checkout Windows cambiano i byte del bundle' }, async () => {
    // Il client Rust incorpora questo file con include_str!: se le sorgenti cambiano e il bundle no, GPUI verifica con regole vecchie.
    const { bundleDossierWorker } = await import('../../../scripts/build-dossier-worker.mjs');
    const committed = readFileSync('experiments/gpui-patient-pilot/worker/dossier.bundle.mjs', 'utf8');
    assert.equal(await bundleDossierWorker() === committed, true, 'bundle non allineato: esegui node scripts/build-dossier-worker.mjs');
});
