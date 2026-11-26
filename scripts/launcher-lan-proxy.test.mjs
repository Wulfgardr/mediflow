import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { createServer } from 'node:net';
import { join } from 'node:path';
import tls from 'node:tls';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { syntheticTaxCode } from '../lib/patient-identity.test-support.ts';
import { pin, startDevicePairingFixture } from './fixtures/device-pairing-runtime.mjs';
import { certificatePin, createLanProxyController, readNetworkOverview } from './launcher-lan-proxy.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
let fixture, lan, port;

async function freePort() {
    const server = createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port: value } = server.address();
    await new Promise(resolve => server.close(resolve));
    return value;
}

before(async () => {
    fixture = await startDevicePairingFixture({ proxy: false });
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost',
        '-keyout', join(fixture.directory, 'impostor.key'), '-out', join(fixture.directory, 'impostor.crt')], { stdio: 'ignore' });
    port = await freePort();
    lan = createLanProxyController({ root, dataDir: fixture.directory, port,
        readOverview: target => readNetworkOverview(target, fixture.directory, { MEDIFLOW_LOCAL_API_TOKEN: fixture.localApiToken }) });
    await lan.follow(fixture.httpOrigin);
});
after(async () => {
    await lan?.detach();
    await fixture?.close();
});

function device(origin, fingerprint, path, { method = 'GET', headers = {}, body } = {}) {
    const target = new URL(origin);
    return new Promise((resolve, reject) => {
        const socket = tls.connect({ host: target.hostname, port: Number(target.port), localAddress: fixture.peer, rejectUnauthorized: false, servername: 'localhost' });
        socket.once('error', reject);
        socket.once('secureConnect', () => {
            const presented = socket.getPeerCertificate().fingerprint256?.replaceAll(':', '').toLowerCase();
            if (presented !== fingerprint) { socket.destroy(); reject(Object.assign(new Error('certificate not recognised'), { code: 'PIN_MISMATCH' })); return; }
            const request = http.request({ createConnection: () => socket, method, path, host: target.host,
                headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) } }, response => {
                let text = '';
                response.on('data', chunk => { text += chunk; });
                response.on('end', () => { socket.destroy(); resolve({ status: response.statusCode, text, headers: response.headers }); });
            });
            request.once('error', reject);
            request.end(body);
        });
    });
}

async function syntheticChart() {
    const headers = { Authorization: 'Bearer ' + fixture.localApiToken, 'Content-Type': 'application/json' };
    const ambulatories = await (await fetch(fixture.httpOrigin + '/api/v1/ambulatories', { headers })).json();
    const ambulatoryId = (ambulatories.find(item => item.isDefault) ?? ambulatories[0]).id;
    const id = randomUUID();
    const created = await fetch(fixture.httpOrigin + '/api/v1/patients', { method: 'POST', headers, body: JSON.stringify({
        id, firstName: 'Sintetico', lastName: 'Lancio', taxCode: syntheticTaxCode(id.replaceAll('-', '').slice(0, 13).toUpperCase()),
        ambulatoryId, notes: 'ENC:c3ludGhldGlj:bGFuY2lhdG9yZQ==', isAdi: false, isArchived: false }) });
    assert.equal(created.status, 201, await created.clone().text());
    return id;
}

async function pairDevice() {
    const offer = await fetch(fixture.httpOrigin + '/api/device-pairing', { method: 'POST', headers: fixture.webHeaders, body: JSON.stringify({ pin }) });
    assert.equal(offer.status, 201, await offer.clone().text());
    const link = new URL((await offer.json()).link);
    const origin = link.searchParams.get('origin'), fingerprint = link.searchParams.get('fingerprint');
    const redeemed = await device(origin, fingerprint, '/api/v1/network/pairing-offers/redeem', { method: 'POST', body: JSON.stringify({
        offerId: link.searchParams.get('id'), secret: link.searchParams.get('secret'), clientPlatform: 'ios', deviceName: 'iPhone sintetico' }) });
    assert.equal(redeemed.status, 201, redeemed.text);
    const { clientId, pairedClientToken } = JSON.parse(redeemed.text);
    const paired = { 'x-mediflow-paired-client-id': clientId, 'x-mediflow-paired-client-token': pairedClientToken };
    const login = await device(origin, fingerprint, '/api/auth/native/login', { method: 'POST', headers: paired, body: JSON.stringify({ verifier: fixture.verifier }) });
    assert.equal(login.status, 200, login.text);
    const cookie = login.headers['set-cookie'].find(value => value.startsWith('mediflow_session=')).split(';')[0];
    return { origin, fingerprint, paired, session: { ...paired, Cookie: cookie } };
}

async function settles(predicate) {
    for (let attempt = 0; attempt < 100; attempt++) {
        await lan.refresh();
        if (predicate(lan.status())) return lan.status();
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.fail(JSON.stringify(lan.status()));
}

test('a paired synthetic device opens a synthetic chart through the proxy the launcher started', async () => {
    assert.deepEqual(lan.status(), { state: 'on', paired: false, port, reason: null });
    const status = JSON.parse(readFileSync(join(fixture.directory, 'runtime-status.json'), 'utf8'));
    assert.equal(status.port, port);
    assert.equal(status.bindHost, '0.0.0.0');
    assert.equal(status.tlsPin, certificatePin(join(fixture.directory, 'certs/local-api.crt')));
    assert.equal(readFileSync(join(fixture.directory, 'local-api-tls-proxy.pid'), 'utf8').trim(), String(lan.pid()));
    assert.ok(!execFileSync('/bin/ps', ['-o', 'args=', '-p', String(lan.pid())], { encoding: 'utf8' }).includes(fixture.localApiToken));

    const id = await syntheticChart();
    const phone = await pairDevice();
    assert.equal(phone.origin, `https://${fixture.peer}:${port}`);
    assert.equal(phone.fingerprint, status.tlsPin);
    const chart = await device(phone.origin, phone.fingerprint, `/api/v1/network/patients/${id}`, { headers: phone.session });
    assert.equal(chart.status, 200, chart.text);
    assert.equal(JSON.parse(chart.text).id, id);
    assert.deepEqual(await settles(value => value.paired), { state: 'on', paired: true, port, reason: null });
});

test('an unpaired device, an unrecognised certificate and a stopped proxy read nothing', async () => {
    const id = await syntheticChart();
    const phone = await pairDevice();
    for (const headers of [{}, { 'x-mediflow-paired-client-id': randomUUID(), 'x-mediflow-paired-client-token': randomBytes(32).toString('base64url') },
        { Cookie: phone.session.Cookie }]) {
        const denied = await device(phone.origin, phone.fingerprint, `/api/v1/network/patients/${id}`, { headers });
        assert.equal(denied.status, 401, JSON.stringify(headers));
        assert.ok(!denied.text.includes(id) && !denied.text.includes('Sintetico'));
    }
    const listed = await device(phone.origin, phone.fingerprint, '/api/v1/network/patients', {});
    assert.equal(listed.status, 401);

    const received = [];
    const impostor = https.createServer({ key: readFileSync(join(fixture.directory, 'impostor.key')), cert: readFileSync(join(fixture.directory, 'impostor.crt')) },
        (request, response) => { received.push(request.headers); response.end('{}'); });
    await new Promise(resolve => impostor.listen(0, '0.0.0.0', resolve));
    try {
        await assert.rejects(device(`https://${fixture.peer}:${impostor.address().port}`, phone.fingerprint, `/api/v1/network/patients/${id}`, { headers: phone.session }), { code: 'PIN_MISMATCH' });
        assert.deepEqual(received, []);
    } finally { await new Promise(resolve => impostor.close(resolve)); }
    await assert.rejects(device(phone.origin, 'f'.repeat(64), `/api/v1/network/patients/${id}`, { headers: phone.session }), { code: 'PIN_MISMATCH' });

    const local = await fetch(fixture.httpOrigin + '/api/settings/network.mode', { method: 'PUT', headers: fixture.webHeaders, body: JSON.stringify({ value: 'local-only' }) });
    assert.equal(local.status, 200);
    assert.deepEqual(await settles(value => value.state === 'off'), { state: 'off', paired: false, port: null, reason: null });
    assert.equal(existsSync(join(fixture.directory, 'runtime-status.json')), false);
    assert.equal(existsSync(join(fixture.directory, 'local-api-tls-proxy.pid')), false);
    await assert.rejects(device(phone.origin, phone.fingerprint, `/api/v1/network/patients/${id}`, { headers: phone.session }), { code: 'ECONNREFUSED' });

    const home = await fetch(fixture.httpOrigin + '/api/settings/network.mode', { method: 'PUT', headers: fixture.webHeaders, body: JSON.stringify({ value: 'network-home-base' }) });
    assert.equal(home.status, 200);
    await settles(value => value.state === 'on');
    assert.equal((await device(phone.origin, phone.fingerprint, `/api/v1/network/patients/${id}`, { headers: phone.session })).status, 200);
    await lan.detach();
    assert.equal(existsSync(join(fixture.directory, 'runtime-status.json')), false);
    await assert.rejects(device(phone.origin, phone.fingerprint, `/api/v1/network/patients/${id}`, { headers: phone.session }), { code: 'ECONNREFUSED' });
});
