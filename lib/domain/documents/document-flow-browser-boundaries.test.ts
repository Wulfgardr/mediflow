/* @Codex: real browser adapters, wholly synthetic HTTP fixtures. Not live-route/host qualification. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { requestAnyDocLocalExtractionPreview } from './anydoc-local-extraction-client.ts';
import { createDocumentSynthesisBrowserOrchestrator } from '../../ai-providers/fabric/document-synthesis-browser-orchestrator.ts';
import { createDocumentSynthesisReviewBrowserController } from '../../ai-providers/fabric/document-synthesis-review-browser-controller.ts';

const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const attachmentId = 'synthetic-file/uno';
function extraction() {
    const markdown = 'Documento interamente inventato per il test: la sfera è blu.';
    return {
        schemaVersion: 'mediflow.anydoc_local_extraction.v1',
        provenance: { attachmentId, sourceSha256: sha('synthetic source'), byteLength: 16 },
        receipt: { receiptId: sha('synthetic receipt'), parser: 'anydoc-local', outcome: 'extracted', sourceSha256: sha('synthetic source'),
            sourceByteLength: 16, markdownSha256: sha(markdown), markdownByteLength: Buffer.byteLength(markdown) },
        review: 'required', writes: 0, apply: 'none', status: 'extracted', markdown, candidateUse: 'review_only',
    };
}
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('explicit extraction uses the real attachment route, no body, no cache and validates the UTF-8 digest', async () => {
    const value = extraction(); let calls = 0; const controller = new AbortController();
    const request: typeof fetch = async (input, init) => {
        calls += 1;
        assert.equal(input, '/api/attachments/synthetic-file%2Funo/local-extraction');
        assert.equal(init?.method, 'POST'); assert.equal(init?.cache, 'no-store');
        assert.equal(init?.body, undefined); assert.equal(init?.signal, controller.signal);
        return response(value);
    };
    const result = await requestAnyDocLocalExtractionPreview(attachmentId, request, controller.signal);
    assert.equal(result?.status, 'available'); assert.equal(result?.markdown, value.markdown);
    assert.equal(calls, 1);
});

for (const violation of ['digest', 'source', 'write', 'apply', 'review', 'extra-key', 'non-canonical'] as const) {
    test(`extraction refuses ${violation} without manufacturing a usable preview`, async () => {
        const value: Record<string, unknown> = extraction();
        if (violation === 'digest') value.markdown = 'different synthetic text';
        if (violation === 'source') (value.provenance as { attachmentId: string }).attachmentId = 'other-synthetic-source';
        if (violation === 'write') value.writes = 1;
        if (violation === 'apply') value.apply = 'automatic';
        if (violation === 'review') value.review = 'optional';
        if (violation === 'extra-key') value.extra = true;
        const request: typeof fetch = async () => violation === 'non-canonical'
            ? new Response(JSON.stringify(value, null, 2)) : response(value);
        assert.equal(await requestAnyDocLocalExtractionPreview(attachmentId, request), null);
    });
}

test('extraction cancellation discards even an otherwise valid late response', async () => {
    const controller = new AbortController();
    const request: typeof fetch = async () => { controller.abort(); return response(extraction()); };
    assert.equal(await requestAnyDocLocalExtractionPreview(attachmentId, request, controller.signal), null);
});

test('extraction unavailable response and abort before start never retry', async () => {
    let calls = 0;
    const request: typeof fetch = async () => { calls += 1; return response({ code: 'unsupported_local_extraction' }, 409); };
    assert.equal(await requestAnyDocLocalExtractionPreview(attachmentId, request), null);
    const controller = new AbortController(); controller.abort();
    assert.equal(await requestAnyDocLocalExtractionPreview(attachmentId, request, controller.signal), null);
    assert.equal(calls, 1);
});

test('synthesis sends only opaque handles over the actual three paths; invalid publication stays denied', async () => {
    const calls: Array<{ path: unknown; body: unknown; headers?: HeadersInit }> = [];
    const captureHandle = `dsc_${'a'.repeat(32)}`; const previewHandle = `dsp_${'b'.repeat(32)}`;
    const request: typeof fetch = async (input, init) => {
        assert.equal(init?.method, 'POST'); assert.equal(init?.cache, 'no-store');
        calls.push({ path: input, body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body ?? null, headers: init?.headers });
        return response(calls.length === 1 ? { captureHandle } : calls.length === 2 ? { previewHandle } : { status: 'available' });
    };
    const orchestrator = createDocumentSynthesisBrowserOrchestrator({ fetch: request });
    assert.equal(calls.length, 0);
    await assert.rejects(orchestrator.run('synthetic-attachment', async () => ({ id: 'synthetic-attachment', data: 'U3ludGhldGljLg==' })), { code: 'response_invalid' });
    assert.deepEqual(calls, [
        { path: '/api/ai/document-synthesis/capture', body: { attachmentId: 'synthetic-attachment' }, headers: { 'content-type': 'application/json' } },
        { path: '/api/ai/document-synthesis/ingest', body: new ArrayBuffer(10), headers: { 'X-MediFlow-Document-Synthesis-Capture': captureHandle, 'Content-Type': 'application/octet-stream' } },
        { path: '/api/ai/document-synthesis/preview', body: { previewHandle }, headers: { 'content-type': 'application/json' } },
    ]);
});

for (const status of [401, 409, 503]) {
    test(`synthesis HTTP ${status} cannot advance to ingest, fallback or a clinical write`, async () => {
        let calls = 0;
        const orchestrator = createDocumentSynthesisBrowserOrchestrator({ fetch: async () => {
            calls += 1; return response({ error: 'synthetic denial', code: 'operation_unavailable' }, status);
        } });
        await assert.rejects(orchestrator.run('synthetic-attachment'), { code: status === 401 ? 'session_unavailable' : 'capture_unavailable' });
        assert.equal(calls, 1);
    });
}

test('unknown synthesis transport outcome requires a new user attempt, never automatic replay', async () => {
    let calls = 0;
    const orchestrator = createDocumentSynthesisBrowserOrchestrator({ fetch: async () => { calls += 1; throw new Error('synthetic lost response'); } });
    await assert.rejects(orchestrator.run('synthetic-attachment'), { code: 'capture_outcome_unknown' });
    assert.equal(calls, 1);
});

test('source reset prevents a late capture from advancing or publishing', async () => {
    let calls = 0;
    const orchestrator = createDocumentSynthesisBrowserOrchestrator({ fetch: async () => {
        calls += 1; orchestrator.reset(); return response({ captureHandle: `dsc_${'a'.repeat(32)}` });
    } });
    await assert.rejects(orchestrator.run('synthetic-attachment'), { code: 'operation_superseded' });
    assert.equal(calls, 1);
});

function contextController(changeVersion = false) {
    const calls: string[] = []; let patientReads = 0;
    const controller = createDocumentSynthesisReviewBrowserController({ fetch: async (input) => {
        const path = String(input); calls.push(path);
        if (path === '/api/patients/synthetic-patient') {
            patientReads += 1;
            return response({ id: 'synthetic-patient', firstName: 'Inventato', lastName: 'Test', version: changeVersion ? patientReads : 1 });
        }
        if (path === '/api/ambulatories') return response([{ id: 'synthetic-ambulatory', name: 'Ambulatorio inventato', address: '', version: 1 }]);
        assert.fail(`Unexpected authority or synthesis request: ${path}`);
    } });
    return { calls, controller };
}

test('context read does not grant authority; confirmation and a current exact choice remain mandatory', async () => {
    const { controller, calls } = contextController();
    const proposal = await controller.readProposal('synthetic-patient');
    const base = { patientId: 'synthetic-patient', attachmentId: 'synthetic-attachment', proposal, ambulatory: proposal.ambulatories[0] };
    // Intentionally test the runtime guard with a value outside the TypeScript contract.
    await assert.rejects(controller.run(base, false as true), { code: 'confirmation_required' });
    await assert.rejects(controller.run({ ...base, ambulatory: { ...proposal.ambulatories[0] } }, true), { code: 'choice_required' });
    controller.reset();
    await assert.rejects(controller.run(base, true), { code: 'proposal_stale' });
    assert.deepEqual(calls, ['/api/patients/synthetic-patient', '/api/ambulatories']);
});

test('changed patient version invalidates confirmation before selection/capture', async () => {
    const { controller, calls } = contextController(true);
    const proposal = await controller.readProposal('synthetic-patient');
    await assert.rejects(controller.run({ patientId: 'synthetic-patient', attachmentId: 'synthetic-attachment', proposal, ambulatory: proposal.ambulatories[0] }, true), { code: 'proposal_stale' });
    assert.deepEqual(calls, ['/api/patients/synthetic-patient', '/api/ambulatories', '/api/patients/synthetic-patient', '/api/ambulatories']);
});

test('context reset aborts transport and discards a late patient read', async () => {
    let signal: AbortSignal | null | undefined; let calls = 0;
    const controller = createDocumentSynthesisReviewBrowserController({ fetch: async (_input, init) => {
        calls += 1; signal = init?.signal; controller.reset();
        return response({ id: 'synthetic-patient', firstName: 'Inventato', lastName: 'Test', version: 1 });
    } });
    await assert.rejects(controller.readProposal('synthetic-patient'), { code: 'operation_superseded' });
    assert.equal(signal?.aborted, true); assert.equal(calls, 1);
});
