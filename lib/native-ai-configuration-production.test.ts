/* @Codex */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import Database from 'better-sqlite3';

// Set the dedicated synthetic directory BEFORE importing any production database module.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-native-config-production-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
process.env.MEDIFLOW_NATIVE_AI_CONFIG_GRANTS_FILE = path.join(dataDir, 'grants.json');
const sqlite = new Database(path.join(dataDir, 'medical.db'));
for (const name of fs.readdirSync('drizzle').filter(n => n.endsWith('.sql')).sort()) {
    sqlite.exec(fs.readFileSync(path.join('drizzle', name), 'utf8').replace(/^-->\s+statement-breakpoint\s*$/gmu, ''));
}
sqlite.close();
const nextBaseline = 'next/dist/server/node-environment-baseline.js';
await import(nextBaseline);
const { workAsyncStorage } = await import('next/dist/server/app-render/work-async-storage.external.js');
const { workUnitAsyncStorage } = await import('next/dist/server/app-render/work-unit-async-storage.external.js');
const { RequestCookiesAdapter } = await import('next/dist/server/web/spec-extension/adapters/request-cookies.js');
const { RequestCookies } = await import('next/dist/server/web/spec-extension/cookies.js');
const { dbServer } = await import('./db-server.ts');
const { users, settings } = await import('./schema.ts');
const { eq } = await import('drizzle-orm');
const { createNativeServerSession, deleteSession } = await import('./security/server-session.ts');
const { issueSyntheticWebSession, retireSyntheticWebSession } = await import('./security/web-auth-lifecycle-owner-test-fixture.ts');
const { NETWORK_MODE_KEY } = await import('./network-contract.ts');
const { NETWORK_PAIRING_STATE_KEY, hashNetworkPairedClientToken } = await import('./network-pairing-model.ts');
const { GET, POST } = await import('../app/api/v1/network/ai/functions/route.ts');
const { POST: PREVIEW } = await import('../app/api/v1/network/ai/functions/preview/route.ts');
const { FUNCTION_PREFERENCES_KEY, FUNCTION_SWITCH_KEYS } = await import('./ai-providers/fabric/function-model-preferences.ts');
const set = (key: string, value: string) => dbServer.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run();
const user = { id: 'synthetic-native-admin', username: 'synthetic-native-admin', role: 'admin' };
const clientId = 'synthetic-mac'; const token = 'synthetic-native-pairing-token';
const binding = { clientId, clientPlatform: 'macos' as const, tokenHash: hashNetworkPairedClientToken(token) };
const pairings = { intents: [], clients: [{ ...binding, deviceName: 'Synthetic Mac', appVersion: '0.8.6', pairedAt: new Date().toISOString(), sourceIntentId: 'synthetic-intent', grantedCapabilities: ['network.discovery.read'] }] };
const grant = { schemaVersion: 'mediflow.native-ai-grants.v1', grants: [{ grantId: 'synthetic-config-grant', userId: user.id, clientId, capability: 'native.ai.configure', expiresAt: Date.now() + 60_000 }] };
const writeGrant = (value = grant) => fs.writeFileSync(process.env.MEDIFLOW_NATIVE_AI_CONFIG_GRANTS_FILE!, JSON.stringify(value), { mode: 0o600 });
dbServer.insert(users).values({ ...user, passwordHash: 'synthetic-not-a-login-hash', encryptedMasterKey: 'synthetic-only', salt: 'synthetic-only' }).run();
set(NETWORK_MODE_KEY, 'network-home-base'); set(NETWORK_PAIRING_STATE_KEY, JSON.stringify(pairings));
for (const key of Object.values(FUNCTION_SWITCH_KEYS)) set(key, 'disabled');
set('aiProvider', 'ollama'); set('aiModel', 'synthetic-model:1');
const session = createNativeServerSession(user, binding);
function call(handler: (request: Request) => Promise<Response>, body?: unknown, sessionId = session.id, pairingToken = token) {
    const headers = new Headers({ cookie: `mediflow_session=${sessionId}`, 'x-mediflow-paired-client-id': clientId, 'x-mediflow-paired-client-token': pairingToken });
    if (body !== undefined) headers.set('content-type', 'application/json');
    const requestCookies = RequestCookiesAdapter.seal(new RequestCookies(headers));
    const requestStore = { type: 'request', phase: 'render', cookies: requestCookies, asyncApiPromises: { cookies: Promise.resolve(requestCookies) } };
    const workStore = { route: '/api/v1/network/ai/functions', page: '/api/v1/network/ai/functions/route', isStaticGeneration: false };
    return workAsyncStorage.run(workStore as never, () => workUnitAsyncStorage.run(requestStore as never,
        () => handler(new Request('https://synthetic.invalid/api/v1/network/ai/functions', { method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body) }))));
}
test('production native routes: host grant, SQLite CAS/replay, native binding, role and revocation', async () => {
    assert.equal((await call(GET)).status, 403, 'pairing and native session alone grant no authority');
    writeGrant();
    const read = await call(GET); assert.equal(read.status, 200); const initial = await read.json();
    const command = { schemaVersion: 'mediflow.function-preferences-command.v1', commandId: randomUUID(), action: 'preset', presetId: 'all_off', expectedRevision: initial.revision, expectedCatalogRevision: initial.catalogRevision };
    assert.equal((await call(PREVIEW, command)).status, 200);
    assert.equal(dbServer.select().from(settings).where(eq(settings.key, FUNCTION_PREFERENCES_KEY)).get(), undefined);
    const applied = await call(POST, command); assert.equal(applied.status, 200); const observed = await applied.json();
    assert.equal((await (await call(GET)).json()).revision, observed.revision);
    assert.equal((await call(POST, command)).status, 200);
    assert.equal((await call(POST, { ...command, commandId: randomUUID() })).status, 409);
    assert.equal((await call(GET, undefined, session.id, 'wrong-synthetic-token')).status, 401);
    const web = issueSyntheticWebSession(user, 'native-config-denied');
    assert.equal((await call(GET, undefined, web.id)).status, 401, 'Web authority cannot substitute native binding');
    retireSyntheticWebSession(web);
    // Revoke the host grant from a synthetic SQLite trigger during the write.
    // The outer native transaction must roll back the domain's nested transaction.
    const before = dbServer.select().from(settings).where(eq(settings.key, FUNCTION_PREFERENCES_KEY)).get()!.value;
    dbServer.$client.function('synthetic_revoke_native_grant', () => { writeGrant({ ...grant, grants: [] }); return 0; });
    dbServer.$client.exec(`CREATE TEMP TRIGGER synthetic_revoke_config AFTER UPDATE ON settings
        WHEN NEW.key = 'ai.fabric.functionPreferences' BEGIN SELECT synthetic_revoke_native_grant(); END`);
    const nextView = await (await call(GET)).json();
    const revoked = await call(POST, { ...command, commandId: randomUUID(), expectedRevision: nextView.revision, expectedCatalogRevision: nextView.catalogRevision });
    assert.equal(revoked.status, 403);
    assert.equal(dbServer.select().from(settings).where(eq(settings.key, FUNCTION_PREFERENCES_KEY)).get()!.value, before);
    dbServer.$client.exec('DROP TRIGGER synthetic_revoke_config');
    writeGrant({ ...grant, grants: [] }); assert.equal((await call(GET)).status, 403);
    writeGrant(); set(NETWORK_PAIRING_STATE_KEY, JSON.stringify({ intents: [], clients: [] }));
    assert.equal((await call(GET)).status, 401);
    set(NETWORK_PAIRING_STATE_KEY, JSON.stringify(pairings));
    dbServer.update(users).set({ role: 'user' }).where(eq(users.id, user.id)).run();
    assert.equal((await call(GET)).status, 401);
    deleteSession(session.id);
});
