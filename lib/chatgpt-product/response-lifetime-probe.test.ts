/* @Codex — probe regressions only. Synthetic emitters are not browser evidence. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import type { Page, Request as BrowserRequest, Response as BrowserResponse, WebSocket } from '@playwright/test';
import { createResponseLifetimeProbe } from '../../e2e/chatgpt-response-lifetime-probe.ts';

const origin = 'http://127.0.0.1:3987';
const path = '/api/settings/ai/chatgpt/synthesis/consent';
function fixture() {
    const page = new EventEmitter(), context = new EventEmitter(), browser = new EventEmitter();
    const frame = { url: () => origin + '/' };
    Object.assign(context, { browser: () => browser });
    Object.assign(page, { context: () => context, mainFrame: () => frame });
    const request = { url: () => origin + path + '?DO_NOT_LOG=private', method: () => 'POST',
        isNavigationRequest: () => false, redirectedFrom: () => null, failure: () => null } as unknown as BrowserRequest;
    let reads = 0;
    const response = { request: () => request, status: () => 200, headers: () => ({ 'cache-control': 'no-store', 'set-cookie': 'DO_NOT_LOG' }),
        fromServiceWorker: () => false, json: async () => { reads++; return { snapshot: { state: 'consented', clinicalAdmission: 'held' } }; } } as unknown as BrowserResponse;
    return { page, context, browser, frame, request, response, reads: () => reads, typedPage: page as unknown as Page };
}

test('attaching and receiving headers/finish never eagerly reads a response', async () => {
    const f = fixture(), p = createResponseLifetimeProbe(), observed: BrowserResponse[] = [];
    p.attach(f.typedPage, origin, response => observed.push(response));
    f.page.emit('request', f.request); f.page.emit('response', f.response); f.page.emit('requestfinished', f.request);
    assert.equal(f.reads(), 0); assert.strictEqual(observed[0], f.response);
    const result = await p.json(f.response);
    assert.deepEqual(result, { snapshot: { state: 'consented', clinicalAdmission: 'held' } });
    assert.equal(f.reads(), 1);
    assert.deepEqual(p.snapshot().events.map(e => e.event), ['browser/request', 'browser/response', 'browser/requestfinished', 'body/read-start', 'body/read-succeeded']);
    p.dispose();
});

test('the CDP error is rethrown by identity, once, without body fallback or retry', async () => {
    const f = fixture(), p = createResponseLifetimeProbe(); p.attach(f.typedPage, origin);
    const original = new Error('response.json: Protocol error (Network.getResponseBody): No data found for resource with given identifier');
    let reads = 0;
    Object.assign(f.response, { json: async () => { reads++; throw original; } });
    await assert.rejects(p.json(f.response), error => error === original);
    assert.equal(reads, 1);
    p.phase('scenario-cleanup-start'); f.context.emit('close'); p.phase('scenario-failed');
    const trace = p.snapshot();
    assert.equal(trace.events.find(e => e.event === 'body/read-failed')?.failure, 'cdp-body-resource-missing');
    assert.ok(trace.events.findIndex(e => e.event === 'body/read-failed') < trace.events.findIndex(e => e.event === 'scenario-cleanup-start'));
    p.dispose();
});

test('JSON syntax errors and falsy thrown values remain failures, unchanged', async () => {
    for (const error of [new SyntaxError('not JSON'), undefined, null, false]) {
        const f = fixture(), p = createResponseLifetimeProbe();
        Object.assign(f.response, { json: async () => { throw error; } });
        const result = await p.json(f.response).then(() => ({ success: true }), caught => ({ success: false, caught }));
        assert.equal(result.success, false); assert.strictEqual('caught' in result ? result.caught : 'unexpected success', error);
        assert.equal(p.snapshot().events.at(-1)?.event, 'body/read-failed'); p.dispose();
    }
});

test('the original response object, not URL equality, identifies a body read', async () => {
    const f = fixture(), p = createResponseLifetimeProbe(); p.attach(f.typedPage, origin);
    const secondRequest = { ...f.request };
    const secondResponse = { ...f.response, request: () => secondRequest };
    f.page.emit('response', f.response); f.page.emit('response', secondResponse);
    await p.json(secondResponse); await p.json(f.response);
    const events = p.snapshot().events;
    assert.deepEqual(events.filter(e => e.event === 'browser/response').map(e => e.request), [1, 2]);
    assert.deepEqual(events.filter(e => e.event === 'body/read-start').map(e => e.request), [2, 1]); p.dispose();
});

test('wire metadata, body-ready and finish are distinct, including a partial close', () => {
    const p = createResponseLifetimeProbe();
    const denied = p.wireRequest('consent', 'POST', new Headers({ 'Content-Type': 'application/json' }), origin);
    p.wireReply(denied, new Response('forbidden', { status: 403 }), Buffer.from('forbidden'));
    p.wireEvent('finish', denied, true);
    const accepted = p.wireRequest('consent', 'POST', new Headers({ origin, 'sec-fetch-site': 'same-origin', 'Content-Type': 'application/json' }), origin);
    const bytes = Buffer.from('{"snapshot":{"state":"consented","clinicalAdmission":"held"}}');
    p.wireReply(accepted, new Response(bytes, { headers: { 'cache-control': 'no-store' } }), bytes);
    p.wireEvent('close', accepted, false); p.wireEvent('abort', accepted, false);
    const trace = p.snapshot();
    assert.equal(trace.events[0].originMatches, false); assert.equal(trace.events[0].fetchSameOrigin, false);
    assert.equal(trace.events[3].originMatches, true); assert.equal(trace.events[3].fetchSameOrigin, true);
    assert.equal(trace.events[4].bytes, bytes.length); assert.match(String(trace.events[4].sha256), /^[a-f0-9]{64}$/u);
    assert.equal(trace.events.some(e => e.event === 'wire/finish' && e.wire === accepted), false);
    assert.equal(trace.events.at(-1)?.finished, false); p.dispose();
});

test('navigation and request failure are recorded, not guessed to be caused by HMR', () => {
    const f = fixture(), p = createResponseLifetimeProbe(); p.attach(f.typedPage, origin);
    f.page.emit('framenavigated', f.frame); f.page.emit('framenavigated', { url: () => origin + '/iframe' });
    f.page.emit('request', f.request);
    Object.assign(f.request, { failure: () => ({ errorText: 'net::ERR_ABORTED DO_NOT_LOG' }) });
    f.page.emit('requestfailed', f.request); f.page.emit('framenavigated', f.frame); f.page.emit('crash');
    const trace = p.snapshot();
    assert.equal(trace.events.filter(e => e.event === 'browser/main-frame-commit').length, 2);
    assert.equal(trace.events.find(e => e.event === 'browser/requestfailed')?.failure, 'aborted');
    assert.equal(trace.hmrFrameAbsenceExcludesRefresh, false); p.dispose();
});

test('no body, header, URL, challenge or arbitrary HMR/console text enters the trace', async () => {
    const f = fixture(), p = createResponseLifetimeProbe(); p.attach(f.typedPage, origin);
    f.page.emit('response', f.response); await p.json(f.response);
    const socket = Object.assign(new EventEmitter(), { url: () => origin.replace('http:', 'ws:') + '/_next/hmr?id=DO_NOT_LOG' });
    f.page.emit('websocket', socket as unknown as WebSocket);
    socket.emit('framereceived', { payload: JSON.stringify({ action: 'reloadPage', secret: 'DO_NOT_LOG' }) });
    socket.emit('framereceived', { payload: JSON.stringify({ action: 'DO_NOT_LOG' }) });
    socket.emit('framereceived', { payload: 'DO_NOT_LOG'.repeat(10000) });
    f.page.emit('console', { text: () => '[Fast Refresh] rebuilding DO_NOT_LOG' });
    const bytes = Buffer.from('DO_NOT_LOG body'); p.wireReply(1, new Response(bytes), bytes);
    const trace = p.snapshot(), serialized = JSON.stringify(trace);
    assert.equal(serialized.includes('DO_NOT_LOG'), false); assert.equal(serialized.includes('private'), false);
    assert.equal(serialized.includes('consented'), false); assert.equal(serialized.includes('set-cookie'), false);
    assert.deepEqual(trace.events.filter(e => e.event === 'browser/hmr-frame').map(e => e.action), ['reloadPage', 'unknown', 'unknown']);
    assert.equal(trace.hmrFrames, 3); p.dispose();
});

test('event and listener bounds are explicit, never silently a complete trace', () => {
    const f = fixture(), p = createResponseLifetimeProbe(); p.attach(f.typedPage, origin);
    for (let i = 0; i < 700; i++) p.phase('ui-ready');
    const trace = p.snapshot(); assert.equal(trace.events.length, 512); assert.equal(trace.dropped, 188); assert.equal(trace.complete, false);
    const sockets: EventEmitter[] = [];
    for (let i = 0; i < 100; i++) {
        const socket = Object.assign(new EventEmitter(), { url: () => origin.replace('http:', 'ws:') + '/_next/hmr' });
        sockets.push(socket); f.page.emit('websocket', socket);
    }
    assert.equal(p.snapshot().listenerOverflow, true); p.dispose();
    assert.ok(sockets.every(socket => socket.eventNames().length === 0));
});

test('dispose removes only owned listeners and is idempotent after close', () => {
    const f = fixture(), p = createResponseLifetimeProbe();
    const existing = () => {}; f.page.on('response', existing);
    p.attach(f.typedPage, origin); f.page.emit('close'); f.context.emit('close'); f.browser.emit('disconnected');
    const before = p.snapshot(); p.dispose(); p.dispose();
    assert.deepEqual(f.page.listeners('response'), [existing]); assert.deepEqual(f.page.eventNames(), ['response']);
    assert.equal(f.context.eventNames().length, 0); assert.equal(f.browser.eventNames().length, 0);
    p.phase('scenario-failed'); assert.deepEqual(p.snapshot(), before);
    const copy = p.snapshot(); copy.events[0].event = 'edited-copy'; assert.notEqual(p.snapshot().events[0].event, 'edited-copy');
});
