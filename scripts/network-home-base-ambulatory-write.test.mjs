#!/usr/bin/env node
/* @Codex */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';

const BASE_URL = process.env.E2E_BASE_URL || 'http://127.0.0.1:3400';
const LOCAL_API_TOKEN = process.env.MEDIFLOW_LOCAL_API_TOKEN || 'mediflow-network-write-smoke-local-token';
const USERNAME = process.env.E2E_USERNAME || 'admin';
const PIN = process.env.E2E_PIN || '1234';
const REPORT_PATH = resolveReportPath();
const READ_CAPABILITY = 'network.replica.readonly-patients';
const WRITE_CAPABILITY = 'network.ambulatories.write';
const scenarioResults = [];

after(() => { fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true }); fs.writeFileSync(REPORT_PATH, `${JSON.stringify({ generatedAt: new Date().toISOString(), baseUrl: BASE_URL, scenarios: scenarioResults }, null, 2)}\n`); console.log(`[network-home-base-ambulatory-write] Report written to ${REPORT_PATH}`); });

test('paired ambulatory write preserves capability, concurrency, default, delete, and clear guards', async () => {
    await assertServerReady(); await enableHomeBaseMode();
    const reader = await pairClient([READ_CAPABILITY], 'Desk iPad ambulatory readonly');
    const writer = await pairClient([READ_CAPABILITY, WRITE_CAPABILITY], 'Desk iPad ambulatory writer');
    const login = await request('POST', '/api/auth/login', { body: { username: USERNAME, password: PIN } });
    assert.equal(login.response.status, 200); const cookie = extractSessionCookie(login.response);
    const createdIds = []; const intentionallyGuardedIds = new Set(); let linkedPatientId = null;
    try {
        const denied = await request('POST', '/api/v1/network/ambulatories', { headers: { ...pairedHeaders(reader), Cookie: cookie }, body: { name: 'Denied' } }); assert.equal(denied.response.status, 403);
        const missingSession = await request('POST', '/api/v1/network/ambulatories', { headers: pairedHeaders(writer), body: { name: 'No session' } }); assert.equal(missingSession.response.status, 401);
        const first = await create(writer, cookie, { name: 'S3 Test A', type: 'test' }); createdIds.push(first.json.id); assert.equal(first.response.status, 201); assert.equal(first.json.version, 1);
        const update = await mutate('PUT', `/api/v1/network/ambulatories/${first.json.id}`, writer, cookie, { version: 1, description: 'updated' }); assert.equal(update.response.status, 200); assert.equal(update.json.version, 2);
        const stale = await mutate('PUT', `/api/v1/network/ambulatories/${first.json.id}`, writer, cookie, { version: 1, description: 'stale' }); assert.equal(stale.response.status, 409); assert.equal(stale.json.code, 'VERSION_CONFLICT');
        const beforeDefault = (await list(writer, cookie)).json.find((row) => row.isDefault); assert.ok(beforeDefault?.id);
        const second = await create(writer, cookie, { name: 'S3 Test B', type: 'test' }); createdIds.push(second.json.id); assert.equal(second.response.status, 201);
        const promote = await mutate('PUT', `/api/v1/network/ambulatories/${second.json.id}`, writer, cookie, { version: 1, isDefault: true }); assert.equal(promote.response.status, 200); assert.ok(promote.json.affectedAmbulatories.some((row) => row.id === beforeDefault.id && row.version === beforeDefault.version + 1));
        const unsetDefault = await mutate('PUT', `/api/v1/network/ambulatories/${second.json.id}`, writer, cookie, { version: 2, isDefault: false }); assert.equal(unsetDefault.response.status, 409);
        const linked = await create(writer, cookie, { name: 'S3 Linked', type: 'live' }); createdIds.push(linked.json.id); intentionallyGuardedIds.add(linked.json.id);
        linkedPatientId = await createLocalPatient(linked.json.id);
        const linkedDelete = await mutate('DELETE', `/api/v1/network/ambulatories/${linked.json.id}`, writer, cookie, { version: 1 }); assert.equal(linkedDelete.response.status, 409);
        const free = await create(writer, cookie, { name: 'S3 Free', type: 'live' }); createdIds.push(free.json.id);
        const freeDelete = await mutate('DELETE', `/api/v1/network/ambulatories/${free.json.id}`, writer, cookie, { version: 1 }); assert.equal(freeDelete.response.status, 200); createdIds.splice(createdIds.indexOf(free.json.id), 1);
        const clearTest = await mutate('POST', '/api/v1/network/ambulatories/clear', writer, cookie, { ambulatoryId: first.json.id, version: 2 }); assert.equal(clearTest.response.status, 200); assert.equal(clearTest.json.version, 3);
        const live = await create(writer, cookie, { name: 'S3 Live', type: 'live' }); createdIds.push(live.json.id);
        const clearLive = await mutate('POST', '/api/v1/network/ambulatories/clear', writer, cookie, { ambulatoryId: live.json.id, version: 1 }); assert.equal(clearLive.response.status, 403);
        scenarioResults.push({ name: 'paired ambulatory write', deniedStatus: denied.response.status, missingSessionStatus: missingSession.response.status, staleStatus: stale.response.status, unsetDefaultStatus: unsetDefault.response.status, linkedDeleteStatus: linkedDelete.response.status, freeDeleteStatus: freeDelete.response.status, clearTestStatus: clearTest.response.status, clearLiveStatus: clearLive.response.status });
    } finally { if (linkedPatientId) await cleanupPatient(linkedPatientId); for (const id of createdIds.reverse()) await cleanupAmbulatory(id, writer, cookie, intentionallyGuardedIds); }
});

async function assertServerReady() { const result = await request('GET', '/api/v1/ambulatories', { headers: localApiHeaders() }); assert.equal(result.response.status, 200); }
async function enableHomeBaseMode() { const result = await request('PUT', '/api/settings/network.mode', { headers: localApiHeaders(), body: { value: 'network-home-base' } }); assert.equal(result.response.status, 200); }
async function pairClient(requestedCapabilities, deviceName) { const intent = await request('POST', '/api/v1/network/pairing-intents', { body: { deviceName, clientPlatform: 'ipados', appVersion: '0.7.1-smoke', requestedCapabilities } }); assert.equal(intent.response.status, 201); const confirmed = await request('POST', `/api/v1/network/pairing-intents/${intent.json.intentId}/confirm`, { headers: localApiHeaders() }); assert.equal(confirmed.response.status, 201); return { pairedClientId: confirmed.json.pairedClient.clientId, pairedClientToken: confirmed.json.pairedClientToken }; }
async function create(client, cookie, body) { return mutate('POST', '/api/v1/network/ambulatories', client, cookie, body); }
async function list(client, cookie) { return request('GET', '/api/v1/network/ambulatories', { headers: { ...pairedHeaders(client), Cookie: cookie } }); }
async function mutate(method, pathname, client, cookie, body) { return request(method, pathname, { headers: { ...pairedHeaders(client), Cookie: cookie }, body }); }
async function createLocalPatient(ambulatoryId) { const id = crypto.randomUUID(); const suffix = id.replace(/-/g, '').slice(0, 13).toUpperCase(); const created = await request('POST', '/api/v1/patients', { headers: localApiHeaders(), body: { id, firstName: 'Ambulatory', lastName: 'Membership', taxCode: `AMB${suffix}`, ambulatoryId, isAdi: false } }); assert.equal(created.response.status, 201); return id; }
async function cleanupPatient(id) { const detail = await request('GET', `/api/v1/patients/${id}`, { headers: localApiHeaders() }); if (detail.response.status === 200) { const deleted = await request('DELETE', `/api/v1/patients/${id}`, { headers: localApiHeaders(), body: { version: detail.json.version } }); assert.equal(deleted.response.status, 200); } }
async function cleanupAmbulatory(id, client, cookie, intentionallyGuardedIds) { if (intentionallyGuardedIds.has(id)) return; const rows = await list(client, cookie); const row = rows.json?.find((item) => item.id === id); if (!row || row.isDefault) return; const deleted = await mutate('DELETE', `/api/v1/network/ambulatories/${id}`, client, cookie, { version: row.version }); assert.equal(deleted.response.status, 200); }
function localApiHeaders() { return { Authorization: `Bearer ${LOCAL_API_TOKEN}`, 'Cache-Control': 'no-store' }; }
function pairedHeaders(client) { return { 'x-mediflow-paired-client-id': client.pairedClientId, 'x-mediflow-paired-client-token': client.pairedClientToken }; }
function extractSessionCookie(response) { const cookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : []; const raw = cookies.find((entry) => entry.startsWith('mediflow_session=')) ?? response.headers.get('set-cookie'); assert.ok(raw, 'login must set mediflow_session'); return raw.split(';')[0]; }
async function request(method, pathname, { headers = {}, body } = {}) { const finalHeaders = { ...headers }; if (body !== undefined) finalHeaders['Content-Type'] = 'application/json'; const response = await fetch(new URL(pathname, BASE_URL), { method, headers: finalHeaders, body: body === undefined ? undefined : JSON.stringify(body) }); const text = await response.text(); let json = null; try { json = text ? JSON.parse(text) : null; } catch { json = text; } return { response, json, text }; }
function resolveReportPath() { const dataDir = process.env.MEDIFLOW_DATA_DIR || process.env.MEDIFLOW_NETWORK_WRITE_DATA_DIR; return dataDir ? path.join(dataDir, 'reports', 'network-home-base-ambulatory-write-report.json') : path.join(process.cwd(), 'tmp-network-home-base-ambulatory-write-report.json'); }
