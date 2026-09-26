/* @Codex: C05 synthetic real HTTP admin restore; no auth seam or production DB. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { loginWithWebAuthControl } from './web-auth-control-test-client.mjs';

const baseUrl = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3505';
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
    const report = path.join(dataDir, 'reports', 'patient-restore-required-audit-http-report.json');
    fs.mkdirSync(path.dirname(report), { recursive: true });
    fs.writeFileSync(report, `${JSON.stringify({ baseUrl, observations }, null, 2)}\n`);
});

async function request(method, pathname, { headers = {}, body, rawBody } = {}) {
    const response = await fetch(new URL(pathname, baseUrl), {
        method,
        headers: { ...headers, ...(body === undefined && rawBody === undefined ? {} : { 'content-type': 'application/json' }) },
        body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
        cache: 'no-store',
    });
    const raw = await response.text();
    let json = null;
    try { json = raw ? JSON.parse(raw) : null; } catch { /* status is still authoritative */ }
    return { response, json };
}

function seedPatient(id, ambulatoryId) {
    const now = Math.floor(Date.now() / 1000);
    writer.transaction(() => {
        writer.prepare(`INSERT INTO patients
            (id, first_name, last_name, tax_code, version, ambulatory_id, is_archived, deleted_at,
             deletion_reason, notes, created_at, updated_at)
            VALUES (?, ?, ?, ?, 3, ?, 1, ?, ?, ?, ?, ?)`).run(
            id, 'Ada', 'Sintetica', `SYN${id.replaceAll('-', '').slice(0, 11)}`, ambulatoryId,
            now - 100, 'ENC:synthetic:reason', 'ENC:synthetic:notes', now - 200, now - 200,
        );
        writer.prepare('INSERT INTO patients_to_ambulatories (patient_id, ambulatory_id) VALUES (?, ?)')
            .run(id, ambulatoryId);
        writer.prepare('INSERT INTO entries (id, patient_id, type, title, date, content) VALUES (?, ?, ?, ?, ?, ?)')
            .run(`${id}-entry`, id, 'note', 'Voce sintetica', now - 150, 'ENC:synthetic:entry');
    })();
}

function readBack(id) {
    const reopened = new Database(dbPath, { readonly: true });
    try {
        return {
            patient: reopened.prepare('SELECT * FROM patients WHERE id=?').get(id) ?? null,
            memberships: reopened.prepare('SELECT * FROM patients_to_ambulatories WHERE patient_id=? ORDER BY ambulatory_id').all(id),
            entries: reopened.prepare('SELECT * FROM entries WHERE patient_id=? ORDER BY id').all(id),
            audit: reopened.prepare('SELECT * FROM audit_events WHERE subject_ref=? ORDER BY rowid').all(id),
        };
    } finally { reopened.close(); }
}

function assertRestored(before, after, id, userId) {
    assert.deepEqual(after.patient, { ...before.patient, version: 4, deleted_at: null,
        deletion_reason: null, updated_at: after.patient.updated_at });
    assert.deepEqual(after.memberships, before.memberships);
    assert.deepEqual(after.entries, before.entries);
    assert.equal(after.audit.length, 1);
    const event = after.audit[0];
    assert.equal(event.event_type, 'patient.restored');
    assert.equal(event.outcome, 'success');
    assert.equal(event.actor_type, 'user');
    assert.equal(event.actor_ref, userId);
    assert.equal(event.source_surface, 'web');
    assert.equal(event.subject_ref, id);
    assert.deepEqual(JSON.parse(event.redacted_metadata), {
        changedFields: ['deletedAt', 'deletionReason'], flags: ['auth:session'], resourceVersion: 4,
    });
}

test('real cookie Web-admin restore ignores bearer spoof, serializes contention, and rejects token-only', async () => {
    const ready = await request('GET', '/api/v1/ambulatories', { headers: { authorization: `Bearer ${token}` } });
    assert.equal(ready.response.status, 200);
    const ambulatory = writer.prepare('SELECT id FROM ambulatories WHERE is_default=1 LIMIT 1').get();
    assert.ok(ambulatory);
    const user = writer.prepare('SELECT id FROM users WHERE username=?').get(username);
    assert.ok(user);
    const login = await loginWithWebAuthControl(baseUrl, { username, password: pin });
    assert.equal(login.response.status, 200);
    assert.ok(login.cookieHeader);
    const webHeaders = { Cookie: login.cookieHeader, authorization: `Bearer ${token}`,
        'x-mediflow-source-surface': 'job', 'x-actor-ref': 'spoofed-actor' };
    const firstId = randomUUID();
    seedPatient(firstId, ambulatory.id);
    const before = readBack(firstId);

    const tokenOnly = await request('POST', '/api/system/restore-patient', {
        headers: { authorization: `Bearer ${token}` }, body: { patientId: firstId },
    });
    assert.equal(tokenOnly.response.status, 401);
    assert.deepEqual(readBack(firstId), before);
    const tokenOnlyList = await request('GET', '/api/system/restore-patient', {
        headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(tokenOnlyList.response.status, 401);
    const invalid = await request('POST', '/api/system/restore-patient', { headers: webHeaders, rawBody: 'null' });
    assert.equal(invalid.response.status, 400);
    assert.deepEqual(readBack(firstId), before);
    const validEnvelope = JSON.stringify({ patientId: firstId });
    const oversizedBody = `${validEnvelope}${' '.repeat(65_537 - Buffer.byteLength(validEnvelope, 'utf8'))}`;
    assert.equal(Buffer.byteLength(oversizedBody, 'utf8'), 65_537);
    const oversized = await request('POST', '/api/system/restore-patient', {
        headers: webHeaders, rawBody: oversizedBody,
    });
    assert.equal(oversized.response.status, 413);
    assert.deepEqual(readBack(firstId), before);
    const unsupportedStatuses = [];
    for (const body of [
        { patientId: firstId, actorRef: 'spoofed-actor' },
        { patientId: firstId, sourceSurface: 'job' },
        { patientId: firstId, clinicalSentinel: 'CLINICAL_SENTINEL' },
        { patientId: firstId, version: 1 },
        { patientId: firstId, expectedVersion: 999 },
    ]) {
        const unsupported = await request('POST', '/api/system/restore-patient', { headers: webHeaders, body });
        unsupportedStatuses.push(unsupported.response.status);
        assert.equal(unsupported.response.status, 400);
        assert.deepEqual(readBack(firstId), before);
    }
    const listing = await request('GET', '/api/system/restore-patient', { headers: webHeaders });
    assert.equal(listing.response.status, 200);
    assert.ok(listing.json.softDeleted.some(item => item.id === firstId));

    const restored = await request('POST', '/api/system/restore-patient', {
        headers: webHeaders, body: { patientId: firstId },
    });
    assert.equal(restored.response.status, 200);
    assert.deepEqual(restored.json, { success: true, patientId: firstId, version: 4 });
    const after = readBack(firstId);
    assertRestored(before, after, firstId, user.id);
    const afterList = await request('GET', '/api/system/restore-patient', { headers: webHeaders });
    assert.equal(afterList.response.status, 200);
    assert.equal(afterList.json.softDeleted.some(item => item.id === firstId), false);
    const retry = await request('POST', '/api/system/restore-patient', { headers: webHeaders, body: { patientId: firstId } });
    assert.equal(retry.response.status, 409);
    assert.deepEqual(readBack(firstId), after);

    const contestedId = randomUUID();
    seedPatient(contestedId, ambulatory.id);
    const contestedBefore = readBack(contestedId);
    const attempts = await Promise.all([0, 1].map(() => request('POST', '/api/system/restore-patient', {
        headers: webHeaders, body: { patientId: contestedId },
    })));
    assert.deepEqual(attempts.map(item => item.response.status).sort(), [200, 409]);
    const contestedAfter = readBack(contestedId);
    assertRestored(contestedBefore, contestedAfter, contestedId, user.id);
    const contestedRetry = await request('POST', '/api/system/restore-patient', {
        headers: webHeaders, body: { patientId: contestedId },
    });
    assert.equal(contestedRetry.response.status, 409);
    assert.deepEqual(readBack(contestedId), contestedAfter);
    observations.push({ tokenOnlyStatus: tokenOnly.response.status, tokenOnlyListStatus: tokenOnlyList.response.status,
        invalidStatus: invalid.response.status, oversizedStatus: oversized.response.status, unsupportedStatuses,
        unsupportedStateUnchanged: true, beforeListStatus: listing.response.status,
        afterListStatus: afterList.response.status,
        firstStatus: restored.response.status, firstRetryStatus: retry.response.status,
        concurrentStatuses: [200, 409], concurrentRetryStatus: contestedRetry.response.status,
        eventsPerRestoredPatient: 1, actorSource: 'web-session' });
});
