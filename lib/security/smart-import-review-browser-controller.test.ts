/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSmartImportReviewBrowserController } from './smart-import-review-browser-controller.ts';
const patientId = 'patient.synthetic.01';
const captureInput = { patient: { version: 1 }, currentDiagnoses: [], currentActiveTherapies: [], sources: [{ kind: 'patient-notes', originKey: 'patient-notes:1', label: 'Synthetic', date: null, content: 'Synthetic source' }], therapyCandidateHints: [] };
const lease = { sessionRef: `ssr_${'1'.repeat(32)}`, selectionEpoch: 1, patientRef: `ptr_${'2'.repeat(32)}`, ambulatoryRef: `abr_${'3'.repeat(32)}`, leaseRef: `lsr_${'4'.repeat(32)}`, expiresAt: 999999 };
function fixture() {
    const state = { version: 1, name: 'Ambulatorio Nord', selectionStatus: 200 };
    const calls: Array<{ url: string; method: string; body: unknown }> = [];
    const fetcher: typeof fetch = async (path, init) => {
        const url = String(path); calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null });
        if (url === `/api/patients/${patientId}`) return Response.json({ id: patientId, firstName: 'Alice', lastName: 'Esempio', version: state.version });
        if (url === '/api/ambulatories') return Response.json([{ id: 'centro', name: 'Ambulatorio Centro', version: 1, isDefault: true }, { id: 'nord', name: state.name, version: 1 }]);
        if (url.endsWith('/selection')) return init?.method === 'GET' ? Response.json({ selectionEpoch: 0 }) : Response.json({ selection: lease }, { status: state.selectionStatus });
        if (url.endsWith('/ingest')) return Response.json({ handle: `prj_${'f'.repeat(32)}` });
        if (url.endsWith('/preview')) return Response.json({ preview: { writesPerformed: 0, apply: 'denied', status: 'denied', code: 'projection_unavailable', proposal: null, receipt: null, provenance: null, reviewRef: null } });
        throw new Error('Unexpected request');
    };
    const controller = createSmartImportReviewBrowserController({ fetch: fetcher, clock: () => new Date('2026-09-07T12:00:00Z'), requestId: (() => { let n = 0; return () => `req_${String(++n).padStart(32, 'a')}`; })() });
    return { state, calls, controller, fetcher };
}
test('ordinary session without cookie offers named choices; only confirmed choice reaches host selection', async () => {
    const f = fixture(); const proposal = await f.controller.readProposal(patientId);
    assert.deepEqual(proposal.ambulatories.map(x => x.name), ['Ambulatorio Centro', 'Ambulatorio Nord']);
    assert.equal(f.calls.some(x => x.url === '/api/context' || x.method === 'POST'), false);
    const input = { patientId, proposal, ambulatory: proposal.ambulatories[1], captureInput };
    await assert.rejects(f.controller.run(input, false as true), { code: 'confirmation_required' });
    await assert.rejects(f.controller.run({ ...input, ambulatory: null }, true), { code: 'choice_required' });
    await assert.rejects(f.controller.run({ ...input, ambulatory: { ...input.ambulatory } }, true), { code: 'choice_required' });
    assert.equal(f.calls.filter(x => x.method === 'POST').length, 0);
    const result = await f.controller.run(input, true); assert.equal(result.preview.status, 'denied');
    assert.deepEqual(f.calls.filter(x => x.method === 'POST').map(x => x.url), ['/api/ai/smart-import/selection', '/api/ai/smart-import/ingest', '/api/ai/smart-import/preview']);
    assert.deepEqual(f.calls.find(x => x.method === 'POST')?.body, { expectedEpoch: 0, patientId, ambulatoryId: 'nord' });
    await assert.rejects(f.controller.run(input, true), { code: 'proposal_stale' });
});
test('patient mismatch, copied proposal and changed displayed context cannot initiate a POST', async () => {
    for (const change of ['patient', 'copy', 'version', 'name']) {
        const f = fixture(); const proposal = await f.controller.readProposal(patientId); const input = { patientId, proposal, ambulatory: proposal.ambulatories[1], captureInput };
        if (change === 'version') f.state.version++;
        if (change === 'name') f.state.name = 'Nome modificato';
        await assert.rejects(f.controller.run(change === 'patient' ? { ...input, patientId: 'other' } : change === 'copy' ? { ...input, proposal: { ...proposal } } : input, true), { code: 'proposal_stale' });
        assert.equal(f.calls.filter(x => x.method === 'POST').length, 0);
    }
});
test('membership conflict stays host-owned and is not retried; invalid capture never reaches ingest', async () => {
    for (const conflict of [true, false]) {
        const f = fixture(); const proposal = await f.controller.readProposal(patientId); if (conflict) f.state.selectionStatus = 409;
        await assert.rejects(f.controller.run({ patientId, proposal, ambulatory: proposal.ambulatories[0], captureInput: conflict ? captureInput : { ...captureInput, sources: [] } }, true));
        assert.deepEqual(f.calls.filter(x => x.method === 'POST').map(x => x.url), ['/api/ai/smart-import/selection']);
    }
});
test('reset and a later read invalidate an earlier unresolved proposal', async () => {
    for (const reset of [true, false]) {
        const f = fixture(); let resolve!: (value: Response) => void; let reads = 0;
        const controller = createSmartImportReviewBrowserController({ fetch: async (url, init) => {
            if (++reads === 1) return new Promise<Response>(r => { resolve = r; }); return f.fetcher(url, init);
        } });
        const old = controller.readProposal(patientId); if (reset) controller.reset(); else await controller.readProposal(patientId);
        resolve(Response.json({ id: patientId, firstName: 'Alice', lastName: 'Esempio', version: 1 }));
        await assert.rejects(old, { code: 'operation_superseded' }); assert.equal(f.calls.some(x => x.method === 'POST'), false);
    }
});
test('reset during reread prevents selection and retirement reaches the caller', async () => {
    const f = fixture(); let pause = false; let release!: () => void; let entered!: () => void; const pending = new Promise<void>(r => { entered = r; });
    const controller = createSmartImportReviewBrowserController({ fetch: async (url, init) => {
        if (pause) { pause = false; entered(); await new Promise<void>(r => { release = r; }); } return f.fetcher(url, init);
    } });
    const proposal = await controller.readProposal(patientId); pause = true;
    const run = controller.run({ patientId, proposal, ambulatory: proposal.ambulatories[0], captureInput }, true);
    await pending; controller.reset(); release(); await assert.rejects(run, { code: 'operation_superseded' });
    assert.equal(f.calls.some(x => x.method === 'POST'), false);
});
