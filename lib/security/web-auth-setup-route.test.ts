/* @Codex */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';

const root = process.cwd();
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-web-setup-route-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
for (const fileName of fs.readdirSync(path.join(root, 'drizzle')).filter((name) => name.endsWith('.sql')).sort()) {
    const sqlite = new Database(path.join(dataDir, 'medical.db'));
    try {
        sqlite.exec(fs.readFileSync(path.join(root, 'drizzle', fileName), 'utf8').replace(/^-->\s+statement-breakpoint\s*$/gmu, ''));
    } finally { sqlite.close(); }
}

const { POST: setup } = await import('../../app/api/auth/setup/route.ts');
const { POST: login } = await import('../../app/api/auth/login/route.ts');
const { GET: check } = await import('../../app/api/auth/check/route.ts');
const { dbServer } = await import('../db-server.ts');
const { users } = await import('../schema.ts');
const { retire } = await import('./web-auth-lifecycle-owner-adapter.ts');
const { completeExactWebP3Logout } = await import('./web-auth-logout-server.ts');

const transaction = dbServer.transaction.bind(dbServer);
const USERNAME = ['synthetic', 'recovery', 'admin'].join('-');
const PIN = ['24', '68'].join('');
type Control = Readonly<{ controlId: string; etag: string }>;
function request(pathname: string, body: Record<string, unknown>, control: Control): Request {
    return new Request(`${['http:', '', '127.0.0.1'].join('/')}${pathname}`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            cookie: `mediflow_auth_control=${control.controlId}`,
            'if-match': control.etag,
            'idempotency-key': randomUUID(),
        },
        body: JSON.stringify(body),
    });
}
function cookieId(response: Response): string | null {
    const cookie = response.headers.get('set-cookie');
    return cookie?.match(/^mediflow_session=([^;]+)/u)?.[1] ?? null;
}
function responseCookie(response: Response, name: string): string {
    const cookie = typeof response.headers.getSetCookie === 'function'
        ? response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`))
        : response.headers.get('set-cookie');
    assert.ok(cookie);
    return cookie.slice(`${name}=`.length).split(';', 1)[0];
}
async function bootstrapControl(): Promise<Control> {
    const response = await check(new Request('http://127.0.0.1/api/auth/check'));
    assert.notEqual(response.status, 503);
    const etag = response.headers.get('etag');
    assert.ok(etag);
    return Object.freeze({ controlId: responseCookie(response, 'mediflow_auth_control'), etag });
}

test.after(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
});

test('keeps the committed setup recoverable through ordinary login when final P3 issue denies', async () => {
    const failedControl = await bootstrapControl();
    const originalError = console.error;
    let failedCommit: Response;
    try {
        console.error = () => undefined;
        dbServer.transaction = (() => { throw new Error('synthetic transaction failure'); }) as typeof dbServer.transaction;
        failedCommit = await setup(request('/api/auth/setup', {
            username: USERNAME, password: PIN,
            encryptedMasterKey: 'synthetic-wrapped-key', salt: 'synthetic-salt',
            displayName: 'Synthetic Recovery Operator', ambulatoryName: 'Synthetic Recovery Ambulatory',
        }, failedControl));
    } finally {
        console.error = originalError;
        dbServer.transaction = transaction;
    }
    assert.equal(failedCommit.status, 500);
    assert.equal(failedCommit.headers.get('set-cookie'), null);
    assert.deepEqual(await dbServer.select({ id: users.id }).from(users).limit(1), []);

    const setupControl = await bootstrapControl();
    let successorEtag: string | null = null;
    dbServer.transaction = ((callback: Parameters<typeof dbServer.transaction>[0]) => {
        const result = transaction(callback);
        const receipt = retire(null, 'lock', {
            controlId: setupControl.controlId,
            ifMatch: setupControl.etag.slice(1, -1),
            idempotencyKey: randomUUID(),
        });
        assert.equal(receipt.outcome, 'completed');
        successorEtag = receipt.etag ? `"${receipt.etag}"` : null;
        return result;
    }) as typeof dbServer.transaction;

    let setupResponse: Response;
    try {
        setupResponse = await setup(request('/api/auth/setup', {
            username: USERNAME, password: PIN,
            encryptedMasterKey: 'synthetic-wrapped-key', salt: 'synthetic-salt',
            displayName: 'Synthetic Recovery Operator', ambulatoryName: 'Synthetic Recovery Ambulatory',
        }, setupControl));
    } finally { dbServer.transaction = transaction; }

    assert.equal(setupResponse.status, 409);
    assert.deepEqual(await setupResponse.json(), {
        error: 'Setup completed. Sign in to continue.', code: 'SETUP_COMMITTED_AUTH_UNAVAILABLE',
    });
    assert.equal(setupResponse.headers.get('set-cookie'), null);
    const persisted = await dbServer.select({ id: users.id }).from(users).limit(1);
    assert.match(persisted[0]?.id ?? '', /^[0-9a-f-]{36}$/u);

    assert.ok(successorEtag);
    const retryControl = await bootstrapControl();
    const retrySetup = await setup(request('/api/auth/setup', {}, retryControl));
    assert.equal(retrySetup.status, 409);
    assert.deepEqual(await retrySetup.json(), { error: 'Setup already completed', code: 'SETUP_ALREADY_COMPLETED' });
    assert.equal(retrySetup.headers.get('set-cookie'), null);

    const loginControl = await bootstrapControl();
    const loginResponse = await login(request('/api/auth/login', { username: USERNAME, password: PIN }, loginControl));
    assert.equal(loginResponse.status, 200);
    const loginBody = await loginResponse.json() as Record<string, unknown>;
    assert.equal(loginBody.id, persisted[0]?.id);
    const sessionId = cookieId(loginResponse);
    assert.ok(sessionId);
    const logout = await completeExactWebP3Logout(
        { name: 'mediflow_session', value: sessionId },
        { name: 'mediflow_auth_control', value: loginControl.controlId },
        new Request('http://127.0.0.1/api/auth/logout', { method: 'POST' }),
    );
    assert.equal(logout.status, 204);
});
