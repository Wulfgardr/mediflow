/* @Codex */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    createTreatmentReasoningIngestHttpHandler,
    createTreatmentReasoningPreviewHttpHandler,
} from './treatment-reasoning-production-http.ts';
import type { TreatmentReasoningPublication } from './treatment-reasoning-production-operation.ts';

const request = (body: unknown) => new Request('http://localhost/api/ai/treatment-reasoning/test', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

const projection = Object.freeze({
    schemaVersion: 'mediflow.ai.treatment-reasoning-projection-attachment.v1', capability: 'treatment_reasoning',
    patientRevision: 7, sourceRevision: 'source_synthetic_01', capturedAt: '2026-09-01T10:00:00.000Z',
    therapyRefs: Object.freeze(['therapy:synthetic.01']), evidenceRefs: Object.freeze(['therapy:synthetic.01']),
    sources: Object.freeze([Object.freeze({ id: 'therapy:synthetic.01', sourceKind: 'therapy', label: 'Terapia sintetica', excerpt: 'Fonte sintetica.', date: null })]),
});

const publication = Object.freeze({
    schemaVersion: 'mediflow.ai.treatment-reasoning-publication.v1', capability: 'treatment_reasoning', stage: 'preview', review: 'required', status: 'available',
    value: Object.freeze({ synthetic: true }), sourceBindings: Object.freeze([]), attestation: Object.freeze({ synthetic: true }),
    fabricReceipt: Object.freeze({ synthetic: true }), provenance: Object.freeze({ synthetic: true }),
    sourceRevision: 'source_synthetic_01', capturedAt: '2026-09-01T10:00:00.000Z', writesPerformed: 0, applyPolicy: 'none',
}) as unknown as TreatmentReasoningPublication;

test('acquires authenticated ingest before body and returns only the opaque handle', async () => {
    const calls: string[] = [];
    const handler = createTreatmentReasoningIngestHttpHandler({
        async acquireIngest() { calls.push('auth'); return Object.freeze({ ingest(input: unknown) {
            calls.push(`ingest:${Object.keys(input as object).join(',')}`); return 'trp_0123456789abcdef0123456789abcdef';
        } }); },
    });
    const response = await handler(request({ projection, requestId: 'request.synthetic.ingest.01' }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { handle: 'trp_0123456789abcdef0123456789abcdef' });
    assert.deepEqual(calls, ['auth', 'ingest:projection,requestId']);
});

test('publishes the trusted review-only root directly with no-store', async () => {
    const calls: string[] = [];
    const handler = createTreatmentReasoningPreviewHttpHandler({
        async acquirePreview() { calls.push('auth'); return Object.freeze({ async preview(input: unknown) {
            calls.push(`preview:${Object.keys(input as object).join(',')}`);
            return Object.freeze({ status: 'available' as const, code: null, publication, writesPerformed: 0 as const, applyPolicy: 'none' as const });
        } }); },
    });
    const response = await handler(request({ handle: 'trp_0123456789abcdef0123456789abcdef', requestId: 'request.synthetic.preview.01' }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), publication);
    assert.deepEqual(calls, ['auth', 'preview:handle,requestId']);
});

test('authentication failure observes no request body and denials remain typed', async () => {
    let bodyReads = 0;
    const unauthenticated = createTreatmentReasoningIngestHttpHandler({ async acquireIngest() { return null; } });
    const opaqueRequest = Object.freeze({ json: async () => { bodyReads += 1; return { provider: 'athena_mlx' }; } }) as unknown as Request;
    const deniedAuth = await unauthenticated(opaqueRequest);
    assert.equal(deniedAuth.status, 401);
    assert.equal(bodyReads, 0);

    const unavailable = createTreatmentReasoningPreviewHttpHandler({ async acquirePreview() {
        return Object.freeze({ async preview() { return Object.freeze({ status: 'denied' as const, code: 'runtime_unavailable' as const,
            publication: null, writesPerformed: 0 as const, applyPolicy: 'none' as const }); } });
    } });
    const deniedRuntime = await unavailable(request({ handle: 'trp_0123456789abcdef0123456789abcdef', requestId: 'request.synthetic.preview.02' }));
    assert.equal(deniedRuntime.status, 503);
    assert.deepEqual(await deniedRuntime.json(), { code: 'runtime_unavailable', error: 'Treatment Reasoning non disponibile.' });
});

test('rejects caller authority and malformed JSON before an operation runs', async () => {
    let calls = 0;
    const handler = createTreatmentReasoningPreviewHttpHandler({ async acquirePreview() {
        return Object.freeze({ async preview() { calls += 1; throw new Error('must not run'); } });
    } });
    const extra = await handler(request({ handle: 'trp_0123456789abcdef0123456789abcdef', requestId: 'request.synthetic.preview.03', apply: true }));
    assert.equal(extra.status, 400); assert.equal(calls, 0);
    const malformed = await handler(new Request('http://localhost/test', { method: 'POST', body: '{' }));
    assert.equal(malformed.status, 400); assert.equal(calls, 0);
});
