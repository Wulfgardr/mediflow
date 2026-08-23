/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';

import { SmartImportReviewBrowserControllerError, createSmartImportReviewBrowserController } from './smart-import-review-browser-controller.ts';

const lease = { sessionRef: `ssr_${'1'.repeat(32)}`, selectionEpoch: 1, patientRef: `ptr_${'2'.repeat(32)}`, ambulatoryRef: `abr_${'3'.repeat(32)}`, leaseRef: `lsr_${'4'.repeat(32)}`, expiresAt: 999_999 };
const captureInput = { patient: { version: 1 }, currentDiagnoses: [], currentActiveTherapies: [], sources: [{ kind: 'patient-notes', originKey: 'patient-notes:1', label: 'Synthetic', date: null, content: 'Synthetic source' }], therapyCandidateHints: [] };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const rejects = (code: string) => (error: unknown) => error instanceof SmartImportReviewBrowserControllerError && error.code === code;
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((next) => { resolve = next; }); return { promise, resolve }; }

test('runs one context-proposal, selection, capture, ingest, and preview sequence', async () => {
    const calls: string[] = []; const controller = createSmartImportReviewBrowserController({ clock: () => new Date('2026-08-23T12:00:00.000Z'), requestId: (() => { let n = 0; return () => `req_${(++n).toString().padStart(32, 'a')}`; })(), fetch: async (path, init) => {
        const url = String(path); calls.push(`${init?.method}:${url}`); if (url === '/api/context') return response({ ambulatoryId: 'ambulatory.synthetic.01' });
        if (init?.method === 'GET') return response({ selectionEpoch: 0 }); if (url.endsWith('/selection')) return response({ selection: lease });
        if (url.endsWith('/ingest')) return response({ handle: `prj_${'f'.repeat(32)}` }); return response({ preview: { writesPerformed: 0, apply: 'denied', status: 'denied', code: 'projection_unavailable', proposal: null, receipt: null, provenance: null, reviewRef: null } });
    } });
    const proposal = await controller.readProposal(); const result = await controller.run({ patientId: 'patient.synthetic.01', proposal, captureInput }, true);
    assert.equal(result.preview.status, 'denied'); assert.deepEqual(calls, ['GET:/api/context', 'GET:/api/ai/smart-import/selection', 'POST:/api/ai/smart-import/selection', 'POST:/api/ai/smart-import/ingest', 'POST:/api/ai/smart-import/preview']);
});

test('rejects unconfirmed, foreign, and consumed proposals before any POST', async () => {
    let posts = 0; const controller = createSmartImportReviewBrowserController({ fetch: async (_path, init) => { if (init?.method === 'POST') posts += 1; return response({ ambulatoryId: 'ambulatory.synthetic.01' }); } });
    const proposal = await controller.readProposal();
    await assert.rejects(() => controller.run({ patientId: 'patient.synthetic.01', proposal, captureInput }, false as never), rejects('confirmation_required'));
    await assert.rejects(() => controller.run({ patientId: 'patient.synthetic.01', proposal: { ambulatoryId: proposal.ambulatoryId }, captureInput }, true), rejects('proposal_stale'));
    assert.equal(posts, 0);
});

test('capture failure prevents ingest and a conflict never retries selection POST', async () => {
    let posts = 0; const controller = createSmartImportReviewBrowserController({ fetch: async (path, init) => { if (init?.method === 'POST') posts += 1; if (path === '/api/context') return response({ ambulatoryId: 'ambulatory.synthetic.01' }); if (init?.method === 'GET') return response({ selectionEpoch: 0 }); return response({}, 409); } });
    const proposal = await controller.readProposal(); await assert.rejects(() => controller.run({ patientId: 'patient.synthetic.01', proposal, captureInput: { ...captureInput, sources: [] } }, true));
    assert.equal(posts, 1);
});

test('capture invalid prevents ingest and reset fences an in-flight run', async () => {
    let posts = 0; const controller = createSmartImportReviewBrowserController({ fetch: async (path, init) => { if (init?.method === 'POST') posts += 1; if (path === '/api/context') return response({ ambulatoryId: 'ambulatory.synthetic.01' }); return init?.method === 'GET' ? response({ selectionEpoch: 0 }) : response({ selection: lease }); } });
    const proposal = await controller.readProposal(); await assert.rejects(() => controller.run({ patientId: 'patient.synthetic.01', proposal, captureInput: { ...captureInput, sources: [] } }, true)); assert.equal(posts, 1);
    const pending = deferred<Response>(); const stale = createSmartImportReviewBrowserController({ fetch: async (path) => path === '/api/context' ? response({ ambulatoryId: 'ambulatory.synthetic.01' }) : pending.promise });
    const staleProposal = await stale.readProposal(); const run = stale.run({ patientId: 'patient.synthetic.01', proposal: staleProposal, captureInput }, true); stale.reset(); pending.resolve(response({ selectionEpoch: 0 }));
    await assert.rejects(() => run, rejects('operation_superseded'));
});

test('fences reset and overlapping context reads so only the latest proposal can run', async () => {
    const first = deferred<Response>(); let reads = 0; let posts = 0;
    const controller = createSmartImportReviewBrowserController({ fetch: async (_path, init) => { if (init?.method === 'POST') posts += 1; reads += 1; return reads === 1 ? first.promise : response({ ambulatoryId: `ambulatory.synthetic.0${reads}` }); } });
    const stale = controller.readProposal(); controller.reset(); first.resolve(response({ ambulatoryId: 'ambulatory.synthetic.01' })); await assert.rejects(() => stale, rejects('operation_superseded'));
    const oldRead = controller.readProposal(); const newest = await controller.readProposal(); await assert.rejects(() => oldRead, rejects('operation_superseded'));
    await assert.rejects(() => controller.run({ patientId: 'patient.synthetic.01', proposal: Object.freeze({ ambulatoryId: 'ambulatory.synthetic.02' }), captureInput }, true), rejects('proposal_stale'));
    assert.equal(newest.ambulatoryId, 'ambulatory.synthetic.03'); assert.equal(posts, 0);
});
