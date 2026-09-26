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
const LIFECYCLE_CAPABILITY = 'network.replica.write-patient-lifecycle';
const PIN_ITERATIONS = 100000;

const scenarioResults = [];

after(() => {
    const report = {
        generatedAt: new Date().toISOString(),
        baseUrl: BASE_URL,
        scenarios: scenarioResults,
    };

    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`[network-home-base-patient-lifecycle-write] Report written to ${REPORT_PATH}`);
});

test('paired patient lifecycle create, tombstone, and restore preserves sealed sensitive fields', async () => {
    await assertServerReady();

    await enableHomeBaseMode();
    const masterKey = await loadE2EMasterKey();
    const readOnlyClient = await pairClient([READ_CAPABILITY], 'Desk iPad lifecycle readonly');
    const lifecycleClient = await pairClient([READ_CAPABILITY, LIFECYCLE_CAPABILITY], 'Desk iPad lifecycle writer');

    const login = await loginWithWebAuthControl(BASE_URL, { username: USERNAME, password: PIN });
    assert.equal(login.response.status, 200);
    const cookieHeader = login.cookieHeader;

    const patientId = crypto.randomUUID();
    const suffix = patientId.replace(/-/g, '').slice(0, 13).toUpperCase();
    const plaintext = {
        address: 'Via Lifecycle 12, Milano',
        phone: '+39 02 7770001',
        caregiver: 'Caregiver Smoke',
        exemptions: ['048', 'C01'],
        diagnoses: [
            {
                code: 'E11.9',
                description: 'Diabete tipo 2',
                system: 'ICD-10',
                date: '2026-01-01T00:00:00.000Z',
            },
        ],
        statusReason: 'follow-up programmato',
        notes: 'nota lifecycle sigillata',
        deletionReason: 'richiesta paziente test paired',
    };
    const sealed = {
        address: await sealField(plaintext.address, masterKey),
        phone: await sealField(plaintext.phone, masterKey),
        caregiver: await sealField(plaintext.caregiver, masterKey),
        exemptions: await sealField(plaintext.exemptions, masterKey),
        diagnoses: await sealField(plaintext.diagnoses, masterKey),
        statusReason: await sealField(plaintext.statusReason, masterKey),
        notes: await sealField(plaintext.notes, masterKey),
        deletionReason: await sealField(plaintext.deletionReason, masterKey),
    };

    try {
        const readOnlyPatientId = crypto.randomUUID();
        const beforeReadOnlyCreate = patientMutationSnapshot(readOnlyPatientId);
        const readOnlyCreate = await request('POST', '/api/v1/network/patients', {
            headers: {
                ...pairedHeaders(readOnlyClient),
                Cookie: cookieHeader,
            },
            body: {
                id: readOnlyPatientId,
                firstName: 'Readonly',
                lastName: 'Lifecycle',
                taxCode: `RDL${suffix}`,
            },
        });
        assert.equal(readOnlyCreate.response.status, 403);
        assert.deepEqual(patientMutationSnapshot(readOnlyPatientId), beforeReadOnlyCreate);

        const missingSessionCreate = await request('POST', '/api/v1/network/patients', {
            headers: pairedHeaders(lifecycleClient),
            body: { id: readOnlyPatientId, firstName: 'No', lastName: 'Session', taxCode: `NOS${suffix}` },
        });
        assert.equal(missingSessionCreate.response.status, 401);
        assert.deepEqual(patientMutationSnapshot(readOnlyPatientId), beforeReadOnlyCreate);

        const readOnlyTrash = await request('GET', '/api/v1/network/patients?includeDeleted=true', {
            headers: {
                ...pairedHeaders(readOnlyClient),
                Cookie: cookieHeader,
            },
        });
        assert.equal(readOnlyTrash.response.status, 403);

        const plaintextCreate = await request('POST', '/api/v1/network/patients', {
            headers: {
                ...pairedHeaders(lifecycleClient),
                Cookie: cookieHeader,
            },
            body: {
                id: crypto.randomUUID(),
                firstName: 'Plain',
                lastName: 'Lifecycle',
                taxCode: `PLN${suffix}`,
                notes: 'plaintext must fail',
            },
        });
        assert.equal(plaintextCreate.response.status, 400);
        assert.equal(plaintextCreate.json?.error, 'Network create requires sealed sensitive fields');

        const aiCreate = await request('POST', '/api/v1/network/patients', {
            headers: {
                ...pairedHeaders(lifecycleClient),
                Cookie: cookieHeader,
            },
            body: {
                id: crypto.randomUUID(),
                firstName: 'AI',
                lastName: 'Lifecycle',
                taxCode: `AIL${suffix}`,
                aiSummary: 'ENC:blocked:blocked',
            },
        });
        assert.equal(aiCreate.response.status, 403);
        assert.equal(aiCreate.json?.error, 'Network patient write boundary excludes AI fields');

        const create = await request('POST', '/api/v1/network/patients', {
            headers: {
                ...pairedHeaders(lifecycleClient),
                Cookie: cookieHeader,
            },
            body: {
                id: patientId,
                firstName: 'Lifecycle',
                lastName: 'Writer',
                taxCode: `LCW${suffix}`,
                birthDate: '1980-01-01T00:00:00.000Z',
                address: sealed.address,
                phone: sealed.phone,
                caregiver: sealed.caregiver,
                exemptions: sealed.exemptions,
                diagnoses: sealed.diagnoses,
                statusReason: sealed.statusReason,
                notes: sealed.notes,
                monitoringProfile: 'standard',
                isAdi: false,
            },
        });
        assert.equal(create.response.status, 201);
        assert.deepEqual(create.json, { id: patientId, version: 1 });
        const afterCreate = patientMutationSnapshot(patientId);
        assert.equal(afterCreate.patient.version, 1);
        assert.equal(afterCreate.memberships.length, 1);
        assertLifecycleAudit(afterCreate.audit, ['patient.created'], [1], lifecycleClient.pairedClientId, patientId);

        const duplicateCreate = await request('POST', '/api/v1/network/patients', {
            headers: { ...pairedHeaders(lifecycleClient), Cookie: cookieHeader },
            body: { id: patientId, firstName: 'Lifecycle', lastName: 'Writer', taxCode: `LCW${suffix}` },
        });
        assert.equal(duplicateCreate.response.status, 500);
        assert.deepEqual(patientMutationSnapshot(patientId), afterCreate);

        const detail = await request('GET', `/api/v1/network/patients/${patientId}`, {
            headers: {
                ...pairedHeaders(lifecycleClient),
                Cookie: cookieHeader,
            },
        });
        assert.equal(detail.response.status, 200);
        for (const field of ['address', 'phone', 'caregiver', 'exemptions', 'diagnoses', 'statusReason', 'notes']) {
            assert.equal(detail.json?.[field], sealed[field], `${field} ciphertext must round-trip byte-identically`);
            assert.deepEqual(await openField(detail.json[field], masterKey), plaintext[field]);
        }

        const staleDelete = await request('DELETE', `/api/v1/network/patients/${patientId}`, {
            headers: {
                ...pairedHeaders(lifecycleClient),
                Cookie: cookieHeader,
            },
            body: {
                version: 999,
                deletionReason: sealed.deletionReason,
            },
        });
        assert.equal(staleDelete.response.status, 409);
        assert.equal(staleDelete.json?.code, 'VERSION_CONFLICT');
        assert.equal(staleDelete.json?.currentVersion, 1);
        assert.deepEqual(patientMutationSnapshot(patientId), afterCreate);

        const readOnlyDelete = await request('DELETE', `/api/v1/network/patients/${patientId}`, {
            headers: { ...pairedHeaders(readOnlyClient), Cookie: cookieHeader },
            body: { version: 1, deletionReason: sealed.deletionReason },
        });
        assert.equal(readOnlyDelete.response.status, 403);
        const missingSessionDelete = await request('DELETE', `/api/v1/network/patients/${patientId}`, {
            headers: pairedHeaders(lifecycleClient), body: { version: 1, deletionReason: sealed.deletionReason },
        });
        assert.equal(missingSessionDelete.response.status, 401);
        assert.deepEqual(patientMutationSnapshot(patientId), afterCreate);

        const deletion = await request('DELETE', `/api/v1/network/patients/${patientId}`, {
            headers: {
                ...pairedHeaders(lifecycleClient),
                Cookie: cookieHeader,
            },
            body: {
                version: 1,
                deletionReason: sealed.deletionReason,
            },
        });
        assert.equal(deletion.response.status, 200);
        assert.deepEqual(deletion.json, { id: patientId, version: 2 });
        const afterDelete = patientMutationSnapshot(patientId);
        assert.equal(afterDelete.patient.version, 2);
        assert.ok(afterDelete.patient.deleted_at);
        assert.equal(afterDelete.patient.deletion_reason, sealed.deletionReason);
        assert.deepEqual(afterDelete.memberships, afterCreate.memberships);
        assertLifecycleAudit(afterDelete.audit, ['patient.created', 'patient.deleted'], [1, 2], lifecycleClient.pairedClientId, patientId);
        const repeatedDelete = await request('DELETE', `/api/v1/network/patients/${patientId}`, {
            headers: { ...pairedHeaders(lifecycleClient), Cookie: cookieHeader },
            body: { version: 1, deletionReason: sealed.deletionReason },
        });
        assert.equal(repeatedDelete.response.status, 404);
        assert.deepEqual(patientMutationSnapshot(patientId), afterDelete);

        const deletedDetail = await request('GET', `/api/v1/network/patients/${patientId}`, {
            headers: {
                ...pairedHeaders(lifecycleClient),
                Cookie: cookieHeader,
            },
        });
        assert.equal(deletedDetail.response.status, 404);

        const deletedActiveList = await request('GET', '/api/v1/network/patients', {
            headers: { ...pairedHeaders(lifecycleClient), Cookie: cookieHeader },
        });
        assert.equal(deletedActiveList.response.status, 200);
        assert.ok(Array.isArray(deletedActiveList.json));
        assert.equal(deletedActiveList.json.some((item) => item.id === patientId), false);

        const trashList = await request('GET', '/api/v1/network/patients?includeDeleted=true', {
            headers: {
                ...pairedHeaders(lifecycleClient),
                Cookie: cookieHeader,
            },
        });
        assert.equal(trashList.response.status, 200);
        assert.ok(Array.isArray(trashList.json));
        const tombstone = trashList.json.find((item) => item.id === patientId);
        assert.ok(tombstone, 'Expected includeDeleted list to expose the patient tombstone');
        assert.equal(tombstone.deletedAt !== null, true);
        assert.equal(tombstone.deletionReason, sealed.deletionReason);
        assert.equal(await openField(tombstone.deletionReason, masterKey), plaintext.deletionReason);
        assert.equal(tombstone.version, 2);

        const staleRestore = await request('POST', `/api/v1/network/patients/${patientId}/restore`, {
            headers: {
                ...pairedHeaders(lifecycleClient),
                Cookie: cookieHeader,
            },
            body: {
                version: 1,
            },
        });
        assert.equal(staleRestore.response.status, 409);
        assert.equal(staleRestore.json?.code, 'VERSION_CONFLICT');
        assert.equal(staleRestore.json?.currentVersion, 2);
        const readOnlyRestore = await request('POST', `/api/v1/network/patients/${patientId}/restore`, {
            headers: { ...pairedHeaders(readOnlyClient), Cookie: cookieHeader }, body: { version: 2 },
        });
        assert.equal(readOnlyRestore.response.status, 403);
        const missingSessionRestore = await request('POST', `/api/v1/network/patients/${patientId}/restore`, {
            headers: pairedHeaders(lifecycleClient), body: { version: 2 },
        });
        assert.equal(missingSessionRestore.response.status, 401);
        assert.deepEqual(patientMutationSnapshot(patientId), afterDelete);

        const restore = await request('POST', `/api/v1/network/patients/${patientId}/restore`, {
            headers: {
                ...pairedHeaders(lifecycleClient),
                Cookie: cookieHeader,
            },
            body: {
                version: 2,
            },
        });
        assert.equal(restore.response.status, 200);
        assert.deepEqual(restore.json, { id: patientId, version: 3 });
        const afterRestore = patientMutationSnapshot(patientId);
        assert.equal(afterRestore.patient.version, 3);
        assert.equal(afterRestore.patient.deleted_at, null);
        assert.equal(afterRestore.patient.deletion_reason, null);
        assert.deepEqual(afterRestore.memberships, afterCreate.memberships);
        assertLifecycleAudit(afterRestore.audit, ['patient.created', 'patient.deleted', 'patient.restored'], [1, 2, 3], lifecycleClient.pairedClientId, patientId);
        const repeatedRestore = await request('POST', `/api/v1/network/patients/${patientId}/restore`, {
            headers: { ...pairedHeaders(lifecycleClient), Cookie: cookieHeader }, body: { version: 2 },
        });
        assert.equal(repeatedRestore.response.status, 404);
        assert.deepEqual(patientMutationSnapshot(patientId), afterRestore);

        const activeList = await request('GET', '/api/v1/network/patients', {
            headers: {
                ...pairedHeaders(lifecycleClient),
                Cookie: cookieHeader,
            },
        });
        assert.equal(activeList.response.status, 200);
        assert.ok(activeList.json.some((item) => item.id === patientId), 'Restored patient must be active again');

        const postRestoreList = await request('GET', '/api/v1/network/patients?includeDeleted=true', {
            headers: {
                ...pairedHeaders(lifecycleClient),
                Cookie: cookieHeader,
            },
        });
        assert.equal(postRestoreList.response.status, 200);
        const deletedRows = postRestoreList.json.filter((item) => item.deletedAt);
        assert.equal(deletedRows.some((item) => item.id === patientId), false, 'Restored patient must disappear from the tombstone subset');

        scenarioResults.push({
            name: 'paired patient lifecycle write',
            patientId,
            createStatus: create.response.status,
            detailStatus: detail.response.status,
            plaintextCreateStatus: plaintextCreate.response.status,
            aiCreateStatus: aiCreate.response.status,
            readOnlyCreateStatus: readOnlyCreate.response.status,
            readOnlyTrashStatus: readOnlyTrash.response.status,
            staleDeleteStatus: staleDelete.response.status,
            deleteStatus: deletion.response.status,
            staleRestoreStatus: staleRestore.response.status,
            restoreStatus: restore.response.status,
            pairedClientId: lifecycleClient.pairedClientId,
        });
    } finally {
        await cleanupPatient(patientId);
    }
});

test('paired lifecycle rejects wrong-scope rows without patient or audit changes', async () => {
    await assertServerReady();
    const client = await pairClient([READ_CAPABILITY, LIFECYCLE_CAPABILITY], 'Desk iPad lifecycle wrong scope');
    const login = await loginWithWebAuthControl(BASE_URL, { username: USERNAME, password: PIN });
    assert.equal(login.response.status, 200);
    const patientId = crypto.randomUUID();
    const otherAmbulatoryId = crypto.randomUUID();
    seedOutOfScopePatient(patientId, otherAmbulatoryId);
    try {
        const active = patientMutationSnapshot(patientId);
        const deniedDelete = await request('DELETE', `/api/v1/network/patients/${patientId}`, {
            headers: { ...pairedHeaders(client), Cookie: login.cookieHeader }, body: { version: 3 },
        });
        assert.equal(deniedDelete.response.status, 404);
        assert.deepEqual(patientMutationSnapshot(patientId), active);
        markSyntheticPatientDeleted(patientId);
        const deleted = patientMutationSnapshot(patientId);
        const deniedRestore = await request('POST', `/api/v1/network/patients/${patientId}/restore`, {
            headers: { ...pairedHeaders(client), Cookie: login.cookieHeader }, body: { version: 3 },
        });
        assert.equal(deniedRestore.response.status, 404);
        assert.deepEqual(patientMutationSnapshot(patientId), deleted);
        scenarioResults.push({ name: 'wrong-scope lifecycle', deleteStatus: 404, restoreStatus: 404 });
    } finally { removeOutOfScopeFixture(patientId, otherAmbulatoryId); }
});

test('concurrent HTTP deletes and restores have one winner and no replay audit', async () => {
    await assertServerReady();
    const client = await pairClient([READ_CAPABILITY, LIFECYCLE_CAPABILITY], 'Desk iPad lifecycle concurrency');
    const login = await loginWithWebAuthControl(BASE_URL, { username: USERNAME, password: PIN });
    assert.equal(login.response.status, 200);
    const patientId = crypto.randomUUID();
    const suffix = patientId.replace(/-/g, '').slice(0, 13).toUpperCase();
    const headers = { ...pairedHeaders(client), Cookie: login.cookieHeader };
    try {
        const createBody = { id: patientId, firstName: 'Concurrency', lastName: 'Synthetic', taxCode: `CON${suffix}` };
        const creates = await Promise.all([0, 1].map(() => request('POST', '/api/v1/network/patients', {
            headers, body: createBody,
        })));
        assert.deepEqual(creates.map(item => item.response.status).sort(), [201, 500]);
        const afterCreate = patientMutationSnapshot(patientId);
        assert.equal(afterCreate.patient.version, 1);
        assert.equal(afterCreate.memberships.length, 1);
        assertLifecycleAudit(afterCreate.audit, ['patient.created'], [1], client.pairedClientId, patientId);
        const deletes = await Promise.all([0, 1].map(() => request('DELETE', `/api/v1/network/patients/${patientId}`, {
            headers, body: { version: 1 },
        })));
        assert.deepEqual(deletes.map(item => item.response.status).sort(), [200, 404]);
        const afterDelete = patientMutationSnapshot(patientId);
        assert.equal(afterDelete.patient.version, 2);
        assertLifecycleAudit(afterDelete.audit, ['patient.created', 'patient.deleted'], [1, 2], client.pairedClientId, patientId);
        const retryDelete = await request('DELETE', `/api/v1/network/patients/${patientId}`, { headers, body: { version: 1 } });
        assert.equal(retryDelete.response.status, 404);
        assert.deepEqual(patientMutationSnapshot(patientId), afterDelete);

        const restores = await Promise.all([0, 1].map(() => request('POST', `/api/v1/network/patients/${patientId}/restore`, {
            headers, body: { version: 2 },
        })));
        assert.deepEqual(restores.map(item => item.response.status).sort(), [200, 404]);
        const afterRestore = patientMutationSnapshot(patientId);
        assert.equal(afterRestore.patient.version, 3);
        assertLifecycleAudit(afterRestore.audit, ['patient.created', 'patient.deleted', 'patient.restored'], [1, 2, 3], client.pairedClientId, patientId);
        const retryRestore = await request('POST', `/api/v1/network/patients/${patientId}/restore`, { headers, body: { version: 2 } });
        assert.equal(retryRestore.response.status, 404);
        assert.deepEqual(patientMutationSnapshot(patientId), afterRestore);
        scenarioResults.push({ name: 'concurrent HTTP lifecycle', createStatuses: [201, 500], deleteStatuses: [200, 404], restoreStatuses: [200, 404], auditEvents: 3 });
    } finally { await cleanupPatient(patientId); }
});

async function assertServerReady() {
    const response = await request('GET', '/api/v1/ambulatories', {
        headers: localApiHeaders(),
    });
    assert.equal(response.response.status, 200, `Expected ${BASE_URL}/api/v1/ambulatories to be reachable`);
}

async function enableHomeBaseMode() {
    const networkMode = await request('PUT', '/api/settings/network.mode', {
        headers: localApiHeaders(),
        body: { value: 'network-home-base' },
    });
    assert.equal(networkMode.response.status, 200);

    const clinicName = await request('PUT', '/api/settings/clinicName', {
        headers: localApiHeaders(),
        body: { value: 'MediFlow Network Patient Lifecycle Write Smoke' },
    });
    assert.equal(clinicName.response.status, 200);
}

async function pairClient(requestedCapabilities, deviceName) {
    const pairingIntent = await request('POST', '/api/v1/network/pairing-intents', {
        body: {
            deviceName,
            clientPlatform: 'ipados',
            appVersion: '0.7.1-smoke',
            requestedCapabilities,
        },
    });
    assert.equal(pairingIntent.response.status, 201);
    const intentId = pairingIntent.json?.intentId;
    assert.ok(typeof intentId === 'string' && intentId.length > 0);

    const confirmation = await request('POST', `/api/v1/network/pairing-intents/${intentId}/confirm`, {
        headers: localApiHeaders(),
    });
    assert.equal(confirmation.response.status, 201);
    const pairedClientId = confirmation.json?.pairedClient?.clientId;
    const pairedClientToken = confirmation.json?.pairedClientToken;
    assert.ok(typeof pairedClientId === 'string' && pairedClientId.length > 0);
    assert.ok(typeof pairedClientToken === 'string' && pairedClientToken.length > 0);
    return { pairedClientId, pairedClientToken };
}

async function cleanupPatient(patientId) {
    const detail = await request('GET', `/api/v1/patients/${patientId}`, {
        headers: localApiHeaders(),
    });
    if (detail.response.status !== 200) return;

    const deletion = await request('DELETE', `/api/v1/patients/${patientId}`, {
        headers: localApiHeaders(),
        body: { version: detail.json?.version },
    });
    assert.equal(deletion.response.status, 200);
}

/* @Codex: direct readback of the same synthetic DB used by the real HTTP server. */
function patientMutationSnapshot(patientId) {
    const dataDir = process.env.MEDIFLOW_DATA_DIR;
    assert.ok(dataDir);
    const db = new Database(path.join(dataDir, 'medical.db'), { readonly: true });
    try {
        return {
            patient: db.prepare('SELECT * FROM patients WHERE id=?').get(patientId) ?? null,
            memberships: db.prepare('SELECT * FROM patients_to_ambulatories WHERE patient_id=? ORDER BY ambulatory_id').all(patientId),
            audit: db.prepare('SELECT * FROM audit_events WHERE subject_ref=? ORDER BY rowid').all(patientId),
        };
    } finally { db.close(); }
}

function withSyntheticDb(write) {
    const dataDir = process.env.MEDIFLOW_DATA_DIR;
    assert.ok(dataDir);
    const db = new Database(path.join(dataDir, 'medical.db'));
    try { return write(db); } finally { db.close(); }
}

function seedOutOfScopePatient(patientId, ambulatoryId) {
    withSyntheticDb(db => db.transaction(() => {
        db.prepare("INSERT INTO ambulatories (id, name, type, version) VALUES (?, 'Altro ambulatorio sintetico', 'live', 1)").run(ambulatoryId);
        db.prepare("INSERT INTO patients (id, first_name, last_name, tax_code, version, ambulatory_id) VALUES (?, 'Fuori', 'Scope', ?, 3, ?)")
            .run(patientId, `SCOPE${patientId.replaceAll('-', '').slice(0, 12)}`, ambulatoryId);
        db.prepare('INSERT INTO patients_to_ambulatories (patient_id, ambulatory_id) VALUES (?, ?)').run(patientId, ambulatoryId);
    })());
}

function markSyntheticPatientDeleted(patientId) {
    withSyntheticDb(db => db.prepare('UPDATE patients SET deleted_at=?, deletion_reason=? WHERE id=?')
        .run(Math.floor(Date.now() / 1000), 'synthetic-scope-test', patientId));
}

function removeOutOfScopeFixture(patientId, ambulatoryId) {
    withSyntheticDb(db => db.transaction(() => {
        db.prepare('DELETE FROM patients_to_ambulatories WHERE patient_id=?').run(patientId);
        db.prepare('DELETE FROM patients WHERE id=?').run(patientId);
        db.prepare('DELETE FROM ambulatories WHERE id=?').run(ambulatoryId);
    })());
}

function assertLifecycleAudit(events, eventTypes, versions, pairedClientId, patientId) {
    assert.deepEqual(events.map(event => event.event_type), eventTypes);
    assert.equal(events.length, versions.length);
    for (const [index, event] of events.entries()) {
        assert.equal(event.outcome, 'success');
        assert.equal(event.actor_type, 'user');
        assert.ok(typeof event.actor_ref === 'string' && event.actor_ref.length > 0);
        assert.equal(event.subject_type, 'patient');
        assert.equal(event.subject_ref, patientId);
        assert.equal(event.source_surface, 'native');
        assert.deepEqual(JSON.parse(event.redacted_metadata), {
            resourceVersion: versions[index],
            flags: ['auth:paired-client', `paired-client:${pairedClientId}`, 'scope:ambulatory'],
        });
        assert.doesNotMatch(JSON.stringify(event), /Via Lifecycle|nota lifecycle|richiesta paziente test paired|ENC:/);
    }
}

async function loadE2EMasterKey() {
    const dataDir = process.env.MEDIFLOW_DATA_DIR;
    assert.ok(dataDir, 'MEDIFLOW_DATA_DIR is required to read the E2E wrapped master key');
    const dbPath = path.join(dataDir, 'medical.db');
    assert.ok(fs.existsSync(dbPath), `Expected E2E database at ${dbPath}`);

    const db = new Database(dbPath, { readonly: true });
    try {
        const row = db
            .prepare('SELECT encrypted_master_key AS encryptedMasterKey, salt FROM users WHERE username = ? LIMIT 1')
            .get(USERNAME);
        assert.ok(row?.encryptedMasterKey, `Expected user ${USERNAME} to have an encrypted master key`);
        assert.ok(row?.salt, `Expected user ${USERNAME} to have a PIN salt`);
        return unwrapMasterKey(row.encryptedMasterKey, PIN, row.salt);
    } finally {
        db.close();
    }
}

async function unwrapMasterKey(encryptedMasterKey, pin, saltB64) {
    const salt = Buffer.from(saltB64, 'base64');
    const keyMaterial = await crypto.webcrypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(pin),
        'PBKDF2',
        false,
        ['deriveKey'],
    );
    const kek = await crypto.webcrypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt,
            iterations: PIN_ITERATIONS,
            hash: 'SHA-256',
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['decrypt'],
    );
    const combined = Buffer.from(encryptedMasterKey, 'base64');
    const iv = combined.subarray(0, 12);
    const data = combined.subarray(12);
    const rawMasterKey = await crypto.webcrypto.subtle.decrypt({ name: 'AES-GCM', iv }, kek, data);
    return crypto.webcrypto.subtle.importKey('raw', rawMasterKey, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function sealField(value, masterKey) {
    const iv = crypto.webcrypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(JSON.stringify(value));
    const ciphertext = await crypto.webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, masterKey, encoded);
    return `ENC:${Buffer.from(iv).toString('base64')}:${Buffer.from(ciphertext).toString('base64')}`;
}

async function openField(sealedValue, masterKey) {
    assert.equal(typeof sealedValue, 'string');
    assert.ok(sealedValue.startsWith('ENC:'));
    const [, ivB64, dataB64] = sealedValue.split(':');
    const plaintext = await crypto.webcrypto.subtle.decrypt(
        { name: 'AES-GCM', iv: Buffer.from(ivB64, 'base64') },
        masterKey,
        Buffer.from(dataB64, 'base64'),
    );
    return JSON.parse(new TextDecoder().decode(plaintext));
}

function localApiHeaders() {
    return {
        Authorization: `Bearer ${LOCAL_API_TOKEN}`,
        'Cache-Control': 'no-store',
    };
}

function pairedHeaders(client) {
    return {
        'x-mediflow-paired-client-id': client.pairedClientId,
        'x-mediflow-paired-client-token': client.pairedClientToken,
    };
}

async function request(method, pathname, { headers = {}, body } = {}) {
    const url = new URL(pathname, BASE_URL);
    const finalHeaders = { ...headers };
    let payload;

    if (body !== undefined) {
        finalHeaders['Content-Type'] = 'application/json';
        payload = JSON.stringify(body);
    }

    const response = await fetch(url, {
        method,
        headers: finalHeaders,
        body: payload,
    });

    const text = await response.text();
    let json = null;
    if (text.length > 0) {
        try {
            json = JSON.parse(text);
        } catch {
            json = text;
        }
    }

    return { response, json, text };
}

function resolveReportPath() {
    if (process.env.MEDIFLOW_NETWORK_WRITE_REPORT_PATH) {
        return process.env.MEDIFLOW_NETWORK_WRITE_REPORT_PATH;
    }

    const dataDir = process.env.MEDIFLOW_DATA_DIR || process.env.MEDIFLOW_NETWORK_WRITE_DATA_DIR;
    if (dataDir) {
        return path.join(dataDir, 'reports', 'network-home-base-patient-lifecycle-write-report.json');
    }

    return path.join(process.cwd(), 'tmp-network-home-base-patient-lifecycle-write-report.json');
}
