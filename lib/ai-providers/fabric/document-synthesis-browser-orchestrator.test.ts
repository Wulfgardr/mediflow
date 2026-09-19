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

test('runs capture, binary ingest, and one preview without text, write, or provider inputs', async () => {
    const calls: Array<{ url: string; body: unknown; headers?: HeadersInit }> = [];
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input); const body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body ?? null;
        calls.push({ url, body, headers: init?.headers });
        if (url.endsWith('/capture')) return response({ captureHandle: `dsc_${'1'.repeat(32)}` });
        if (url.endsWith('/ingest')) return response({ previewHandle: `dsp_${'2'.repeat(32)}` });
        if (url.endsWith('/preview')) return response(serializeDocumentSynthesisPreviewWire(publication));
        throw new Error('unexpected route');
    };
    const orchestrator = createDocumentSynthesisBrowserOrchestrator({ fetch: fetcher as typeof fetch });
    const result = await orchestrator.run('attachment.synthetic.1', async () => ({ id: 'attachment.synthetic.1', data: 'U3ludGhldGljLg==' }));
    assert.equal(result.publication.receipt.writesPerformed, 0);
    assert.deepEqual(calls, [
        { url: '/api/ai/document-synthesis/capture', body: { attachmentId: 'attachment.synthetic.1' }, headers: { 'content-type': 'application/json' } },
        { url: '/api/ai/document-synthesis/ingest', body: new ArrayBuffer(10), headers: { 'X-MediFlow-Document-Synthesis-Capture': `dsc_${'1'.repeat(32)}`, 'Content-Type': 'application/octet-stream' } },
        { url: '/api/ai/document-synthesis/preview', body: { previewHandle: `dsp_${'2'.repeat(32)}` }, headers: { 'content-type': 'application/json' } },
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
    await assert.rejects(() => orchestrator.run('attachment.synthetic.1', async () => ({ id: 'attachment.synthetic.1', data: 'U3ludGhldGljLg==' })), (error: unknown) => error instanceof DocumentSynthesisBrowserOrchestratorError && error.code === 'unsupported_local_extraction');
    assert.equal(calls, 2);
    const pending = createDocumentSynthesisBrowserOrchestrator({
        fetch: async (input) => {
            calls += 1;
            if (String(input).endsWith('/capture')) return response({ captureHandle: `dsc_${'1'.repeat(32)}` });
            return new Promise((resolve) => setImmediate(() => resolve(response({ previewHandle: `dsp_${'2'.repeat(32)}` }))));
        },
    });
    const run = pending.run('attachment.synthetic.2', async () => ({ id: 'attachment.synthetic.2', data: 'U3ludGhldGljLg==' }));
    await new Promise((resolve) => setImmediate(resolve));
    pending.reset();
    await assert.rejects(run, (error: unknown) => error instanceof DocumentSynthesisBrowserOrchestratorError && error.code === 'operation_superseded');
});

test('reset during facade decryption discards bytes and never posts ingest', async () => {
    const entered = Promise.withResolvers<void>(); const release = Promise.withResolvers<void>();
    const calls: string[] = [];
    const orchestrator = createDocumentSynthesisBrowserOrchestrator({ fetch: async (input) => {
        calls.push(String(input));
        return response({ captureHandle: `dsc_${'1'.repeat(32)}` });
    } });
    const pending = orchestrator.run('attachment.synthetic.3', async () => {
        entered.resolve(); await release.promise;
        return { id: 'attachment.synthetic.3', data: 'U3ludGhldGljLg==' };
    });
    await entered.promise;
    orchestrator.reset(); release.resolve();
    await assert.rejects(pending, (error: unknown) => error instanceof DocumentSynthesisBrowserOrchestratorError && error.code === 'operation_superseded');
    assert.deepEqual(calls, ['/api/ai/document-synthesis/capture']);
});

/* @Codex */
test('preserves session unavailability without continuing to ingest or inference', async () => {
    let calls = 0;
    const orchestrator = createDocumentSynthesisBrowserOrchestrator({ fetch: async () => {
        calls++; return Response.json({ error: 'Document Synthesis non disponibile.', code: 'session_unavailable' }, { status: 401 });
    } });
    await assert.rejects(orchestrator.run('synthetic-attachment', async () => ({ id: 'synthetic-attachment', data: 'U3ludGhldGljLg==' })), { code: 'session_unavailable' });
    assert.equal(calls, 1);
});
