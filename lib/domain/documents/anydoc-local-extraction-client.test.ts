/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
    parseAnyDocLocalExtractionPreview,
    requestAnyDocLocalExtractionPreview,
} from './anydoc-local-extraction-client.ts';

const extracted = {
    schemaVersion: 'mediflow.anydoc_local_extraction.v1',
    provenance: { attachmentId: 'attachment.synthetic.l1d', sourceSha256: 'a'.repeat(64), byteLength: 42 },
    receipt: { receiptId: 'b'.repeat(64), parser: 'anydoc-local', outcome: 'extracted', sourceSha256: 'a'.repeat(64), sourceByteLength: 42, markdownSha256: 'c'.repeat(64), markdownByteLength: 25 },
    review: 'required', writes: 0, apply: 'none', status: 'extracted',
    markdown: 'Referto sintetico locale.', candidateUse: 'review_only',
};

test('requests one encoded host attachment without a caller payload and returns a transient review preview', async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const preview = await requestAnyDocLocalExtractionPreview('attachment/synthetic l1d', async (input, init) => {
        calls.push([input, init]);
        return { ok: true, json: async () => extracted } as Response;
    });

    assert.deepEqual(calls, [['/api/attachments/attachment%2Fsynthetic%20l1d/local-extraction', { method: 'POST', cache: 'no-store' }]]);
    assert.equal(preview?.status, 'available');
    assert.equal(preview?.markdown, 'Referto sintetico locale.');
    assert.equal(Object.isFrozen(preview), true);
    assert.equal(Object.getPrototypeOf(preview), null);
});

test('returns no candidate for review-required, denied, malformed, transport, or invalid attachment input', async () => {
    const reviewRequired = { ...extracted, status: 'review_required', reason: 'unsupported_local_extraction', detail: 'image_or_scan', markdown: '', candidateUse: 'blocked' };
    const denied = { schemaVersion: extracted.schemaVersion, status: 'denied', reason: 'invalid_contract_input', field: 'source', review: 'required', writes: 0, apply: 'none', candidateUse: 'blocked' };
    for (const body of [reviewRequired, denied, { ...extracted, writes: 1 }, { ...extracted, extra: true },
        { ...extracted, receipt: { ...extracted.receipt, markdownByteLength: 24 } },
        { ...extracted, provenance: { ...extracted.provenance, byteLength: 0 } }]) {
        const result = await requestAnyDocLocalExtractionPreview('attachment.synthetic.l1d', async () => ({ ok: true, json: async () => body }) as Response);
        assert.equal(result, null);
    }
    assert.equal(await requestAnyDocLocalExtractionPreview('', async () => { throw new Error('must not fetch'); }), null);
    assert.equal(await requestAnyDocLocalExtractionPreview('attachment.synthetic.l1d', async () => { throw new Error('synthetic network failure'); }), null);
    assert.equal(await requestAnyDocLocalExtractionPreview('attachment.synthetic.l1d', async () => ({ ok: false }) as Response), null);
    assert.equal(await requestAnyDocLocalExtractionPreview('attachment.synthetic.l1d', async () => Object.defineProperty({}, 'ok', { get() { throw new Error('hostile response'); } }) as Response), null);
});

test('rejects hostile response records without reading accessors or leaking parser errors', () => {
    let reads = 0;
    const accessor = { ...extracted } as Record<string, unknown>;
    Object.defineProperty(accessor, 'markdown', { enumerable: true, get() { reads += 1; return 'hostile'; } });
    const nonEnumerable = { ...extracted };
    Object.defineProperty(nonEnumerable, 'markdown', { value: extracted.markdown, enumerable: false });
    const symbol = { ...extracted, [Symbol('authority')]: true };
    const proxy = new Proxy(extracted, { ownKeys() { throw new Error('synthetic proxy trap'); } });
    for (const value of [accessor, nonEnumerable, symbol, proxy, Object.create(extracted), [], null]) {
        assert.doesNotThrow(() => assert.equal(parseAnyDocLocalExtractionPreview(value), null));
    }
    assert.equal(reads, 0);
});

test('connects only the existing attachment retry control to the read-only local preview boundary', () => {
    const source = readFileSync(new URL('../../../components/document-upload.tsx', import.meta.url), 'utf8');
    assert.match(source, /requestAnyDocLocalExtractionPreview/u);
    assert.match(source, /Anteprima estrazione locale \(sola lettura\)/u);
    assert.doesNotMatch(source, /\/ocr-replay|documentSha256|Replay OCR/u);
    assert.doesNotMatch(source, /body:\s*JSON\.stringify/u);
});
