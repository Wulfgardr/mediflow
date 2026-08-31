#!/usr/bin/env node
/* @Codex */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { loginWithWebAuthControl } from './web-auth-control-test-client.mjs';

const BASE_URL = process.env.E2E_BASE_URL || 'http://127.0.0.1:3400';
const LOCAL_API_TOKEN = process.env.MEDIFLOW_LOCAL_API_TOKEN || 'mediflow-network-write-smoke-local-token';
const USERNAME = process.env.E2E_USERNAME || 'admin';
const PIN = process.env.E2E_PIN || '1234';
const NEW_PIN = '5678';
const REPORT_PATH = resolveReportPath();
const READ_CAPABILITY = 'network.replica.readonly-patients';
const WRITE_CAPABILITY = 'network.replica.write-patient-lifecycle';
const KDF_ITERATIONS = { 1: 100_000, 2: 600_000 };
const scenarioResults = [];

after(() => {
    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, `${JSON.stringify({ generatedAt: new Date().toISOString(), baseUrl: BASE_URL, scenarios: scenarioResults }, null, 2)}\n`);
    console.log(`[network-home-base-account-pin] Report written to ${REPORT_PATH}`);
});

test('re-wrap master key rejects malformed JSON bodies', async () => {
    await assertServerReady();
    const firstLogin = await login(PIN);
    assert.equal(firstLogin.response.status, 200);

    const rejected = await rewrapMasterKeyWithRawBody(firstLogin.cookie, '{"encryptedMasterKey":');
    assert.equal(rejected.response.status, 400);
    assert.equal(rejected.json?.code, 'KDF_REWRAP_INVALID');

    const loginAfterRejectedRewrap = await login(PIN);
    assert.equal(loginAfterRejectedRewrap.response.status, 200);
    assert.equal(loginAfterRejectedRewrap.json.encryptedMasterKey, firstLogin.json.encryptedMasterKey);
    assert.equal(loginAfterRejectedRewrap.json.salt, firstLogin.json.salt);
});

test('paired account PIN rotation preserves the master key and sealed patient field', async () => {
    await assertServerReady();
    await enableHomeBaseMode();
    const client = await pairClient([READ_CAPABILITY, WRITE_CAPABILITY], 'Desk iPad account PIN smoke');
    const firstLogin = await login(PIN);
    const originalMasterKey = await unwrapMasterKeyVersioned(firstLogin.json.encryptedMasterKey, PIN, firstLogin.json.salt);
    const originalMasterKeyBytes = await exportMasterKey(originalMasterKey);
    const patientId = crypto.randomUUID();
    const sealedNotes = await sealField('account-pin ciphertext survives rewrap', originalMasterKey);

    try {
        const invalidRewrapPayloads = [
            { encryptedMasterKey: 'v2:not base64', salt: firstLogin.json.salt },
            { encryptedMasterKey: `v1:${Buffer.alloc(60, 1).toString('base64')}`, salt: firstLogin.json.salt },
            { encryptedMasterKey: `v2:${Buffer.alloc(60, 1).toString('base64')}`, salt: Buffer.alloc(15, 2).toString('base64') },
            { encryptedMasterKey: `v2:${'A'.repeat(600)}`, salt: firstLogin.json.salt },
        ];
        for (const payload of invalidRewrapPayloads) {
            const rejected = await rewrapMasterKey(firstLogin.cookie, payload);
            assert.equal(rejected.response.status, 400);
            assert.equal(rejected.json?.code, 'KDF_REWRAP_INVALID');
        }
        const loginAfterRejectedRewrap = await login(PIN);
        assert.equal(loginAfterRejectedRewrap.response.status, 200);
        assert.equal(loginAfterRejectedRewrap.json.encryptedMasterKey, firstLogin.json.encryptedMasterKey);
        assert.equal(loginAfterRejectedRewrap.json.salt, firstLogin.json.salt);

        const created = await request('POST', '/api/v1/network/patients', {
            headers: { ...pairedHeaders(client), Cookie: firstLogin.cookie },
            body: patientPayload(patientId, sealedNotes),
        });
        assert.equal(created.response.status, 201);

        const nextSalt = crypto.randomBytes(16);
        const nextBlob = await wrapMasterKeyVersioned(originalMasterKey, NEW_PIN, nextSalt, 2);
        const changed = await changePin(firstLogin.cookie, PIN, NEW_PIN, nextBlob, nextSalt);
        assert.equal(changed.response.status, 200);

        const oldPinLogin = await login(PIN);
        assert.equal(oldPinLogin.response.status, 401);

        const secondLogin = await login(NEW_PIN);
        assert.equal(secondLogin.response.status, 200, 'new PIN must authenticate immediately after old PIN failure');
        assert.equal(secondLogin.json.encryptedMasterKey, nextBlob);
        assert.ok(secondLogin.json.encryptedMasterKey.startsWith('v2:'));
        const reloadedMasterKey = await unwrapMasterKeyVersioned(secondLogin.json.encryptedMasterKey, NEW_PIN, secondLogin.json.salt);
        assert.deepEqual(await exportMasterKey(reloadedMasterKey), originalMasterKeyBytes);

        const detail = await request('GET', `/api/v1/network/patients/${patientId}`, {
            headers: { ...pairedHeaders(client), Cookie: secondLogin.cookie },
        });
        assert.equal(detail.response.status, 200);
        assert.equal(detail.json?.notes, sealedNotes);
        assert.equal(await openField(detail.json.notes, reloadedMasterKey), 'account-pin ciphertext survives rewrap');

        const raceA = { pin: '6789', salt: crypto.randomBytes(16) };
        const raceB = { pin: '7890', salt: crypto.randomBytes(16) };
        raceA.blob = await wrapMasterKeyVersioned(reloadedMasterKey, raceA.pin, raceA.salt, 2);
        raceB.blob = await wrapMasterKeyVersioned(reloadedMasterKey, raceB.pin, raceB.salt, 2);
        const [changeA, changeB] = await Promise.all([
            changePin(secondLogin.cookie, NEW_PIN, raceA.pin, raceA.blob, raceA.salt),
            changePin(secondLogin.cookie, NEW_PIN, raceB.pin, raceB.blob, raceB.salt),
        ]);
        const raceResponses = [changeA, changeB];
        assert.equal(raceResponses.filter(({ response }) => response.status === 200).length, 1);
        assert.equal(
            raceResponses.filter(({ response, json }) => response.status === 409 && json?.code === 'PIN_CHANGE_CONFLICT').length,
            1,
            `Expected one PIN_CHANGE_CONFLICT response, got ${JSON.stringify(raceResponses.map(({ response, json }) => ({ status: response.status, json })) )}`,
        );
        const winner = changeA.response.status === 200 ? raceA : raceB;
        const winnerLogin = await login(winner.pin);
        assert.equal(winnerLogin.response.status, 200);
        assert.equal(winnerLogin.json.encryptedMasterKey, winner.blob);

        const profileName = `Account Pin Smoke ${patientId.slice(0, 8)}`;
        const profile = await request('PUT', '/api/auth/profile', {
            headers: { Cookie: winnerLogin.cookie },
            body: { id: winnerLogin.json.id, displayName: profileName, ambulatoryName: 'Account PIN Ambulatory' },
        });
        assert.equal(profile.response.status, 200);
        const identity = await request('GET', '/api/v1/network/identity', {
            headers: { ...pairedHeaders(client), Cookie: winnerLogin.cookie },
        });
        assert.equal(identity.response.status, 200);
        assert.equal(identity.json?.operator?.displayName, profileName);

        scenarioResults.push({ name: 'account PIN rotation', patientId, changePinStatus: changed.response.status, oldPinStatus: oldPinLogin.response.status, newPinStatus: secondLogin.response.status, raceStatuses: raceResponses.map(({ response }) => response.status), profileStatus: profile.response.status, identityStatus: identity.response.status });
    } finally {
        await cleanupPatient(patientId);
    }
});

async function assertServerReady() { const result = await request('GET', '/api/v1/ambulatories', { headers: localApiHeaders() }); assert.equal(result.response.status, 200); }
async function enableHomeBaseMode() { const result = await request('PUT', '/api/settings/network.mode', { headers: localApiHeaders(), body: { value: 'network-home-base' } }); assert.equal(result.response.status, 200); }
async function login(pin) { const result = await loginWithWebAuthControl(BASE_URL, { username: USERNAME, password: pin }); return { ...result, cookie: result.response.status === 200 ? result.sessionCookie : null }; }
async function changePin(cookie, currentPin, newPin, blob, salt) { return request('POST', '/api/auth/change-pin', { headers: { Cookie: cookie }, body: { currentPin, newPin, encryptedMasterKey: blob, salt: salt.toString('base64') } }); }
async function rewrapMasterKey(cookie, body) { return request('POST', '/api/auth/rewrap-master-key', { headers: { Cookie: cookie }, body }); }
async function rewrapMasterKeyWithRawBody(cookie, body) { const response = await fetch(new URL('/api/auth/rewrap-master-key', BASE_URL), { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body }); const text = await response.text(); let json = null; try { json = text ? JSON.parse(text) : null; } catch { json = text; } return { response, json, text }; }
async function pairClient(requestedCapabilities, deviceName) { const intent = await request('POST', '/api/v1/network/pairing-intents', { body: { deviceName, clientPlatform: 'ipados', appVersion: '0.7.1-smoke', requestedCapabilities } }); assert.equal(intent.response.status, 201); const confirmed = await request('POST', `/api/v1/network/pairing-intents/${intent.json.intentId}/confirm`, { headers: localApiHeaders() }); assert.equal(confirmed.response.status, 201); return { pairedClientId: confirmed.json.pairedClient.clientId, pairedClientToken: confirmed.json.pairedClientToken }; }
function patientPayload(id, notes) { const suffix = id.replace(/-/g, '').slice(0, 13).toUpperCase(); return { id, firstName: 'Account', lastName: 'Pin', taxCode: `ACP${suffix}`, notes, isAdi: false }; }
async function cleanupPatient(patientId) { const detail = await request('GET', `/api/v1/patients/${patientId}`, { headers: localApiHeaders() }); if (detail.response.status === 200) { const deleted = await request('DELETE', `/api/v1/patients/${patientId}`, { headers: localApiHeaders(), body: { version: detail.json.version } }); assert.equal(deleted.response.status, 200); } }
async function wrapMasterKeyVersioned(masterKey, pin, salt, version) { return `v${version}:${await wrapMasterKey(masterKey, await deriveKek(pin, salt, version))}`; }
async function unwrapMasterKeyVersioned(blob, pin, saltB64) { const match = /^v(\d+):(.*)$/.exec(blob); const version = match ? Number(match[1]) : 1; return unwrapMasterKey(match ? match[2] : blob, await deriveKek(pin, Buffer.from(saltB64, 'base64'), version)); }
async function deriveKek(pin, salt, version) { const material = await crypto.webcrypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveKey']); return crypto.webcrypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: KDF_ITERATIONS[version], hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']); }
async function wrapMasterKey(masterKey, kek) { const raw = await crypto.webcrypto.subtle.exportKey('raw', masterKey); const iv = crypto.randomBytes(12); const encrypted = await crypto.webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, kek, raw); return Buffer.concat([iv, Buffer.from(encrypted)]).toString('base64'); }
async function unwrapMasterKey(blob, kek) { const payload = Buffer.from(blob, 'base64'); const raw = await crypto.webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: payload.subarray(0, 12) }, kek, payload.subarray(12)); return crypto.webcrypto.subtle.importKey('raw', raw, 'AES-GCM', true, ['encrypt', 'decrypt']); }
async function exportMasterKey(masterKey) { return Buffer.from(await crypto.webcrypto.subtle.exportKey('raw', masterKey)); }
async function sealField(value, masterKey) { const iv = crypto.randomBytes(12); const encrypted = await crypto.webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, masterKey, new TextEncoder().encode(JSON.stringify(value))); return `ENC:${iv.toString('base64')}:${Buffer.from(encrypted).toString('base64')}`; }
async function openField(value, masterKey) { const [, iv, data] = value.split(':'); const plaintext = await crypto.webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(iv, 'base64') }, masterKey, Buffer.from(data, 'base64')); return JSON.parse(new TextDecoder().decode(plaintext)); }
function localApiHeaders() { return { Authorization: `Bearer ${LOCAL_API_TOKEN}`, 'Cache-Control': 'no-store' }; }
function pairedHeaders(client) { return { 'x-mediflow-paired-client-id': client.pairedClientId, 'x-mediflow-paired-client-token': client.pairedClientToken }; }
async function request(method, pathname, { headers = {}, body } = {}) { const finalHeaders = { ...headers }; if (body !== undefined) finalHeaders['Content-Type'] = 'application/json'; const response = await fetch(new URL(pathname, BASE_URL), { method, headers: finalHeaders, body: body === undefined ? undefined : JSON.stringify(body) }); const text = await response.text(); let json = null; try { json = text ? JSON.parse(text) : null; } catch { json = text; } return { response, json, text }; }
function resolveReportPath() { const dataDir = process.env.MEDIFLOW_DATA_DIR || process.env.MEDIFLOW_NETWORK_WRITE_DATA_DIR; return dataDir ? path.join(dataDir, 'reports', 'network-home-base-account-pin-report.json') : path.join(process.cwd(), 'tmp-network-home-base-account-pin-report.json'); }
