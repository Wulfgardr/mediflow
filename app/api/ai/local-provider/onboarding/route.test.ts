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
    method: 'POST', headers: { origin: 'http://localhost:3000', 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(body),
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
