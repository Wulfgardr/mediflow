/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createDocumentSynthesisReviewBrowserController } from './document-synthesis-review-browser-controller.ts';
import { serializeDocumentSynthesisPreviewWire } from './document-synthesis-preview-wire.ts';

const publication = {
    schemaVersion: 'mediflow.document-synthesis.publication.v1',
    output: { schemaVersion: 'mediflow.ai.extract.v1', task: 'document_synthesis', summary: 'Sintesi.', data: { qualityLevel: 'green', medications: [], diagnoses: [], problemStatements: [], therapyCandidates: [], servicePrescriptions: [] } },
    citations: [{ label: 'S1', quote: 'Fonte.', startByte: 0, endByte: 6, quoteSha256: 'a'.repeat(64) }],
    claims: [{ claimPath: 'summary', labels: ['S1'] }],
    receipt: { schemaVersion: 'mediflow.document-synthesis.publication-receipt.v1', capability: 'document_synthesis', outputSha256: 'b'.repeat(64), claimCitationsDigestSha256: Array(32).fill(1), sourceSetDigestSha256: Array(32).fill(2), providerBindingReceipt: { schemaVersion: 'mediflow.document-synthesis.provider-binding.v1', capability: 'document_synthesis', registryTask: 'reasoning', provider: 'ollama', model: 'local:latest', venue: 'local_process', egress: 'none', fallback: 'none', runtimeReadiness: 'required' }, reviewOnly: true, applyPolicy: 'none', writesPerformed: 0 },
    provenance: { schemaVersion: 'mediflow.document-synthesis.publication-provenance.v1', capability: 'document_synthesis', sourceSetAuthority: 'application_host', inputDigestScope: 'ordered_normalized_provider_projection_set', citationSupport: 'provider_declared_host_membership_and_locator_validated', modelCausality: 'not_established', fabricProvenance: { schemaVersion: 'mediflow.ai.fabric-provenance.v1', capability: 'document_synthesis', venue: 'local_process', provider: 'ollama', model: 'local:latest', preprocessing: ['context_minimization'], receipt: { schemaVersion: 'mediflow.ai.fabric-resolution.v1', capability: 'document_synthesis', class: 'generative', venue: 'local_process', egressProfile: { id: 'local_only', version: 'mediflow.ai.egress-profile.v1', egress: 'none' }, provider: 'ollama', model: 'local:latest', providerReceipt: null, fallbackCount: 0 } } },
};


const PATIENT = 'synthetic-patient';
const ATTACHMENT = 'synthetic-document';
function fixture(pause?: string, status = 200) {
    const state = { version: 1, name: 'Ambulatorio Centro' };
    const calls: Array<{ url: string; body: unknown; signal?: AbortSignal | null }> = [];
    let resume: (() => void) | undefined; let entered!: () => void; let pauseOnce = true;
    const paused = new Promise<void>((resolve) => { entered = resolve; });
    const controller = createDocumentSynthesisReviewBrowserController({ fetch: async (input, init) => {
        const url = String(input); const body = init?.body ? JSON.parse(String(init.body)) : null;
        calls.push({ url, body, signal: init?.signal });
        if (pauseOnce && url.endsWith(pause ?? 'never')) { pauseOnce = false; entered(); await new Promise<void>((resolve) => { resume = resolve; }); }
        // The ordinary session has no ambulatory cookie; this route must not be needed.
        if (url === '/api/context') return Response.json({ ambulatoryId: null });
        if (url === `/api/patients/${PATIENT}`) return Response.json({ id: PATIENT, firstName: 'Alice', lastName: 'Esempio', version: state.version });
        if (url === '/api/ambulatories') return Response.json([
            { id: 'synthetic-centro', name: state.name, address: 'Via Centrale', version: 1, isDefault: true },
            { id: 'synthetic-nord', name: 'Ambulatorio Nord', address: null, version: 1 },
        ]);
        if (url.endsWith('/selection')) return init?.method === 'GET'
            ? Response.json({ selectionEpoch: 0 })
            : Response.json({ selection: { sessionRef: `ssr_${'1'.repeat(32)}`, selectionEpoch: 1,
                patientRef: `ptr_${'2'.repeat(32)}`, ambulatoryRef: `abr_${'3'.repeat(32)}`,
                leaseRef: `lsr_${'4'.repeat(32)}`, expiresAt: Date.now() + 60_000 } }, { status });
        if (url.endsWith('/capture')) return Response.json({ captureHandle: `dsc_${'5'.repeat(32)}` });
        if (url.endsWith('/ingest')) return Response.json({ previewHandle: `dsp_${'6'.repeat(32)}` });
        if (url.endsWith('/preview')) return Response.json(serializeDocumentSynthesisPreviewWire(publication));
        throw new Error('Unexpected request');
    } });
    return { controller, calls, state, paused, resume: () => resume?.() };
}
const intent = { patientId: PATIENT, attachmentId: ATTACHMENT };

test('missing cookie still offers named choices; only the explicit non-default selection reaches DS', async () => {
    const f = fixture(); const proposal = await f.controller.readProposal(PATIENT);
    assert.equal(proposal.patientName, 'Alice Esempio');
    assert.deepEqual(proposal.ambulatories.map((a) => a.name), ['Ambulatorio Centro', 'Ambulatorio Nord']);
    assert.equal(f.calls.some(({ url }) => url === '/api/context' || url.includes('/api/ai/')), false);
    const ambulatory = proposal.ambulatories[1];
    await assert.rejects(f.controller.run({ ...intent, proposal, ambulatory }, false as true), { code: 'confirmation_required' });
    await assert.rejects(f.controller.run({ ...intent, proposal, ambulatory: null }, true), { code: 'choice_required' });
    await assert.rejects(f.controller.run({ ...intent, proposal, ambulatory: { ...ambulatory } }, true), { code: 'choice_required' });
    const result = await f.controller.run({ ...intent, proposal, ambulatory }, true);
    assert.equal(result.publication.receipt.writesPerformed, 0);
    const mutations = f.calls.filter(({ body }) => body !== null);
    assert.deepEqual(mutations.map(({ url, body }) => ({ url, body })), [
        { url: '/api/ai/smart-import/selection', body: { expectedEpoch: 0, patientId: PATIENT, ambulatoryId: 'synthetic-nord' } },
        { url: '/api/ai/document-synthesis/capture', body: { attachmentId: ATTACHMENT } },
        { url: '/api/ai/document-synthesis/ingest', body: { captureHandle: `dsc_${'5'.repeat(32)}` } },
        { url: '/api/ai/document-synthesis/preview', body: { previewHandle: `dsp_${'6'.repeat(32)}` } },
    ]);
    await assert.rejects(f.controller.run({ ...intent, proposal, ambulatory }, true), { code: 'proposal_stale' });
    f.controller.reset();
});

test('membership denial and epoch conflict stop before capture without retrying selection', async () => {
    for (const status of [401, 409, 503]) {
        const f = fixture(undefined, status); const proposal = await f.controller.readProposal(PATIENT);
        await assert.rejects(f.controller.run({ ...intent, proposal, ambulatory: proposal.ambulatories[0] }, true));
        assert.equal(f.calls.some(({ url }) => url.endsWith('/capture')), false);
        assert.equal(f.calls.filter(({ body }) => body !== null).length, 1);
        f.controller.reset();
    }
});

test('stale patient, renamed ambulatory, and a different patient invalidate confirmation before selection', async () => {
    for (const drift of ['version', 'name', 'patient'] as const) {
        const f = fixture(); const proposal = await f.controller.readProposal(PATIENT);
        if (drift === 'version') f.state.version++;
        if (drift === 'name') f.state.name = 'Ambulatorio Rinominato';
        await assert.rejects(f.controller.run({ ...intent, patientId: drift === 'patient' ? 'other' : PATIENT,
            proposal, ambulatory: proposal.ambulatories[0] }, true), { code: 'proposal_stale' });
        assert.equal(f.calls.some(({ body }) => body !== null), false);
        f.controller.reset();
    }
});

test('reset aborts context reads and suppresses late selection, capture, ingest and preview', async () => {
    for (const pause of [`/patients/${PATIENT}`, '/ambulatories', '/selection', '/capture', '/ingest', '/preview']) {
        const f = fixture(pause);
        const pending = pause === '/ambulatories' || pause.includes('/patients/') ? f.controller.readProposal(PATIENT)
            : (async () => { const proposal = await f.controller.readProposal(PATIENT);
                return f.controller.run({ ...intent, proposal, ambulatory: proposal.ambulatories[0] }, true); })();
        await f.paused;
        const count = f.calls.length; f.controller.reset();
        assert.equal(f.calls.at(-1)?.signal?.aborted, true);
        f.resume(); await assert.rejects(pending, { code: 'operation_superseded' });
        assert.equal(f.calls.length, count);
    }
});

/* @Codex */
test('missing patient or empty ambulatory catalog never produces a confirmable context', async () => {
    for (const unavailable of ['patient', 'ambulatories', 'session'] as const) {
        const calls: string[] = [];
        const controller = createDocumentSynthesisReviewBrowserController({ fetch: async (url) => {
            calls.push(String(url));
            if (unavailable === 'session') return Response.json({}, { status: 401 });
            if (String(url).includes('/patients/')) return unavailable === 'patient' ? Response.json({}, { status: 404 })
                : Response.json({ id: PATIENT, firstName: 'Alice', lastName: 'Esempio', version: 1 });
            return Response.json([]);
        } });
        await assert.rejects(controller.readProposal(PATIENT), { code: unavailable === 'session' ? 'session_unavailable' : 'context_unavailable' });
        assert.equal(calls.some((url) => url.includes('/api/ai/')), false);
        controller.reset();
    }
});

/* @Codex */
test('a fresh confirmed request recovers after cancellation without reusing the old proposal or transport', async () => {
    for (const pause of ['/capture', '/ingest', '/preview']) {
        const f = fixture(pause);
        try {
            const oldProposal = await f.controller.readProposal(PATIENT);
            const pending = f.controller.run({ ...intent, proposal: oldProposal, ambulatory: oldProposal.ambulatories[0] }, true);
            await f.paused;
            const oldSignal = f.calls.at(-1)?.signal;
            f.controller.reset();
            assert.equal(oldSignal?.aborted, true);
            f.resume();
            await assert.rejects(pending, { code: 'operation_superseded' });
            await assert.rejects(f.controller.run({ ...intent, proposal: oldProposal,
                ambulatory: oldProposal.ambulatories[0] }, true), { code: 'proposal_stale' });
            const fresh = await f.controller.readProposal(PATIENT);
            const result = await f.controller.run({ ...intent, proposal: fresh, ambulatory: fresh.ambulatories[0] }, true);
            assert.notEqual(f.calls.at(-1)?.signal, oldSignal);
            assert.equal(f.calls.at(-1)?.signal?.aborted, false);
            assert.deepEqual([result.publication.receipt.reviewOnly, result.publication.receipt.writesPerformed,
                result.publication.receipt.applyPolicy], [true, 0, 'none']);
            assert.equal(f.calls.some(({ url }) => /(?:apply|commit|ocr-replay)/u.test(url)), false);
        } finally { f.resume(); f.controller.reset(); }
    }
});
