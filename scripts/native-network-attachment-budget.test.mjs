/* @Codex */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { getEventListeners } from 'node:events';
import path from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
const routePath = 'app/api/v1/network/patients/[id]/attachments/route.ts';
const ctx = { params: Promise.resolve({ id: 'synthetic-patient' }) };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

function harness({ deny = false, service = async () => ({ status: 201, value: { ok: true } }), cap, wireCap, responseJson } = {}) {
    const cache = new Map(), timers = new Map(), events = [];
    let nextTimer = 0;
    function load(relative) {
        if (cache.has(relative)) return cache.get(relative);
        assert.ok([routePath, 'lib/native-network-json-body.ts', 'lib/bounded-request-body.ts', 'lib/attachment-payload.ts'].includes(relative));
        const exports = {};
        cache.set(relative, exports);
        const source = fs.readFileSync(path.join(root, relative), 'utf8');
        const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
        const require = name => {
            if (name === '@/lib/native-network-json-body') return load('lib/native-network-json-body.ts');
            if (name === './bounded-request-body') {
                const actual = load('lib/bounded-request-body.ts');
                return { ...actual, readBoundedJsonBody: (...args) => {
                    events.push('read');
                    if (cap !== undefined) args[1] = cap;
                    return actual.readBoundedJsonBody(...args);
                } };
            }
            if (name === './attachment-payload') {
                const actual = load('lib/attachment-payload.ts');
                return wireCap === undefined ? actual : { ...actual, resolveMaxAttachmentBytes: () => wireCap };
            }
            if (name === 'next/server') return { NextResponse: { json: responseJson ?? Response.json } };
            if (name === '@/lib/network-write-context') return { requireNetworkWriteContext: async () => {
                events.push('auth');
                return deny ? { ok: false, response: Response.json({}, { status: 403 }) }
                    : { ok: true, context: { scopeAmbulatoryId: 'synthetic-scope' } };
            } };
            if (name === '@/lib/network-attachment-write') return { NETWORK_ATTACHMENT_WRITE_CAPABILITY: 'synthetic-capability', createNetworkScopedAttachment: async (...args) => {
                events.push('service'); return service(...args);
            } };
            if (name === '@/lib/network-attachment-read') return {};
            throw new Error(`Unexpected import ${name}`);
        };
        new Function('require', 'exports', 'setTimeout', 'clearTimeout', 'console', output)(require, exports,
            (fn, ms) => { assert.equal(ms, 30_000); timers.set(++nextTimer, fn); return nextTimer; },
            id => timers.delete(id), { error() {} });
        return exports;
    }
    return { route: load(routePath), helper: load('lib/native-network-json-body.ts'), events, timers,
        expire() { for (const callback of [...timers.values()]) callback(); } };
}

function request({ text = '{}', declared, stalled = false, signal, cancel } = {}) {
    let pulls = 0, cancels = 0, reads = 0, sent = false;
    const body = new ReadableStream({
        pull(controller) {
            pulls++;
            if (stalled) return;
            if (sent) return controller.close();
            sent = true; controller.enqueue(new TextEncoder().encode(text));
        },
        cancel() { cancels++; return cancel?.(); },
    }, { highWaterMark: 0 });
    return { req: {
        signal: signal ?? new AbortController().signal,
        get headers() { reads++; return new Headers(declared === undefined ? {} : { 'content-length': String(declared) }); },
        get body() { reads++; return body; },
    }, body, counts: () => ({ pulls, cancels, reads }) };
}

async function tick() { for (let i = 0; i < 12; i++) await Promise.resolve(); }

test('attachment cap is wire limit plus 4 MiB, without allocating a large body', () => {
    assert.equal(harness().helper.networkAttachmentJsonMaxBytes(), 29 * 1024 * 1024);
    assert.equal(harness({ wireCap: 128 }).helper.networkAttachmentJsonMaxBytes(), 128 + 4 * 1024 * 1024);
});

test('one reservation covers awaited service and rejects concurrent request before reading', async () => {
    const entered = deferred(), finish = deferred();
    const h = harness({ service: async () => { entered.resolve(); await finish.promise; return { status: 201, value: {} }; } });
    const first = h.route.POST(request().req, ctx);
    await entered.promise;
    const second = request();
    // Allow baseline to settle without hanging when it lacks admission control.
    const competing = h.route.POST(second.req, ctx);
    await tick();
    finish.resolve();
    const response = await competing;
    await first;
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('retry-after'), '1');
    assert.deepEqual(second.counts(), { pulls: 0, cancels: 0, reads: 0 });
    assert.equal((await response.json()).code, 'ATTACHMENT_OPERATION_BUSY');
    assert.equal((await h.route.POST(request().req, ctx)).status, 201);
});

test('canonical ENC envelope preserves data at its wire cap; default 25 MiB fits by byte arithmetic', async () => {
    const data = 'ENC:aQ==:' + '/'.repeat(119);
    const payload = { name: 'ENC:aQ==:YQ==', path: 'ENC:aQ==:Yg==', data, type: 'application/pdf', size: 1 };
    assert.equal(Buffer.byteLength(data), 128);
    const text = JSON.stringify(payload);
    const overhead = Buffer.byteLength(text) - Buffer.byteLength(data);
    assert.ok(25 * 1024 * 1024 + overhead <= harness().helper.networkAttachmentJsonMaxBytes());
    const h = harness({ wireCap: 128, service: async (_context, actual) => {
        assert.deepEqual(actual, payload); return { status: 201, value: {} };
    } });
    assert.equal((await h.route.POST(request({ text }).req, ctx)).status, 201);
    assert.equal(h.timers.size, 0);
});

test('declared and actual oversize use stable 413, stop reading and release reservation', async () => {
    for (const declared of [undefined, 0, 9]) {
        const h = harness({ cap: 8 });
        const f = request({ text: '{"a":"12"}', declared });
        const response = await h.route.POST(f.req, ctx);
        assert.equal(response.status, 413);
        assert.deepEqual(await response.json(), { error: 'JSON payload too large', code: 'JSON_BODY_TOO_LARGE' });
        assert.equal(f.counts().pulls, declared === 9 ? 0 : 1);
        assert.equal(f.counts().cancels, 1);
        assert.equal(f.body.locked, false);
        assert.equal(h.events.includes('service'), false);
        assert.equal((await h.route.POST(request().req, ctx)).status, 201);
    }
});

test('auth denial and already aborted request do not read body', async () => {
    const h = harness({ deny: true });
    const f = request({ declared: Number.MAX_SAFE_INTEGER });
    assert.equal((await h.route.POST(f.req, ctx)).status, 403);
    assert.deepEqual(f.counts(), { pulls: 0, cancels: 0, reads: 0 });
    assert.deepEqual(h.events, ['auth']);
    const allowed = harness();
    const controller = new AbortController(); controller.abort();
    const aborted = request({ signal: controller.signal });
    assert.equal((await allowed.route.POST(aborted.req, ctx)).status, 400);
    assert.deepEqual(aborted.counts(), { pulls: 0, cancels: 0, reads: 0 });
    assert.equal((await allowed.route.POST(request().req, ctx)).status, 201);
});

test('malformed body, stream error, service rejection and response failure release the slot', async () => {
    for (const mode of ['parse', 'stream', 'service', 'response']) {
        let fail = true;
        const h = harness({
            service: async () => { if (mode === 'service' && fail) throw new Error('synthetic'); return { status: 201, value: {} }; },
            responseJson: (...args) => { if (mode === 'response' && fail) { fail = false; throw new Error('synthetic'); } return Response.json(...args); },
        });
        const f = request({ text: mode === 'parse' ? '{' : '{}' });
        if (mode === 'stream') Object.defineProperty(f.req, 'body', { value: new ReadableStream({ pull() { throw new Error('synthetic'); } }, { highWaterMark: 0 }) });
        assert.equal((await h.route.POST(f.req, ctx)).status, 500);
        fail = false;
        assert.equal(h.timers.size, 0);
        assert.equal((await h.route.POST(request().req, ctx)).status, 201);
    }
});

test('abort and total read timeout cancel a stalled reader, clear hooks and release without awaiting transport cleanup', async () => {
    for (const reason of ['abort', 'timeout']) {
        const h = harness(), controller = new AbortController(), cleanup = deferred();
        const f = request({ stalled: true, signal: controller.signal, cancel: () => cleanup.promise });
        const pending = h.route.POST(f.req, ctx);
        await tick();
        assert.equal(f.counts().pulls, 1);
        assert.equal(getEventListeners(controller.signal, 'abort').length, 1);
        const busy = request();
        assert.equal((await h.route.POST(busy.req, ctx)).status, 503);
        assert.equal(busy.counts().reads, 0);
        if (reason === 'abort') controller.abort(); else h.expire();
        const response = await pending;
        assert.equal(response.status, reason === 'abort' ? 400 : 408);
        assert.equal((await response.json()).code, reason === 'abort' ? 'ATTACHMENT_BODY_READ_ABORTED' : 'ATTACHMENT_BODY_READ_TIMEOUT');
        assert.equal(f.counts().cancels, 1);
        assert.equal(f.body.locked, false);
        assert.equal(h.events.includes('service'), false);
        assert.equal(h.timers.size, 0);
        assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
        assert.equal((await h.route.POST(request().req, ctx)).status, 201);
        cleanup.resolve();
    }
});

test('abort during service retains reservation until service settles, with read timer removed', async () => {
    const entered = deferred(), finish = deferred(), controller = new AbortController();
    const h = harness({ service: async () => { entered.resolve(); await finish.promise; throw new Error('synthetic'); } });
    const pending = h.route.POST(request({ signal: controller.signal }).req, ctx);
    await entered.promise;
    assert.equal(h.timers.size, 0);
    controller.abort(); h.expire();
    const second = request();
    assert.equal((await h.route.POST(second.req, ctx)).status, 503);
    assert.equal(second.counts().reads, 0);
    finish.resolve();
    assert.equal((await pending).status, 500);
    assert.equal((await h.route.POST(request().req, ctx)).status, 500); // service invoked again, no busy lease
});

test('reservation includes response JSON construction', async () => {
    let h, concurrent;
    const second = request();
    h = harness({ responseJson: (...args) => {
        concurrent = h.helper.withNetworkAttachmentJson(second.req, async () => Response.json({}));
        return Response.json(...args);
    } });
    assert.equal((await h.route.POST(request().req, ctx)).status, 201);
    assert.equal((await concurrent).status, 503);
    assert.equal(second.counts().reads, 0);
});

test('read deadline is checked between chunks even before the timer callback runs', async () => {
    const h = harness();
    let pulls = 0, cancels = 0;
    const control = { signal: new AbortController().signal, deadline: performance.now() + 30_000 };
    const body = new ReadableStream({ pull(c) {
        pulls++;
        c.enqueue(new TextEncoder().encode('{'));
        control.deadline = 0; // Controlled clock-boundary seam; no long-running input.
    }, cancel() { cancels++; } }, { highWaterMark: 0 });
    await assert.rejects(h.helper.readNativeNetworkJson({ headers: new Headers(), body }, 16, control), SyntaxError);
    assert.equal(pulls, 1);
    assert.equal(cancels, 1);
    assert.equal(body.locked, false);
});

test('incoming chunks do not reset the attachment read timer', async () => {
    const h = harness();
    let controller;
    const body = new ReadableStream({ start(c) { controller = c; } }, { highWaterMark: 0 });
    const req = { signal: new AbortController().signal, headers: new Headers(), body };
    const pending = h.route.POST(req, ctx);
    await tick();
    const timer = [...h.timers.keys()];
    controller.enqueue(new TextEncoder().encode('{'));
    await tick();
    assert.deepEqual([...h.timers.keys()], timer);
    h.expire();
    assert.equal((await pending).status, 408);
    assert.equal(h.events.includes('service'), false);
    assert.equal((await h.route.POST(request().req, ctx)).status, 201);
});

test('established size rejection remains 413 if cancellation also triggers the deadline', async () => {
    const h = harness({ cap: 8 });
    const f = request({ declared: 9, cancel: () => h.expire() });
    const response = await h.route.POST(f.req, ctx);
    assert.equal(response.status, 413);
    assert.equal((await response.json()).code, 'JSON_BODY_TOO_LARGE');
    assert.equal((await h.route.POST(request().req, ctx)).status, 201);
});
