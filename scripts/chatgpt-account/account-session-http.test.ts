/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createAccountService } from '../../lib/chatgpt-account/account-service';
import { createAccountSessionRegistry } from '../../lib/chatgpt-account/account-session';
import { createAccountHttp } from '../../lib/chatgpt-account/account-http';
import { SyntheticAccountTransport, deferred } from './account-test-fixture';
import { issueSyntheticWebSessionContext, retireSyntheticWebSession } from '../../lib/security/web-auth-lifecycle-owner-test-fixture';
import * as owner from '../../lib/security/web-auth-lifecycle-owner-adapter';

let sequence = 0;
function setup() {
    sequence++;
    const context = issueSyntheticWebSessionContext({ id: `synthetic-user-${sequence}`, username: 'synthetic', role: 'doctor' }, `chatgpt-${sequence}`);
    const session = context.session as owner.WebSessionProjection;
    const transport = new SyntheticAccountTransport();
    const service = createAccountService({ configured: true, createTransport: async () => transport });
    const registry = createAccountSessionRegistry(() => service);
    const http = createAccountHttp({ acquire: async () => registry.acquire(session) });
    return { session, context, transport, registry, service, http, cleanup() { registry.dispose(); retireSyntheticWebSession(session); } };
}
function request(operation = 'read', body = '{}', extra: Record<string, string> = {}) {
    return new Request(`http://localhost:3000/api/settings/ai/chatgpt/${operation}`, { method: 'POST', body,
        headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', origin: 'http://localhost:3000', ...extra } });
}
test('unauthenticated requests cannot spawn, and CSRF or extra input deny before any RPC', async () => {
    const unavailable = createAccountHttp({ acquire: async () => null });
    assert.equal((await unavailable(request('login/start'), 'login/start')).status, 401);
    const f = setup();
    try {
        for (const headers of [{ origin: 'https://foreign.invalid' }, { 'sec-fetch-site': 'cross-site' }, { 'content-type': 'text/plain' }, { origin: '' }] as Record<string, string>[]) {
            assert.equal((await f.http(request('login/start', '{}', headers), 'login/start')).status, 403);
        }
        for (const body of ['null', '[]', '{"command":"synthetic"}', '{"path":"/synthetic"}', '{"loginId":"foreign"}', 'x'.repeat(65)]) {
            assert.equal((await f.http(request('login/start', body), 'login/start')).status, 400);
        }
        assert.equal((await f.http(request('login/start?path=synthetic'), 'login/start')).status, 400);
        assert.equal(f.transport.calls.length, 0);
    } finally { f.cleanup(); }
});
test('status is no-store and read-only; authenticated login/catalog/limits/logout use real owner ports', async () => {
    const f = setup();
    try {
        const status = await f.http(new Request('http://localhost:3000/api/settings/ai/chatgpt/status'), 'status');
        assert.equal(status.status, 200); assert.equal(status.headers.get('cache-control'), 'no-store'); assert.equal(f.transport.calls.length, 0);
        assert.equal((await f.http(request('login/start'), 'login/start')).status, 200);
        f.transport.complete();
        assert.equal((await f.http(request('login/complete'), 'login/complete')).status, 200);
        for (const op of ['read', 'models', 'rate-limits', 'logout'] as const) {
            const result = await f.http(request(op), op); assert.equal(result.status, 200);
            assert.equal(JSON.stringify(await result.json()).includes('fixture@example'), false);
        }
        assert.equal(f.transport.closed, 1);
    } finally { f.cleanup(); }
});
test('copied or expired session cannot acquire an account capability', () => {
    const f = setup();
    try {
        assert.throws(() => f.registry.acquire({ ...f.session }), /session_expired/);
        assert.throws(() => f.registry.acquire({ ...f.session, expiresAt: 0 }), /session_expired/);
        retireSyntheticWebSession(f.session);
        assert.throws(() => f.registry.acquire(f.session), /session_expired/);
    } finally { f.cleanup(); }
});
test('real owner retirement disposes process and prevents late account response serialization', async () => {
    for (const reason of ['dispose', 'lock'] as const) {
        const f = setup();
        try {
            await f.http(request('login/start'), 'login/start'); f.transport.complete();
            await f.http(request('login/complete'), 'login/complete');
            const response = deferred<unknown>(); const reached = deferred<void>();
            f.transport.handler = async () => { reached.resolve(); return response.promise; };
            let serialized = false;
            const pending = f.registry.acquire(f.session).respond('models', () => { serialized = true; return Response.json({ forbidden: true }); });
            await reached.promise;
            const receipt = owner.retire(f.session, reason, reason === 'lock' ? { controlId: f.context.controlId, ifMatch: f.context.etag, idempotencyKey: 'synthetic-lock-' + sequence } : undefined);
            assert.notEqual(receipt.outcome, 'denied', reason);
            response.resolve({ data: [], nextCursor: null });
            await assert.rejects(pending, /session_expired/);
            assert.equal(serialized, false); assert.equal(f.transport.closed, 1);
        } finally { f.cleanup(); }
    }
});
test('a new application session does not inherit a prior account', async () => {
    const first = setup();
    await first.http(request('login/start'), 'login/start'); first.transport.complete();
    await first.http(request('login/complete'), 'login/complete'); first.cleanup();
    const second = setup();
    try { assert.equal(second.service.status().state, 'disconnected'); assert.equal(second.transport.calls.length, 0); }
    finally { second.cleanup(); }
});
test('HTTP returns sanitized stable failures and checks method', async () => {
    const f = setup();
    try {
        const response = await f.http(request(), 'read'); assert.equal(response.status, 409);
        assert.equal((await f.http(new Request('http://localhost:3000/read'), 'read')).status, 405);
        const broken = createAccountHttp({ acquire: async () => { throw new Error('synthetic-private-detail'); } });
        const failure = await broken(request(), 'read');
        assert.equal(await failure.text(), '{"error":"protocol_error","inferenceEnabled":false,"executionBlock":"data_boundary_unqualified"}');
    } finally { f.cleanup(); }
});
test('all eight routes bind only the account handler; production uses Web owner, never local token or Fabric', () => {
    for (const op of ['status', 'login/start', 'login/cancel', 'login/complete', 'read', 'models', 'rate-limits', 'logout']) {
        const source = readFileSync(`app/api/settings/ai/chatgpt/${op}/route.ts`, 'utf8');
        assert.match(source, /handleAccountRequest/); assert.match(source, /runtime = 'nodejs'/);
        assert.match(source, op === 'status' ? /function GET/ : /function POST/);
    }
    const source = readFileSync('lib/chatgpt-account/account-production.ts', 'utf8');
    assert.match(source, /requireSession/); assert.doesNotMatch(source, /requireSessionOrLocalToken|fabric|thread\/start|turn\/start/);
});
test('streamed oversized body is bounded even without Content-Length', async () => {
    const f = setup();
    try {
        const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(65)); } });
        const req = new Request('http://localhost:3000/api/settings/ai/chatgpt/login/start', {
            method: 'POST', body: stream, duplex: 'half',
            headers: { 'content-type': 'application/json', origin: 'http://localhost:3000', 'sec-fetch-site': 'same-origin' },
        } as RequestInit);
        assert.equal((await f.http(req, 'login/start')).status, 400);
        assert.equal(f.transport.calls.length, 0);
    } finally { f.cleanup(); }
});
