#!/usr/bin/env node
// ADR 0143 over real HTTP: an account moves from its PIN to a passphrase, then only the
// passphrase opens it. The client side is written here with node:crypto alone, the way a
// second implementation would follow the documented construction.

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
const PIN_KDF_ITERATIONS = { 1: 100_000, 2: 600_000 };
const UNLOCK_KDF_ITERATIONS = 2_000_000;

test('an account moves from its PIN to a passphrase and the PIN stops opening it', async () => {
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
    const adoption = (cookieHeader, overrides = {}, headers = sameOrigin) => request('POST', '/api/auth/passphrase', {
        headers: { Cookie: cookieHeader, ...headers },
        body: {
            currentPin: PIN, encryptedMasterKey: unlock.blob, salt: unlock.salt, verifier: unlock.verifier,
            recovery: { wrappedMasterKey: recovery.blob, salt: recovery.salt, verifier: recovery.verifier },
            ...overrides,
        },
    });

    // Refused requests change nothing: the PIN still opens the same wrapping.
    assert.equal((await adoption('')).response.status, 401);
    const wrongPin = await adoption(pinLogin.cookieHeader, { currentPin: `${PIN}-wrong` });
    assert.deepEqual([wrongPin.response.status, wrongPin.json?.code], [401, 'PASSPHRASE_ADOPTION_INVALID_PIN']);
    const pinWrapping = await adoption(pinLogin.cookieHeader, { encryptedMasterKey: pinLogin.json.encryptedMasterKey });
    assert.deepEqual([pinWrapping.response.status, pinWrapping.json?.code], [400, 'PASSPHRASE_ADOPTION_INVALID']);
    // The right session and the right PIN, asked by anything other than this origin's own page.
    for (const headers of [{}, { Origin: 'http://attacker.invalid', 'Sec-Fetch-Site': 'cross-site' }, { Origin: sameOrigin.Origin }]) {
        const foreign = await adoption(pinLogin.cookieHeader, {}, headers);
        assert.deepEqual([foreign.response.status, foreign.json?.code], [403, 'PASSPHRASE_ADOPTION_UNTRUSTED_REQUEST']);
    }
    const unchanged = await login({ password: PIN });
    assert.equal(unchanged.response.status, 200);
    assert.equal(unchanged.json.encryptedMasterKey, pinLogin.json.encryptedMasterKey);
    assert.ok(fs.existsSync(pinEraCopy), 'refused requests and PIN logins leave the copy where it is');

    const adopted = await adoption(unchanged.cookieHeader);
    assert.deepEqual([adopted.response.status, adopted.json], [200, { success: true, earlierCopiesCleared: true }]);
    // Nothing the product keeps beside the archive holds the PIN wrapping or its salt any more:
    // not the copy, not the archive, not its write-ahead log.
    assert.equal(fs.existsSync(pinEraCopy), false);
    assert.deepEqual([...filesHolding(pinLogin.json.encryptedMasterKey), ...filesHolding(pinLogin.json.salt)], []);

    // Every session of the account is retired, including the one that asked.
    for (const cookieHeader of [pinLogin.cookieHeader, unchanged.cookieHeader]) {
        const profile = await request('PUT', '/api/auth/profile', { headers: { Cookie: cookieHeader }, body: { displayName: 'Synthetic' } });
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
    const again = await adoption(passphraseLogin.cookieHeader);
    assert.deepEqual([again.response.status, again.json?.code], [409, 'PASSPHRASE_ALREADY_ADOPTED']);
    const pinSalt = crypto.randomBytes(16);
    const pinBlob = `v2:${wrap(masterKey, crypto.pbkdf2Sync(PIN, pinSalt, PIN_KDF_ITERATIONS[2], 32, 'sha256'))}`;
    const changePin = await request('POST', '/api/auth/change-pin', {
        headers: { Cookie: passphraseLogin.cookieHeader },
        body: { currentPin: PIN, newPin: '97531', encryptedMasterKey: pinBlob, salt: pinSalt.toString('base64') },
    });
    assert.deepEqual([changePin.response.status, changePin.json?.code], [409, 'PIN_CHANGE_PASSPHRASE_ACCOUNT']);
    const rewrap = await request('POST', '/api/auth/rewrap-master-key', {
        headers: { Cookie: passphraseLogin.cookieHeader }, body: { encryptedMasterKey: pinBlob, salt: pinSalt.toString('base64') },
    });
    assert.deepEqual([rewrap.response.status, rewrap.json?.code], [409, 'KDF_REWRAP_NOT_APPLICABLE']);
    const still = await login({ verifier: material.verifier });
    assert.equal(still.json.encryptedMasterKey, unlock.blob);
});

async function check() { return (await request('GET', '/api/auth/check')).json; }
function login(secret) { return loginWithWebAuthControl(BASE_URL, { username: USERNAME, ...secret }); }

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
function recoveryWrapping(masterKey) {
    const recoveryKey = crypto.randomBytes(20);
    const salt = crypto.randomBytes(16);
    const derive = (info) => Buffer.from(crypto.hkdfSync('sha256', recoveryKey, salt, info, 32));
    return { blob: `r1:${wrap(masterKey, derive('mediflow.recovery.kek.v1'))}`, salt: salt.toString('base64'), verifier: derive('mediflow.recovery.verifier.v1').toString('base64') };
}
