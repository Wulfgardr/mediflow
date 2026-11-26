import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import Database from 'better-sqlite3';
import { pin, startDevicePairingFixture } from './fixtures/device-pairing-runtime.mjs';

const adminRoute = '/api/device-pairing';
const redeemRoute = '/api/v1/network/pairing-offers/redeem';
const clientsRoute = '/api/v1/network/pairing-clients';
const offerKey = 'network.pairing.offers';
const pairingKey = 'network.pairing.state';
let fixture;
let db;

before(async () => {
    fixture = await startDevicePairingFixture({ source: process.env.MEDIFLOW_PAIRING_TEST_SOURCE });
    db = new Database(join(fixture.directory, 'medical.db'), { fileMustExist: true });
});
after(async () => {
    db?.close();
    await fixture?.close();
});

function issue(headers = fixture.webHeaders, value = pin) {
    return fetch(fixture.httpOrigin + adminRoute, { method: 'POST', headers, body: JSON.stringify({ pin: value }) });
}

async function claim() {
    const response = await issue();
    assert.equal(response.status, 201);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const offer = await response.json();
    const link = new URL(offer.link);
    assert.equal(link.protocol, 'mediflow:');
    assert.equal(link.hostname, 'collega');
    assert.equal(link.searchParams.get('origin'), `https://${fixture.peer}:${fixture.tlsPort}`);
    assert.match(link.searchParams.get('fingerprint'), /^[a-f0-9]{64}$/u);
    return {
        offerId: link.searchParams.get('id'), secret: link.searchParams.get('secret'),
        clientPlatform: 'macos', deviceName: 'Mac sintetico',
    };
}

function redeem(value) {
    return fixture.lan(redeemRoute, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
}

function setting(key) {
    return db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? null;
}

function audit() {
    return db.prepare("SELECT event_type, subject_ref, actor_ref, redacted_metadata FROM audit_events WHERE event_type LIKE 'network.pairing.%' ORDER BY rowid").all();
}

test('offer creation requires an active loopback administrator, trusted mutation and the PIN', async () => {
    const untrusted = { ...fixture.webHeaders, 'Sec-Fetch-Site': 'cross-site' };
    assert.equal((await issue(untrusted)).status, 403, 'Cross-origin mutation');
    assert.equal((await issue(undefined, '734185')).status, 403, 'Wrong confirmation PIN');
    assert.equal((await issue(undefined, 'ab12cd')).status, 403, 'Alphanumeric confirmation PIN reaches verification');
    assert.equal((await issue(undefined, 'ab12cd345')).status, 400, 'Confirmation PIN longer than the configured limit');
    assert.equal((await fixture.lan(adminRoute, {
        method: 'POST', headers: fixture.webHeaders, body: JSON.stringify({ pin }),
    })).status, 403, 'Genuine non-loopback TLS peer with copied cookies');
    const locked = await fetch(fixture.httpOrigin + '/api/auth/lock', {
        method: 'POST', headers: { ...fixture.webHeaders, 'If-Match': fixture.web.controlEtag,
            'Idempotency-Key': randomUUID() },
    });
    assert.equal(locked.status, 200);
    assert.equal((await issue(fixture.webHeaders)).status, 403, 'Locked Web session with stale cookies');
    Object.assign(fixture, await fixture.signIn());
    assert.equal(setting(offerKey), null);
    assert.deepEqual(audit(), []);
});

test('valid redemption requires TLS, consumes the secret once and revocation immediately denies the token', async () => {
    const offer = await claim();
    const stored = setting(offerKey);
    assert.ok(!stored.includes(offer.secret));
    assert.ok(stored.includes(createHash('sha256').update(offer.secret).digest('hex')));
    assert.equal((await fetch(fixture.httpOrigin + redeemRoute, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(offer),
    })).status, 403, 'Plain HTTP');
    assert.equal((await redeem({ ...offer, secret: randomBytes(32).toString('base64url') })).status, 404);
    assert.equal((await redeem({ ...offer, deviceName: 'a'.repeat(2050) })).status, 413);
    assert.equal(setting(offerKey), stored);

    const result = await redeem(offer);
    assert.equal(result.status, 201);
    assert.ok(!result.headers['set-cookie']);
    const { clientId, pairedClientToken } = JSON.parse(result.text);
    const paired = { 'x-mediflow-paired-client-id': clientId, 'x-mediflow-paired-client-token': pairedClientToken };
    assert.equal((await redeem(offer)).status, 404);
    assert.equal((await fixture.lan('/api/v1/network/patients', { headers: paired })).status, 401);
    const unpairedCheck = await fixture.lan('/api/auth/check');
    assert.equal(unpairedCheck.status, 401);
    assert.ok(!unpairedCheck.text.includes('archiveGeneration') && !unpairedCheck.text.includes('salt'));
    const pairedCheck = await fixture.lan('/api/auth/check', { headers: paired });
    assert.equal(pairedCheck.status, 200);
    assert.ok(pairedCheck.text.includes('archiveGeneration'));
    const login = await fixture.lan('/api/auth/native/login', { method: 'POST',
        headers: { ...paired, 'Content-Type': 'application/json' },
        body: JSON.stringify({ verifier: fixture.verifier }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers['set-cookie'].find(value => value.startsWith('mediflow_session=')).split(';')[0];
    const session = { ...paired, Cookie: cookie };
    assert.equal((await fixture.lan('/api/v1/network/patients', { headers: session })).status, 200);

    const listed = await fetch(fixture.httpOrigin + adminRoute, { headers: fixture.webHeaders });
    assert.equal(listed.status, 200);
    const projection = await listed.text();
    assert.ok(projection.includes(clientId) && !projection.includes(pairedClientToken) && !projection.includes('tokenHash'));
    const revoked = await fetch(`${fixture.httpOrigin}${clientsRoute}/${clientId}`, { method: 'DELETE', headers: fixture.webHeaders });
    assert.equal(revoked.status, 200);
    assert.equal((await fixture.lan('/api/v1/network/patients', { headers: session })).status, 401);
    assert.equal((await fixture.lan('/api/v1/network/node', { headers: paired })).status, 401);
    assert.equal((await fixture.lan('/api/auth/check', { headers: paired })).status, 401);
    const records = audit();
    assert.deepEqual(records.map(record => record.event_type), [
        'network.pairing.offer.created', 'network.pairing.offer.redeemed', 'network.pairing.client.revoked',
    ]);
    const output = JSON.stringify(records) + readFileSync(join(fixture.directory, 'next.log'), 'utf8') + readFileSync(join(fixture.directory, 'proxy.log'), 'utf8');
    assert.ok(!output.includes(offer.secret) && !output.includes(pairedClientToken));
});

test('expired offers, concurrent redemptions and local-only mode have one durable outcome', async () => {
    const expired = await claim();
    const state = JSON.parse(setting(offerKey));
    state.offers.find(offer => offer.id === expired.offerId).expiresAt = Date.now() - 1;
    db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(JSON.stringify(state), offerKey);
    assert.equal((await redeem(expired)).status, 404);

    const offer = await claim();
    const mode = await fetch(fixture.httpOrigin + '/api/settings/network.mode', {
        method: 'PUT', headers: fixture.webHeaders, body: JSON.stringify({ value: 'local-only' }),
    });
    assert.equal(mode.status, 200);
    assert.equal((await redeem(offer)).status, 409);
    const enabled = await fetch(fixture.httpOrigin + '/api/settings/network.mode', {
        method: 'PUT', headers: fixture.webHeaders, body: JSON.stringify({ value: 'network-home-base' }),
    });
    assert.equal(enabled.status, 200);

    const results = await Promise.all([redeem(offer), redeem(offer)]);
    assert.deepEqual(results.map(result => result.status).sort(), [201, 404]);
    assert.equal(JSON.parse(setting(pairingKey)).clients.length, 1);
    assert.equal(audit().filter(record => record.event_type.endsWith('.redeemed') && record.subject_ref === offer.offerId).length, 1);
    assert.equal((await redeem({ ...offer, offerId: randomUUID() })).status, 404);
});

test('offers are bounded and an audit failure rolls back redemption', async () => {
    const offer = await claim();
    for (let index = 0; index < 3; index++) assert.equal((await issue()).status, 201);
    assert.equal((await issue()).status, 409);
    const beforePairing = setting(pairingKey);
    const beforeOffers = setting(offerKey);
    db.exec(`CREATE TRIGGER synthetic_pairing_audit_failure BEFORE INSERT ON audit_events
        WHEN NEW.event_type = 'network.pairing.offer.redeemed' BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END`);
    try {
        assert.equal((await redeem(offer)).status, 503);
        assert.ok(setting(pairingKey) === beforePairing && setting(offerKey) === beforeOffers);
    } finally {
        db.exec('DROP TRIGGER synthetic_pairing_audit_failure');
    }
    assert.equal((await redeem(offer)).status, 201);
});
