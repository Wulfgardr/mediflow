import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { eq } from 'drizzle-orm';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-network-mode-'));
process.env.MEDIFLOW_DATA_DIR = root;
process.env.MEDIFLOW_LOCAL_API_TOKEN = randomBytes(32).toString('hex');
const { PUT, GET } = await import('./[key]/route.ts');
const { dbServer } = await import('../../../lib/db-server.ts');
const { settings } = await import('../../../lib/schema.ts');
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
    assert.equal((await PUT(request({ value: 'network-home-base', expectedValue: null }), context)).status, 200);
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
    ]) assert.equal((await PUT(request(body), context)).status, 400);
    assert.equal((await PUT(request({ value: 'network-home-base', expectedValue: 'local-only' }, false), context)).status, 401);
    assert.equal(value(), 'local-only');
});
test('legacy Web and bootstrap writers keep their existing request contract', async () => {
    assert.equal((await PUT(request({ value: 'network-home-base' }), context)).status, 200);
    assert.equal(value(), 'network-home-base');
});
