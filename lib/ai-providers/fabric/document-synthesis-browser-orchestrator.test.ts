/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';

import { createDocumentSynthesisBrowserOrchestrator, DocumentSynthesisBrowserOrchestratorError } from './document-synthesis-browser-orchestrator.ts';
import { serializeDocumentSynthesisPreviewWire } from './document-synthesis-preview-wire.ts';

function response(body: unknown, ok = true): Response {
    return { ok, json: async () => body } as Response;
}

const publication = {
    schemaVersion: 'mediflow.document-synthesis.publication.v1',
    output: { schemaVersion: 'mediflow.ai.extract.v1', task: 'document_synthesis', summary: 'Sintesi.', data: { qualityLevel: 'green', medications: [], diagnoses: [], problemStatements: [], therapyCandidates: [], servicePrescriptions: [] } },
    citations: [{ label: 'S1', quote: 'Fonte.', startByte: 0, endByte: 6, quoteSha256: 'a'.repeat(64) }],
    claims: [{ claimPath: 'summary', labels: ['S1'] }],
    receipt: { schemaVersion: 'mediflow.document-synthesis.publication-receipt.v1', capability: 'document_synthesis', outputSha256: 'b'.repeat(64), claimCitationsDigestSha256: Array(32).fill(1), sourceSetDigestSha256: Array(32).fill(2), providerBindingReceipt: { schemaVersion: 'mediflow.document-synthesis.provider-binding.v1', capability: 'document_synthesis', registryTask: 'reasoning', provider: 'ollama', model: 'local:latest', venue: 'local_process', egress: 'none', fallback: 'none', runtimeReadiness: 'required' }, reviewOnly: true, applyPolicy: 'none', writesPerformed: 0 },
    provenance: { schemaVersion: 'mediflow.document-synthesis.publication-provenance.v1', capability: 'document_synthesis', sourceSetAuthority: 'application_host', inputDigestScope: 'ordered_normalized_provider_projection_set', citationSupport: 'provider_declared_host_membership_and_locator_validated', modelCausality: 'not_established', fabricProvenance: { schemaVersion: 'mediflow.ai.fabric-provenance.v1', capability: 'document_synthesis', venue: 'local_process', provider: 'ollama', model: 'local:latest', preprocessing: ['context_minimization'], receipt: { schemaVersion: 'mediflow.ai.fabric-resolution.v1', capability: 'document_synthesis', class: 'generative', venue: 'local_process', egressProfile: { id: 'local_only', version: 'mediflow.ai.egress-profile.v1', egress: 'none' }, provider: 'ollama', model: 'local:latest', providerReceipt: null, fallbackCount: 0 } } },
};

test('runs capture, host-owned ingest, and one preview without source, write, or provider inputs', async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input); const body = init?.body ? JSON.parse(String(init.body)) : null;
        calls.push({ url, body });
        if (url.endsWith('/capture')) return response({ captureHandle: `dsc_${'1'.repeat(32)}` });
        if (url.endsWith('/ingest')) return response({ previewHandle: `dsp_${'2'.repeat(32)}` });
        if (url.endsWith('/preview')) return response(serializeDocumentSynthesisPreviewWire(publication));
        throw new Error('unexpected route');
    };
    const orchestrator = createDocumentSynthesisBrowserOrchestrator({ fetch: fetcher as typeof fetch });
    const result = await orchestrator.run('attachment.synthetic.1');
    assert.equal(result.publication.receipt.writesPerformed, 0);
    assert.deepEqual(calls, [
        { url: '/api/ai/document-synthesis/capture', body: { attachmentId: 'attachment.synthetic.1' } },
        { url: '/api/ai/document-synthesis/ingest', body: { captureHandle: `dsc_${'1'.repeat(32)}` } },
        { url: '/api/ai/document-synthesis/preview', body: { previewHandle: `dsp_${'2'.repeat(32)}` } },
    ]);
    assert.equal(JSON.stringify(calls).includes('provider'), false);
    assert.equal(JSON.stringify(calls).includes('prompt'), false);
    assert.equal(JSON.stringify(calls).includes('patientId'), false);
    assert.equal(JSON.stringify(calls).includes('sourceText'), false);
});

test('fails closed for unsupported extraction and never continues after reset', async () => {
    let calls = 0;
    const orchestrator = createDocumentSynthesisBrowserOrchestrator({
        fetch: async (input) => {
            calls += 1;
            return String(input).endsWith('/capture')
                ? response({ captureHandle: `dsc_${'1'.repeat(32)}` })
                : response({ error: 'unavailable', code: 'unsupported_local_extraction' }, false);
        },
    });
    await assert.rejects(() => orchestrator.run('attachment.synthetic.1'), (error: unknown) => error instanceof DocumentSynthesisBrowserOrchestratorError && error.code === 'unsupported_local_extraction');
    assert.equal(calls, 2);
    const pending = createDocumentSynthesisBrowserOrchestrator({
        fetch: async (input) => {
            calls += 1;
            if (String(input).endsWith('/capture')) return response({ captureHandle: `dsc_${'1'.repeat(32)}` });
            return new Promise((resolve) => setImmediate(() => resolve(response({ previewHandle: `dsp_${'2'.repeat(32)}` }))));
        },
    });
    const run = pending.run('attachment.synthetic.2');
    await new Promise((resolve) => setImmediate(resolve));
    pending.reset();
    await assert.rejects(run, (error: unknown) => error instanceof DocumentSynthesisBrowserOrchestratorError && error.code === 'operation_superseded');
});
