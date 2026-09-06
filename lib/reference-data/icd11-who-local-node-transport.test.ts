/* @Codex */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import http from 'node:http';
import test from 'node:test';
import { createIcd11WhoLocalNodeTransport } from './icd11-who-local-node-transport.ts';
import { Icd11WhoServiceError } from './icd11-who-service.ts';

function fixture(status = 200, chunks = [Buffer.from('{}')], idle = false) {
    const options: http.RequestOptions[] = [];
    let destroyed = 0;
    const fake = ((input: http.RequestOptions, callback: (response: http.IncomingMessage) => void) => {
        options.push(input);
        const request = new EventEmitter() as http.ClientRequest;
        request.destroy = () => { destroyed++; return request; };
        request.end = (() => {
            queueMicrotask(() => {
                const response = new EventEmitter() as http.IncomingMessage;
                response.statusCode = status;
                response.destroy = () => response;
                callback(response);
                if (!idle) { for (const chunk of chunks) response.emit('data', chunk); response.emit('end'); }
            });
            return request;
        }) as http.ClientRequest['end'];
        return request;
    }) as typeof http.request;
    return { transport: createIcd11WhoLocalNodeTransport(fake), options, destroyed: () => destroyed };
}

test('uses only literal loopback/port/path and fixed API headers, never OAuth', async () => {
    const f = fixture();
    const query = 'synthetic & q=another';
    assert.deepEqual(await f.transport(query, new AbortController().signal), { status: 200, body: '{}' });
    assert.equal(f.options.length, 1);
    const request = f.options[0]!;
    assert.equal(request.hostname, '127.0.0.1');
    assert.equal(request.port, 8382);
    assert.equal(request.protocol, 'http:');
    assert.equal(request.agent, false);
    assert.equal(request.method, 'GET');
    assert.deepEqual(request.headers, { 'API-Version': 'v2', Accept: 'application/json', 'Accept-Language': 'en' });
    const [path, queryString] = String(request.path).split('?');
    assert.equal(path, '/icd/release/11/2026-01/mms/search');
    assert.equal(new URLSearchParams(queryString).get('q'), query);
    assert.equal([...new URLSearchParams(queryString)].length, 5);
    assert.equal(request.auth, undefined);
});

test('refuses redirects and HTTP failures with one request and bounded errors', async () => {
    for (const status of [301, 302, 307, 401, 404, 429, 500]) {
        const f = fixture(status);
        await assert.rejects(f.transport('synthetic', new AbortController().signal),
            error => error instanceof Icd11WhoServiceError && error.code === 'upstream_unavailable');
        assert.equal(f.options.length, 1);
        assert.ok(f.destroyed() > 0);
    }
});

test('enforces streamed byte cap and valid UTF-8 before parsing', async () => {
    for (const chunks of [[Buffer.alloc(40_000), Buffer.alloc(40_000)], [Buffer.from([0xff])]]) {
        const f = fixture(200, chunks);
        await assert.rejects(f.transport('synthetic', new AbortController().signal),
            error => error instanceof Icd11WhoServiceError && error.code === 'response_invalid');
    }
});

test('abort destroys pending IO and pre-aborted or invalid input performs no request', async () => {
    const f = fixture(200, [], true), controller = new AbortController();
    const pending = f.transport('synthetic', controller.signal);
    controller.abort();
    await assert.rejects(pending);
    assert.ok(f.destroyed() > 0);
    const blocked = fixture();
    await assert.rejects(blocked.transport('synthetic', controller.signal));
    for (const query of ['', 'x'.repeat(161), ' a ', '<script>']) {
        await assert.rejects(blocked.transport(query, new AbortController().signal));
    }
    assert.equal(blocked.options.length, 0);
});
