import 'next/dist/server/node-environment.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server.js';
import { getCloneableBody } from 'next/dist/server/body-streams.js';
import nextConfig from '@/next.config.ts';

import { NextRequest } from 'next/server';

import { config, proxy } from '../../proxy';

const SESSION = 'a'.repeat(64);
const CONTROL = 'A'.repeat(32);
const WEB_COOKIES = `mediflow_session=${SESSION}; mediflow_auth_control=${CONTROL}`;

function request(
    method: string,
    headers: Record<string, string> = {},
    body?: BodyInit,
): NextRequest {
    return new NextRequest('http://127.0.0.1:3000/api/patients', {
        method,
        headers,
        ...(body === undefined ? {} : { body }),
    });
}

function trustedHeaders(contentType?: string): Record<string, string> {
    return {
        cookie: WEB_COOKIES,
        host: '127.0.0.1:3000',
        origin: 'http://127.0.0.1:3000',
        'sec-fetch-site': 'same-origin',
        ...(contentType ? { 'content-type': contentType } : {}),
    };
}

test('central admission covers APIs except the exact backup routes with their own transport admission', () => {
    for (const url of ['/api/patients', '/api/attachments', '/api/prosthetics/catalog/documents', '/api/system/backup-restore/verify-other', '/api/system/backup-restore-other']) {
        assert.equal(unstable_doesMiddlewareMatch({ config, nextConfig, url }), true, url);
    }
    for (const url of ['/api/system/backup-restore', '/api/system/backup-restore/', '/api/system/backup-restore?source=local', '/api/system/backup-restore/verify', '/api/system/backup-restore/verify/']) {
        assert.equal(unstable_doesMiddlewareMatch({ config, nextConfig, url }), false, url);
    }
});

test('Next route dispatch preserves JSON backup bodies above 35 MiB after proxy finalization', async () => {
    const body = Buffer.from(JSON.stringify({ attachment: 'x'.repeat(36 * 1024 * 1024) }));
    for (const url of ['/api/system/backup-restore', '/api/system/backup-restore/verify']) {
        const incoming = new IncomingMessage(new Socket());
        incoming.url = url;
        const clone = getCloneableBody(incoming, nextConfig.experimental!.proxyClientMaxBodySize as number);
        if (unstable_doesMiddlewareMatch({ config, nextConfig, url: incoming.url })) clone.cloneBodyStream().resume();
        for (let offset = 0; offset < body.length; offset += 64 * 1024) incoming.push(body.subarray(offset, offset + 64 * 1024));
        incoming.push(null);
        await clone.finalize();
        const chunks: Buffer[] = [];
        for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
        const received = Buffer.concat(chunks);
        assert.equal(received.length, body.length);
        assert.deepEqual(JSON.parse(received.toString()), JSON.parse(body.toString()));
    }
});

test('rejects every Web-cookie mutation method on hostile transport before body consumption', async () => {
    const cases: Array<Record<string, string>> = [
        { origin: 'http://127.0.0.1:4000', 'sec-fetch-site': 'same-site', 'content-type': 'application/json' },
        { origin: 'http://127.0.0.1:4000', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' },
        { origin: 'http://127.0.0.1:3000', 'sec-fetch-site': 'cross-site', 'content-type': 'application/json' },
        { origin: 'http://127.0.0.1:3000', 'sec-fetch-site': 'same-origin', 'content-type': 'text/plain' },
        { 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' },
    ];
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        for (const transport of cases) {
            const candidate = request(method, { cookie: WEB_COOKIES, host: '127.0.0.1:3000', ...transport }, '{}');
            const response = proxy(candidate);
            assert.equal(response.status, 403, `${method} ${JSON.stringify(transport)}`);
            assert.equal(candidate.bodyUsed, false);
            assert.equal(response.headers.get('cache-control'), 'no-store');
            assert.deepEqual(await response.json(), {
                error: 'Request transport unavailable',
                code: 'request_transport_invalid',
            });
        }
    }
});

test('preserves exact-origin Web JSON, multipart, binary and bodyless mutations', () => {
    const accepted = [
        request('POST', trustedHeaders('application/json'), '{}'),
        request('POST', trustedHeaders('application/json; charset=utf-8'), '{}'),
        request('POST', trustedHeaders('multipart/form-data; boundary=synthetic'), '--synthetic--'),
        request('POST', trustedHeaders('application/octet-stream'), new Uint8Array([1, 2, 3])),
        request('DELETE', trustedHeaders()),
    ];
    for (const candidate of accepted) {
        const response = proxy(candidate);
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('x-middleware-next'), '1');
        assert.equal(candidate.bodyUsed, false);
    }
});

test('does not reinterpret safe methods, public bootstrap or native cookie transport', () => {
    const controls = [
        request('GET', { cookie: WEB_COOKIES }),
        request('POST', { 'content-type': 'application/json' }, '{}'),
        request('POST', { cookie: `mediflow_session=${SESSION}`, 'content-type': 'application/json' }, '{}'),
        request('POST', { cookie: `mediflow_auth_control=${CONTROL}`, 'content-type': 'application/json' }, '{}'),
    ];
    for (const candidate of controls) {
        const response = proxy(candidate);
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('x-middleware-next'), '1');
    }
});

test('malformed paired Web cookies cannot bypass transport admission', () => {
    const candidate = request('POST', {
        cookie: 'mediflow_session=invalid; mediflow_auth_control=invalid',
        host: '127.0.0.1:3000',
        origin: 'http://127.0.0.1:4000',
        'sec-fetch-site': 'same-site',
        'content-type': 'text/plain',
    }, '{}');
    const response = proxy(candidate);
    assert.equal(response.status, 403);
    assert.equal(candidate.bodyUsed, false);
});

test('accepts the exact browser origin reconstructed through the local TLS proxy', () => {
    const candidate = new NextRequest('http://127.0.0.1:3000/api/settings', {
        method: 'POST',
        headers: {
            cookie: WEB_COOKIES,
            host: '127.0.0.1:3000',
            origin: 'https://127.0.0.1:3000',
            'sec-fetch-site': 'same-origin',
            'content-type': 'application/json',
            'x-forwarded-proto': 'https',
            'x-mediflow-tls-proxy': 'local-api',
        },
        body: '{}',
    });
    const response = proxy(candidate);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-middleware-next'), '1');
});
