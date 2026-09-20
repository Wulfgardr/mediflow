/* @Codex */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, mock, test } from 'node:test';
import { dbServer } from '../../../../../lib/db-server';
import { settings } from '../../../../../lib/schema';
import * as auth from '../../../../../lib/security/server-auth';
import * as owner from '../../../../../lib/security/web-auth-lifecycle-owner-adapter';
import * as locality from '../../../../../lib/ai-providers/ollama-locality';
import { GET, POST } from './route';
import { NextRequest } from 'next/server';

const root = process.env.MEDIFLOW_DATA_DIR!;
assert.ok(root && root.includes('local-onboarding'));
let current: owner.WebSessionProjection | null = null;
afterEach(() => {
    if (current) owner.retireForUser(current);
    current = null; mock.restoreAll();
    dbServer.delete(settings).run();
    fs.rmSync(path.join(root, 'ai'), { recursive: true, force: true });
});
function fixture() {
    const control = owner.bootstrapControl()!;
    const attempt = owner.begin('login', { controlId: control.controlId, ifMatch: control.etag, idempotencyKey: `route-${Date.now()}` })!;
    const issued = owner.issue(attempt, { id: 'synthetic-route', username: path.basename(root), role: 'user' })!;
    const resolved = owner.resolve(issued.sessionId, control.controlId);
    assert.equal(resolved.status, 'active'); if (resolved.status !== 'active') throw new Error('fixture');
    current = resolved.projection;
    mock.method(auth, 'requireSession', async () => {
        const reread = owner.resolve(issued.sessionId, control.controlId);
        return reread.status === 'active' ? reread.projection : null;
    });
    for (const [key, value] of Object.entries({ aiProvider: 'ollama', aiModel_clinical: 'synthetic-local', aiUrl: 'http://127.0.0.1:11434' }))
        dbServer.insert(settings).values({ key, value }).run();
    const attest = mock.method(locality, 'attestLocalOllamaModel', async () => ({ provider: 'ollama', checkedAt: new Date().toISOString() }));
    return attest;
}
const request = (body: unknown, extra: Record<string, string> = {}) => new Request('http://localhost:3000/api/ai/local-provider/onboarding', {
    method: 'POST', headers: { origin: 'http://localhost:3000', 'sec-fetch-site': 'same-origin', 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(body),
});

test('route composes canonical service: no-store read, explicit activation, receipt and no caller target', async () => {
    const attest = fixture(); const read = await GET(new Request('http://localhost:3000/api/ai/local-provider/onboarding'));
    assert.equal(read.status, 200); assert.equal(read.headers.get('cache-control'), 'no-store');
    const initial = await read.json(); assert.equal(attest.mock.callCount(), 0);
    const result = await POST(request({ intent: 'verify_and_activate', expectedRevision: initial.revision }));
    assert.equal(result.status, 200); assert.equal(result.headers.get('cache-control'), 'no-store');
    const body = await result.json(); assert.equal(body.version, 1); assert.match(body.receipt, /^receipt_/);
    assert.equal(body.inference, 'not_run'); assert.equal(attest.mock.callCount(), 1);
    assert.equal((await (await GET(new Request('http://localhost:3000/api/ai/local-provider/onboarding'))).json()).state, 'available_unqualified');
});

test('expired ordinary session denies before body parse or provider work', async () => {
    const attest = fixture(); owner.retireForUser(current!);
    const response = await POST(request({ intent: 'verify_and_activate', expectedRevision: 'a'.repeat(64) }));
    assert.equal(response.status, 401); assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(attest.mock.callCount(), 0); assert.equal(fs.existsSync(path.join(root, 'ai')), false);
});

test('ordinary malformed, excessive and stale requests produce bounded denial without attestation', async () => {
    const attest = fixture(); const status = await (await GET(new Request('http://localhost:3000/api/ai/local-provider/onboarding'))).json();
    for (const body of [{}, { intent: 'verify_and_activate', expectedRevision: status.revision, url: 'ignored' },
        { intent: 'verify_and_activate', expectedRevision: 'x'.repeat(300) }]) {
        assert.equal((await POST(request(body))).status, 400);
    }
    assert.equal((await POST(request({ intent: 'verify_and_activate', expectedRevision: 'a'.repeat(64) }))).status, 409);
    assert.equal((await POST(request({ intent: 'verify_and_activate', expectedRevision: status.revision }, { origin: 'null' }))).status, 400);
    assert.equal(attest.mock.callCount(), 0); assert.equal(fs.existsSync(path.join(root, 'ai')), false);
});

test('network error reports practical code and preserves missing lifecycle', async () => {
    const attest = fixture(); attest.mock.mockImplementation(async () => { throw new Error('private-network-detail'); });
    const status = await (await GET(new Request('http://localhost:3000/api/ai/local-provider/onboarding'))).json();
    const response = await POST(request({ intent: 'verify_and_activate', expectedRevision: status.revision }));
    assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: 'provider_unreachable' });
    assert.equal((await (await GET(new Request('http://localhost:3000/api/ai/local-provider/onboarding'))).json()).state, 'missing');
});

/* @Codex: real NextRequest normalization, not a plain WHATWG Request fixture. */
test('ordinary NextRequest preserves browser Host authority when loopback URL normalizes', async () => {
    const attest = fixture();
    const initial = await (await GET(new NextRequest('http://127.0.0.1:4396/api/ai/local-provider/onboarding'))).json();
    const browserRequest = new NextRequest('http://127.0.0.1:4396/api/ai/local-provider/onboarding', {
        method: 'POST', headers: { host: '127.0.0.1:4396', origin: 'http://127.0.0.1:4396',
            'sec-fetch-site': 'same-origin', 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ intent: 'verify_and_activate', expectedRevision: initial.revision }),
    });
    assert.equal(new URL(browserRequest.url).hostname, 'localhost');
    const response = await POST(browserRequest);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).state, 'available_unqualified');
    assert.equal(attest.mock.callCount(), 1);
});

/* @Codex: exact scheme/host/port remain required despite Next URL normalization. */
test('ordinary NextRequest rejects inconsistent browser transport without provider work', async () => {
    const attest = fixture();
    const initial = await (await GET(new NextRequest('http://127.0.0.1:4396/api/ai/local-provider/onboarding'))).json();
    for (const extra of [
        { origin: 'http://localhost:4396' },
        { origin: 'http://127.0.0.1:4397' },
        { origin: 'https://127.0.0.1:4396' },
        { origin: 'null' },
        { 'sec-fetch-site': 'cross-site' },
        { 'sec-fetch-site': 'same-site' },
        { 'sec-fetch-site': '' },
    ]) {
        const headers = new Headers({ host: '127.0.0.1:4396', origin: 'http://127.0.0.1:4396',
            'sec-fetch-site': 'same-origin', 'content-type': 'application/json' });
        for (const [key, value] of Object.entries(extra)) headers.set(key, value);
        const response = await POST(new NextRequest('http://127.0.0.1:4396/api/ai/local-provider/onboarding', {
            method: 'POST', headers,
            body: JSON.stringify({ intent: 'verify_and_activate', expectedRevision: initial.revision }),
        }));
        assert.equal(response.status, 400);
        assert.deepEqual(await response.json(), { error: 'input_invalid' });
    }
    assert.equal(attest.mock.callCount(), 0);
    assert.equal(fs.existsSync(path.join(root, 'ai')), false);
});

/* @Codex: cancellation never creates an admission or a successful late response. */
test('POST forwards ordinary request cancellation through the canonical service to attestation', async () => {
    const attest = fixture();
    const initial = await (await GET(new Request('http://localhost:3000/api/ai/local-provider/onboarding'))).json();
    let started!: () => void;
    const waiting = new Promise<void>(resolve => { started = resolve; });
    let observed: AbortSignal | undefined;
    let finish!: () => void;
    attest.mock.mockImplementation(async (...args: unknown[]): Promise<Awaited<ReturnType<typeof locality.attestLocalOllamaModel>>> => {
        observed = args[2] as AbortSignal;
        started(); return new Promise(resolve => { finish = () => resolve({
            authorityPlane: 'clinical_application', provider: 'ollama', executionMode: 'local', endpointClass: 'loopback',
            requestedModel: 'synthetic-local', canonicalModel: 'synthetic-local', digest: 'a'.repeat(64),
            serverVersion: '0.33.3', checkedAt: new Date().toISOString(),
        }); });
    });
    const controller = new AbortController();
    const pending = POST(new Request(request({ intent: 'verify_and_activate', expectedRevision: initial.revision }), { signal: controller.signal }));
    await waiting; controller.abort();
    const response = await pending;
    assert.equal(response.status, 409); assert.deepEqual(await response.json(), { error: 'verification_interrupted' });
    assert.equal(response.headers.get('cache-control'), 'no-store'); assert.equal(observed?.aborted, true);
    finish(); await Promise.resolve();
    assert.equal(fs.existsSync(path.join(root, 'ai')), false);
    assert.equal((await (await GET(new Request('http://localhost:3000/api/ai/local-provider/onboarding'))).json()).state, 'missing');
});

test('already cancelled POST does not reach attestation', async () => {
    const attest = fixture();
    const initial = await (await GET(new Request('http://localhost:3000/api/ai/local-provider/onboarding'))).json();
    const controller = new AbortController(); controller.abort();
    const response = await POST(new Request(request({ intent: 'verify_and_activate', expectedRevision: initial.revision }), { signal: controller.signal }));
    assert.equal(response.status, 409); assert.deepEqual(await response.json(), { error: 'verification_interrupted' });
    assert.equal(attest.mock.callCount(), 0); assert.equal(fs.existsSync(path.join(root, 'ai')), false);
});

for (const stop of ['request', 'deadline'] as const) {
    test(`incomplete body is cancelled and unlocked on ${stop} without provider work`, async context => {
        context.mock.timers.enable({ apis: ['setTimeout'] });
        const attest = fixture();
        let started!: () => void;
        const waiting = new Promise<void>(resolve => { started = resolve; });
        let pulls = 0; let cancelled = false;
        const stream = new ReadableStream<Uint8Array>({
            pull(target) { if (++pulls === 1) target.enqueue(new TextEncoder().encode('{')); else started(); },
            cancel() { cancelled = true; },
        });
        const controller = new AbortController();
        const input = new Request('http://localhost:3000/api/ai/local-provider/onboarding', {
            method: 'POST', headers: { origin: 'http://localhost:3000', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' },
            body: stream, signal: controller.signal, duplex: 'half',
        } as RequestInit & { duplex: 'half' });
        const pending = POST(input); await waiting;
        if (stop === 'request') controller.abort(); else context.mock.timers.tick(5001);
        const response = await pending;
        assert.equal(response.status, stop === 'request' ? 409 : 400);
        assert.deepEqual(await response.json(), { error: stop === 'request' ? 'verification_interrupted' : 'input_invalid' });
        assert.equal(cancelled, true); assert.equal(stream.locked, false);
        assert.equal(attest.mock.callCount(), 0); assert.equal(fs.existsSync(path.join(root, 'ai')), false);
    });
}

test('body remains capped at 256 actual bytes, accepting the boundary and rejecting the next byte', async () => {
    const attest = fixture();
    const initial = await (await GET(new Request('http://localhost:3000/api/ai/local-provider/onboarding'))).json();
    const body = JSON.stringify({ intent: 'verify_and_activate', expectedRevision: initial.revision });
    const exact = body.padEnd(256, ' ');
    assert.equal(new TextEncoder().encode(exact).byteLength, 256);
    assert.equal((await POST(new Request(request({}), { body: exact + ' ' }))).status, 400);
    assert.equal(attest.mock.callCount(), 0);
    assert.equal((await POST(new Request(request({}), { body: exact }))).status, 200);
    assert.equal(attest.mock.callCount(), 1);
});

test('ambiguous duplicate intent is invalid JSON input, not a second activation instruction', async () => {
    const attest = fixture();
    const initial = await (await GET(new Request('http://localhost:3000/api/ai/local-provider/onboarding'))).json();
    const body = `{"intent":"verify_and_activate","intent":"verify_and_activate","expectedRevision":"${initial.revision}"}`;
    const response = await POST(new Request(request({}), { body }));
    assert.equal(response.status, 400); assert.deepEqual(await response.json(), { error: 'input_invalid' });
    assert.equal(attest.mock.callCount(), 0); assert.equal(fs.existsSync(path.join(root, 'ai')), false);
});
