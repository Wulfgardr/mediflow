import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createServer, request as httpsRequest } from 'node:https';
import { spawn, spawnSync } from 'node:child_process';
import test from 'node:test';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';

const root = path.resolve(import.meta.dirname, '../..');
const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-native-v3-http-')));
process.env.MEDIFLOW_DATA_DIR = directory;
process.env.MEDIFLOW_E2E_DISABLE_LEGACY_COPY = '1';
const initial = new Database(path.join(directory, 'medical.db'));
for (const file of fs.readdirSync(path.join(root, 'drizzle')).filter(name => name.endsWith('.sql')).sort()) {
    initial.exec(fs.readFileSync(path.join(root, 'drizzle', file), 'utf8').replace(/^-->\s+statement-breakpoint\s*$/gm, ''));
}
initial.close();
const nextEnvironmentBaseline = 'next/dist/server/node-environment-baseline.js';
await import(nextEnvironmentBaseline);
const { workAsyncStorage } = await import('next/dist/server/app-render/work-async-storage.external.js');
const { workUnitAsyncStorage } = await import('next/dist/server/app-render/work-unit-async-storage.external.js');
const { RequestCookiesAdapter } = await import('next/dist/server/web/spec-extension/adapters/request-cookies.js');
const { RequestCookies } = await import('next/dist/server/web/spec-extension/cookies.js');
const { dbServer } = await import('../db-server.ts');
const { users, settings } = await import('../schema.ts');
const { currentArchiveGeneration } = await import('./archive-session-generation.ts');
const { getSession, clearAllSessions } = await import('./server-session.ts');
const { NETWORK_PAIRING_STATE_KEY, hashNetworkPairedClientToken, serializeNetworkPairingState } = await import('../network-pairing-model.ts');
const { GET: check } = await import('../../app/api/auth/check/route.ts');
const { POST: login } = await import('../../app/api/auth/native/login/route.ts');
const { POST: logout } = await import('../../app/api/auth/native/logout/route.ts');
const vector = JSON.parse(fs.readFileSync(path.join(root, 'native/contracts/crypto-golden-vectors.v3.json'), 'utf8'));
const clientId = 'synthetic-v3-client', token = 'synthetic-v3-token';
const username = ['synthetic', 'v3', 'user'].join('-');
const confirmationPin = ['2', '4', '6', '8'].join('');
const pairedHeaders = { 'x-mediflow-paired-client-id': clientId, 'x-mediflow-paired-client-token': token };
dbServer.insert(settings).values({ key: 'network.mode', value: 'network-home-base' }).run();
function pair(platform: 'macos' | 'ios' | 'ipados' | null) {
    const state = { ...JSON.parse(serializeNetworkPairingState({ intents: [], clients: platform ? [{ clientId,
        deviceName: 'Synthetic v3 client', clientPlatform: platform, appVersion: null, grantedCapabilities: [],
        pairedAt: '2026-10-16T00:00:00.000Z', lastSeenAt: null, sourceIntentId: 'synthetic-v3-intent',
        tokenHash: hashNetworkPairedClientToken(token) }] : [] })), archiveGeneration: currentArchiveGeneration() };
    const value = JSON.stringify(state);
    dbServer.insert(settings).values({ key: NETWORK_PAIRING_STATE_KEY, value })
        .onConflictDoUpdate({ target: settings.key, set: { value } }).run();
}
dbServer.insert(users).values({ id: 'synthetic-v3-user', username, role: 'admin',
    passwordHash: await bcrypt.hash('2468', 4), encryptedMasterKey: vector.wrappedMasterKey, salt: vector.salt,
    unlockVerifierHash: createHash('sha256').update(Buffer.from(vector.verifier, 'base64')).digest('hex'),
    createdAt: new Date(), failedLoginAttempts: 0 }).run();
const certificate = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-subj', '/CN=localhost', '-keyout', path.join(directory, 'key.pem'), '-out', path.join(directory, 'cert.pem')], { encoding: 'utf8' });
assert.equal(certificate.status, 0, 'Synthetic TLS certificate creation failed');
let lastSession: string | null = null;
const server = createServer({ key: fs.readFileSync(path.join(directory, 'key.pem')), cert: fs.readFileSync(path.join(directory, 'cert.pem')) }, async (incoming, outgoing) => {
    try {
        const chunks: Buffer[] = [];
        for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
        const body = Buffer.concat(chunks);
        const request = new Request(new URL(incoming.url ?? '/', 'https://localhost').href, { method: incoming.method,
            headers: incoming.headers as Record<string, string>, ...(body.length ? { body: body.toString() } : {}) });
        const cookies = RequestCookiesAdapter.seal(new RequestCookies(request.headers));
        const requestStore = { type: 'request', phase: 'render', cookies, asyncApiPromises: { cookies: Promise.resolve(cookies) } };
        const workStore = { route: incoming.url, page: '/native-v3-test', isStaticGeneration: false };
        const response = await workAsyncStorage.run(workStore as never, () => workUnitAsyncStorage.run(requestStore as never, () =>
            incoming.url === '/api/auth/check' ? check(request)
                : incoming.url === '/api/auth/native/login' ? login(request)
                    : incoming.url === '/api/auth/native/logout' ? logout(request) : Promise.resolve(new Response(null, { status: 404 }))));
        const session = response.headers.get('set-cookie')?.match(/mediflow_session=([^;]+)/u)?.[1];
        if (session) lastSession = session;
        outgoing.writeHead(response.status, Object.fromEntries(response.headers));
        outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch { outgoing.writeHead(500); outgoing.end(); }
});
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert.ok(address && typeof address === 'object');
const origin = `https://127.0.0.1:${address.port}`;
function call(route: string, input?: unknown, cookie?: string) {
    return new Promise<{ status: number; cookie?: string; body: Record<string, unknown> }>((resolve, reject) => {
        const request = httpsRequest(origin + route, { method: input === undefined ? 'GET' : 'POST', rejectUnauthorized: false,
            headers: { ...pairedHeaders, ...(input === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}) } }, response => {
            const chunks: Buffer[] = [];
            response.on('data', chunk => chunks.push(chunk));
            response.on('end', () => {
                const text = Buffer.concat(chunks).toString();
                resolve({ status: response.statusCode!, cookie: response.headers['set-cookie']?.[0]?.split(';')[0], body: text ? JSON.parse(text) : {} });
            });
        });
        request.on('error', reject);
        request.end(input === undefined ? undefined : JSON.stringify(input));
    });
}
test.after(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    clearAllSessions(); dbServer.$client.close(); fs.rmSync(directory, { recursive: true, force: true });
});
test('real HTTPS native routes admit v3 on Mac/iPhone/iPad and reject PIN, mixed input, logout replay and revoked pairing', async () => {
    for (const platform of ['macos', 'ios', 'ipados'] as const) {
        pair(platform);
        const parameters = await call('/api/auth/check');
        assert.deepEqual(parameters.body.unlock, { credential: 'passphrase', kdfVersion: 3, salt: vector.salt });
        assert.equal((await call('/api/auth/native/login', { username, password: confirmationPin })).status, 401);
        assert.equal((await call('/api/auth/native/login', { username, password: confirmationPin, verifier: vector.verifier })).status, 401);
        const accepted = await call('/api/auth/native/login', { username, verifier: vector.verifier });
        assert.equal(accepted.status, 200); assert.equal(accepted.body.encryptedMasterKey, vector.wrappedMasterKey);
        assert.ok(lastSession && getSession(lastSession));
        assert.equal((await call('/api/auth/native/logout', {}, accepted.cookie)).status, 204);
        assert.equal(getSession(lastSession!), null);
        assert.equal((await call('/api/auth/native/logout', {}, accepted.cookie)).status, 401);
    }
    pair(null);
    assert.equal((await call('/api/auth/native/login', { username, verifier: vector.verifier })).status, 401);
});
test('actual Swift client logs in and unwraps v3 over pinned HTTPS, then retires its session', async t => {
    const bundle = process.env.MEDIFLOW_NATIVE_AUTH_XCTEST_BUNDLE;
    if (!bundle) { t.skip('Set the task-built XCTest bundle for the real Swift HTTPS proof'); return; }
    pair('macos'); lastSession = null;
    const der = spawnSync('openssl', ['x509', '-in', path.join(directory, 'cert.pem'), '-outform', 'der']);
    assert.equal(der.status, 0);
    const child = spawn('/usr/bin/xcrun', ['xctest', '-XCTest', 'MediFlowAppleSharedTests.HomeBasePatientsClientTests/testRealV3HTTPSLoginAndLogout', bundle], {
        env: { ...process.env, DEVELOPER_DIR: '/Applications/Xcode.app/Contents/Developer',
            MEDIFLOW_NATIVE_AUTH_SMOKE_URL: origin, MEDIFLOW_NATIVE_AUTH_SMOKE_TLS_PIN: createHash('sha256').update(der.stdout).digest('hex') },
        stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; for (const stream of [child.stdout, child.stderr]) stream.on('data', value => { output += value; });
    const exit = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
    assert.equal(exit, 0, output);
    assert.match(output, /Executed 1 test/u);
    assert.ok(lastSession, 'Actual Swift client did not reach the production login route');
    assert.equal(getSession(lastSession), null, 'Swift logout must retire the actual host session');
});
test('real v3 native route applies the shared lockout and cannot use a confirmation PIN to bypass it', async () => {
    pair('macos');
    for (let attempt = 1; attempt <= 5; attempt += 1) {
        const denied = await call('/api/auth/native/login', { username, verifier: Buffer.alloc(32, 99).toString('base64') });
        assert.equal(denied.status, attempt === 5 ? 423 : 401);
        assert.equal(denied.cookie, undefined);
    }
    assert.equal((await call('/api/auth/native/login', { username, verifier: vector.verifier })).status, 423);
    assert.equal((await call('/api/auth/native/login', { username, password: confirmationPin })).status, 423);
});
