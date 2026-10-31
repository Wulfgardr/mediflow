import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import test from 'node:test';
import { eq } from 'drizzle-orm';
import { installLoopbackIngress } from '../../../lib/security/loopback-ingress.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-network-mode-'));
process.env.MEDIFLOW_DATA_DIR = root;
process.env.MEDIFLOW_LOCAL_API_TOKEN = randomBytes(32).toString('hex');
const { PUT, GET } = await import('./[key]/route.ts');
const { POST } = await import('./route.ts');
const { dbServer } = await import('../../../lib/db-server.ts');
const { settings } = await import('../../../lib/schema.ts');
const { exposedNetworkModeAllowed } = await import('../../../lib/security/settings-write-policy.ts');
installLoopbackIngress();
// Attestation is minted at the Node socket boundary, so this write crosses a real loopback socket.
const server = http.createServer(async (incoming, outgoing) => {
    const chunks: Buffer[] = [];
    for await (const chunk of incoming) chunks.push(chunk as Buffer);
    const response = await PUT(new Request('http://127.0.0.1/api/settings/network.mode', {
        method: 'PUT', headers: incoming.headers as Record<string, string>, body: Buffer.concat(chunks),
    }), context);
    outgoing.statusCode = response.status;
    outgoing.end(await response.text());
});
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
test.after(() => server.close());
async function viaLoopback(body: unknown) {
    const { port } = server.address() as { port: number };
    return fetch(`http://127.0.0.1:${port}/`, {
        method: 'PUT', body: JSON.stringify(body),
        headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.MEDIFLOW_LOCAL_API_TOKEN}` },
    });
}
const context = { params: Promise.resolve({ key: 'network.mode' }) };
function request(body?: unknown, authenticated = true) {
    return new Request('http://127.0.0.1/api/settings/network.mode', {
        method: body === undefined ? 'GET' : 'PUT',
        headers: { 'content-type': 'application/json', ...(authenticated ? { authorization: `Bearer ${process.env.MEDIFLOW_LOCAL_API_TOKEN}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
}
const value = () => dbServer.select().from(settings).where(eq(settings.key, 'network.mode')).get()?.value ?? null;
test('network mode uses the existing writer with atomic stale-value rejection and reread', async () => {
    assert.equal((await viaLoopback({ value: 'network-home-base', expectedValue: null })).status, 200);
    assert.equal(value(), 'network-home-base');
    const response = await GET(request(), context);
    assert.equal((await response.json()).value, 'network-home-base');
    assert.equal((await PUT(request({ value: 'local-only', expectedValue: null }), context)).status, 409);
    assert.equal(value(), 'network-home-base');
    assert.equal((await PUT(request({ value: 'local-only', expectedValue: 'network-home-base' }), context)).status, 200);
    assert.equal(value(), 'local-only');
});
test('invalid and unauthorized conditional writes leave the previous mode unchanged', async () => {
    for (const body of [
        { value: 'remote-cloud', expectedValue: 'local-only' },
        { value: 'network-home-base', expectedValue: {} },
    ]) assert.equal((await viaLoopback(body)).status, 400);
    assert.equal((await PUT(request({ value: 'network-home-base', expectedValue: 'local-only' }, false), context)).status, 401);
    assert.equal(value(), 'local-only');
});
test('legacy Web and bootstrap writers keep their existing request contract', async () => {
    assert.equal((await viaLoopback({ value: 'network-home-base' })).status, 200);
    assert.equal(value(), 'network-home-base');
    assert.equal((await PUT(request({ value: 'local-only' }), context)).status, 200);
    assert.equal(value(), 'local-only');
});
test('the exposed mode needs an admin on this computer, with or without a precondition', async () => {
    for (const body of [{ value: 'network-home-base' }, { value: 'network-home-base', expectedValue: 'local-only' }]) {
        assert.equal((await PUT(request(body), context)).status, 403);
        assert.equal(value(), 'local-only');
    }
    const generic = new Request('http://127.0.0.1/api/settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.MEDIFLOW_LOCAL_API_TOKEN}` },
        body: JSON.stringify({ key: 'network.mode', value: 'network-home-base' }),
    });
    assert.equal((await POST(generic)).status, 403);
    assert.equal(value(), 'local-only');
    assert.equal(exposedNetworkModeAllowed({ role: 'admin' }, true), true);
    assert.equal(exposedNetworkModeAllowed({ role: 'admin' }, false), false);
    assert.equal(exposedNetworkModeAllowed({ role: 'clinician' }, true), false);
    assert.equal(exposedNetworkModeAllowed({ role: 'nurse' }, true), false);
});
test('an out-of-domain mode is rejected without a precondition too', async () => {
    assert.equal((await PUT(request({ value: 'invalid' }), context)).status, 400);
    const generic = new Request('http://127.0.0.1/api/settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.MEDIFLOW_LOCAL_API_TOKEN}` },
        body: JSON.stringify({ key: 'network.mode', value: 'invalid' }),
    });
    assert.equal((await POST(generic)).status, 400);
    assert.equal(value(), 'local-only');
});
