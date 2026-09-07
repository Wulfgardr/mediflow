/* @Codex */
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

/* @Codex */
test('deadline is also checked synchronously by the transaction guard after parsing', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: 0 });
    await assert.rejects(withAifaDownload(new AbortController().signal, async (_file, _acquisition, _signal, assertDeadline) => {
        t.mock.timers.setTime(180_001);
        assertDeadline();
    }, transport(response)), { status: 504 });
    await withAifaDownload(new AbortController().signal, async () => undefined, transport(response));
});
