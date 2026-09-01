/* @Codex */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import https from 'node:https';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import {
    Icd11WhoNodeHttpsClientError,
    createIcd11WhoNodeHttpsClient,
} from './icd11-who-node-https-client.ts';
import {
    ICD11_WHO_TOKEN_TARGET,
} from './icd11-who-credential-lease.ts';
import {
    ICD11_WHO_TRANSPORT_TARGET,
} from './icd11-who-service.ts';

const SEARCH_PATH = '/icd/release/11/2026-01/mms/search';
const tokenHeaders = new Map([
    ['accept', 'application/json'],
    ['authorization', 'Basic U1lOVEhFVElDOlNZTlRIRVRJQw=='],
    ['content-type', 'application/x-www-form-urlencoded'],
    ['user-agent', 'MediFlow/0.8.5 ICD11-WHO'],
]);
const tokenForm = new Map([
    ['grant_type', 'client_credentials'],
    ['scope', 'icdapi_access'],
]);
const searchHeaders = new Map([
    ['api-version', 'v2'],
    ['accept', 'application/json'],
    ['accept-language', 'en'],
    ['authorization', 'Bearer SYNTHETIC_WHO_TOKEN_085_ABCDEFGHIJKLMNOPQRSTUVWXYZ'],
]);
const searchQuery = new Map([
    ['q', 'synthetic hypertension'],
    ['flatResults', 'true'],
    ['highlightingEnabled', 'false'],
    ['medicalCodingMode', 'true'],
    ['includeKeywordResult', 'false'],
]);

function facade(values: Map<string, string>) {
    return Object.freeze({ get(name: string) { return values.get(name) ?? null; } });
}

function tokenRequest(signal = new AbortController().signal) {
    return Object.freeze({
        target: ICD11_WHO_TOKEN_TARGET,
        protocol: 'https:' as const,
        hostname: 'icdaccessmanagement.who.int' as const,
        path: '/connect/token' as const,
        method: 'POST' as const,
        redirect: 'error' as const,
        headers: facade(tokenHeaders),
        form: facade(tokenForm),
        signal,
        maxRequestBytes: 8_192,
        maxResponseBytes: 8_192,
    });
}

function searchRequest(signal = new AbortController().signal) {
    return Object.freeze({
        target: ICD11_WHO_TRANSPORT_TARGET,
        protocol: 'https:' as const,
        hostname: 'id.who.int' as const,
        path: SEARCH_PATH,
        method: 'GET' as const,
        redirect: 'error' as const,
        headers: facade(searchHeaders),
        query: facade(searchQuery),
        signal,
        maxResponseBytes: 65_536 as const,
    });
}

type CapturedRequest = {
    options: Record<string, unknown>;
    body: string | null;
    request: FakeRequest;
};

class FakeRequest extends EventEmitter {
    body: string | null = null;
    destroyed = false;
    end(body?: string): void { this.body = body ?? null; }
    destroy(error?: Error): void {
        this.destroyed = true;
        if (error) queueMicrotask(() => this.emit('error', error));
    }
}

function installHttpsFake(context: test.TestContext, response: {
    statusCode?: number;
    body?: string | Buffer;
    chunks?: readonly Buffer[];
    error?: Error;
}) {
    const calls: CapturedRequest[] = [];
    context.mock.method(https, 'request', ((options: Record<string, unknown>, onResponse: (value: PassThrough) => void) => {
        const request = new FakeRequest();
        const capturedOptions = { ...options,
            headers: { ...(options.headers as Record<string, string>) } };
        calls.push({ options: capturedOptions, body: null, request });
        const originalEnd = request.end.bind(request);
        request.end = (body?: string) => {
            originalEnd(body);
            calls.at(-1)!.body = request.body;
            queueMicrotask(() => {
                if (response.error) {
                    request.emit('error', response.error);
                    return;
                }
                const incoming = new PassThrough() as PassThrough & { statusCode?: number };
                incoming.statusCode = response.statusCode ?? 200;
                onResponse(incoming);
                if (response.chunks) {
                    for (const chunk of response.chunks) incoming.write(chunk);
                    incoming.end();
                } else {
                    incoming.end(response.body ?? '{}');
                }
            });
        };
        return request;
    }) as never);
    return calls;
}

function isClientError(code: string) {
    return (error: unknown) => error instanceof Icd11WhoNodeHttpsClientError && error.code === code;
}

test('materializes the fixed WHO OAuth request without endpoint or proxy input', async (context) => {
    const calls = installHttpsFake(context, { body: '{"access_token":"synthetic"}' });
    const client = createIcd11WhoNodeHttpsClient();
    const request = tokenRequest();

    const result = await client(request);

    assert.deepEqual(result, Object.freeze({
        status: 200,
        finalUrl: 'https://icdaccessmanagement.who.int/connect/token',
        redirected: false,
        body: '{"access_token":"synthetic"}',
    }));
    assert.equal(calls.length, 1);
    assert.deepEqual({ ...calls[0]?.options, headers: { ...(calls[0]?.options.headers as object) } }, {
        protocol: 'https:', hostname: 'icdaccessmanagement.who.int', port: 443,
        path: '/connect/token', method: 'POST', agent: false,
        headers: Object.fromEntries(tokenHeaders), signal: request.signal,
    });
    assert.equal(calls[0]?.body, 'grant_type=client_credentials&scope=icdapi_access');
    assert.doesNotMatch(JSON.stringify(calls[0]?.options), /proxy|127\.0\.0\.1|8888/u);
});

test('materializes only the fixed WHO Search query and headers', async (context) => {
    const calls = installHttpsFake(context, { body: '{"destinationEntities":[]}' });
    const client = createIcd11WhoNodeHttpsClient();
    const request = searchRequest();

    const result = await client(request);

    assert.ok(result && typeof result === 'object');
    const envelope = result as { status: number; finalUrl: string };
    assert.equal(envelope.status, 200);
    assert.equal(envelope.finalUrl,
        'https://id.who.int/icd/release/11/2026-01/mms/search?q=synthetic+hypertension'
        + '&flatResults=true&highlightingEnabled=false&medicalCodingMode=true&includeKeywordResult=false');
    assert.equal(calls[0]?.options.hostname, 'id.who.int');
    assert.equal(calls[0]?.options.method, 'GET');
    assert.equal(calls[0]?.body, null);
    assert.equal((calls[0]?.options.headers as Record<string, string>).authorization,
        'Bearer SYNTHETIC_WHO_TOKEN_085_ABCDEFGHIJKLMNOPQRSTUVWXYZ');
});

test('fails closed on oversized responses and aborts the native request', async (context) => {
    const calls = installHttpsFake(context, {
        chunks: [Buffer.alloc(6_000, 97), Buffer.alloc(3_000, 98)],
    });
    const client = createIcd11WhoNodeHttpsClient();

    await assert.rejects(client(tokenRequest()), isClientError('response_too_large'));
    assert.equal(calls[0]?.request.destroyed, true);
});

test('rejects cancellation before or during I/O without publishing late bytes', async (context) => {
    const controller = new AbortController();
    controller.abort();
    const client = createIcd11WhoNodeHttpsClient();
    await assert.rejects(client(searchRequest(controller.signal)), isClientError('request_cancelled'));

    const calls = installHttpsFake(context, { body: '{"late":true}' });
    const active = new AbortController();
    const pending = client(searchRequest(active.signal));
    active.abort();
    await assert.rejects(pending, isClientError('request_cancelled'));
    assert.equal(calls[0]?.request.destroyed, true);
});
