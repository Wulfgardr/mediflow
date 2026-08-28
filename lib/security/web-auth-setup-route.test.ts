/* @Codex */
import assert from 'node:assert/strict';
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

const originalNow = Date.now;
let poisonIssue = false;
const issuePoison: { begin: typeof import('./web-auth-session-issuer.ts').begin | null } = { begin: null };
Date.now = (() => {
    const now = originalNow();
    if (poisonIssue) {
        poisonIssue = false;
        assert.equal(issuePoison.begin?.('login'), null);
    }
    return now;
}) as typeof Date.now;

const { POST: setup } = await import('../../app/api/auth/setup/route.ts');
const { POST: login } = await import('../../app/api/auth/login/route.ts');
const { dbServer } = await import('../db-server.ts');
const { users } = await import('../schema.ts');
const issuer = await import('./web-auth-session-issuer.ts');
issuePoison.begin = issuer.begin;

const transaction = dbServer.transaction.bind(dbServer);
const USERNAME = ['synthetic', 'recovery', 'admin'].join('-');
const PIN = ['24', '68'].join('');
function request(pathname: string, body: Record<string, unknown>): Request {
    return new Request(`${['http:', '', '127.0.0.1'].join('/')}${pathname}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
}
function cookieId(response: Response): string | null {
    const cookie = response.headers.get('set-cookie');
    return cookie?.match(/^mediflow_session=([^;]+)/u)?.[1] ?? null;
}

test.after(() => {
    Date.now = originalNow;
    fs.rmSync(dataDir, { recursive: true, force: true });
});

test('keeps the committed setup recoverable through ordinary login when final P3 issue denies', async () => {
    const originalError = console.error;
    let failedCommit: Response;
    try {
        console.error = () => undefined;
        dbServer.transaction = (() => { throw new Error('synthetic transaction failure'); }) as typeof dbServer.transaction;
        failedCommit = await setup(request('/api/auth/setup', {
            username: USERNAME, password: PIN,
            encryptedMasterKey: 'synthetic-wrapped-key', salt: 'synthetic-salt',
            displayName: 'Synthetic Recovery Operator', ambulatoryName: 'Synthetic Recovery Ambulatory',
        }));
    } finally {
        console.error = originalError;
        dbServer.transaction = transaction;
    }
    assert.equal(failedCommit.status, 500);
    assert.equal(failedCommit.headers.get('set-cookie'), null);
    assert.deepEqual(await dbServer.select({ id: users.id }).from(users).limit(1), []);

    dbServer.transaction = ((callback: Parameters<typeof dbServer.transaction>[0]) => {
        const result = transaction(callback);
        poisonIssue = true;
        return result;
    }) as typeof dbServer.transaction;

    let setupResponse: Response;
    try {
        setupResponse = await setup(request('/api/auth/setup', {
            username: USERNAME, password: PIN,
            encryptedMasterKey: 'synthetic-wrapped-key', salt: 'synthetic-salt',
            displayName: 'Synthetic Recovery Operator', ambulatoryName: 'Synthetic Recovery Ambulatory',
        }));
    } finally { dbServer.transaction = transaction; }

    assert.equal(setupResponse.status, 409);
    assert.deepEqual(await setupResponse.json(), {
        error: 'Setup completed. Sign in to continue.', code: 'SETUP_COMMITTED_AUTH_UNAVAILABLE',
    });
    assert.equal(setupResponse.headers.get('set-cookie'), null);
    const persisted = await dbServer.select({ id: users.id }).from(users).limit(1);
    assert.match(persisted[0]?.id ?? '', /^[0-9a-f-]{36}$/u);

    const retrySetup = await setup(request('/api/auth/setup', {}));
    assert.equal(retrySetup.status, 409);
    assert.deepEqual(await retrySetup.json(), { error: 'Setup already completed', code: 'SETUP_ALREADY_COMPLETED' });
    assert.equal(retrySetup.headers.get('set-cookie'), null);

    const loginResponse = await login(request('/api/auth/login', { username: USERNAME, password: PIN }));
    assert.equal(loginResponse.status, 200);
    const loginBody = await loginResponse.json() as Record<string, unknown>;
    assert.equal(loginBody.id, persisted[0]?.id);
    const sessionId = cookieId(loginResponse);
    assert.ok(sessionId);
});
