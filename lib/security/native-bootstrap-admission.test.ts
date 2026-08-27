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
dbServer.insert(settings).values({
    key: NETWORK_PAIRING_STATE_KEY,
    value: serializeNetworkPairingState({
        intents: [],
        clients: [{
            clientId,
            deviceName: 'Dispositivo sintetico',
            clientPlatform: 'ipados',
            appVersion: null,
            grantedCapabilities: [],
            pairedAt: '2026-08-27T08:00:00.000Z',
            lastSeenAt: null,
            sourceIntentId: 'synthetic-intent',
            tokenHash: hashNetworkPairedClientToken(token),
        }],
    }),
}).run();

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
    assert.deepEqual(consumeNativeBootstrapAdmission(webMarked), { clientId, clientPlatform: 'ipados' });
    assert.deepEqual(consumeNativeBootstrapAdmission(nativeMarked), { clientId, clientPlatform: 'ipados' });
});

test('native bootstrap artifacts are process-local, opaque, and one-use', async () => {
    const admission = await admitNativeBootstrap({ request: pairedRequest('native') });
    assert.ok(admission);
    assert.equal(Object.getPrototypeOf(admission), null);
    assert.equal(consumeNativeBootstrapAdmission({}), null);
    assert.equal(consumeNativeBootstrapAdmission({ ...admission }), null);
    assert.deepEqual(consumeNativeBootstrapAdmission(admission), { clientId, clientPlatform: 'ipados' });
    assert.equal(consumeNativeBootstrapAdmission(admission), null);
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
