/* @Codex */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-native-bootstrap-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;

const sqlite = new Database(path.join(dataDir, 'medical.db'));
try {
    for (const file of fs.readdirSync(path.join(root, 'drizzle')).filter((item) => item.endsWith('.sql')).sort()) {
        sqlite.exec(fs.readFileSync(path.join(root, 'drizzle', file), 'utf8').replace(/^-->\s+statement-breakpoint\s*$/gm, ''));
    }
} finally {
    sqlite.close();
}

const { dbServer } = await import('../db-server.ts');
const { settings } = await import('../schema.ts');
const { NETWORK_PAIRING_STATE_KEY, hashNetworkPairedClientToken, serializeNetworkPairingState } = await import('../network-pairing-model.ts');
const { admitNativeBootstrap, consumeNativeBootstrapAdmission } = await import('./native-bootstrap-admission.ts');

const clientId = 'synthetic-native-bootstrap-client';
const token = 'synthetic-native-bootstrap-token';
function syntheticClient(id = clientId, value = token) {
    return { clientId: id, deviceName: 'Dispositivo sintetico', clientPlatform: 'ipados' as const, appVersion: null, grantedCapabilities: [], pairedAt: '2026-08-27T08:00:00.000Z', lastSeenAt: null, sourceIntentId: `intent-${id}`, tokenHash: hashNetworkPairedClientToken(value) };
}

function writeClients(clients: ReturnType<typeof syntheticClient>[]): void {
    dbServer.insert(settings).values({ key: NETWORK_PAIRING_STATE_KEY, value: serializeNetworkPairingState({ intents: [], clients }) }).onConflictDoUpdate({ target: settings.key, set: { value: serializeNetworkPairingState({ intents: [], clients }) } }).run();
}

writeClients([syntheticClient()]);

function pairedRequest(sourceSurface: string): Request {
    return new Request('https://127.0.0.1/api/native-bootstrap', {
        headers: {
            'x-mediflow-paired-client-id': clientId,
            'x-mediflow-paired-client-token': token,
            'x-mediflow-source-surface': sourceSurface,
        },
    });
}

test('native bootstrap trusts the persisted paired client, not source-surface metadata', async () => {
    const webMarked = await admitNativeBootstrap({ request: pairedRequest('web') });
    const nativeMarked = await admitNativeBootstrap({ request: pairedRequest('native') });
    const sourceOnly = await admitNativeBootstrap({ request: new Request('https://127.0.0.1/api/native-bootstrap', {
        headers: { 'x-mediflow-source-surface': 'native' },
    }) });
    assert.ok(webMarked);
    assert.ok(nativeMarked);
    assert.equal(sourceOnly, null);
    assert.deepEqual(await consumeNativeBootstrapAdmission(webMarked), { clientId, clientPlatform: 'ipados' });
    assert.deepEqual(await consumeNativeBootstrapAdmission(nativeMarked), { clientId, clientPlatform: 'ipados' });
});

test('native bootstrap artifacts are process-local, opaque, and one-use', async () => {
    const admission = await admitNativeBootstrap({ request: pairedRequest('native') });
    assert.ok(admission);
    assert.equal(Object.getPrototypeOf(admission), null);
    assert.equal(await consumeNativeBootstrapAdmission({}), null);
    assert.equal(await consumeNativeBootstrapAdmission({ ...admission }), null);
    assert.deepEqual(await consumeNativeBootstrapAdmission(admission), { clientId, clientPlatform: 'ipados' });
    assert.equal(await consumeNativeBootstrapAdmission(admission), null);
});

test('native bootstrap denies hostile or expanded caller envelopes before reading them', async () => {
    let observed = false;
    const accessor = {};
    Object.defineProperty(accessor, 'request', { enumerable: true, configurable: true, get: () => { observed = true; throw new Error('must not read'); } });

    for (const value of [
        accessor,
        { request: pairedRequest('native'), authChannel: 'native' },
        Object.assign(Object.create({}), { request: pairedRequest('native') }),
        Object.assign({ request: pairedRequest('native') }, { [Symbol('extra')]: true }),
        Object.assign({ request: pairedRequest('native') }, { then: () => undefined }),
        new Proxy({ request: pairedRequest('native') }, {}),
    ]) {
        assert.equal(await admitNativeBootstrap(value), null);
    }
    const hidden = {};
    Object.defineProperty(hidden, 'request', { value: pairedRequest('native') });
    assert.equal(await admitNativeBootstrap(hidden), null);
    assert.equal(observed, false);
});

test('native bootstrap rejects forged or overridden Request headers without reading the override', async () => {
    const forged = Object.create(Request.prototype);
    const overridden = pairedRequest('native');
    let observed = false;
    Object.defineProperty(overridden, 'headers', { configurable: true, get: () => { observed = true; throw new Error('must not read'); } });
    const ownHeaders = pairedRequest('native');
    Object.defineProperty(ownHeaders, 'headers', { configurable: true, value: new Headers() });
    const thenable = pairedRequest('native');
    Object.defineProperty(thenable, 'then', { configurable: true, get: () => { observed = true; throw new Error('must not read'); } });
    assert.equal(await admitNativeBootstrap({ request: forged }), null);
    assert.equal(await admitNativeBootstrap({ request: overridden }), null);
    assert.equal(await admitNativeBootstrap({ request: ownHeaders }), null);
    assert.equal(await admitNativeBootstrap({ request: thenable }), null);
    assert.equal(observed, false);
});

test('native bootstrap burns before revalidation and denies revoked, rotated, or cross-client state', async () => {
    const revoked = await admitNativeBootstrap({ request: pairedRequest('native') });
    assert.ok(revoked);
    writeClients([]);
    assert.equal(await consumeNativeBootstrapAdmission(revoked), null);
    assert.equal(await consumeNativeBootstrapAdmission(revoked), null);

    writeClients([syntheticClient()]);
    const rotated = await admitNativeBootstrap({ request: pairedRequest('native') });
    assert.ok(rotated);
    writeClients([syntheticClient(clientId, 'rotated-token')]);
    assert.equal(await consumeNativeBootstrapAdmission(rotated), null);

    writeClients([syntheticClient()]);
    const crossClient = await admitNativeBootstrap({ request: pairedRequest('native') });
    assert.ok(crossClient);
    writeClients([syntheticClient('other-client', 'other-token')]);
    assert.equal(await consumeNativeBootstrapAdmission(crossClient), null);
});

test('native bootstrap denies closed-state admission and burns reload failure without rejecting', async () => {
    writeClients([syntheticClient()]);
    const admission = await admitNativeBootstrap({ request: pairedRequest('native') });
    assert.ok(admission);
    dbServer.$client.close();
    assert.equal(await consumeNativeBootstrapAdmission(admission), null);
    assert.equal(await consumeNativeBootstrapAdmission(admission), null);
    assert.equal(await admitNativeBootstrap({ request: pairedRequest('native') }), null);
    assert.equal(await admitNativeBootstrap({ request: pairedRequest('native') }), null);
});
