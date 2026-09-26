/* @Codex: synthetic real-HTTP Web-cookie and local-v1-token therapy audit/budget proof. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { loginWithWebAuthControl } from './web-auth-control-test-client.mjs';

const baseUrl = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:51804';
const dataDir = process.env.MEDIFLOW_DATA_DIR;
if (!dataDir) throw new Error('Synthetic MEDIFLOW_DATA_DIR required');
const dbPath = path.join(dataDir, 'medical.db');
const token = process.env.MEDIFLOW_LOCAL_API_TOKEN ?? 'mediflow-network-write-smoke-local-token';
const username = process.env.E2E_USERNAME ?? 'admin';
const pin = process.env.E2E_PIN ?? '1234';
const writer = new Database(dbPath);
const observations = [];

after(() => {
    writer.close();
    const report = path.join(dataDir, 'reports', 'therapy-required-audit-http-report.json');
    fs.mkdirSync(path.dirname(report), { recursive: true });
    fs.writeFileSync(report, `${JSON.stringify({ baseUrl, observations }, null, 2)}\n`);
});

async function request(method, pathname, { headers = {}, body, rawBody } = {}) {
    const response = await fetch(new URL(pathname, baseUrl), {
        method, headers: { ...headers, 'content-type': 'application/json' },
        body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)), cache: 'no-store',
    });
    const raw = await response.text();
    let json = null;
    try { json = raw ? JSON.parse(raw) : null; } catch { /* preserve status and raw below */ }
    return { status: response.status, json, raw };
}

function seedPatient(id, ambulatoryId) {
    const now = Math.floor(Date.now() / 1000);
    writer.prepare(`INSERT INTO patients (id, first_name, last_name, tax_code, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)`).run(id, 'Synthetic', 'Therapy', `SYN${id.replaceAll('-', '').slice(0, 11)}`, now, now);
    writer.prepare('INSERT INTO patients_to_ambulatories (patient_id, ambulatory_id) VALUES (?, ?)').run(id, ambulatoryId);
}

function readBack(patientId, therapyId) {
    const fresh = new Database(dbPath, { readonly: true });
    try {
        return {
            patient: fresh.prepare('SELECT * FROM patients WHERE id=?').get(patientId) ?? null,
            membership: fresh.prepare('SELECT * FROM patients_to_ambulatories WHERE patient_id=? ORDER BY ambulatory_id').all(patientId),
            therapies: fresh.prepare('SELECT * FROM therapies WHERE patient_id=? ORDER BY id').all(patientId),
            audit: fresh.prepare("SELECT * FROM audit_events WHERE subject_type='therapy' AND (subject_ref=? OR subject_ref IN (SELECT id FROM therapies WHERE patient_id=?)) ORDER BY rowid").all(therapyId, patientId),
        };
    } finally { fresh.close(); }
}

test('real Web cookie and local v1 token admit therapy writes, enforce 4 MiB and rollback audit faults',
    { skip: process.env.MEDIFLOW_THERAPY_HTTP_ONLY_PAIRED === '1' }, async () => {
    const ready = await request('GET', '/api/v1/ambulatories', { headers: { authorization: `Bearer ${token}` } });
    assert.equal(ready.status, 200);
    const ambulatory = writer.prepare('SELECT id FROM ambulatories WHERE is_default=1 LIMIT 1').get();
    assert.ok(ambulatory);
    const login = await loginWithWebAuthControl(baseUrl, { username, password: pin });
    assert.equal(login.response.status, 200);
    assert.ok(login.cookieHeader);

    for (const surface of ['web', 'v1']) {
        const patientId = randomUUID();
        const therapyId = randomUUID();
        seedPatient(patientId, ambulatory.id);
        const route = surface === 'web' ? '/api/therapies' : `/api/v1/patients/${patientId}/therapies`;
        const headers = surface === 'web'
            ? { Cookie: login.cookieHeader, authorization: `Bearer ${token}`,
                'x-mediflow-source-surface': 'job', 'x-actor-ref': 'synthetic-spoof' }
            : { authorization: `Bearer ${token}` };
        const body = { id: therapyId, ...(surface === 'web' ? { patientId } : {}),
            drugName: 'ENC:synthetic:drug', dosage: 'ENC:synthetic:dose',
            motivation: 'ENC:synthetic:motivation', startDate: '2026-05-02T09:00:00.000Z' };
        const before = readBack(patientId, therapyId);
        const raw = JSON.stringify(body);
        const oversized = `${raw}${' '.repeat(4_194_305 - Buffer.byteLength(raw, 'utf8'))}`;
        const denied = await request('POST', route, { headers, rawBody: oversized });
        assert.equal(denied.status, 413);
        assert.deepEqual(readBack(patientId, therapyId), before);
        const authDenied = await request('POST', route,
            { headers: {}, rawBody: oversized });
        assert.equal(authDenied.status, 401);
        assert.deepEqual(readBack(patientId, therapyId), before);

        const created = await request('POST', route, { headers, body });
        assert.equal(created.status, 201);
        assert.deepEqual(created.json, { id: therapyId, version: 1 });
        const after = readBack(patientId, therapyId);
        assert.equal(after.therapies.length, 1);
        assert.equal(after.audit.length, 1);
        assert.equal(after.audit[0].event_type, 'therapy.created');
        assert.equal(after.audit[0].subject_ref, therapyId);
        assert.equal(after.audit[0].actor_type, surface === 'web' ? 'user' : 'system');
        assert.equal(after.audit[0].source_surface, surface === 'web' ? 'web' : 'api');
        assert.deepEqual(after.patient, before.patient);
        assert.deepEqual(after.membership, before.membership);

        const failedId = randomUUID();
        const failedBody = { ...body, id: failedId };
        const beforeFailure = readBack(patientId, failedId);
        writer.exec("CREATE TRIGGER c05_therapy_http_audit_fail BEFORE INSERT ON audit_events BEGIN SELECT RAISE(FAIL, 'synthetic audit failure'); END");
        try {
            const failed = await request('POST', route, { headers, body: failedBody });
            assert.equal(failed.status, 500);
            assert.deepEqual(readBack(patientId, failedId), beforeFailure);
        } finally { writer.exec('DROP TRIGGER c05_therapy_http_audit_fail'); }
        observations.push({ surface, deniedStatus: denied.status, authDeniedStatus: authDenied.status,
            createStatus: created.status, failedAuditStatus: 500,
            therapyVersion: after.therapies[0].version, auditCount: after.audit.length,
            actorType: after.audit[0].actor_type, sourceSurface: after.audit[0].source_surface });
    }
});

/* @Codex: real paired capability plus Web session, with required-audit failure readback. */
test('real paired therapy create and PUT rollback audit FAIL and IGNORE', async () => {
    const ready = await request('GET', '/api/v1/ambulatories', { headers: { authorization: `Bearer ${token}` } });
    assert.equal(ready.status, 200);
    const ambulatory = writer.prepare('SELECT id FROM ambulatories WHERE is_default=1 LIMIT 1').get();
    assert.ok(ambulatory);
    const homeBase = await request('PUT', '/api/settings/network.mode',
        { headers: { authorization: `Bearer ${token}` }, body: { value: 'network-home-base' } });
    assert.equal(homeBase.status, 200);
    const clinic = await request('PUT', '/api/settings/clinicName',
        { headers: { authorization: `Bearer ${token}` }, body: { value: 'Synthetic Therapy Audit' } });
    assert.equal(clinic.status, 200);
    const login = await loginWithWebAuthControl(baseUrl, { username, password: pin });
    assert.equal(login.response.status, 200);
    assert.ok(login.cookieHeader);

    const intent = await request('POST', '/api/v1/network/pairing-intents', { body: {
        deviceName: 'Synthetic therapy audit client', clientPlatform: 'ipados', appVersion: '0.5.0-test',
        requestedCapabilities: ['network.replica.readonly-patients', 'network.replica.readonly-therapies',
            'network.replica.write-therapies'],
    } });
    assert.equal(intent.status, 201);
    const confirm = await request('POST', `/api/v1/network/pairing-intents/${intent.json?.intentId}/confirm`,
        { headers: { authorization: `Bearer ${token}` } });
    assert.equal(confirm.status, 201);
    const clientId = confirm.json?.pairedClient?.clientId;
    const clientToken = confirm.json?.pairedClientToken;
    assert.ok(clientId && clientToken);
    const headers = { Cookie: login.cookieHeader,
        'x-mediflow-paired-client-id': clientId, 'x-mediflow-paired-client-token': clientToken };

    const patientId = randomUUID();
    const therapyId = randomUUID();
    seedPatient(patientId, ambulatory.id);
    const route = `/api/v1/network/patients/${patientId}/therapies`;
    const body = { id: therapyId, drugName: 'ENC:synthetic:drug', dosage: 'ENC:synthetic:dose',
        motivation: 'ENC:synthetic:motivation', startDate: '2026-05-02T09:00:00.000Z' };
    const created = await request('POST', route, { headers, body });
    assert.equal(created.status, 201);
    assert.deepEqual(created.json, { id: therapyId, version: 1 });
    const afterCreate = readBack(patientId, therapyId);
    assert.equal(afterCreate.therapies.length, 1);
    assert.equal(afterCreate.audit.length, 1);
    assert.equal(afterCreate.audit[0].actor_type, 'user');
    assert.equal(afterCreate.audit[0].source_surface, 'native');
    const metadata = JSON.parse(afterCreate.audit[0].redacted_metadata);
    assert.ok(metadata.flags.includes('auth:paired-client'));
    assert.ok(metadata.flags.includes('scope:ambulatory'));

    for (const fault of ['FAIL', 'IGNORE']) {
        const failedId = randomUUID();
        const beforeCreate = readBack(patientId, failedId);
        writer.exec(`CREATE TRIGGER c05_therapy_paired_audit_fault BEFORE INSERT ON audit_events BEGIN SELECT RAISE(${fault}${fault === 'FAIL' ? ", 'synthetic audit fault'" : ''}); END`);
        try {
            const failedCreate = await request('POST', route, { headers, body: { ...body, id: failedId } });
            assert.equal(failedCreate.status, 500);
            assert.deepEqual(readBack(patientId, failedId), beforeCreate);
            const beforeUpdate = readBack(patientId, therapyId);
            const failedUpdate = await request('PUT', `${route}/${therapyId}`,
                { headers, body: { version: 1, dosage: 'ENC:synthetic:changed-dose' } });
            assert.equal(failedUpdate.status, 500);
            assert.deepEqual(readBack(patientId, therapyId), beforeUpdate);
            observations.push({ surface: 'paired', fault, createStatus: failedCreate.status,
                updateStatus: failedUpdate.status, unchangedAfterEach: true });
        } finally { writer.exec('DROP TRIGGER c05_therapy_paired_audit_fault'); }
    }
    observations.push({ surface: 'paired', positiveCreateStatus: created.status,
        actorType: afterCreate.audit[0].actor_type, sourceSurface: afterCreate.audit[0].source_surface,
        eventCount: afterCreate.audit.length });
});
