#!/usr/bin/env node
// ADR 0143 over real HTTP: an account moves from its PIN to a passphrase, then only the
// passphrase opens it, and the recovery key sets a new one when it is lost. The client side is
// written here with node:crypto alone, the way a second implementation would follow the
// documented construction.

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { loginWithWebAuthControl } from './web-auth-control-test-client.mjs';

const BASE_URL = process.env.E2E_BASE_URL || 'http://127.0.0.1:3400';
const LOCAL_API_TOKEN = process.env.MEDIFLOW_LOCAL_API_TOKEN || 'mediflow-network-write-smoke-local-token';
const USERNAME = process.env.E2E_USERNAME || 'admin';
const PIN = process.env.E2E_PIN || '1234';
const PASSPHRASE = 'cavallo batteria graffetta corretta';
const NEW_PASSPHRASE = 'una passphrase del tutto nuova';
const PIN_KDF_ITERATIONS = { 1: 100_000, 2: 600_000 };
const UNLOCK_KDF_ITERATIONS = 2_000_000;

test('an account moves from its PIN to a passphrase, the PIN stops opening it, and the recovery key sets a new passphrase', async () => {
    const ready = await request('GET', '/api/v1/ambulatories', { headers: { Authorization: `Bearer ${LOCAL_API_TOKEN}` } });
    assert.equal(ready.response.status, 200);

    assert.deepEqual((await check()).unlock, { credential: 'pin' });
    const pinLogin = await login({ password: PIN });
    assert.equal(pinLogin.response.status, 200);
    const masterKey = openPinWrapping(pinLogin.json.encryptedMasterKey, pinLogin.json.salt);

    // A full copy of the archive, named and sealed the way a repair leaves it, taken while the PIN wraps the key.
    assert.ok(process.env.MEDIFLOW_DATA_DIR, 'MEDIFLOW_DATA_DIR is required to look at the files of the archive');
    const archive = path.join(process.env.MEDIFLOW_DATA_DIR, 'medical.db');
    const pinEraCopy = `${archive}.bak-20261011-101500123`;
    const source = new Database(archive, { readonly: true });
    try { source.prepare('VACUUM INTO ?').run(pinEraCopy); } finally { source.close(); }
    const sealed = new Database(pinEraCopy);
    try { sealed.pragma('journal_mode = DELETE'); } finally { sealed.close(); }
    const filesHolding = (text) => [archive, `${archive}-wal`, pinEraCopy]
        .filter((file) => fs.existsSync(file) && fs.readFileSync(file).includes(Buffer.from(text))).map((file) => path.basename(file));
    assert.ok(filesHolding(pinLogin.json.encryptedMasterKey).includes(path.basename(pinEraCopy)));

    const unlock = passphraseWrapping(masterKey, PASSPHRASE);
    const recovery = recoveryWrapping(masterKey);
    // A page of this origin: what a browser adds to a same-origin fetch.
    const sameOrigin = { Origin: new URL(BASE_URL).origin, 'Sec-Fetch-Site': 'same-origin' };
    const adoption = (sessionHeaders, overrides = {}, headers = sameOrigin) => request('POST', '/api/auth/passphrase', {
        headers: { ...sessionHeaders, ...headers },
        body: {
            currentPin: PIN, encryptedMasterKey: unlock.blob, salt: unlock.salt, verifier: unlock.verifier,
            recovery: { wrappedMasterKey: recovery.blob, salt: recovery.salt, verifier: recovery.verifier },
            ...overrides,
        },
    });

    // Refused requests change nothing: the PIN still opens the same wrapping.
    assert.equal((await adoption('')).response.status, 401);
    const wrongPin = await adoption(pinLogin.webHeaders, { currentPin: `${PIN}-wrong` });
    assert.deepEqual([wrongPin.response.status, wrongPin.json?.code], [401, 'PASSPHRASE_ADOPTION_INVALID_PIN']);
    const pinWrapping = await adoption(pinLogin.webHeaders, { encryptedMasterKey: pinLogin.json.encryptedMasterKey });
    assert.deepEqual([pinWrapping.response.status, pinWrapping.json?.code], [400, 'PASSPHRASE_ADOPTION_INVALID']);
    // The right session and the right PIN, asked by anything other than this origin's own page.
    for (const headers of [{}, { Origin: 'http://attacker.invalid', 'Sec-Fetch-Site': 'cross-site' }, { Origin: sameOrigin.Origin }]) {
        const foreign = await adoption(pinLogin.webHeaders, {}, headers);
        assert.deepEqual([foreign.response.status, foreign.json?.code], [403, 'PASSPHRASE_ADOPTION_UNTRUSTED_REQUEST']);
    }
    const unchanged = await login({ password: PIN });
    assert.equal(unchanged.response.status, 200);
    assert.equal(unchanged.json.encryptedMasterKey, pinLogin.json.encryptedMasterKey);
    assert.ok(fs.existsSync(pinEraCopy), 'refused requests and PIN logins leave the copy where it is');

    const adopted = await adoption(unchanged.webHeaders);
    assert.deepEqual([adopted.response.status, adopted.json], [200, { success: true, earlierCopiesCleared: true }]);
    // Nothing the product keeps beside the archive holds the PIN wrapping or its salt any more:
    // not the copy, not the archive, not its write-ahead log.
    assert.equal(fs.existsSync(pinEraCopy), false);
    assert.deepEqual([...filesHolding(pinLogin.json.encryptedMasterKey), ...filesHolding(pinLogin.json.salt)], []);

    // Every session of the account is retired, including the one that asked.
    for (const sessionHeaders of [pinLogin.webHeaders, unchanged.webHeaders]) {
        const profile = await request('PUT', '/api/auth/profile', { headers: { ...sessionHeaders }, body: { displayName: 'Synthetic' } });
        assert.equal(profile.response.status, 401);
    }

    // Before authentication the server gives the salt; the PIN opens nothing any more.
    assert.deepEqual((await check()).unlock, { credential: 'passphrase', kdfVersion: 3, salt: unlock.salt });
    assert.equal((await login({ password: PIN })).response.status, 401);
    const wrongPassphrase = await login({ verifier: unlockMaterial(`${PASSPHRASE}!`, unlock.salt).verifier });
    assert.equal(wrongPassphrase.response.status, 401);

    // The passphrase opens the same master key the PIN opened.
    const material = unlockMaterial(PASSPHRASE, unlock.salt);
    const passphraseLogin = await login({ verifier: material.verifier });
    assert.equal(passphraseLogin.response.status, 200);
    assert.equal(passphraseLogin.json.encryptedMasterKey, unlock.blob);
    assert.deepEqual(openWrapping(passphraseLogin.json.encryptedMasterKey.slice(3), material.kek), masterKey);

    // With a session, the PIN still cannot put another wrapping in place of the passphrase one.
    const again = await adoption(passphraseLogin.webHeaders);
    assert.deepEqual([again.response.status, again.json?.code], [409, 'PASSPHRASE_ALREADY_ADOPTED']);
    const pinSalt = crypto.randomBytes(16);
    const pinBlob = `v2:${wrap(masterKey, crypto.pbkdf2Sync(PIN, pinSalt, PIN_KDF_ITERATIONS[2], 32, 'sha256'))}`;
    const changePin = await request('POST', '/api/auth/change-pin', {
        headers: { ...passphraseLogin.webHeaders },
        body: { currentPin: PIN, newPin: '97531', encryptedMasterKey: pinBlob, salt: pinSalt.toString('base64') },
    });
    assert.deepEqual([changePin.response.status, changePin.json?.code], [409, 'PIN_CHANGE_PASSPHRASE_ACCOUNT']);
    const rewrap = await request('POST', '/api/auth/rewrap-master-key', {
        headers: { ...passphraseLogin.webHeaders }, body: { encryptedMasterKey: pinBlob, salt: pinSalt.toString('base64') },
    });
    assert.deepEqual([rewrap.response.status, rewrap.json?.code], [409, 'KDF_REWRAP_NOT_APPLICABLE']);
    const still = await login({ verifier: material.verifier });
    assert.equal(still.json.encryptedMasterKey, unlock.blob);

    // The passphrase is lost. The kit and the recovery key give the master key back in the browser...
    const recovered = openRecoveryWrapping(recovery.blob, recovery.salt, recovery.recoveryKey);
    assert.deepEqual(recovered.masterKey, masterKey);
    assert.equal(recovered.verifier, recovery.verifier);
    // ...which wraps it under a new passphrase and a new recovery key, and asks with no session,
    // through the Web auth control as a login does.
    const next = passphraseWrapping(recovered.masterKey, NEW_PASSPHRASE);
    const nextRecovery = recoveryWrapping(recovered.masterKey);
    const recoveryBody = (overrides = {}) => ({
        username: USERNAME, recoveryVerifier: recovered.verifier,
        encryptedMasterKey: next.blob, salt: next.salt, verifier: next.verifier,
        recovery: { wrappedMasterKey: nextRecovery.blob, salt: nextRecovery.salt, verifier: nextRecovery.verifier },
        ...overrides,
    });
    const recover = (overrides = {}, headers = sameOrigin) => throughWebAuthControl('/api/auth/passphrase/recover', recoveryBody(overrides), headers);

    // Refused: another origin, no auth control, the old recovery key kept as the new one, a wrong recovery key.
    assert.deepEqual((await recover({}, {})).json?.code, 'PASSPHRASE_RECOVERY_UNTRUSTED_REQUEST');
    const noControl = await request('POST', '/api/auth/passphrase/recover', { headers: sameOrigin, body: recoveryBody() });
    assert.deepEqual([noControl.response.status, noControl.json?.code], [503, 'PASSPHRASE_RECOVERY_UNAVAILABLE']);
    const keptKey = await recover({ recovery: { wrappedMasterKey: nextRecovery.blob, salt: nextRecovery.salt, verifier: recovered.verifier } });
    assert.deepEqual([keptKey.response.status, keptKey.json?.code], [400, 'PASSPHRASE_RECOVERY_INVALID']);
    const wrongKey = await recover({ recoveryVerifier: crypto.randomBytes(32).toString('base64') });
    assert.deepEqual([wrongKey.response.status, wrongKey.json?.message], [401, 'Chiave di recupero o kit non validi. Tentativi rimasti: 4.']);
    const afterRefusals = await login({ verifier: material.verifier });
    assert.equal(afterRefusals.response.status, 200, 'refused recoveries change nothing');

    const done = await recover();
    assert.deepEqual([done.response.status, done.json], [200, { success: true }]);
    // The session the server opened for the recovery never reaches the browser, and its control holds none.
    assert.equal(done.response.headers.getSetCookie().some((cookie) => cookie.startsWith('mediflow_session=')), false);
    const controlAfter = await request('GET', '/api/auth/check', { headers: { Cookie: done.controlCookie } });
    assert.equal(controlAfter.json.hasSession, false);

    // Every session is retired, the old passphrase and the spent recovery key are refused, the new passphrase opens the same key.
    for (const sessionHeaders of [still.webHeaders, afterRefusals.webHeaders]) {
        const retired = await request('PUT', '/api/auth/profile', { headers: { ...sessionHeaders }, body: { displayName: 'Synthetic' } });
        assert.equal(retired.response.status, 401);
    }
    assert.equal((await login({ verifier: material.verifier })).response.status, 401);
    assert.equal((await recover()).response.status, 401);
    assert.deepEqual((await check()).unlock, { credential: 'passphrase', kdfVersion: 3, salt: next.salt });
    const nextMaterial = unlockMaterial(NEW_PASSPHRASE, next.salt);
    const nextLogin = await login({ verifier: nextMaterial.verifier });
    assert.equal(nextLogin.response.status, 200);
    assert.deepEqual(openWrapping(nextLogin.json.encryptedMasterKey.slice(3), nextMaterial.kek), masterKey);
});

async function check() { return (await request('GET', '/api/auth/check')).json; }
function login(secret) { return loginWithWebAuthControl(BASE_URL, { username: USERNAME, ...secret }); }

/** A request with no session that passes through the Web auth control, as the browser sends a login. */
async function throughWebAuthControl(pathname, body, headers) {
    const checked = await fetch(new URL('/api/auth/check', BASE_URL), { cache: 'no-store' });
    const controlCookie = /mediflow_auth_control=[^;,]+/u.exec(checked.headers.getSetCookie().join(','))?.[0];
    assert.ok(controlCookie, 'the check gives an auth control');
    const sent = await request('POST', pathname, {
        headers: { Cookie: controlCookie, 'If-Match': checked.headers.get('etag'), 'Idempotency-Key': crypto.randomUUID(), ...headers }, body,
    });
    return { ...sent, controlCookie };
}

async function request(method, pathname, { headers = {}, body } = {}) {
    const response = await fetch(new URL(pathname, BASE_URL), {
        method,
        headers: { 'Cache-Control': 'no-store', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    return { response, json };
}

// AES-256-GCM as the product stores it: base64 of 12 bytes of IV, ciphertext, 16 bytes of tag.
function wrap(masterKey, kek) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', kek, iv);
    return Buffer.concat([iv, cipher.update(masterKey), cipher.final(), cipher.getAuthTag()]).toString('base64');
}
function openWrapping(base64, kek) {
    const payload = Buffer.from(base64, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', kek, payload.subarray(0, 12));
    decipher.setAuthTag(payload.subarray(payload.length - 16));
    return Buffer.concat([decipher.update(payload.subarray(12, payload.length - 16)), decipher.final()]);
}
function openPinWrapping(blob, saltBase64) {
    const match = /^v(\d+):(.*)$/u.exec(blob);
    const kek = crypto.pbkdf2Sync(PIN, Buffer.from(saltBase64, 'base64'), PIN_KDF_ITERATIONS[match ? Number(match[1]) : 1], 32, 'sha256');
    return openWrapping(match ? match[2] : blob, kek);
}
// Version 3: PBKDF2-HMAC-SHA256 over the NFKC passphrase, then HKDF-SHA256 into two independent values.
function unlockMaterial(passphrase, saltBase64) {
    const root = crypto.pbkdf2Sync(Buffer.from(passphrase.normalize('NFKC'), 'utf8'), Buffer.from(saltBase64, 'base64'), UNLOCK_KDF_ITERATIONS, 32, 'sha256');
    const derive = (info) => Buffer.from(crypto.hkdfSync('sha256', root, Buffer.alloc(0), info, 32));
    return { kek: derive('mediflow.unlock.kek.v3'), verifier: derive('mediflow.unlock.verifier.v3').toString('base64') };
}
function passphraseWrapping(masterKey, passphrase) {
    const salt = crypto.randomBytes(16).toString('base64');
    const { kek, verifier } = unlockMaterial(passphrase, salt);
    return { blob: `v3:${wrap(masterKey, kek)}`, salt, verifier };
}
// The recovery key is 160 random bits; HKDF with the salt of the kit separates its two uses.
function recoveryMaterial(recoveryKey, saltBase64) {
    const derive = (info) => Buffer.from(crypto.hkdfSync('sha256', recoveryKey, Buffer.from(saltBase64, 'base64'), info, 32));
    return { kek: derive('mediflow.recovery.kek.v1'), verifier: derive('mediflow.recovery.verifier.v1').toString('base64') };
}
function recoveryWrapping(masterKey) {
    const recoveryKey = crypto.randomBytes(20);
    const salt = crypto.randomBytes(16).toString('base64');
    const { kek, verifier } = recoveryMaterial(recoveryKey, salt);
    return { recoveryKey, blob: `r1:${wrap(masterKey, kek)}`, salt, verifier };
}
function openRecoveryWrapping(blob, saltBase64, recoveryKey) {
    const { kek, verifier } = recoveryMaterial(recoveryKey, saltBase64);
    return { masterKey: openWrapping(blob.slice(3), kek), verifier };
}
