/* @Codex */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
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
const { GET: check } = await import('../../app/api/auth/check/route.ts');
const { dbServer } = await import('../db-server.ts');
const { users } = await import('../schema.ts');
const { listAuditEvents } = await import('./audit.ts');
const { clearAllSessions, getSession } = await import('./server-session.ts');
const { completeExactWebP3Logout } = await import('./web-auth-logout-server.ts');

const USERNAME = 'synthetic-web-admin'; const PIN = '2468';
const WRAPPED_KEY = 'synthetic-wrapped-key'; const SALT = 'synthetic-salt';
type Control = Readonly<{ controlId: string; etag: string }>;
function forgedRequest(pathname: string, body: Record<string, unknown>, control: Control): Request {
    return new Request(`${['http:', '', '127.0.0.1'].join('/')}${pathname}`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'x-mediflow-source-surface': 'native',
            'x-mediflow-paired-client-id': 'synthetic-paired-client',
            'x-mediflow-paired-client-token': 'synthetic-paired-token',
            authorization: 'Bearer synthetic-local-api-token',
            cookie: `mediflow_session=forged-existing-cookie; mediflow_auth_control=${control.controlId}`,
            'if-match': control.etag,
            'idempotency-key': randomUUID(),
        },
        body: JSON.stringify(body),
    });
}
async function bootstrapControl(): Promise<Control> {
    const response = await check(new Request('http://127.0.0.1/api/auth/check', {
        headers: {
            'x-mediflow-source-surface': 'native',
            authorization: 'Bearer synthetic-local-api-token',
        },
    }));
    assert.notEqual(response.status, 503);
    const controlId = responseCookie(response, 'mediflow_auth_control');
    const etag = response.headers.get('etag');
    assert.ok(etag);
    assert.match(etag, /^"[A-Za-z0-9_-]{32,256}"$/u);
    return Object.freeze({ controlId, etag });
}
function responseCookie(response: Response, name: string): string {
    const cookie = typeof response.headers.getSetCookie === 'function'
        ? response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`))
        : response.headers.get('set-cookie');
    assert.ok(cookie, `response must set ${name}`);
    assert.match(cookie, new RegExp(`^${name}=[^;]+`, 'u'));
    assert.match(cookie, /;\s*Path=\//iu);
    assert.match(cookie, /;\s*HttpOnly/iu);
    assert.match(cookie, /;\s*SameSite=Lax/iu);
    return cookie.slice(`${name}=`.length).split(';', 1)[0];
}
function sessionId(response: Response): string { return responseCookie(response, 'mediflow_session'); }
test.after(() => { clearAllSessions(); fs.rmSync(dataDir, { recursive: true, force: true }); });
test('setup emits a web session despite forged native, paired, token, and cookie metadata', async () => {
    const control = await bootstrapControl();
    const response = await setup(forgedRequest('/api/auth/setup', {
        username: USERNAME,
        password: PIN,
        encryptedMasterKey: WRAPPED_KEY,
        salt: SALT,
        displayName: 'Synthetic Operator',
        ambulatoryName: 'Synthetic Ambulatory',
    }, control));
    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    assert.deepEqual(Object.keys(body).sort(), ['id', 'success']);
    assert.equal(body.success, true);
    assert.match(String(body.id), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu);
    assert.deepEqual(await dbServer.select({ id: users.id }).from(users).limit(1), [{ id: body.id }]);
    const id = sessionId(response);
    assert.equal(getSession(id), null);
    const logout = await completeExactWebP3Logout(
        { name: 'mediflow_session', value: id },
        { name: 'mediflow_auth_control', value: control.controlId },
        new Request('http://127.0.0.1/api/auth/logout', { method: 'POST' }),
    );
    assert.equal(logout.status, 204);
});
test('login delegates credentials, preserves its Web contract, and records Web authority', async () => {
    const control = await bootstrapControl();
    const response = await login(forgedRequest('/api/auth/login', { username: USERNAME, password: PIN }, control));
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
    const logout = await completeExactWebP3Logout(
        { name: 'mediflow_session', value: id },
        { name: 'mediflow_auth_control', value: control.controlId },
        new Request('http://127.0.0.1/api/auth/logout', { method: 'POST' }),
    );
    assert.equal(logout.status, 204);
});
test('routes make Web authority literal, do not read source-surface, and retain audit-failure containment', () => {
    const loginSource = fs.readFileSync(path.join(root, 'app/api/auth/login/route.ts'), 'utf8');
    const setupSource = fs.readFileSync(path.join(root, 'app/api/auth/setup/route.ts'), 'utf8');
    assert.match(loginSource, /from '@\/lib\/security\/host-credential-verification'/u);
    assert.match(loginSource, /verifyHostCredentials\(\{ username: requestedUsername, pin: password \}\)/u);
    assert.match(loginSource, /authFailureResponse\(verification\.body, verification\.status, mutation\.ifMatch\)/u);
    assert.match(loginSource, /beginWebAuthControl\('login', mutation\)/u);
    assert.match(loginSource, /issueWebAuthControl\(attempt,\s*\{[\s\S]*?id:\s*user\.id[\s\S]*?\}\);/u);
    assert.doesNotMatch(loginSource, /createSession\(/u);
    assert.match(setupSource, /beginWebAuthControl\('setup', mutation\)/u);
    assert.match(setupSource, /issueWebAuthControl\(attempt,[\s\S]*?id:\s*userId[\s\S]*?\)/u);
    assert.match(setupSource, /const session = issueWebAuthControl[\s\S]*?if \(!session\)[\s\S]*?response\.cookies\.set/u);
    assert.doesNotMatch(setupSource, /createSession\(/u);
    assert.doesNotMatch(loginSource, /auditSourceSurfaceFromRequest|sourceSurface === 'native'/u);
    assert.doesNotMatch(setupSource, /auditSourceSurfaceFromRequest|sourceSurface === 'native'/u);
    assert.match(loginSource, /const session = issueWebAuthControl[\s\S]*?try\s*\{\s*await writeAuditEvent[\s\S]*?catch/u);
});
