/* @Codex: C05 synthetic real HTTP qualification, separate from route auth/cookie seams. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { loginWithWebAuthControl } from './web-auth-control-test-client.mjs';

const baseUrl = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3501';
const dataDir = process.env.MEDIFLOW_DATA_DIR;
if (!dataDir) throw new Error('A synthetic MEDIFLOW_DATA_DIR is required');
const databasePath = path.join(dataDir, 'medical.db');
const token = process.env.MEDIFLOW_LOCAL_API_TOKEN ?? 'mediflow-network-write-smoke-local-token';
const username = process.env.E2E_USERNAME ?? 'admin';
const pin = process.env.E2E_PIN ?? '1234';
const writer = new Database(databasePath);
const observations = [];

after(() => {
    writer.exec('DROP TRIGGER IF EXISTS c05_create_http_audit_fault');
    writer.close();
    const report = path.join(dataDir, 'reports', 'patient-create-required-audit-http-report.json');
    fs.mkdirSync(path.dirname(report), { recursive: true });
    fs.writeFileSync(report, `${JSON.stringify({ baseUrl, observations }, null, 2)}\n`);
});

async function request(method, pathname, { headers = {}, body } = {}) {
    const response = await fetch(new URL(pathname, baseUrl), {
        method,
        headers: { ...headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: 'no-store',
    });
    const raw = await response.text();
    let json = null;
    try { json = raw ? JSON.parse(raw) : null; } catch { /* preserve status without payload */ }
    return { response, json };
}

function snapshot(id) {
    const reopened = new Database(databasePath, { readonly: true });
    try {
        return {
            patient: reopened.prepare('SELECT * FROM patients WHERE id=?').get(id) ?? null,
            memberships: reopened.prepare('SELECT * FROM patients_to_ambulatories WHERE patient_id=? ORDER BY ambulatory_id').all(id),
            audit: reopened.prepare('SELECT * FROM audit_events WHERE subject_ref=? ORDER BY rowid').all(id),
        };
    } finally { reopened.close(); }
}

function bodyFor(id, ambulatoryId) {
    return { id, firstName: 'Ada', lastName: 'Sintetica', taxCode: `SYN${id.replaceAll('-', '').slice(0, 11)}`,
        ambulatoryId, notes: 'ENC:synthetic:sealed', unknownClinicalProperty: 'CLINICAL_SENTINEL' };
}

function checkEvent(id, expectedActorRef, expectedActorType, expectedSurface) {
    const state = snapshot(id);
    assert.ok(state.patient);
    assert.equal(state.patient.version, 1);
    assert.equal(state.memberships.length, 1);
    assert.equal(state.audit.length, 1);
    const event = state.audit[0];
    assert.equal(event.event_type, 'patient.created');
    assert.equal(event.subject_ref, id);
    assert.equal(event.actor_ref, expectedActorRef);
    assert.equal(event.actor_type, expectedActorType);
    assert.equal(event.source_surface, expectedSurface);
    const metadata = JSON.parse(event.redacted_metadata);
    assert.equal(metadata.resourceVersion, 1);
    assert.equal(JSON.stringify(metadata).includes('CLINICAL_SENTINEL'), false);
    assert.equal(JSON.stringify(metadata).includes('ENC:synthetic:sealed'), false);
    return state;
}

test('real Web legacy, fixed-preview, and v1 create have one host-attributed event; denied requests do not write', async () => {
    const ready = await request('GET', '/api/v1/ambulatories', { headers: { authorization: `Bearer ${token}` } });
    assert.equal(ready.response.status, 200);
    const login = await loginWithWebAuthControl(baseUrl, { username, password: pin });
    assert.equal(login.response.status, 200);
    assert.ok(login.cookieHeader);
    const user = writer.prepare('SELECT id FROM users WHERE username=?').get(username);
    assert.ok(user);
    const target = writer.prepare('SELECT id FROM ambulatories WHERE is_default=1 LIMIT 1').get();
    assert.ok(target);
    const webHeaders = { Cookie: login.cookieHeader, 'x-mediflow-source-surface': 'job', 'x-actor-ref': 'spoofed-actor' };
    const v1Headers = { authorization: `Bearer ${token}`, 'x-mediflow-source-surface': 'job', 'x-actor-ref': 'spoofed-actor' };

    const deniedWebId = randomUUID();
    const deniedWeb = await request('POST', '/api/patients', { body: bodyFor(deniedWebId, target.id) });
    assert.equal(deniedWeb.response.status, 401);
    assert.deepEqual(snapshot(deniedWebId), { patient: null, memberships: [], audit: [] });
    const deniedV1Id = randomUUID();
    const deniedV1 = await request('POST', '/api/v1/patients', { body: bodyFor(deniedV1Id, target.id) });
    assert.equal(deniedV1.response.status, 401);
    assert.deepEqual(snapshot(deniedV1Id), { patient: null, memberships: [], audit: [] });

    const legacyId = randomUUID();
    const legacy = await request('POST', '/api/patients', { headers: webHeaders, body: bodyFor(legacyId, target.id) });
    assert.equal(legacy.response.status, 201);
    assert.deepEqual(legacy.json, { id: legacyId });
    const afterLegacy = checkEvent(legacyId, user.id, 'user', 'web');
    assert.equal(afterLegacy.memberships[0].ambulatory_id, target.id);

    const context = await request('GET', '/api/patients/create-context', { headers: webHeaders });
    assert.equal(context.response.status, 200);
    assert.equal(context.json.ambulatoryId, target.id);
    const fixedHeaders = { ...webHeaders,
        'X-MediFlow-Patient-Create-Mode': 'fixed-preview-v1',
        'X-MediFlow-Patient-Create-Context': context.json.nonce,
        'X-MediFlow-Patient-Create-Target': context.json.ambulatoryId };
    const invalidId = randomUUID();
    const invalid = await request('POST', '/api/patients', { headers: { ...fixedHeaders,
        'X-MediFlow-Patient-Create-Context': '0'.repeat(64) }, body: bodyFor(invalidId, target.id) });
    assert.equal(invalid.response.status, 409);
    assert.deepEqual(snapshot(invalidId), { patient: null, memberships: [], audit: [] });
    const fixedId = randomUUID();
    const fixed = await request('POST', '/api/patients', { headers: fixedHeaders, body: bodyFor(fixedId, target.id) });
    assert.equal(fixed.response.status, 201);
    assert.deepEqual(fixed.json, { id: fixedId });
    const afterFixed = checkEvent(fixedId, user.id, 'user', 'web');
    assert.equal(afterFixed.memberships[0].ambulatory_id, target.id);

    const v1Id = randomUUID();
    const v1 = await request('POST', '/api/v1/patients', { headers: v1Headers,
        body: { ...bodyFor(v1Id, target.id), isArchived: true } });
    assert.equal(v1.response.status, 201);
    assert.deepEqual(v1.json, { id: v1Id });
    const afterV1 = checkEvent(v1Id, 'local-api', 'system', 'api');
    assert.equal(afterV1.patient.is_archived, 1);
    assert.equal(afterV1.memberships[0].ambulatory_id, target.id);

    const duplicate = await request('POST', '/api/v1/patients', { headers: v1Headers, body: bodyFor(v1Id, target.id) });
    assert.equal(duplicate.response.status, 500);
    assert.deepEqual(snapshot(v1Id), afterV1);
    const concurrent = [];
    for (const surface of ['web-legacy', 'web-fixed-preview-v1', 'v1']) {
        const id = randomUUID();
        let pathname = surface === 'v1' ? '/api/v1/patients' : '/api/patients';
        let headers = surface === 'v1' ? v1Headers : webHeaders;
        if (surface === 'web-fixed-preview-v1') {
            const preview = await request('GET', '/api/patients/create-context', { headers: webHeaders });
            assert.equal(preview.response.status, 200);
            headers = { ...webHeaders,
                'X-MediFlow-Patient-Create-Mode': 'fixed-preview-v1',
                'X-MediFlow-Patient-Create-Context': preview.json.nonce,
                'X-MediFlow-Patient-Create-Target': preview.json.ambulatoryId };
        }
        const body = bodyFor(id, target.id);
        const responses = await Promise.all([0, 1].map(() => request('POST', pathname, { headers, body })));
        assert.deepEqual(responses.map(item => item.response.status).sort(), [201, 500]);
        const state = checkEvent(id, surface === 'v1' ? 'local-api' : user.id,
            surface === 'v1' ? 'system' : 'user', surface === 'v1' ? 'api' : 'web');
        const retry = await request('POST', pathname, { headers, body });
        assert.equal(retry.response.status, 500);
        assert.deepEqual(snapshot(id), state);
        concurrent.push({ surface, statuses: [201, 500], retryStatus: retry.response.status, auditCount: 1 });
    }
    observations.push({ names: ['Web legacy', 'Web fixed-preview-v1', 'API-v1'],
        successStatuses: [legacy.response.status, fixed.response.status, v1.response.status],
        deniedStatuses: [deniedWeb.response.status, deniedV1.response.status, invalid.response.status],
        duplicateStatus: duplicate.response.status, auditPerSuccessfulCreate: 1, concurrent });
});
