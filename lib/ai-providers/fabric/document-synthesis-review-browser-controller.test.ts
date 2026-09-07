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


function fixture(pause?: string, status = 200) {
    const calls: Array<{ url: string; body: unknown; signal?: AbortSignal | null }> = [];
    let resume: (() => void) | undefined;
    let entered!: () => void;
    const paused = new Promise<void>((resolve) => { entered = resolve; });
    const controller = createDocumentSynthesisReviewBrowserController({ fetch: async (input, init) => {
        const url = String(input); const body = init?.body ? JSON.parse(String(init.body)) : null;
        calls.push({ url, body, signal: init?.signal });
        if (url.endsWith(pause ?? 'never')) { entered(); await new Promise<void>((resolve) => { resume = resolve; }); }
        if (url === '/api/context') return Response.json({ ambulatoryId: 'synthetic-ambulatory' });
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
    return { controller, calls, paused, resume: () => resume?.() };
}
const intent = { patientId: 'synthetic-patient', attachmentId: 'synthetic-attachment' };

test('confirms a single context then selects before DS capture without Smart Import generation', async () => {
    const f = fixture(); const proposal = await f.controller.readProposal();
    assert.equal(f.calls.length, 1);
    await assert.rejects(f.controller.run({ ...intent, proposal }, false as true), { code: 'confirmation_required' });
    await assert.rejects(f.controller.run({ ...intent, proposal: { ...proposal } }, true), { code: 'proposal_stale' });
    const result = await f.controller.run({ ...intent, proposal }, true);
    assert.equal(result.publication.receipt.writesPerformed, 0);
    assert.deepEqual(f.calls.map(({ url, body }) => ({ url, body })), [
        { url: '/api/context', body: null },
        { url: '/api/ai/smart-import/selection', body: null },
        { url: '/api/ai/smart-import/selection', body: { expectedEpoch: 0, patientId: intent.patientId, ambulatoryId: proposal.ambulatoryId } },
        { url: '/api/ai/document-synthesis/capture', body: { attachmentId: intent.attachmentId } },
        { url: '/api/ai/document-synthesis/ingest', body: { captureHandle: `dsc_${'5'.repeat(32)}` } },
        { url: '/api/ai/document-synthesis/preview', body: { previewHandle: `dsp_${'6'.repeat(32)}` } },
    ]);
    await assert.rejects(f.controller.run({ ...intent, proposal }, true), { code: 'proposal_stale' });
    f.controller.reset();
});

test('selection denial and conflict stop before capture and require fresh confirmation', async () => {
    for (const status of [401, 409, 503]) {
        const f = fixture(undefined, status); const proposal = await f.controller.readProposal();
        await assert.rejects(f.controller.run({ ...intent, proposal }, true));
        assert.equal(f.calls.some(({ url }) => url.endsWith('/capture')), false);
        await assert.rejects(f.controller.run({ ...intent, proposal }, true), { code: 'proposal_stale' });
        f.controller.reset();
    }
});

test('reset aborts transport and suppresses late results at every asynchronous boundary', async () => {
    for (const pause of ['/context', '/selection', '/capture', '/ingest', '/preview']) {
        const f = fixture(pause);
        const pending = pause === '/context' ? f.controller.readProposal()
            : f.controller.run({ ...intent, proposal: await f.controller.readProposal() }, true);
        await f.paused;
        const count = f.calls.length; f.controller.reset();
        assert.equal(f.calls.at(-1)?.signal?.aborted, true);
        f.resume();
        await assert.rejects(pending, { code: 'operation_superseded' });
        assert.equal(f.calls.length, count);
    }
});
