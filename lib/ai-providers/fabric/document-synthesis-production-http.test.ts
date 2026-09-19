/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createDocumentSynthesisCaptureHttpHandler,
    createDocumentSynthesisIngestHttpHandler,
    createDocumentSynthesisPreviewHttpHandler,
    DOCUMENT_SYNTHESIS_CAPTURE_HEADER,
} from './document-synthesis-production-http.ts';
import { serializeDocumentSynthesisPreviewWire } from './document-synthesis-preview-wire.ts';

function request(body: unknown, events: string[]): Request {
    return { json: async () => { events.push('body'); return body; } } as Request;
}

function ingestRequest(handle: string): Request {
    return new Request('http://localhost/api/ai/document-synthesis/ingest', { method: 'POST', body: new Uint8Array([1]),
        headers: { host: 'localhost', origin: 'http://localhost', 'content-type': 'application/octet-stream',
            [DOCUMENT_SYNTHESIS_CAPTURE_HEADER]: handle } });
}

test('authenticates before observing each request and emits no-store opaque handles', async () => {
    const events: string[] = [];
    const operation = Object.freeze({
        capture: async (input: unknown) => { events.push('capture'); assert.deepEqual(input, { attachmentId: 'attachment.synthetic' }); return { status: 'available' as const, code: null, captureHandle: `dsc_${'1'.repeat(32)}` }; },
        ingest: async (input: unknown, received: Request) => { events.push('ingest'); assert.deepEqual(input, { captureHandle: `dsc_${'1'.repeat(32)}` }); assert.equal(received.headers.get('content-type'), 'application/octet-stream'); return { status: 'available' as const, code: null, previewHandle: `dsp_${'2'.repeat(32)}` }; },
        preview: async () => { events.push('preview'); return { status: 'available' as const, code: null, publication: {} }; },
    });
    const acquireOperation = async () => { events.push('auth'); return operation; };
    const capture = await createDocumentSynthesisCaptureHttpHandler({ acquireOperation })(request({ attachmentId: 'attachment.synthetic' }, events));
    assert.equal(capture.status, 200); assert.equal(capture.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await capture.json(), { captureHandle: `dsc_${'1'.repeat(32)}` });
    const ingest = await createDocumentSynthesisIngestHttpHandler({ acquireOperation })(ingestRequest(`dsc_${'1'.repeat(32)}`));
    assert.equal(ingest.status, 200); assert.equal(ingest.headers.get('cache-control'), 'no-store');
    const preview = await createDocumentSynthesisPreviewHttpHandler({ acquireOperation, serialize: () => serializeDocumentSynthesisPreviewWire(null) })(request({ previewHandle: `dsp_${'2'.repeat(32)}` }, events));
    assert.equal(preview.status, 503);
    assert.deepEqual(events, ['auth', 'body', 'capture', 'auth', 'ingest', 'auth', 'body', 'preview']);
});

test('denies before body observation when authentication is unavailable', async () => {
    let reads = 0;
    const handler = createDocumentSynthesisCaptureHttpHandler({ acquireOperation: async () => null });
    const response = await handler({ json: async () => { reads += 1; return { attachmentId: 'forbidden' }; } } as Request);
    assert.equal(response.status, 401);
    assert.equal(reads, 0);
});

test('rejects a non-local binary ingress before the capture can reach the operation', async () => {
    let ingests = 0;
    const handler = createDocumentSynthesisIngestHttpHandler({ acquireOperation: async () => Object.freeze({
        capture: async () => ({ status: 'denied' as const, code: 'input_invalid', captureHandle: null }),
        ingest: async () => { ingests += 1; return { status: 'available' as const, code: null, previewHandle: `dsp_${'2'.repeat(32)}` }; },
        preview: async () => ({ status: 'denied' as const, code: 'input_invalid', publication: null }),
    }) });
    const response = await handler(new Request('https://example.test/api/ai/document-synthesis/ingest', { method: 'POST', body: new Uint8Array([1]),
        headers: { host: 'example.test', origin: 'https://example.test', 'content-type': 'application/octet-stream',
            [DOCUMENT_SYNTHESIS_CAPTURE_HEADER]: `dsc_${'1'.repeat(32)}` } }));
    assert.equal(response.status, 400);
    assert.equal(ingests, 0);
});
