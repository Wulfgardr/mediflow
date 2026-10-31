import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import test from 'node:test';

const base = process.env.E2E_TLS_URL;
const target = process.env.E2E_BASE_URL;
const cert = process.env.MEDIFLOW_TLS_CERT_PATH;
assert.ok(base && target && cert, 'Owned synthetic Next and TLS proxy URLs and certificate required');
const peer = process.env.MEDIFLOW_SYNTHETIC_PEER_ADDRESS
    || Object.values(os.networkInterfaces()).flat().find(value => value.family === 'IPv4' && !value.internal)?.address;
assert.ok(peer, 'A non-loopback source address on this host is required');
const before = process.env.MEDIFLOW_EXPECT_UNRESTRICTED_WEB === '1';
const local = { Authorization: `Bearer ${process.env.MEDIFLOW_LOCAL_API_TOKEN}` };
function call(route, { method = 'GET', headers = {}, body, remote = true, direct = false } = {}) {
    const url = new URL(route, direct ? target : base);
    assert.equal(url.hostname, '127.0.0.1', 'Listeners and destinations must stay on loopback');
    return new Promise((resolve, reject) => {
        const client = url.protocol === 'https:' ? https : http;
        const request = client.request(url, { method, headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) },
            localAddress: remote ? peer : undefined, ca: fs.readFileSync(cert), servername: 'localhost', timeout: 30_000 }, response => {
            let text = ''; response.on('data', chunk => text += chunk); response.on('end', () => {
                let json; try { json = JSON.parse(text); } catch { json = null; }
                resolve({ status: response.statusCode, headers: response.headers, json });
            });
        });
        request.on('error', reject); request.on('timeout', () => request.destroy(new Error('Synthetic ingress timeout')));
        request.end(body ? JSON.stringify(body) : undefined);
    });
}
const cookie = (response, name) => response.headers['set-cookie'].find(value => value.startsWith(`${name}=`)).split(';')[0];
async function login(remote) {
    const check = await call('/api/auth/check', { remote });
    assert.equal(check.status, 200);
    const control = cookie(check, 'mediflow_auth_control');
    const response = await call('/api/auth/login', { remote, method: 'POST', headers: { Cookie: control,
        'If-Match': check.headers.etag, 'Idempotency-Key': randomUUID() }, body: { username: 'admin', password: '1234' } });
    return { response, control };
}

test('a genuine non-loopback socket peer cannot issue or consume Web sessions through TLS or Next', async () => {
    const remote = await login(true);
    assert.equal(remote.response.status, before ? 200 : 403);
    const active = before ? remote : await login(false);
    assert.equal(active.response.status, 200);
    const headers = { Cookie: `${cookie(active.response, 'mediflow_session')}; ${active.control}` };
    for (const route of ['/api/patients', '/api/settings/network.mode']) {
        assert.equal((await call(route, { headers })).status, before ? 200 : 403, route);
        if (!before) assert.equal((await call(route, { headers, direct: true })).status, 401, `Next defense: ${route}`);
    }
    if (!before) {
        assert.equal((await call('/api/auth/login', { direct: true, method: 'POST', body: {} })).status, 403);
        const intent = await call('/api/v1/network/pairing-intents', { method: 'POST', body: { deviceName: 'Synthetic TLS peer', clientPlatform: 'ipados', appVersion: 'test', requestedCapabilities: ['network.replica.readonly-patients'] } });
        assert.equal(intent.status, 201, 'Network route must survive the allowlist');
        const pairing = await call(`/api/v1/network/pairing-intents/${intent.json.intentId}/confirm`, { method: 'POST', direct: true, remote: false, headers: local });
        assert.equal(pairing.status, 201);
        const pairedHeaders = { 'x-mediflow-paired-client-id': pairing.json.pairedClient.clientId, 'x-mediflow-paired-client-token': pairing.json.pairedClientToken };
        const native = await call('/api/auth/native/login', { method: 'POST', headers: pairedHeaders, body: { username: 'admin', password: '1234' } });
        assert.equal(native.status, 200, 'Native login must survive the allowlist');
        const nativeHeaders = { ...pairedHeaders, Cookie: cookie(native, 'mediflow_session') };
        assert.equal((await call('/api/auth/profile', { headers: nativeHeaders })).status, 200);
        assert.equal((await call('/api/v1/network/patients', { headers: nativeHeaders })).status, 200);
    }
});
