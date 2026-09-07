/* @Codex */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { requestAnyDocLocalExtractionPreview } from './anydoc-local-extraction-client.ts';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
function extracted(attachmentId = 'attachment.synthetic.l1d', markdown = 'Referto sintetico locale.', withOcr = false) {
    const ocrProvenance = {
        schemaVersion: 'mediflow.anydoc_local_ocr_provenance.v1', engine: 'apple_vision',
        scriptSha256: 'c'.repeat(64), pageCount: 2, ocrPageCount: 1, receiptSetSha256: 'd'.repeat(64),
    };
    return {
        schemaVersion: 'mediflow.anydoc_local_extraction.v1',
        provenance: { attachmentId, sourceSha256: 'a'.repeat(64), byteLength: 42 },
        receipt: { receiptId: 'b'.repeat(64), parser: 'anydoc-local', outcome: 'extracted', sourceSha256: 'a'.repeat(64), sourceByteLength: 42, markdownSha256: sha256(markdown), markdownByteLength: Buffer.byteLength(markdown), ...(withOcr ? { ocrProvenance } : {}) },
        review: 'required', writes: 0, apply: 'none', status: 'extracted', markdown, candidateUse: 'review_only',
    };
}
const response = (body: unknown) => ({ ok: true, text: async () => JSON.stringify(body), json: async () => body }) as unknown as Response;

test('requests one encoded host attachment without a caller payload and returns a transient review preview', async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const preview = await requestAnyDocLocalExtractionPreview('attachment/synthetic l1d', async (input, init) => {
        calls.push([input, init]);
        return response(extracted('attachment/synthetic l1d'));
    });

    assert.deepEqual(calls, [['/api/attachments/attachment%2Fsynthetic%20l1d/local-extraction', { method: 'POST', cache: 'no-store' }]]);
    assert.equal(preview?.status, 'available');
    assert.equal(preview?.markdown, 'Referto sintetico locale.');
    assert.equal(preview?.ocr, undefined);
    assert.equal(Object.isFrozen(preview), true);
    assert.equal(Object.getPrototypeOf(preview), null);
});

test('accepts exact Apple Vision provenance and rejects malformed OCR provenance', async () => {
    const valid = extracted('attachment.synthetic.l1d', 'Testo sintetico OCR.', true);
    const preview = await requestAnyDocLocalExtractionPreview('attachment.synthetic.l1d', async () => response(valid));
    assert.equal(preview?.markdown, 'Testo sintetico OCR.');
    assert.deepEqual(preview?.ocr, { pageCount: 2, ocrPageCount: 1 });
    assert.equal(Object.isFrozen(preview?.ocr), true);
    for (const ocrProvenance of [
        { ...valid.receipt.ocrProvenance!, engine: 'caller_selected' },
        { ...valid.receipt.ocrProvenance!, ocrPageCount: 3 },
        { ...valid.receipt.ocrProvenance!, extra: true },
    ]) {
        const malformed = { ...valid, receipt: { ...valid.receipt, ocrProvenance } };
        assert.equal(await requestAnyDocLocalExtractionPreview('attachment.synthetic.l1d', async () => response(malformed)), null);
    }
});

test('returns no candidate for review-required, denied, malformed, transport, or invalid attachment input', async () => {
    const valid = extracted();
    const reviewRequired = { ...valid, status: 'review_required', reason: 'unsupported_local_extraction', detail: 'image_or_scan', markdown: '', candidateUse: 'blocked' };
    const denied = { schemaVersion: valid.schemaVersion, status: 'denied', reason: 'invalid_contract_input', field: 'source', review: 'required', writes: 0, apply: 'none', candidateUse: 'blocked' };
    for (const body of [reviewRequired, denied, { ...valid, writes: 1 }, { ...valid, extra: true },
        { ...valid, receipt: { ...valid.receipt, markdownByteLength: 24 } },
        { ...valid, provenance: { ...valid.provenance, byteLength: 0 } }]) {
        const result = await requestAnyDocLocalExtractionPreview('attachment.synthetic.l1d', async () => response(body));
        assert.equal(result, null);
    }
    assert.equal(await requestAnyDocLocalExtractionPreview('', async () => { throw new Error('must not fetch'); }), null);
    assert.equal(await requestAnyDocLocalExtractionPreview('attachment.synthetic.l1d', async () => { throw new Error('synthetic network failure'); }), null);
    assert.equal(await requestAnyDocLocalExtractionPreview('attachment.synthetic.l1d', async () => ({ ok: false }) as Response), null);
    assert.equal(await requestAnyDocLocalExtractionPreview('attachment.synthetic.l1d', async () => Object.defineProperty({}, 'ok', { get() { throw new Error('hostile response'); } }) as Response), null);
});

test('binds the host attachment and exact displayed Markdown digest before publishing', async () => {
    const valid = extracted();
    const changed = { ...valid, markdown: 'Referto sintetico locale!' };
    for (const body of [extracted('attachment.synthetic.other'), changed]) {
        assert.equal(await requestAnyDocLocalExtractionPreview('attachment.synthetic.l1d', async () => response(body)), null);
    }
});

test('accepts only canonical bounded raw JSON and leaves no object parser exposed to Proxies', async () => {
    const valid = JSON.stringify(extracted());
    const malformed = ['{', `${valid} `, 'x'.repeat(8 * 1024 * 1024 + 4097)];
    for (const raw of malformed) {
        assert.equal(await requestAnyDocLocalExtractionPreview('attachment.synthetic.l1d', async () => ({ ok: true, text: async () => raw }) as Response), null);
    }
    const clientExports = await import('./anydoc-local-extraction-client.ts') as Record<string, unknown>;
    assert.equal('parseAnyDocLocalExtractionPreview' in clientExports, false);
    const rawOnly = { ok: true, text: async () => JSON.stringify(extracted()), json: async () => { throw new Error('JSON API must remain unused'); } } as unknown as Response;
    assert.equal((await requestAnyDocLocalExtractionPreview('attachment.synthetic.l1d', async () => rawOnly))?.status, 'available');
});

test('connects only the existing attachment retry control to the read-only local preview boundary', () => {
    const source = readFileSync(new URL('../../../components/document-upload.tsx', import.meta.url), 'utf8');
    assert.match(source, /requestAnyDocLocalExtractionPreview/u);
    assert.match(source, /Anteprima AnyDoc locale · sola lettura/u);
    assert.doesNotMatch(source, /\/ocr-replay|documentSha256|Replay OCR/u);
    assert.doesNotMatch(source, /body:\s*JSON\.stringify/u);
});

test('interruption cancels transport, suppresses late content and allows a fresh request', async () => {
    const controller = new AbortController();
    const held = Promise.withResolvers<Response>();
    let passedSignal: AbortSignal | null | undefined;
    const pending = requestAnyDocLocalExtractionPreview('attachment.synthetic.l1d', async (_url, init) => {
        passedSignal = init?.signal;
        return held.promise;
    }, controller.signal);
    controller.abort();
    held.resolve(response(extracted()));
    assert.equal(await pending, null, 'a late successful response must not revive an interrupted preview');
    assert.equal(passedSignal, controller.signal);
    assert.equal((await requestAnyDocLocalExtractionPreview('attachment.synthetic.l1d', async () => response(extracted())))?.status, 'available');
    let calls = 0;
    assert.equal(await requestAnyDocLocalExtractionPreview('attachment.synthetic.l1d', async () => {
        calls += 1; return response(extracted());
    }, controller.signal), null);
    assert.equal(calls, 0, 'an already interrupted request must not start');
});

test('interruption while reading the response body cannot publish the completed preview', async () => {
    const controller = new AbortController();
    const reading = Promise.withResolvers<void>(); const body = Promise.withResolvers<string>();
    const pending = requestAnyDocLocalExtractionPreview('attachment.synthetic.l1d', async () => ({
        ok: true, text() { reading.resolve(); return body.promise; },
    }) as Response, controller.signal);
    await reading.promise;
    controller.abort(); body.resolve(JSON.stringify(extracted()));
    assert.equal(await pending, null);
});

/* @Codex */
test('accepts Tesseract provenance without treating an unknown engine as desktop OCR', async () => {
    const valid = extracted('attachment.synthetic.desktop', 'Testo OCR sintetico.', true);
    valid.receipt.ocrProvenance!.engine = 'tesseract_wasm';
    const preview = await requestAnyDocLocalExtractionPreview('attachment.synthetic.desktop', async () => response(valid));
    assert.deepEqual(preview?.ocr, { pageCount: 2, ocrPageCount: 1 });
    valid.receipt.ocrProvenance!.engine = 'tesseract_native_unqualified';
    assert.equal(await requestAnyDocLocalExtractionPreview('attachment.synthetic.desktop', async () => response(valid)), null);
});
