/* Node24 native WHATWG streams + synthetic Page event adapter. Browser/HTTP
 * conformance is separately executed by the canonical browser-only suite. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';
import { EventEmitter } from 'node:events';
import { installSameResponseCapture, createBrowserResponseOracle, parseCapturedResponse } from '../../e2e/chatgpt-browser-response.ts';
import type { Page } from '@playwright/test';
const base = 'http://127.0.0.1:47851', namespace = '/api/settings/ai/chatgpt/synthesis/';
const good = '{"snapshot":{"state":"consented","clinicalAdmission":"held"},"unicode":"è 🩺"}';
const encoder = new TextEncoder();
function fixture(text = good, options: { status?: number; cache?: string; chunks?: Uint8Array[]; open?: boolean } = {}) {
    let cancels = 0, pulls = 0, fetches = 0;
    const chunks = options.chunks ?? [encoder.encode(text)];
    let source!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({ start(controller) { source = controller; }, pull(controller) {
        pulls++; if (chunks.length) controller.enqueue(chunks.shift()!); else if (!options.open) controller.close();
    }, cancel() { cancels++; } });
    const response = new Response(stream, { status: options.status ?? 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': options.cache ?? 'no-store' } });
    // Unit fixture metadata only; browser conformance uses genuine response properties.
    Object.defineProperties(response, { url: { value: base + namespace + 'consent' }, type: { value: 'basic' } });
    const promise = Promise.resolve(response);
    const context = createContext({ Response, Request, URL, ReadableStream, Uint8Array, TextDecoder, AbortController, location: { href: base + '/' }, fetch: () => { fetches++; return promise; } });
    runInContext(`(${installSameResponseCapture.toString()})(${JSON.stringify({ base, namespace })})`, context);
    const api = context.__mfSameResponse;
    const start = (signal?: AbortSignal) => { api.arm('one', 'consent'); return context.fetch(namespace + 'consent', { method: 'POST', signal }); };
    async function consume(signal?: AbortSignal, mutate = false) {
        const actual = await start(signal); assert.strictEqual(actual, response);
        const reader = actual.body!.getReader();
        for (;;) { const part = await reader.read(); if (part.done) break; if (mutate) part.value.fill(0); }
        await reader.cancel();
        return api.take('one');
    }
    return { context, api, start, consume, response, promise, stream, source: () => source, stats: () => ({ cancels, pulls, fetches }) };
}
function parse(capture: Parameters<typeof parseCapturedResponse>[0], overrides = {}) {
    return parseCapturedResponse(capture, { id: 'one', url: base + namespace + 'consent', status: 200, cacheControl: 'no-store', contentType: 'application/json', ...overrides });
}

test('native fetch promise, Response, stream, reader and read promise are unchanged; no extra reads', async () => {
    const f = fixture();
    let nativeReader: ReadableStreamDefaultReader<Uint8Array> | undefined, nativeRead: Promise<ReadableStreamReadResult<Uint8Array>> | undefined;
    const getReader = f.stream.getReader.bind(f.stream);
    Object.defineProperty(f.stream, 'getReader', { configurable: true, value: () => {
        nativeReader = getReader(); const read = nativeReader.read.bind(nativeReader);
        Object.defineProperty(nativeReader, 'read', { configurable: true, value: () => { nativeRead = read(); return nativeRead; } }); return nativeReader;
    } });
    assert.strictEqual(f.start(), f.promise);
    const response = await f.promise; assert.strictEqual(response, f.response); assert.strictEqual(response.body, f.stream); assert.equal(f.stream.locked, false);
    const reader = response.body!.getReader(); assert.strictEqual(reader, nativeReader);
    for (;;) { const pending = reader.read(); assert.strictEqual(pending, nativeRead); if ((await pending).done) break; }
    await reader.cancel(); assert.deepEqual(parse(await f.api.take('one')), JSON.parse(good));
    assert.equal(f.stats().fetches, 1); assert.equal(f.stats().cancels, 0);
});
test('split UTF-8 and mutated caller buffers retain exactly the original bytes', async () => {
    const bytes = encoder.encode(good); const f = fixture('', { chunks: Array.from(bytes, byte => Uint8Array.of(byte)) });
    assert.deepEqual(parse(await f.consume(undefined, true)), JSON.parse(good)); assert.equal(f.stats().fetches, 1);
});
test('closed-stream cancel is not a source cancellation', async () => { const f = fixture(); parse(await f.consume()); assert.equal(f.stats().cancels, 0); });
test('cancel before EOF rejects even when a subsequent read returns done:true', async () => {
    const f = fixture(good, { open: true }); const response = await f.start(); const reader = response.body.getReader();
    await reader.cancel(); assert.equal((await reader.read()).done, true);
    await assert.rejects(f.api.take('one'), /ORACLE_CANCEL_BEFORE_EOF/); assert.equal(f.stats().cancels, 1);
});
test('read error propagates natively and invalidates the observation', async () => {
    const f = fixture('', { chunks: [], open: true }); const response = await f.start(); const reader = response.body.getReader(); const pending = reader.read();
    const original = new Error('synthetic-network-loss'); f.source().error(original);
    await assert.rejects(pending, error => error === original); await assert.rejects(f.api.take('one'), /ORACLE_READ_REJECTED/);
});
test('abort after valid bytes but before acceptance is never success', async () => {
    const f = fixture(); const controller = new AbortController(); const response = await f.start(controller.signal); const reader = response.body.getReader();
    while (!(await reader.read()).done) { /* actual caller consumption */ }
    controller.abort(); await assert.rejects(f.api.take('one'), /ORACLE_SIGNAL_ABORTED/);
});
test('already-aborted signal cannot pass', async () => { const f = fixture(); await f.start(AbortSignal.abort()); await assert.rejects(f.api.take('one'), /ORACLE_SIGNAL_ABORTED/); });
test('duplicate matching POST is detected, not collapsed into one response', async () => {
    const f = fixture(); await f.start(); await f.context.fetch(namespace + 'consent', { method: 'POST' });
    await assert.rejects(f.api.take('one'), /ORACLE_DUPLICATE_REQUEST/); assert.equal(f.stats().fetches, 2);
});
test('unarmed consent is detected while non-observed login/complete retains original behavior', async () => {
    const f = fixture(); assert.strictEqual(f.context.fetch(namespace + 'login/complete', { method: 'POST' }), f.promise); f.api.check();
    await f.context.fetch(namespace + 'consent', { method: 'POST' }); assert.throws(() => f.api.check(), /ORACLE_UNARMED_CONSENT/);
});
test('wrong ticket and a second take are rejected', async () => { const f = fixture(); await f.consume(); await assert.rejects(f.api.take('other'), /ORACLE_TICKET/); await assert.rejects(f.api.take('one'), /ORACLE_TICKET/); });
test('only one outstanding ticket and exact operation are accepted', () => { const f = fixture(); assert.throws(() => f.api.arm('one', 'generate'), /ORACLE_ARM/); f.api.arm('one', 'consent'); assert.throws(() => f.api.arm('two', 'consent'), /ORACLE_ARM/); });
test('unread response does not get consumed by the observer', async () => { const f = fixture(); const r = await f.start(); assert.equal(r.bodyUsed, false); assert.equal(r.body.locked, false); assert.throws(() => f.api.check(), /ORACLE_UNCONSUMED/); });
test('size bound is fail-closed without changing the consumer read', async () => {
    const f = fixture('', { chunks: [new Uint8Array(262145)] }); const r = await f.start(); const reader = r.body.getReader(); assert.equal((await reader.read()).value.byteLength, 262145);
    await assert.rejects(f.api.take('one'), /ORACLE_BODY_LIMIT/); await reader.cancel();
});
for (const [name, text] of [['malformed', '{'], ['trailing', good + '{}'], ['empty', '']]) test(`same-body decoder rejects ${name}`, async () => { const f = fixture(text); const capture = await f.consume(); assert.throws(() => parse(capture)); });
test('invalid UTF-8 is rejected rather than replaced', async () => { const f = fixture('', { chunks: [Uint8Array.from([0x7b, 0x22, 0xff, 0x22, 0x3a, 0x31, 0x7d])] }); const awaited = await f.consume(); assert.throws(() => parse(awaited)); });
for (const [field, value] of [['id', 'stale'], ['url', base + '/other'], ['status', 403], ['cacheControl', 'private'], ['contentType', 'text/plain']]) test(`renderer/HTTP ${field} mismatch is rejected`, async () => { const f = fixture(); const capture = await f.consume(); assert.throws(() => parse({ ...capture, [field]: value })); });

// The adapter tests exercise the ACTUAL host oracle without launching a browser.
// Their event source is explicitly synthetic; they never qualify Chromium/Next.
class SyntheticPage extends EventEmitter {
    f = fixture(); frame = {};
    async addInitScript() { /* fixture installed the exact serialized function */ }
    async evaluate(fn: (...args: never[]) => unknown, arg?: unknown) { return await runInContext(`(${fn.toString()})`, this.f.context)(arg); }
    mainFrame() { return this.frame; }
    dispatch(failed = false) {
        const request = { url: () => base + namespace + 'consent', method: () => 'POST', frame: () => this.frame,
            isNavigationRequest: () => false, redirectedFrom: () => null, failure: () => failed ? { errorText: 'net::ERR_ABORTED' } : null };
        const response = { request: () => request, status: () => 200, fromServiceWorker: () => false, url: request.url,
            headers: () => ({ 'cache-control': 'no-store', 'content-type': 'application/json' }), json: () => { throw new Error('CDP_BODY_MUST_NOT_BE_CALLED'); } };
        this.emit('request', request); this.emit('response', response);
        return { request, response, finish: () => this.emit(failed ? 'requestfailed' : 'requestfinished', request) };
    }
    async consume() {
        const r = await this.f.context.fetch(namespace + 'consent', { method: 'POST' }); const reader = r.body.getReader();
        while (!(await reader.read()).done) { /* native stream consumption */ } await reader.cancel();
    }
}
test('host oracle joins natural EOF and the same requestfinished without CDP body access', async () => {
    const page = new SyntheticPage(); const oracle = await createBrowserResponseOracle(page as unknown as Page, base);
    const ticket = await oracle.arm('consent'); const wire = page.dispatch(); await page.consume(); wire.finish();
    assert.deepEqual(await ticket.json(), JSON.parse(good)); await oracle.check(); assert.deepEqual(page.eventNames(), []);
});
test('host oracle rejects loadingFailed even if ALL renderer bytes and EOF are present', async () => {
    const page = new SyntheticPage(); const oracle = await createBrowserResponseOracle(page as unknown as Page, base);
    const ticket = await oracle.arm('consent'); const wire = page.dispatch(true); await page.consume(); wire.finish();
    await assert.rejects(ticket.json(), /ORACLE_NETWORK_FAILED: net::ERR_ABORTED/); assert.deepEqual(page.eventNames(), []);
});
for (const event of ['close', 'crash', 'framenavigated']) test(`host ${event} invalidates the response and drains observers`, async () => {
    const page = new SyntheticPage(); const oracle = await createBrowserResponseOracle(page as unknown as Page, base);
    const ticket = await oracle.arm('consent'); page.dispatch(); page.emit(event, page.frame);
    await assert.rejects(ticket.json(), /ORACLE_PAGE_|ORACLE_DOCUMENT_CHANGED/); assert.deepEqual(page.eventNames(), []);
});
test('host duplicate request and repeated ticket read fail closed', async () => {
    const page = new SyntheticPage(); const oracle = await createBrowserResponseOracle(page as unknown as Page, base);
    const ticket = await oracle.arm('consent'); page.dispatch(); page.dispatch();
    await assert.rejects(ticket.json(), /ORACLE_DUPLICATE_BROWSER_REQUEST/); await assert.rejects(ticket.json(), /ORACLE_TICKET_ALREADY_READ/);
    assert.deepEqual(page.eventNames(), []);
});
test('renderer EOF without matching requestfinished reaches a bounded failure, never success', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const page = new SyntheticPage(); const oracle = await createBrowserResponseOracle(page as unknown as Page, base);
    const ticket = await oracle.arm('consent'); page.dispatch(); await page.consume();
    page.emit('requestfinished', { url: () => base + namespace + 'consent' }); // Same URL, DIFFERENT identity.
    const result = ticket.json(); t.mock.timers.tick(25000);
    await assert.rejects(result, /ORACLE_COMPLETION_DEADLINE/); assert.deepEqual(page.eventNames(), []);
});
test('matching requestfinished without renderer EOF cannot accept a partial body', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const page = new SyntheticPage(); page.f = fixture(good, { open: true });
    const oracle = await createBrowserResponseOracle(page as unknown as Page, base);
    const ticket = await oracle.arm('consent'); const wire = page.dispatch();
    const response = await page.f.context.fetch(namespace + 'consent', { method: 'POST' }); const reader = response.body.getReader();
    await reader.read(); wire.finish(); const result = ticket.json(); t.mock.timers.tick(25000);
    await assert.rejects(result, /ORACLE_COMPLETION_DEADLINE/); await reader.cancel(); assert.deepEqual(page.eventNames(), []);
});
test('failure before response headers is surfaced without body access', async () => {
    const page = new SyntheticPage(); const oracle = await createBrowserResponseOracle(page as unknown as Page, base);
    const ticket = await oracle.arm('consent');
    const request = { url: () => base + namespace + 'consent', method: () => 'POST', frame: () => page.frame,
        isNavigationRequest: () => false, redirectedFrom: () => null, failure: () => ({ errorText: 'net::ERR_FAILED' }) };
    page.emit('request', request); page.emit('requestfailed', request);
    await assert.rejects(ticket.json(), /ORACLE_NETWORK_FAILED/); assert.deepEqual(page.eventNames(), []);
});
test('wrong-frame browser request cannot supply the oracle response', async () => {
    const page = new SyntheticPage(); const oracle = await createBrowserResponseOracle(page as unknown as Page, base);
    const ticket = await oracle.arm('consent');
    page.emit('request', { url: () => base + namespace + 'consent', method: () => 'POST', frame: () => ({}), isNavigationRequest: () => false, redirectedFrom: () => null });
    await assert.rejects(ticket.json(), /ORACLE_BROWSER_REQUEST_IDENTITY/); assert.deepEqual(page.eventNames(), []);
});

test('absent cache-control normalizes null/undefined and still rejects missing no-store', async () => {
    const f = fixture(); const capture = await f.consume();
    assert.throws(() => parse({ ...capture, cacheControl: null }, { cacheControl: undefined }), /ORACLE_NO_STORE_REQUIRED/);
});
test('absent content-type normalizes null/undefined and still rejects non-JSON', async () => {
    const f = fixture(); const capture = await f.consume();
    assert.throws(() => parse({ ...capture, contentType: null }, { contentType: undefined }), /ORACLE_JSON_REQUIRED/);
});
