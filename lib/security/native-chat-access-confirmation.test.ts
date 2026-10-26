import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';

const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-chat-access-test-')));
process.env.MEDIFLOW_DATA_DIR = directory;
process.env.MEDIFLOW_E2E_DISABLE_LEGACY_COPY = '1';
const initial = new Database(path.join(directory, 'medical.db'));
const root = path.resolve(import.meta.dirname, '../..');
for (const file of fs.readdirSync(path.join(root, 'drizzle')).filter(n => n.endsWith('.sql')).sort()) {
    initial.exec(fs.readFileSync(path.join(root, 'drizzle', file), 'utf8').replace(/^-->\s+statement-breakpoint\s*$/gm, ''));
}
initial.close();
const nextBaseline = 'next/dist/server/node-environment-baseline.js';
await import(nextBaseline);
const { dbServer } = await import('../db-server.ts');
const { users, settings } = await import('../schema.ts');
const sessions = await import('./server-session.ts');
const { bindSessionToArchive, currentArchiveGeneration } = await import('./archive-session-generation.ts');
const { confirmNativeChatAccessPin, nativeChatAccessEligibility } = await import('./native-chat-access-confirmation.ts');
const { rotateSqliteArchiveGeneration } = await import('../archive-generation.ts');
const { verifyHostCredentials } = await import('./host-credential-verification.ts');
const { NETWORK_PAIRING_STATE_KEY, hashNetworkPairedClientToken, serializeNetworkPairingState } = await import('../network-pairing-model.ts');
const { workAsyncStorage } = await import('next/dist/server/app-render/work-async-storage.external.js');
const { workUnitAsyncStorage } = await import('next/dist/server/app-render/work-unit-async-storage.external.js');
const { RequestCookiesAdapter } = await import('next/dist/server/web/spec-extension/adapters/request-cookies.js');
const { RequestCookies } = await import('next/dist/server/web/spec-extension/cookies.js');
const route = await import('../../app/api/auth/native/chat-access-confirmation/route.ts');
const token = 'synthetic-chat-pair-token';
const pin = ['2', '4', '6', '8'].join('');
const user = { id: 'synthetic-chat-user', username: ['synthetic', 'chat', 'user'].join('-'), role: 'admin' };
dbServer.insert(users).values({ ...user, passwordHash: await bcrypt.hash(pin, 4),
    encryptedMasterKey: 'synthetic-locked-master-key', salt: 'synthetic-salt',
    unlockVerifierHash: 'a'.repeat(64), createdAt: new Date() }).run();

function session() {
    const value = sessions.createNativeServerSession(user, { clientId: 'synthetic-chat-client', clientPlatform: 'macos', tokenHash: hashNetworkPairedClientToken(token) });
    bindSessionToArchive(value, currentArchiveGeneration());
    return value as typeof value & { authChannel: 'native' };
}
test.after(() => { sessions.clearAllSessions(); dbServer.$client.close(); fs.rmSync(directory, { recursive: true, force: true }); });

test('PIN confirmation uses the existing native cell and returns no bearer or new session', async () => {
    const value = session();
    assert.equal(await confirmNativeChatAccessPin(value, pin), 'confirmed');
    assert.equal(nativeChatAccessEligibility(value), 'eligible');
    assert.equal(sessions.getSession(value.id), value);
    assert.equal(await confirmNativeChatAccessPin({ ...value }, pin), 'denied');
    assert.equal(await confirmNativeChatAccessPin(sessions.createSession(user) as never, pin), 'denied');
    sessions.deleteSession(value.id);
    assert.equal(await confirmNativeChatAccessPin(value, pin), 'denied');
});

test('PIN lockout shares the persistent host attempt budget and cannot create or reopen a session', async () => {
    const value = session();
    for (let i = 0; i < 4; i++) assert.equal(await confirmNativeChatAccessPin(value, '0000'), 'denied');
    assert.equal(await confirmNativeChatAccessPin(value, '0000'), 'locked');
    assert.equal(await confirmNativeChatAccessPin(value, pin), 'locked');
    assert.equal(nativeChatAccessEligibility(value), 'locked', 'biometrics cannot bypass a host PIN lockout');
    const direct = await verifyHostCredentials({ username: user.username, pin });
    assert.equal(direct.kind, 'denied');
    if (direct.kind === 'denied') assert.equal(direct.failureClass, 'locked');
    dbServer.update(users).set({ failedLoginAttempts: 0, firstFailedLoginAt: null, lockedUntil: null }).where(eq(users.id, user.id)).run();
    assert.equal(await confirmNativeChatAccessPin(value, pin), 'confirmed');
});

test('revocation during PIN comparison and archive replacement deny the late result', async () => {
    const value = session();
    const pending = confirmNativeChatAccessPin(value, pin);
    sessions.deleteSession(value.id);
    assert.equal(await pending, 'denied');
    const old = session();
    dbServer.$client.transaction(() => rotateSqliteArchiveGeneration(dbServer.$client))();
    assert.equal(await confirmNativeChatAccessPin(old, pin), 'denied');
});

test('the frame carries no credential and accepts only status protocol; owner fixture remains separate', () => {
    const html = fs.readFileSync(path.join(root, 'lib/chat-card/native-access.html'), 'utf8');
    assert.doesNotMatch(html, /fetch\(|updateModelContext|masterKey|Authorization|gestureProof|document\.cookie/u);
    const adapter = fs.readFileSync(path.join(root, 'experiments/gpui-patient-pilot/app/src/chat_access/adapter.rs'), 'utf8');
    assert.doesNotMatch(adapter, /card-owner|card-profile|db-server|sqlite|native-inference/u);
});

test('the actual native route requires the paired session and archive and rejects forged approval fields', async () => {
    dbServer.insert(settings).values({ key: 'network.mode', value: 'network-home-base' }).run();
    const value = JSON.stringify({ ...JSON.parse(serializeNetworkPairingState({ intents: [], clients: [{ clientId: 'synthetic-chat-client',
        deviceName: 'Synthetic chat client', clientPlatform: 'macos', appVersion: null, grantedCapabilities: [],
        pairedAt: '2026-10-26T00:00:00.000Z', lastSeenAt: null, sourceIntentId: 'synthetic-chat-intent',
        tokenHash: hashNetworkPairedClientToken(token) }] })), archiveGeneration: currentArchiveGeneration() });
    dbServer.insert(settings).values({ key: NETWORK_PAIRING_STATE_KEY, value }).run();
    const current = session();
    async function invoke(input?: unknown, paired = true, generation = currentArchiveGeneration()) {
        const request = new Request('https://127.0.0.1/api/auth/native/chat-access-confirmation', {
            method: input === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json',
                Cookie: `mediflow_session=${current.id}`, 'x-mediflow-archive-generation': generation,
                ...(paired ? { 'x-mediflow-paired-client-id': 'synthetic-chat-client', 'x-mediflow-paired-client-token': token } : {}) },
            ...(input === undefined ? {} : { body: JSON.stringify(input) }),
        });
        const cookies = RequestCookiesAdapter.seal(new RequestCookies(request.headers));
        return workAsyncStorage.run({ route: '/api/auth/native/chat-access-confirmation', page: '/native-chat-test', isStaticGeneration: false } as never,
            () => workUnitAsyncStorage.run({ type: 'request', phase: 'render', cookies, asyncApiPromises: { cookies: Promise.resolve(cookies) } } as never,
                () => input === undefined ? route.GET(request) : route.POST(request)));
    }
    assert.equal((await invoke(undefined, false)).status, 403);
    assert.equal((await invoke(undefined, true, 'other-generation')).status, 403);
    const eligible = await invoke(); assert.equal(eligible.status, 200);
    assert.deepEqual(await eligible.json(), { status: 'eligible' });
    assert.equal((await invoke({ operation: 'mediflow.chat.access-status.v1', pin, authenticated: true })).status, 400);
    assert.equal((await invoke({ operation: 'clinical.write', pin })).status, 400);
    assert.equal((await invoke({ operation: 'mediflow.chat.access-status.v1', pin: ['Synthetic', 'passphrase'].join(' ') })).status, 400);
    const confirmed = await invoke({ operation: 'mediflow.chat.access-status.v1', pin });
    assert.equal(confirmed.status, 200); assert.deepEqual(await confirmed.json(), { status: 'confirmed' });
    assert.equal(confirmed.headers.has('set-cookie'), false);
    sessions.deleteSession(current.id);
    assert.equal((await invoke()).status, 403);
});
