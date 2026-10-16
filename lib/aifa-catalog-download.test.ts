import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { withAifaDownload, AIFA_DOWNLOAD_URL, AIFA_DOWNLOAD_MAX_BYTES } from './aifa-catalog-download.ts';

const csv = 'CODICE_AIC;DENOMINAZIONE\n000000101;SINTETICO';
const response = () => new Response(csv, { headers: { 'Content-Type': 'text/csv' } });
const transport = (factory: () => Response | Promise<Response>) => (async () => factory()) as typeof fetch;

test('fixed credential-free request delivers complete bytes and acquisition metadata', async () => {
    let calls = 0;
    const result = await withAifaDownload(new AbortController().signal, async (file, acquisition) => {
        assert.equal(await file.text(), csv);
        assert.equal(acquisition.sourceUrl, AIFA_DOWNLOAD_URL);
        assert.ok(acquisition.version.endsWith(createHash('sha256').update(csv).digest('hex').slice(0, 16)));
        return 'imported';
    }, (async (url, init) => {
        calls++;
        assert.equal(url, AIFA_DOWNLOAD_URL);
        assert.equal(init?.credentials, 'omit');
        assert.equal(init?.redirect, 'error');
        assert.equal(init?.body, undefined);
        assert.deepEqual(init?.headers, { Accept: 'text/csv', 'Accept-Encoding': 'identity' });
        return response();
    }) as typeof fetch);
    assert.equal(calls, 1);
    assert.equal(result, 'imported');
});

test('rejects status, absent body, HTML, empty payload and declared oversize without consuming', async () => {
    for (const factory of [
        () => new Response('', { status: 302 }),
        () => new Response(null),
        () => new Response('<html/>', { headers: { 'Content-Type': 'text/html' } }),
        () => new Response('', { headers: { 'Content-Type': 'text/csv' } }),
        () => new Response(csv, { headers: { 'Content-Type': 'text/csv', 'Content-Length': String(AIFA_DOWNLOAD_MAX_BYTES + 1) } }),
    ]) {
        await assert.rejects(withAifaDownload(new AbortController().signal, async () => assert.fail('must not import'), transport(factory)));
    }
});

test('counts actual streamed bytes even when Content-Length lies, and cancels the stream', async () => {
    let chunks = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
        pull(controller) { chunks++; controller.enqueue(new Uint8Array(1024 * 1024)); },
        cancel() { cancelled = true; },
    });
    await assert.rejects(withAifaDownload(new AbortController().signal, async () => assert.fail('must not import'),
        transport(() => new Response(stream, { headers: { 'Content-Type': 'text/csv', 'Content-Length': '1' } }))), { status: 413 });
    assert.ok(chunks >= 101 && chunks <= 103);
    assert.equal(cancelled, true);
});

test('pre-cancellation prevents network; active cancellation aborts transport and releases the lock', async () => {
    const cancelled = new AbortController();
    cancelled.abort(new Error('synthetic cancel'));
    await assert.rejects(withAifaDownload(cancelled.signal, async () => undefined, transport(() => assert.fail('network'))), /synthetic cancel/);
    const controller = new AbortController();
    let began!: () => void;
    const started = new Promise<void>((resolve) => { began = resolve; });
    const pending = withAifaDownload(controller.signal, async () => assert.fail('import'), (async (_url, init) => {
        began();
        return new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true }));
    }) as typeof fetch);
    await started;
    await assert.rejects(withAifaDownload(new AbortController().signal, async () => undefined, transport(() => assert.fail('second network'))), { status: 409 });
    controller.abort(new Error('synthetic revoked'));
    await assert.rejects(pending, /synthetic revoked/);
    await withAifaDownload(new AbortController().signal, async () => undefined, transport(response));
});

test('deadline aborts a stalled transport at the production bound', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    let began!: () => void;
    const started = new Promise<void>((resolve) => { began = resolve; });
    const pending = withAifaDownload(new AbortController().signal, async () => assert.fail('import'), (async (_url, init) => {
        began();
        return new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true }));
    }) as typeof fetch);
    await started;
    t.mock.timers.tick(180_000);
    await assert.rejects(pending, { status: 504 });
});

test('deadline is also checked synchronously by the transaction guard after parsing', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: 0 });
    await assert.rejects(withAifaDownload(new AbortController().signal, async (_file, _acquisition, _signal, assertDeadline) => {
        t.mock.timers.setTime(180_001);
        assertDeadline();
    }, transport(response)), { status: 504 });
    await withAifaDownload(new AbortController().signal, async () => undefined, transport(response));
});

test('conditional GET preserves AIFA validators, handles 304 without import and rejects unbound 304', async () => {
    const metadata = { etag: '"synthetic-v1"', lastModified: 'Wed, 14 Oct 2026 23:02:27 GMT' };
    let unchanged = 0;
    const result = await withAifaDownload(new AbortController().signal, async () => assert.fail('304 must not import'),
        (async (_url, init) => {
            assert.deepEqual(init?.headers, { Accept: 'text/csv', 'Accept-Encoding': 'identity',
                'If-None-Match': metadata.etag, 'If-Modified-Since': metadata.lastModified });
            return new Response(null, { status: 304 });
        }) as typeof fetch, { validators: metadata, notModified: async () => { unchanged++; return 'unchanged'; } });
    assert.equal(result, 'unchanged'); assert.equal(unchanged, 1);
    await assert.rejects(withAifaDownload(new AbortController().signal, async () => assert.fail('import'),
        transport(() => new Response(null, { status: 304 }))), { status: 502 });
    await withAifaDownload(new AbortController().signal, async (_file, acquisition) => {
        assert.equal(acquisition.etag, metadata.etag); assert.equal(acquisition.lastModified, metadata.lastModified);
        assert.equal(acquisition.contentLength, Buffer.byteLength(csv));
    }, transport(() => new Response(csv, { headers: { ...metadata, 'last-modified': metadata.lastModified, 'content-type': 'text/csv', 'content-length': String(Buffer.byteLength(csv)) } })));
});

test('truncated and overlong Content-Length payloads never reach the writer', async () => {
    for (const length of [Buffer.byteLength(csv) - 1, Buffer.byteLength(csv) + 1]) {
        await assert.rejects(withAifaDownload(new AbortController().signal, async () => assert.fail('incomplete file imported'),
            transport(() => new Response(csv, { headers: { 'Content-Type': 'text/csv', 'Content-Length': String(length) } }))), { status: 422 });
    }
});

test('HEAD uses the fixed credential-free source and 304 reuses only previously bound metadata', async () => {
    const { readAifaSource } = await import('./aifa-catalog-source');
    const headers = { etag: '"synthetic-head"', 'last-modified': 'Wed, 14 Oct 2026 23:02:27 GMT', 'content-length': '82557001' };
    let requests = 0;
    const metadata = await readAifaSource({}, new AbortController().signal, (async (url, init) => {
        requests++;
        assert.equal(url, AIFA_DOWNLOAD_URL); assert.equal(init?.method, 'HEAD'); assert.equal(init?.redirect, 'error');
        assert.equal(init?.credentials, 'omit'); assert.equal(init?.body, undefined);
        return new Response(null, { headers });
    }) as typeof fetch);
    assert.deepEqual(metadata, { etag: headers.etag, lastModified: headers['last-modified'], contentLength: 82557001 });
    assert.deepEqual(await readAifaSource(metadata, new AbortController().signal, (async (_url, init) => {
        requests++; assert.equal((init?.headers as Record<string, string>)['If-None-Match'], headers.etag);
        return new Response(null, { status: 304 });
    }) as typeof fetch), metadata);
    assert.equal(requests, 2);
    await assert.rejects(readAifaSource({}, new AbortController().signal, transport(() => new Response(null, { status: 304 }))));
});

test('HEAD fails closed on redirects, missing validators, invalid dates and status errors without GET fallback', async () => {
    const { readAifaSource } = await import('./aifa-catalog-source');
    for (const factory of [
        () => new Response(null, { status: 302, headers: { location: 'https://example.invalid/catalog' } }),
        () => { const response = new Response(null, { headers: { etag: '"test"' } }); Object.defineProperty(response, 'url', { value: 'https://example.invalid/catalog' }); return response; },
        () => new Response(null, { headers: { 'content-length': '82557001' } }),
        () => new Response(null, { headers: { 'last-modified': '1' } }),
        () => new Response(null, { status: 503 }),
    ]) {
        let calls = 0;
        await assert.rejects(readAifaSource({}, new AbortController().signal, (async (_url, init) => {
            calls++; assert.equal(init?.method, 'HEAD'); return factory();
        }) as typeof fetch));
        assert.equal(calls, 1);
    }
});

test('HEAD timeout bounds even an uncooperative transport and never downloads a body', async t => {
    const { readAifaSource, AIFA_SOURCE_TIMEOUT_MS } = await import('./aifa-catalog-source');
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let calls = 0;
    const pending = readAifaSource({}, new AbortController().signal, (async (_url, init) => {
        calls++; assert.equal(init?.method, 'HEAD'); return new Promise<Response>(() => undefined);
    }) as typeof fetch);
    t.mock.timers.tick(AIFA_SOURCE_TIMEOUT_MS);
    await assert.rejects(pending, /AIFA_HEAD_TIMEOUT/);
    assert.equal(calls, 1);
});

test('progress reports observed bytes and total, then validation and idle', async () => {
    const { getAifaDownloadProgress } = await import('./aifa-catalog-download');
    const { setImmediate: nextTurn } = await import('node:timers/promises');
    const bytes = new TextEncoder().encode(csv);
    let source!: ReadableStreamDefaultController<Uint8Array>;
    const pending = withAifaDownload(new AbortController().signal, async () => {
        assert.equal(getAifaDownloadProgress()?.phase, 'validating'); return 'done';
    }, transport(() => new Response(new ReadableStream({ start(controller) { source = controller; controller.enqueue(bytes.slice(0, 10)); } }),
        { headers: { 'Content-Type': 'text/csv', 'Content-Length': String(bytes.length) } })));
    await nextTurn();
    assert.deepEqual(getAifaDownloadProgress(), { receivedBytes: 10, totalBytes: bytes.length, phase: 'downloading' });
    source.enqueue(bytes.slice(10)); source.close();
    assert.equal(await pending, 'done'); assert.equal(getAifaDownloadProgress(), null);
});
