import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { eq } from 'drizzle-orm';
import {
    buildNetworkNodeSummary,
    createPairingIntentDraft,
    MAX_PAIRING_APP_VERSION_LENGTH,
    MAX_PAIRING_CAPABILITY_LENGTH,
    MAX_PAIRING_REQUESTED_CAPABILITIES,
    NETWORK_MODE_KEY,
} from './network-contract';
import {
    MAX_PENDING_PAIRING_INTENTS,
    NETWORK_PAIRING_INTENTS_KEY,
    NETWORK_PAIRING_STATE_KEY,
} from './network-pairing-model';
import { settings } from './schema';
import { createPairingRateLimiter } from '../scripts/local-api-tls-proxy.mjs';
import { startLanProxy } from '../scripts/launcher-lan-proxy.mjs';
import { readPairingAddress } from './network-pairing-address';

const load = createRequire(import.meta.url);
const dataDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-wul897-dos-')));
process.env.MEDIFLOW_DATA_DIR = dataDir;
const { dbServer, openDbServer } = load('./db-server.ts') as typeof import('./db-server');
openDbServer();
const {
    authenticateNetworkPairedClient,
    confirmNetworkPairingIntent,
    listNetworkPairingIntents,
    postNetworkPairingIntent,
    revokeNetworkPairedClient,
} = load('./network-home-base-server.ts') as typeof import('./network-home-base-server');

test.after(() => {
    dbServer.$client.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
});

function enableHomeBase() {
    dbServer
        .insert(settings)
        .values({ key: NETWORK_MODE_KEY, value: 'network-home-base' })
        .onConflictDoUpdate({ target: settings.key, set: { value: 'network-home-base' } })
        .run();
}

function readRawSetting(key: string): string | null {
    return dbServer.select({ value: settings.value }).from(settings).where(eq(settings.key, key)).get()?.value ?? null;
}

test('pairing intent validation bounds appVersion and requestedCapabilities before persistence', () => {
    const nodeSummary = buildNetworkNodeSummary({
        nodeId: 'node-wul897',
        snapshot: { [NETWORK_MODE_KEY]: 'network-home-base' },
        hostName: 'synthetic-host',
    });
    const snapshot = { [NETWORK_MODE_KEY]: 'network-home-base' };

    const longVersion = createPairingIntentDraft({
        nodeSummary,
        snapshot,
        payload: { deviceName: 'Synthetic', clientPlatform: 'ios', appVersion: 'v'.repeat(MAX_PAIRING_APP_VERSION_LENGTH + 1) },
    });
    assert.equal(longVersion.ok, false);
    if (!longVersion.ok) {
        assert.equal(longVersion.status, 400);
        assert.equal(longVersion.value.code, 'PAIRING_REQUEST_INVALID');
    }

    const tooManyCaps = createPairingIntentDraft({
        nodeSummary,
        snapshot,
        payload: {
            deviceName: 'Synthetic',
            clientPlatform: 'ios',
            requestedCapabilities: Array.from({ length: MAX_PAIRING_REQUESTED_CAPABILITIES + 1 }, (_, i) => `cap.${i}`),
        },
    });
    assert.equal(tooManyCaps.ok, false);
    if (!tooManyCaps.ok) {
        assert.equal(tooManyCaps.status, 400);
        assert.equal(tooManyCaps.value.code, 'PAIRING_REQUEST_INVALID');
    }

    const longCap = createPairingIntentDraft({
        nodeSummary,
        snapshot,
        payload: {
            deviceName: 'Synthetic',
            clientPlatform: 'ios',
            requestedCapabilities: ['c'.repeat(MAX_PAIRING_CAPABILITY_LENGTH + 1)],
        },
    });
    assert.equal(longCap.ok, false);
    if (!longCap.ok) {
        assert.equal(longCap.status, 400);
        assert.equal(longCap.value.code, 'PAIRING_REQUEST_INVALID');
    }
});

test('1000 pairing intent requests keep persisted state strictly bounded and leave paired client state untouched', async () => {
    enableHomeBase();
    dbServer.delete(settings).where(eq(settings.key, NETWORK_PAIRING_STATE_KEY)).run();
    dbServer.delete(settings).where(eq(settings.key, NETWORK_PAIRING_INTENTS_KEY)).run();

    const seedIntent = await postNetworkPairingIntent({
        deviceName: 'Doctor iPhone',
        clientPlatform: 'ios',
        appVersion: '1.0.0',
        requestedCapabilities: ['network.replica.readonly-patients'],
    });
    assert.equal(seedIntent.ok, true);
    if (!seedIntent.ok) return;
    const confirmed = await confirmNetworkPairingIntent(seedIntent.value.intentId);
    assert.equal(confirmed.status, 201);

    const stateBeforeFlood = readRawSetting(NETWORK_PAIRING_STATE_KEY);
    assert.ok(stateBeforeFlood);

    let accepted = 0;
    let rejected = 0;
    for (let index = 0; index < 1000; index += 1) {
        const res = await postNetworkPairingIntent({
            deviceName: `Flood-${index}`,
            clientPlatform: 'ios',
            appVersion: '1.0.0',
            requestedCapabilities: ['network.replica.readonly-patients'],
        });
        if (res.ok) accepted += 1;
        else rejected += 1;
    }

    assert.equal(accepted, MAX_PENDING_PAIRING_INTENTS);
    assert.equal(rejected, 1000 - MAX_PENDING_PAIRING_INTENTS);

    const intentsRaw = readRawSetting(NETWORK_PAIRING_INTENTS_KEY) ?? '';
    assert.ok(Buffer.byteLength(intentsRaw, 'utf8') < 70_000);
    assert.equal((await listNetworkPairingIntents()).length, MAX_PENDING_PAIRING_INTENTS);
    assert.equal(readRawSetting(NETWORK_PAIRING_STATE_KEY), stateBeforeFlood);
});

test('revoking a paired device succeeds without CAS conflict while pairing intent floods arrive', async () => {
    enableHomeBase();
    for (let ticks = 0; ticks <= 10; ticks += 1) {
        dbServer.delete(settings).where(eq(settings.key, NETWORK_PAIRING_STATE_KEY)).run();
        dbServer.delete(settings).where(eq(settings.key, NETWORK_PAIRING_INTENTS_KEY)).run();

        const initIntent = await postNetworkPairingIntent({
            deviceName: 'Lost iPhone',
            clientPlatform: 'ios',
            appVersion: '1.0.0',
            requestedCapabilities: ['network.replica.readonly-patients'],
        });
        assert.equal(initIntent.ok, true);
        if (!initIntent.ok) return;
        const confirmed = await confirmNetworkPairingIntent(initIntent.value.intentId);
        assert.equal(confirmed.status, 201);
        if (!('pairedClient' in confirmed.value)) return;
        const clientId = confirmed.value.pairedClient.clientId;
        const clientToken = confirmed.value.pairedClientToken;

        const flood = Array.from({ length: 16 }, (_, index) =>
            postNetworkPairingIntent({
                deviceName: `Attacker-${ticks}-${index}`,
                clientPlatform: 'ios',
                appVersion: '1.0.0',
                requestedCapabilities: [],
            })
        );
        for (let step = 0; step < ticks; step += 1) await Promise.resolve();
        const revokePromise = revokeNetworkPairedClient(clientId, { actorRef: 'admin', sourceSurface: 'web' });
        const results = await Promise.all([...flood, revokePromise]);
        const revoked = results.at(-1) as Awaited<ReturnType<typeof revokeNetworkPairedClient>>;

        assert.equal(revoked.conflict, false, `Revocation conflicted at tick ${ticks}`);
        if (!revoked.conflict) {
            assert.equal(revoked.result.ok, true);
            assert.equal(revoked.result.status, 200);
        }

        const authCheck = await authenticateNetworkPairedClient(new Request('https://127.0.0.1:3443/api/v1/network/patients', {
            headers: {
                'x-mediflow-paired-client-id': clientId,
                'x-mediflow-paired-client-token': clientToken,
            },
        }));
        assert.equal(authCheck, null);
    }
});

test('TLS proxy pairing rate limiter bounds per-IP requests and evicts stale buckets', () => {
    let clock = 1_000_000;
    const allow = createPairingRateLimiter({
        maxRequests: 3,
        windowMs: 10_000,
        maxTrackedIps: 2,
        now: () => clock,
    });
    assert.equal(allow('198.51.100.1').allowed, true);
    assert.equal(allow('198.51.100.1').allowed, true);
    assert.equal(allow('198.51.100.1').allowed, true);
    const denied = allow('198.51.100.1');
    assert.equal(denied.allowed, false);
    assert.ok(denied.retryAfterSeconds >= 1);
    assert.equal(allow('198.51.100.2').allowed, true);
    assert.equal(allow('198.51.100.3').allowed, true);
    clock += 10_001;
    assert.equal(allow('198.51.100.1').allowed, true);
});

test('real TLS proxy enforces non-loopback ingress allowlist, single-network bind and per-IP pairing rate limit', { skip: process.platform === 'win32' }, async () => {
    const peer = await readPairingAddress('0.0.0.0');
    assert.ok(peer, 'A non-loopback IPv4 interface is required');

    const otherAddress = Object.entries(os.networkInterfaces())
        .sort(([a], [b]) => a.localeCompare(b))
        .flatMap(([, addresses]) => addresses ?? [])
        .find((address) => address.family === 'IPv4' && !address.internal && !address.address.startsWith('169.254.') && address.address !== peer)?.address;

    const proxyDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-proxy-ratelimit-')));
    let forwardedRedeem = 0;
    const backend = http.createServer((req, res) => {
        if (req.url?.startsWith('/api/v1/network/pairing-offers/redeem')) forwardedRedeem += 1;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
    });
    await new Promise<void>((resolve) => backend.listen(0, '127.0.0.1', resolve));
    const backendPort = (backend.address() as { port: number }).port;

    await assert.rejects(
        startLanProxy({
            root: process.cwd(),
            dataDir: proxyDir,
            target: `http://127.0.0.1:${backendPort}`,
            port: 0,
            bindHost: '0.0.0.0',
        }),
        { code: 'LAN_PROXY_WILDCARD_FORBIDDEN' },
    );

    const proxy = await startLanProxy({
        root: process.cwd(),
        dataDir: proxyDir,
        target: `http://127.0.0.1:${backendPort}`,
        port: 0,
    });
    assert.equal(proxy.bindHost, peer);

    const tcpConnects = (host: string, port: number, localAddress: string) => new Promise<boolean>((resolve) => {
        const socket = net.connect({ host, port, localAddress });
        const timer = setTimeout(() => { socket.destroy(); resolve(false); }, 1000);
        socket.once('connect', () => { clearTimeout(timer); socket.destroy(); resolve(true); });
        socket.once('error', () => { clearTimeout(timer); resolve(false); });
    });

    const callFromLan = (method: string, targetPath: string) =>
        new Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
            const req = https.request(`https://127.0.0.1:${proxy.port}${targetPath}`, {
                method,
                localAddress: peer,
                rejectUnauthorized: false,
                servername: 'localhost',
                timeout: 1500,
            }, (res) => {
                let body = '';
                res.on('data', (chunk) => { body += chunk; });
                res.on('end', () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
            });
            req.once('timeout', () => req.destroy(Object.assign(new Error('Connection timed out'), { code: 'ETIMEDOUT' })));
            req.once('error', reject);
            req.end(method === 'POST' ? '{}' : undefined);
        });

    try {
        assert.equal(await tcpConnects(peer, proxy.port, peer), true);
        if (otherAddress) {
            assert.equal(await tcpConnects(otherAddress, proxy.port, otherAddress), false);
        }

        assert.equal((await callFromLan('GET', '/api/patients')).status, 403);
        assert.equal((await callFromLan('GET', '/api/settings/network.mode')).status, 403);
        assert.equal((await callFromLan('POST', '/api/device-pairing')).status, 403);
        assert.equal((await callFromLan('GET', '/api/backup/export')).status, 403);
        assert.equal((await callFromLan('POST', '/api/v1/network/pairing-intents')).status, 403);
        assert.equal((await callFromLan('GET', '/api/v1/network/pairing-intents')).status, 403);
        assert.equal((await callFromLan('POST', '/api/v1/network/pairing-intents/id-1/confirm')).status, 403);
        assert.equal((await callFromLan('GET', '/api/agent/status')).status, 404);
        assert.equal((await callFromLan('GET', '/api/agent-mandates')).status, 404);
        assert.equal((await callFromLan('GET', '/api/auth/check')).status, 200);

        let passed = 0;
        let rateLimited = 0;
        for (let index = 0; index < 60; index += 1) {
            const res = await callFromLan('POST', '/api/v1/network/pairing-offers/redeem');
            if (res.status === 200) passed += 1;
            else if (res.status === 429) {
                rateLimited += 1;
                assert.ok(res.headers['retry-after']);
                assert.match(res.body, /PAIRING_RATE_LIMITED/u);
            }
        }
        assert.equal(passed, 20);
        assert.equal(rateLimited, 40);
        assert.equal(forwardedRedeem, 20);
    } finally {
        await proxy.stop();
        await new Promise<void>((resolve) => backend.close(() => resolve()));
        fs.rmSync(proxyDir, { recursive: true, force: true });
    }
});
