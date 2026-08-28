/* @Codex */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';

// P1b-C HOLD: native compatibility predicates are outside this Web-only packet.
const root = process.cwd();
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-web-auth-channel-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
function bootstrapDatabase(): void {
    const sqlite = new Database(path.join(dataDir, 'medical.db'));
    try {
        for (const fileName of fs.readdirSync(path.join(root, 'drizzle')).filter((name) => name.endsWith('.sql')).sort()) {
            sqlite.exec(fs.readFileSync(path.join(root, 'drizzle', fileName), 'utf8').replace(/^-->\s+statement-breakpoint\s*$/gmu, ''));
        }
    } finally {
        sqlite.close();
    }
}
bootstrapDatabase();
const { POST: setup } = await import('../../app/api/auth/setup/route.ts');
const { POST: login } = await import('../../app/api/auth/login/route.ts');
const { listAuditEvents } = await import('./audit.ts');
const { clearAllSessions, getSession } = await import('./server-session.ts');

const USERNAME = 'synthetic-web-admin'; const PIN = '2468';
const WRAPPED_KEY = 'synthetic-wrapped-key'; const SALT = 'synthetic-salt';
function forgedRequest(pathname: string, body: Record<string, unknown>): Request {
    return new Request(`${['http:', '', '127.0.0.1'].join('/')}${pathname}`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'x-mediflow-source-surface': 'native',
            'x-mediflow-paired-client-id': 'synthetic-paired-client',
            'x-mediflow-paired-client-token': 'synthetic-paired-token',
            authorization: 'Bearer synthetic-local-api-token',
            cookie: 'mediflow_session=forged-existing-cookie',
        },
        body: JSON.stringify(body),
    });
}
function sessionId(response: Response): string {
    const cookie = typeof response.headers.getSetCookie === 'function'
        ? response.headers.getSetCookie().find((value) => value.startsWith('mediflow_session='))
        : response.headers.get('set-cookie');
    assert.ok(cookie, 'response must set mediflow_session');
    assert.match(cookie, /^mediflow_session=[^;]+/u);
    assert.match(cookie, /;\s*Path=\//iu);
    assert.match(cookie, /;\s*HttpOnly/iu);
    assert.match(cookie, /;\s*SameSite=Lax/iu);
    return cookie.slice('mediflow_session='.length).split(';', 1)[0];
}
test.after(() => { clearAllSessions(); fs.rmSync(dataDir, { recursive: true, force: true }); });
test('setup emits a web session despite forged native, paired, token, and cookie metadata', async () => {
    const response = await setup(forgedRequest('/api/auth/setup', {
        username: USERNAME,
        password: PIN,
        encryptedMasterKey: WRAPPED_KEY,
        salt: SALT,
        displayName: 'Synthetic Operator',
        ambulatoryName: 'Synthetic Ambulatory',
    }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true });
    assert.equal(getSession(sessionId(response))?.authChannel, 'web');
});
test('login delegates credentials, preserves its Web contract, and records Web authority', async () => {
    const response = await login(forgedRequest('/api/auth/login', { username: USERNAME, password: PIN }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.json() as Record<string, unknown>;
    assert.deepEqual(Object.keys(body).sort(), [
        'ambulatoryName', 'displayName', 'encryptedMasterKey', 'id', 'role', 'salt', 'success', 'username',
    ]);
    assert.equal(body.success, true);
    assert.equal(body.username, USERNAME);
    assert.equal(body.encryptedMasterKey, WRAPPED_KEY);
    assert.equal(body.salt, SALT);
    const id = sessionId(response);
    assert.equal(getSession(id), null);
    const audit = (await listAuditEvents({ eventType: 'auth.login.succeeded' }))
        .find((event) => event.subjectRef === id);
    assert.equal(audit?.sourceSurface, 'web');
    assert.deepEqual(audit?.redactedMetadata?.flags, ['auth:session']);
});
test('routes make Web authority literal, do not read source-surface, and retain audit-failure containment', () => {
    const loginSource = fs.readFileSync(path.join(root, 'app/api/auth/login/route.ts'), 'utf8');
    const setupSource = fs.readFileSync(path.join(root, 'app/api/auth/setup/route.ts'), 'utf8');
    assert.match(loginSource, /from '@\/lib\/security\/host-credential-verification'/u);
    assert.match(loginSource, /verifyHostCredentials\(\{ username: requestedUsername, pin: password \}\)/u);
    assert.match(loginSource, /authFailureResponse\(verification\.body, verification\.status\)/u);
    assert.match(loginSource, /beginWebAuthSession\('login'\)/u);
    assert.match(loginSource, /issueWebAuthSession\(attempt,\s*\{[\s\S]*?id:\s*user\.id[\s\S]*?\}\);/u);
    assert.doesNotMatch(loginSource, /createSession\(/u);
    assert.match(setupSource, /createSession\([\s\S]*?'web',\s*\)/u);
    assert.doesNotMatch(loginSource, /auditSourceSurfaceFromRequest|sourceSurface === 'native'/u);
    assert.doesNotMatch(setupSource, /auditSourceSurfaceFromRequest|sourceSurface === 'native'/u);
    assert.match(loginSource, /const session = issueWebAuthSession[\s\S]*?try\s*\{\s*await writeAuditEvent[\s\S]*?catch/u);
});
