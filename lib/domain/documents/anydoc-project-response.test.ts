import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { createContext, runInContext } from 'node:vm';
import type { Page, Response as BrowserResponse } from '@playwright/test';
import { observeAnyDocProjectResponse } from '../../../e2e/anydoc-project-response.ts';

const base = 'http://127.0.0.1:3263';
const url = base + '/api/attachments/synthetic/local-extraction';
const bytes = Buffer.from('{"synthetic":"è"}');
const grant = 'synthetic-grant';
const headers = { 'x-mediflow-extraction-action': 'project', 'x-mediflow-extraction-grant': grant };
async function fixture(options: { open?: boolean; mismatch?: boolean; noStore?: boolean } = {}) {
    const session = Object.assign(new EventEmitter(), {
        send: async (method: string) => method === 'Network.streamResourceContent' ? { bufferedData: '' } : {},
        detach: async () => {},
    });
    let source!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
        source = controller;
        controller.enqueue(Uint8Array.from(bytes)); if (!options.open) controller.close();
    } });
    const response = new Response(stream, { headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' } });
    Object.defineProperties(response, { url: { value: url }, type: { value: 'basic' } });
    const context = createContext({ Response, Request, Headers, URL, ReadableStream, Uint8Array, TextDecoder, AbortController,
        location: { href: base }, fetch: () => Promise.resolve(response) });
    const page = Object.assign(new EventEmitter(), {
        url: () => base,
        context: () => ({ newCDPSession: async () => session }),
        mainFrame: () => page,
        evaluate: async (fn: (...args: never[]) => unknown, arg?: unknown) => await runInContext(`(${fn.toString()})`, context)(arg),
    });
    const observed = await observeAnyDocProjectResponse(page as unknown as Page, 'synthetic');
    const requestId = 'synthetic-original-request';
    session.emit('Network.requestWillBeSent', { requestId, request: { url, method: 'POST', headers } });
    session.emit('Network.responseReceived', { requestId, response: { url, status: 200,
        headers: options.noStore === false ? {} : { 'Cache-Control': 'no-store' } } });
    const data = options.mismatch ? Buffer.from('{"wrong":true}') : bytes;
    session.emit('Network.dataReceived', { requestId, dataLength: data.length, data: data.toString('base64') });
    const controller = new AbortController();
    const selected = await context.fetch(url, { method: 'POST', headers, signal: controller.signal });
    const reader = selected.body.getReader();
    await reader.read();
    const wire = { url: () => url, status: () => 200, request: () => ({ url: () => url, method: () => 'POST', headers: () => headers }) };
    return { session, page, observed, reader, controller, requestId, failRead: () => source.error(new Error('synthetic stream failure')), wire: wire as unknown as BrowserResponse,
        terminal: (errorText = 'net::ERR_ABORTED') => session.emit('Network.loadingFailed', { requestId, canceled: true, errorText, type: 'Fetch' }) };
}

test('AnyDoc joins exact CDP bytes and natural renderer EOF despite Chromium no-store ERR_ABORTED', async () => {
    const f = await fixture();
    try {
        f.terminal();
        assert.equal((await f.reader.read()).done, true);
        assert.deepEqual(await f.observed.json(f.wire), JSON.parse(bytes.toString()));
        f.observed.assertSameResponse(f.wire);
    } finally { await f.observed.dispose(); }
    assert.deepEqual(f.session.eventNames(), []); assert.deepEqual(f.page.eventNames(), []);
});

for (const fault of ['cancel', 'abort', 'read-error', 'mismatch', 'other-network-error', 'missing-no-store', 'navigation'] as const) {
    test(`AnyDoc denies ${fault} rather than treating ERR_ABORTED as success`, async () => {
        const f = await fixture({ open: ['cancel', 'abort', 'read-error'].includes(fault), mismatch: fault === 'mismatch', noStore: fault !== 'missing-no-store' });
        try {
            if (fault === 'cancel') await f.reader.cancel();
            else if (fault === 'abort') f.controller.abort();
            else if (fault === 'read-error') { f.failRead(); await assert.rejects(f.reader.read(), /synthetic stream failure/); }
            else if (fault === 'navigation') f.page.emit('framenavigated', f.page);
            else assert.equal((await f.reader.read()).done, true);
            f.terminal(fault === 'other-network-error' ? 'net::ERR_CONNECTION_RESET' : 'net::ERR_ABORTED');
            await assert.rejects(f.observed.json(f.wire), /natural EOF|mismatch|did not finish|document changed/);
        } finally { await f.observed.dispose(); }
    });
}
