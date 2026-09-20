/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSmartImportContextProposalBrowserAdapter } from './smart-import-patient-context-browser-adapter.ts';
const patient = { id: 'synthetic', firstName: 'Alice', lastName: 'Esempio', version: 1 };
const ambulatory = { id: 'north', name: 'Ambulatorio Nord', version: 1 };
test('named choices are frozen display candidates and no default is selected', async () => {
    const calls: string[] = []; const adapter = createSmartImportContextProposalBrowserAdapter({ fetch: async (url, init) => {
        calls.push(String(url)); assert.equal(init?.method, 'GET'); return Response.json(String(url).includes('/patients/') ? patient : [{ ...ambulatory, isDefault: true }]);
    } });
    const result = await adapter.read('synthetic'); assert.equal(result.patientName, 'Alice Esempio');
    assert.equal(Object.isFrozen(result), true); assert.equal(Object.isFrozen(result.ambulatories[0]), true);
    assert.equal('ambulatoryId' in result, false); assert.deepEqual(calls, ['/api/patients/synthetic', '/api/ambulatories']);
});
test('malformed, empty, duplicate, missing and unauthenticated contexts remain explicit', async () => {
    for (const [rows, code] of [[[], 'context_missing'], [[ambulatory, ambulatory], 'response_invalid'], [[{ ...ambulatory, id: '' }], 'response_invalid'], [{}, 'response_invalid']] as const) {
        const a = createSmartImportContextProposalBrowserAdapter({ fetch: async url => Response.json(String(url).includes('/patients/') ? patient : rows) });
        await assert.rejects(a.read('synthetic'), { code });
    }
    for (const status of [401, 500]) {
        let calls = 0; const a = createSmartImportContextProposalBrowserAdapter({ fetch: async () => { calls++; return Response.json({}, { status }); } });
        await assert.rejects(a.read('synthetic'), { code: status === 401 ? 'session_unavailable' : 'context_unavailable' }); assert.equal(calls, 1);
    }
    let calls = 0; const a = createSmartImportContextProposalBrowserAdapter({ fetch: async () => { calls++; return Response.json(patient); } });
    await assert.rejects(a.read('../invalid'), { code: 'response_invalid' }); assert.equal(calls, 0);
});
