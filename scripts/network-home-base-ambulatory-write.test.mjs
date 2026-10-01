#!/usr/bin/env node
/* @Codex */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { loginWithWebAuthControl } from './web-auth-control-test-client.mjs';

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
    const login = await loginWithWebAuthControl(BASE_URL, { username: USERNAME, password: PIN });
    assert.equal(login.response.status, 200); const cookieHeader = login.cookieHeader;
    assert.ok(cookieHeader, 'Operator login must set session and auth-control cookies');
    const createdIds = []; const intentionallyGuardedIds = new Set(); let linkedPatientId = null;
    try {
        const denied = await request('POST', '/api/v1/network/ambulatories', { headers: { ...pairedHeaders(reader), Cookie: cookieHeader }, body: { name: 'Denied' } }); assert.equal(denied.response.status, 403);
        const missingSession = await request('POST', '/api/v1/network/ambulatories', { headers: pairedHeaders(writer), body: { name: 'No session' } }); assert.equal(missingSession.response.status, 401);
        const first = await create(writer, cookieHeader, { name: 'S3 Test A', type: 'test' }); createdIds.push(first.json.id); assert.equal(first.response.status, 201); assert.equal(first.json.version, 1);
        const update = await mutate('PUT', `/api/v1/network/ambulatories/${first.json.id}`, writer, cookieHeader, { version: 1, description: 'updated' }); assert.equal(update.response.status, 200); assert.equal(update.json.version, 2);
        const stale = await mutate('PUT', `/api/v1/network/ambulatories/${first.json.id}`, writer, cookieHeader, { version: 1, description: 'stale' }); assert.equal(stale.response.status, 409); assert.equal(stale.json.code, 'VERSION_CONFLICT');
        const beforeDefault = (await list(writer, cookieHeader)).json.find((row) => row.isDefault); assert.ok(beforeDefault?.id);
        const second = await create(writer, cookieHeader, { name: 'S3 Test B', type: 'test' }); createdIds.push(second.json.id); assert.equal(second.response.status, 201);
        const promote = await mutate('PUT', `/api/v1/network/ambulatories/${second.json.id}`, writer, cookieHeader, { version: 1, isDefault: true }); assert.equal(promote.response.status, 200); assert.ok(promote.json.affectedAmbulatories.some((row) => row.id === beforeDefault.id && row.version === beforeDefault.version + 1));
        const unsetDefault = await mutate('PUT', `/api/v1/network/ambulatories/${second.json.id}`, writer, cookieHeader, { version: 2, isDefault: false }); assert.equal(unsetDefault.response.status, 409);
        const linked = await create(writer, cookieHeader, { name: 'S3 Linked', type: 'live' }); createdIds.push(linked.json.id); intentionallyGuardedIds.add(linked.json.id);
        linkedPatientId = await createLocalPatient(linked.json.id);
        const linkedDelete = await mutate('DELETE', `/api/v1/network/ambulatories/${linked.json.id}`, writer, cookieHeader, { version: 1 }); assert.equal(linkedDelete.response.status, 409);
        const free = await create(writer, cookieHeader, { name: 'S3 Free', type: 'live' }); createdIds.push(free.json.id);
        const freeDelete = await mutate('DELETE', `/api/v1/network/ambulatories/${free.json.id}`, writer, cookieHeader, { version: 1 }); assert.equal(freeDelete.response.status, 200); createdIds.splice(createdIds.indexOf(free.json.id), 1);
        const clearTest = await mutate('POST', '/api/v1/network/ambulatories/clear', writer, cookieHeader, { ambulatoryId: first.json.id, version: 2 }); assert.equal(clearTest.response.status, 200); assert.equal(clearTest.json.version, 3);
        const live = await create(writer, cookieHeader, { name: 'S3 Live', type: 'live' }); createdIds.push(live.json.id);
        const clearLive = await mutate('POST', '/api/v1/network/ambulatories/clear', writer, cookieHeader, { ambulatoryId: live.json.id, version: 1 }); assert.equal(clearLive.response.status, 403);
        scenarioResults.push({ name: 'paired ambulatory write', deniedStatus: denied.response.status, missingSessionStatus: missingSession.response.status, staleStatus: stale.response.status, unsetDefaultStatus: unsetDefault.response.status, linkedDeleteStatus: linkedDelete.response.status, freeDeleteStatus: freeDelete.response.status, clearTestStatus: clearTest.response.status, clearLiveStatus: clearLive.response.status });
    } finally { if (linkedPatientId) await cleanupPatient(linkedPatientId); for (const id of createdIds.reverse()) await cleanupAmbulatory(id, writer, cookieHeader, intentionallyGuardedIds); }
});

/* @Codex: admitted paired HTTP must roll back both default changes and clear batches. */
test('paired ambulatory audit failures roll back indirect defaults and patient clear before explicit retry',
    { skip: process.env.MF085_SYNTHETIC_E2E !== '1' }, async () => {
    const dataDir = process.env.MEDIFLOW_DATA_DIR;
    const url = new URL(BASE_URL);
    assert.ok(dataDir && path.isAbsolute(dataDir) && url.hostname === '127.0.0.1' && url.port && url.port !== '3000', 'Dedicated synthetic server required');
    await enableHomeBaseMode();
    const writer = await pairClient([READ_CAPABILITY, WRITE_CAPABILITY], 'Synthetic ambulatory integrity');
    const login = await loginWithWebAuthControl(BASE_URL, { username: USERNAME, password: PIN });
    assert.equal(login.response.status, 200);
    const cookie = login.cookieHeader;
    const sql = new Database(path.join(dataDir, 'medical.db'), { fileMustExist: true });
    const snapshot = () => ({
        ambulatories: sql.prepare('SELECT * FROM ambulatories ORDER BY id').all(),
        patients: sql.prepare('SELECT id, version, deleted_at FROM patients ORDER BY id').all(),
        memberships: sql.prepare('SELECT * FROM patients_to_ambulatories ORDER BY patient_id, ambulatory_id').all(),
        events: sql.prepare("SELECT event_type, subject_ref, actor_ref, source_surface, redacted_metadata FROM audit_events WHERE event_type LIKE 'ambulatory.%' OR event_type='patient.deleted' ORDER BY rowid").all(),
    });
    try {
        const before = snapshot();
        sql.exec("CREATE TRIGGER synthetic_paired_ambulatory_audit BEFORE INSERT ON audit_events WHEN NEW.event_type='ambulatory.created' BEGIN SELECT RAISE(IGNORE); END");
        const rejected = await create(writer, cookie, { name: 'Synthetic rollback default', type: 'test', isDefault: true });
        assert.equal(rejected.response.status, 500); assert.deepEqual(snapshot(), before);
        sql.exec('DROP TRIGGER synthetic_paired_ambulatory_audit');
        const accepted = await create(writer, cookie, { name: 'Synthetic accepted default', type: 'test', isDefault: true });
        assert.equal(accepted.response.status, 201);
        const id = accepted.json.id;
        const afterCreate = snapshot();
        const createEvents = afterCreate.events.slice(before.events.length);
        assert.deepEqual(createEvents.map(event => event.event_type).sort(), ['ambulatory.created', 'ambulatory.updated']);
        assert.equal(afterCreate.ambulatories.filter(row => row.is_default === 1).length, 1);
        assert.equal(afterCreate.ambulatories.find(row => row.is_default === 1).id, id);
        const firstPatient = await createLocalPatient(id);
        const secondPatient = await createLocalPatient(id);
        const beforeClear = snapshot();
        sql.exec("CREATE TRIGGER synthetic_paired_ambulatory_audit BEFORE INSERT ON audit_events WHEN NEW.event_type='ambulatory.cleared' BEGIN SELECT RAISE(FAIL, 'synthetic final audit failure'); END");
        const failedClear = await mutate('POST', '/api/v1/network/ambulatories/clear', writer, cookie, { ambulatoryId: id, version: 1 });
        assert.equal(failedClear.response.status, 500); assert.deepEqual(snapshot(), beforeClear);
        sql.exec('DROP TRIGGER synthetic_paired_ambulatory_audit');
        const acceptedClear = await mutate('POST', '/api/v1/network/ambulatories/clear', writer, cookie, { ambulatoryId: id, version: 1 });
        assert.equal(acceptedClear.response.status, 200); assert.equal(acceptedClear.json.version, 2);
        const afterClear = snapshot();
        for (const patientId of [firstPatient, secondPatient]) {
            const row = afterClear.patients.find(patient => patient.id === patientId);
            assert.ok(row.deleted_at); assert.equal(row.version, 2);
        }
        assert.equal(afterClear.memberships.some(row => row.ambulatory_id === id), false);
        const clearEvents = afterClear.events.slice(beforeClear.events.length);
        assert.deepEqual(clearEvents.map(event => event.event_type).sort(), ['ambulatory.cleared', 'patient.deleted', 'patient.deleted']);
        assert.ok([...createEvents, ...clearEvents].every(event => event.source_surface === 'native'));
        const stale = await mutate('POST', '/api/v1/network/ambulatories/clear', writer, cookie, { ambulatoryId: id, version: 1 });
        assert.equal(stale.response.status, 409); assert.deepEqual(snapshot(), afterClear);
        const reread = await list(writer, cookie); assert.equal(reread.response.status, 200);
        assert.equal(reread.json.find(row => row.id === id).version, 2);
        scenarioResults.push({ name: 'paired atomic default and clear', createFailure: rejected.response.status, clearFailure: failedClear.response.status, retry: acceptedClear.response.status, stale: stale.response.status, createEvents, clearEvents });
    } finally { sql.exec('DROP TRIGGER IF EXISTS synthetic_paired_ambulatory_audit'); sql.close(); }
});

async function assertServerReady() { const result = await request('GET', '/api/v1/ambulatories', { headers: localApiHeaders() }); assert.equal(result.response.status, 200); }
async function enableHomeBaseMode() { const result = await request('PUT', '/api/settings/network.mode', { headers: localApiHeaders(), body: { value: 'network-home-base' } }); assert.equal(result.response.status, 200); }
async function pairClient(requestedCapabilities, deviceName) { const intent = await request('POST', '/api/v1/network/pairing-intents', { body: { deviceName, clientPlatform: 'ipados', appVersion: '0.7.1-smoke', requestedCapabilities } }); assert.equal(intent.response.status, 201); const confirmed = await request('POST', `/api/v1/network/pairing-intents/${intent.json.intentId}/confirm`, { headers: localApiHeaders() }); assert.equal(confirmed.response.status, 201); return { pairedClientId: confirmed.json.pairedClient.clientId, pairedClientToken: confirmed.json.pairedClientToken }; }
async function create(client, cookieHeader, body) { return mutate('POST', '/api/v1/network/ambulatories', client, cookieHeader, body); }
async function list(client, cookieHeader) { return request('GET', '/api/v1/network/ambulatories', { headers: { ...pairedHeaders(client), Cookie: cookieHeader } }); }
async function mutate(method, pathname, client, cookieHeader, body) { return request(method, pathname, { headers: { ...pairedHeaders(client), Cookie: cookieHeader }, body }); }
async function createLocalPatient(ambulatoryId) { const id = crypto.randomUUID(); const suffix = id.replace(/-/g, '').slice(0, 13).toUpperCase(); const created = await request('POST', '/api/v1/patients', { headers: localApiHeaders(), body: { id, firstName: 'Ambulatory', lastName: 'Membership', taxCode: `AMB${suffix}`, ambulatoryId, isAdi: false } }); assert.equal(created.response.status, 201); return id; }
async function cleanupPatient(id) { const detail = await request('GET', `/api/v1/patients/${id}`, { headers: localApiHeaders() }); if (detail.response.status === 200) { const deleted = await request('DELETE', `/api/v1/patients/${id}`, { headers: localApiHeaders(), body: { version: detail.json.version } }); assert.equal(deleted.response.status, 200); } }
async function cleanupAmbulatory(id, client, cookieHeader, intentionallyGuardedIds) { if (intentionallyGuardedIds.has(id)) return; const rows = await list(client, cookieHeader); const row = rows.json?.find((item) => item.id === id); if (!row || row.isDefault) return; const deleted = await mutate('DELETE', `/api/v1/network/ambulatories/${id}`, client, cookieHeader, { version: row.version }); assert.equal(deleted.response.status, 200); }
function localApiHeaders() { return { Authorization: `Bearer ${LOCAL_API_TOKEN}`, 'Cache-Control': 'no-store' }; }
function pairedHeaders(client) { return { 'x-mediflow-paired-client-id': client.pairedClientId, 'x-mediflow-paired-client-token': client.pairedClientToken }; }
async function request(method, pathname, { headers = {}, body } = {}) { const finalHeaders = { ...headers }; if (body !== undefined) finalHeaders['Content-Type'] = 'application/json'; const response = await fetch(new URL(pathname, BASE_URL), { method, headers: finalHeaders, body: body === undefined ? undefined : JSON.stringify(body) }); const text = await response.text(); let json = null; try { json = text ? JSON.parse(text) : null; } catch { json = text; } return { response, json, text }; }
function resolveReportPath() { const dataDir = process.env.MEDIFLOW_DATA_DIR || process.env.MEDIFLOW_NETWORK_WRITE_DATA_DIR; return dataDir ? path.join(dataDir, 'reports', 'network-home-base-ambulatory-write-report.json') : path.join(process.cwd(), 'tmp-network-home-base-ambulatory-write-report.json'); }
