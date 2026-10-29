import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { inspectFhirExportReadiness, describeFhirExportReadiness, type ExportControlStatus } from './export-readiness';
import { prepareFhirBundleFromRecords } from './export-precheck';
import type { FhirBundleInput } from './types';
import type { ValidatePatientExportResponse } from '../fse-validate-patient-contract';

function input(): FhirBundleInput {
    const value = JSON.parse(readFileSync(new URL('../../native/contracts/fhir-golden-input.v1.json', import.meta.url), 'utf8')) as FhirBundleInput;
    value.patient.diagnoses = []; value.entries = [];
    return value;
}
function validation(): ValidatePatientExportResponse {
    const summary = { total: 0, ok: 0, withErrors: 0, withWarnings: 0, errorCount: 0, warningCount: 0, items: [] };
    return { patientId: 'synthetic', hasErrors: false, hasWarnings: false, therapyMedication: summary, observationVitals: summary };
}
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
}
const statuses: ExportControlStatus[] = ['ready', 'warning', 'blocked', 'unavailable'];
const severity = { ready: 0, warning: 1, blocked: 2, unavailable: 3 };
for (const first of statuses) for (const second of statuses) {
    test(`gravità complessiva ${first}/${second}, indipendente dall'ordine`, () => {
        const expected = severity[first] >= severity[second] ? first : second;
        for (const controls of [[first, second], [second, first]] as [ExportControlStatus, ExportControlStatus][]) {
            const data = { patientId: 'synthetic', validation: validation(), controls };
            assert.equal(describeFhirExportReadiness({ loading: false, error: null, data }, 'synthetic').phase, expected);
            assert.equal(describeFhirExportReadiness({ loading: true, error: null, data }, 'synthetic').phase, 'pending');
        }
    });
}
for (const first of ['validation', 'bundle'] as const) {
    test(`${first} completa prima: attende entrambi e rileva la scala reale bloccante`, async () => {
        const records = input();
        records.entries = [{ id: 'scale-synthetic', patientId: records.patient.id, date: '2026-10-29', type: 'scale', content: '', metadata: { title: 'Scala sintetica', score: 1.5 } }];
        const local = deferred<ValidatePatientExportResponse>(), bundle = deferred<void>();
        let settled = false;
        const result = inspectFhirExportReadiness('synthetic', () => local.promise, async confirm => {
            await bundle.promise;
            return prepareFhirBundleFromRecords(records, confirm);
        }).then(value => { settled = true; return value; });
        if (first === 'validation') local.resolve(validation()); else bundle.resolve();
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(settled, false);
        local.resolve(validation()); bundle.resolve();
        const data = await result;
        assert.equal(data.validation?.hasErrors, false);
        assert.equal(describeFhirExportReadiness({ loading: false, error: null, data }, 'synthetic').phase, 'blocked');
    });
}
test('diagnosi reali non riconosciute richiedono attenzione, non dichiarano dati pronti', async () => {
    const records = input();
    records.patient.diagnoses = [{ id: 'diagnosis-synthetic', system: 'UNKNOWN', code: 'SYN', description: 'Diagnosi inventata', date: '2026-10-29' }];
    const data = await inspectFhirExportReadiness('synthetic', async () => validation(), confirm => prepareFhirBundleFromRecords(records, confirm));
    const state = describeFhirExportReadiness({ loading: false, error: null, data }, 'synthetic');
    assert.equal(state.phase, 'warning'); assert.equal(state.role, 'alert');
});
test('errore del controllo e risultato assente restano avvisi critici', async () => {
    const data = await inspectFhirExportReadiness('synthetic', async () => { throw new Error('Synthetic HTTP 503'); }, confirm => prepareFhirBundleFromRecords(input(), confirm));
    for (const query of [{ loading: false, error: null, data }, { loading: false, error: new Error('synthetic'), data: undefined }]) {
        const state = describeFhirExportReadiness(query, 'synthetic');
        assert.equal(state.phase, 'unavailable'); assert.equal(state.tone, 'critical'); assert.equal(state.role, 'alert');
        assert.equal(state.label, 'Controllo dei dati per l’esportazione FSE non disponibile.');
    }
});
test('risposta incompleta e bundle assente senza avvisi non diventano pronti', async () => {
    const missing = await inspectFhirExportReadiness('synthetic', async () => null as unknown as ValidatePatientExportResponse, confirm => prepareFhirBundleFromRecords(input(), confirm));
    const empty = await inspectFhirExportReadiness('synthetic', async () => validation(), async () => null);
    for (const data of [missing, empty]) assert.equal(describeFhirExportReadiness({ loading: false, error: null, data }, 'synthetic').phase, 'unavailable');
});
test('tutti i controlli reali conclusi senza rilievi permettono lo stato pronto; un altro paziente lo invalida', async () => {
    const data = await inspectFhirExportReadiness('synthetic', async () => validation(), confirm => prepareFhirBundleFromRecords(input(), confirm));
    assert.equal(describeFhirExportReadiness({ loading: false, error: null, data }, 'synthetic').phase, 'ready');
    const stale = describeFhirExportReadiness({ loading: false, error: null, data }, 'other-synthetic');
    assert.equal(stale.phase, 'pending'); assert.equal(stale.validation, null);
    assert.equal(describeFhirExportReadiness({ loading: false, error: new Error('synthetic'), data }, 'other-synthetic').validation, null);
});

test('un controllo fallito attende comunque il secondo in corso', async () => {
    const bundle = deferred<void>(); let settled = false;
    const request = inspectFhirExportReadiness('synthetic', async () => { throw new Error('Synthetic HTTP 503'); }, async confirm => {
        await bundle.promise; return prepareFhirBundleFromRecords(input(), confirm);
    }).then(value => { settled = true; return value; });
    await new Promise(resolve => setImmediate(resolve)); assert.equal(settled, false);
    bundle.resolve();
    assert.equal(describeFhirExportReadiness({ loading: false, error: null, data: await request }, 'synthetic').phase, 'unavailable');
});
test('la scala bloccante prevale su un avviso del validatore', async () => {
    const records = input(); records.entries = [{ id: 'scale-synthetic', patientId: records.patient.id, date: '2026-10-29', type: 'scale', content: '', metadata: { title: 'Scala sintetica', score: 1.5 } }];
    const data = await inspectFhirExportReadiness('synthetic', async () => ({ ...validation(), hasWarnings: true }), confirm => prepareFhirBundleFromRecords(records, confirm));
    assert.equal(describeFhirExportReadiness({ loading: false, error: null, data }, 'synthetic').phase, 'blocked');
});

test('lettura del bundle fallita: avviso complessivo, senza falsificare il riepilogo locale riuscito', async () => {
    const data = await inspectFhirExportReadiness('synthetic', async () => validation(), async () => { throw new Error('Synthetic denied read'); });
    const state = describeFhirExportReadiness({ loading: false, error: null, data }, 'synthetic');
    assert.equal(state.phase, 'unavailable'); assert.equal(state.role, 'alert'); assert.equal(state.tone, 'critical');
    assert.equal(state.validation?.hasErrors, false); assert.equal(state.error, null);
});
