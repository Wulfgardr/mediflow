/* @Codex */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import http from 'node:http';
import test from 'node:test';
import { checkWhoCode, WhoCodeCheckError } from '../icd-code-check-client';
import { createWhoCodeCheckRoute } from './icd11-who-code-check-http';
import { createIcd11WhoLocalRuntime } from './icd11-who-local-runtime';
import { createIcd11WhoCodeCheckTransport } from './icd11-who-local-node-transport';
import { parseWhoCodeCheckResult, whoCodeInfoReference, type WhoCodeCheckReceipt } from './icd11-who-code-check-contract';
import { Icd11WhoServiceError } from './icd11-who-service';

// Invented terminology and lock identifiers: never an installed classification or clinical fixture.
const URI = 'http://id.who.int/icd/release/11/2026-01/mms/1000000001';
const stem = { '@id': URI, code: 'AA00', title: { '@language': 'en', '@value': 'Invented term' } };
const info = (code: string) => ({ '@id': whoCodeInfoReference(code), code, stemId: URI,
    ...(/[&/]/u.test(code) ? { stemCode: 'AA00', exampleAxis: ['XA001'] } : {}) });
function transportFixture(responses: { status: number; body: unknown }[], idle = false) {
    const requests: http.RequestOptions[] = [];
    let destroyed = 0;
    const implementation = ((options: http.RequestOptions, callback: (response: http.IncomingMessage) => void) => {
        const index = requests.length; requests.push(options);
        const req = new EventEmitter() as http.ClientRequest;
        req.destroy = () => { destroyed++; return req; };
        req.end = (() => {
            queueMicrotask(() => {
                const res = new EventEmitter() as http.IncomingMessage;
                const planned = responses[index] ?? { status: 500, body: {} };
                res.statusCode = planned.status; res.destroy = () => res;
                callback(res);
                if (!idle) { res.emit('data', Buffer.from(JSON.stringify(planned.body))); res.emit('end'); }
            });
            return req;
        }) as http.ClientRequest['end'];
        return req;
    }) as typeof http.request;
    return { transport: createIcd11WhoCodeCheckTransport(implementation), requests, destroyed: () => destroyed };
}
function runtimeFixture(code = 'AA00') {
    const f = transportFixture([{ status: 200, body: info(code) }, { status: 200, body: stem }]);
    const env: Record<string, string> = { MEDIFLOW_ICD_WHO_ENABLED: '1', MEDIFLOW_ICD_WHO_LOCAL_IMAGE_DIGEST: `sha256:${'a'.repeat(64)}`,
        MEDIFLOW_ICD_WHO_LOCAL_DATASET_ID: `sha256:${'b'.repeat(64)}` };
    const receipts: WhoCodeCheckReceipt[] = [];
    const runtime = createIcd11WhoLocalRuntime({ readEnvironment: key => env[key], now: () => Date.parse('2026-09-07T12:00:00.000Z'),
        transport: async () => { throw new Error('Search must not be used for a code check'); }, audit: () => undefined,
        codeCheckTransport: f.transport, auditCodeCheck: r => { receipts.push(r); } });
    return { ...f, env, receipts, runtime };
}

test('single and combined code checks preserve requested code, official reference and separately labelled stem title', async () => {
    for (const code of ['AA00', 'AA00&XA001', 'AA00/XA001']) {
        const f = runtimeFixture(code);
        assert.equal(f.runtime.readiness().status, 'configured');
        const route = createWhoCodeCheckRoute({ authorize: async () => true, getRuntime: () => f.runtime });
        const fetcher: typeof fetch = async (url, init) => route(new Request(new URL(String(url), 'http://localhost'), init));
        const result = await checkWhoCode(code, '2026-01', undefined, fetcher);
        assert.equal(result.status, 'found'); assert.equal(result.code, code);
        assert.equal(result.entry?.stemTitle, 'Invented term'); assert.equal(result.entry?.stemCode, 'AA00');
        assert.equal(result.entry?.canonicalUri, whoCodeInfoReference(code));
        assert.equal(f.receipts.length, 1); assert.equal(f.receipts[0].source, 'live');
        assert.equal(f.runtime.readiness().status, 'available');
        assert.equal(f.requests.length, 2);
        for (const request of f.requests) {
            assert.equal(request.hostname, '127.0.0.1'); assert.equal(request.port, 8382);
            assert.equal(request.method, 'GET'); assert.equal(request.agent, false);
            assert.equal(request.auth, undefined);
        }
        assert.equal(f.requests[0].path, `/icd/release/11/2026-01/mms/codeinfo/${encodeURIComponent(code)}?flexiblemode=false&convertToTerminalCodes=false`);
        assert.equal(f.requests[1].path, '/icd/release/11/2026-01/mms/1000000001');
        assert.equal(parseWhoCodeCheckResult({ ...result, code: 'AA01' }, code), null);
        assert.equal(parseWhoCodeCheckResult({ ...result, receipt: { ...result.receipt, found: false } }, code), null);
        assert.equal(parseWhoCodeCheckResult({ ...result, receipt: { ...result.receipt, source: 'cache' } }, code), null);
        f.runtime.dispose();
    }
});

test('CodeInfo 404 is not_found without entity request; HTTP failure is never a missing code', async () => {
    const unknown = transportFixture([{ status: 404, body: 'Unknown invented code' }]);
    assert.equal(await unknown.transport('ZZ9999', new AbortController().signal), null);
    assert.equal(unknown.requests.length, 1);
    for (const status of [301, 401, 429, 500]) {
        const f = transportFixture([{ status, body: {} }]);
        await assert.rejects(f.transport('AA00', new AbortController().signal), (e) => e instanceof Icd11WhoServiceError && e.code === 'upstream_unavailable');
        assert.equal(f.requests.length, 1);
    }
});

test('mismatched release, code or stem title rejects the response instead of substituting a diagnosis', async () => {
    const cases = [
        [{ status: 200, body: { ...info('AA00'), code: 'AA01' } }],
        [{ status: 200, body: { ...info('AA00'), stemId: URI.replace('2026-01', '2025-01') } }],
        [{ status: 200, body: info('AA00') }, { status: 200, body: { ...stem, code: 'AA01' } }],
        [{ status: 200, body: info('AA00') }, { status: 200, body: { ...stem, title: { '@language': 'it', '@value': 'Termine inventato' } } }],
        [{ status: 200, body: { ...info('AA00'), padding: 'a'.repeat(70_000) } }],
    ];
    for (const responses of cases) {
        const f = transportFixture(responses);
        await assert.rejects(f.transport('AA00', new AbortController().signal), (e) => e instanceof Icd11WhoServiceError && e.code === 'response_invalid');
    }
});

test('disabled, malformed, unknown-release and unauthorized requests perform no WHO lookup', async () => {
    const f = runtimeFixture(); let authorized = true;
    const route = createWhoCodeCheckRoute({ authorize: async () => authorized, getRuntime: () => f.runtime });
    const get = (query: string) => route(new Request(`http://localhost/api/icd/code-check?${query}`));
    for (const query of ['code=AA00', 'code=AA00&code=AA01', 'code=aa00&release=2026-01', 'code=AA00&release=2026-01&extra=1']) {
        assert.equal((await get(query)).status, 400);
    }
    assert.equal((await get('code=AA00&release=2025-01')).status, 409);
    authorized = false; assert.equal((await get('code=AA00&release=2026-01')).status, 401);
    authorized = true; f.env.MEDIFLOW_ICD_WHO_ENABLED = '0';
    assert.equal((await get('code=AA00&release=2026-01')).status, 503);
    assert.equal(f.requests.length, 0); f.runtime.dispose();
});

test('request cancellation destroys pending IO; retirement or configuration change prevents late publication', async () => {
    const pending = transportFixture([{ status: 200, body: {} }], true);
    const abort = new AbortController(); const work = pending.transport('AA00', abort.signal); abort.abort();
    await assert.rejects(work); assert.ok(pending.destroyed() > 0);
    const f = runtimeFixture(); let authorized = true;
    const route = createWhoCodeCheckRoute({ authorize: async () => authorized,
        getRuntime: () => ({ checkCode: async code => { const result = await f.runtime.checkCode(code); authorized = false; return result; } }) });
    const response = await route(new Request('http://localhost/api/icd/code-check?code=AA00&release=2026-01'));
    assert.equal(response.status, 401); assert.doesNotMatch(await response.text(), /stemTitle|AA00/u);
    f.runtime.dispose();

    const changed = runtimeFixture();
    const checking = changed.runtime.checkCode('AA00');
    changed.env.MEDIFLOW_ICD_WHO_ENABLED = '0';
    await assert.rejects(checking, (e) => e instanceof Icd11WhoServiceError && e.code === 'request_cancelled');
    assert.equal(changed.receipts.length, 0); changed.runtime.dispose();
});

test('client rejects a mismatched code and exposes unsupported release without a request', async () => {
    let calls = 0;
    const fetcher: typeof fetch = async () => { calls++; return Response.json({}); };
    await assert.rejects(checkWhoCode('AA00', '2025-01', undefined, fetcher), (e) => e instanceof WhoCodeCheckError && e.code === 'release');
    assert.equal(calls, 0);
    await assert.rejects(checkWhoCode('AA00', '2026-01', undefined, fetcher), (e) => e instanceof WhoCodeCheckError && e.code === 'response');
});
