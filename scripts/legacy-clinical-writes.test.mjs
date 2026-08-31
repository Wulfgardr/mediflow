#!/usr/bin/env node
/* @Codex */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { loginWithWebAuthControl } from './web-auth-control-test-client.mjs';

const BASE_URL = process.env.E2E_BASE_URL || 'http://127.0.0.1:3310';
const LOCAL_API_TOKEN = process.env.MEDIFLOW_LOCAL_API_TOKEN || 'mediflow-legacy-clinical-writes-token';
const USERNAME = process.env.E2E_USERNAME || 'admin';
const PIN = process.env.E2E_PIN || '1234';
const REPORT_PATH = resolveReportPath();
const scenarioResults = [];

after(() => {
    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, `${JSON.stringify({
        generatedAt: new Date().toISOString(),
        baseUrl: BASE_URL,
        scenarios: scenarioResults,
    }, null, 2)}\n`);
    console.log(`[legacy-clinical-writes] Report written to ${REPORT_PATH}`);
});

test('legacy entries and checkups use version guards and soft-delete tombstones', async () => {
    await assertServerReady();

    const cookieHeader = await login();
    const patientId = await createSeedPatient();

    await exerciseLegacyEntryContract(cookieHeader, patientId);
    await exerciseLegacyCheckupContract(cookieHeader, patientId);
});

async function exerciseLegacyEntryContract(cookieHeader, patientId) {
    const create = await webRequest(cookieHeader, 'POST', '/api/entries', {
        id: crypto.randomUUID(),
        patientId,
        type: 'note',
        title: 'Legacy diary',
        date: '2026-05-03T09:00:00.000Z',
        content: 'Voce legacy con contratto versionato',
    });
    assert.equal(create.status, 201);
    const entryId = create.json?.id;
    assert.ok(typeof entryId === 'string' && entryId.length > 0);
    assert.equal(create.json?.version, 1);

    const listed = await webRequest(cookieHeader, 'GET', `/api/entries?patientId=${patientId}`);
    assert.equal(listed.status, 200);
    const listedEntry = listed.json.find((item) => item.id === entryId);
    assert.equal(listedEntry?.version, 1);
    assert.equal(listedEntry?.deletedAt, null);

    const missingPut = await webRequest(cookieHeader, 'PUT', `/api/entries/${crypto.randomUUID()}`, {
        version: 1,
        content: 'missing record',
    });
    assert.equal(missingPut.status, 404);
    assert.deepEqual(missingPut.json, { error: 'Not found' });

    const missingDelete = await webRequest(cookieHeader, 'DELETE', `/api/entries/${crypto.randomUUID()}`, {
        version: 1,
        deletionReason: 'missing record',
    });
    assert.equal(missingDelete.status, 404);
    assert.deepEqual(missingDelete.json, { error: 'Not found' });

    await expectWebError(cookieHeader, 'PUT', `/api/entries/${entryId}`, { content: 'senza versione' }, 400, 'Version is required');

    const fresh = await webRequest(cookieHeader, 'PUT', `/api/entries/${entryId}`, {
        version: 1,
        content: 'Voce legacy aggiornata',
    });
    assert.equal(fresh.status, 200);

    const stale = await webRequest(cookieHeader, 'PUT', `/api/entries/${entryId}`, {
        version: 1,
        content: 'stale write',
    });
    assert.equal(stale.status, 409);
    assert.equal(stale.json?.code, 'VERSION_CONFLICT');
    assert.equal(stale.json?.entity, 'entry');
    assert.equal(stale.json?.recordId, entryId);
    assert.equal(stale.json?.currentVersion, 2);

    await expectWebError(cookieHeader, 'DELETE', `/api/entries/${entryId}`, { deletionReason: 'missing version' }, 400, 'Version is required');

    const staleDelete = await webRequest(cookieHeader, 'DELETE', `/api/entries/${entryId}`, {
        version: 1,
        deletionReason: 'stale delete',
    });
    assert.equal(staleDelete.status, 409);
    assert.equal(staleDelete.json?.code, 'VERSION_CONFLICT');
    assert.equal(staleDelete.json?.currentVersion, 2);

    const deletion = await webRequest(cookieHeader, 'DELETE', `/api/entries/${entryId}`, {
        version: 2,
        deletionReason: 'legacy-entry-delete-smoke',
    });
    assert.equal(deletion.status, 200);

    const hiddenList = await webRequest(cookieHeader, 'GET', `/api/entries?patientId=${patientId}`);
    assert.equal(hiddenList.status, 200);
    assert.ok(!hiddenList.json.some((item) => item.id === entryId), 'legacy entry list should hide tombstones');

    const includedList = await webRequest(cookieHeader, 'GET', `/api/entries?patientId=${patientId}&includeDeleted=true`);
    assert.equal(includedList.status, 200);
    assert.ok(includedList.json.some((item) => item.id === entryId), 'legacy entry includeDeleted should expose tombstones');

    const tombstone = await localRequest('GET', `/api/v1/patients/${patientId}/entries/${entryId}`);
    assert.equal(tombstone.status, 200);
    assert.ok(tombstone.json?.deletedAt, 'entry tombstone should remain readable by id');
    assert.equal(tombstone.json?.deletionReason, 'legacy-entry-delete-smoke');
    assert.equal(tombstone.json?.version, 3);

    const restore = await webRequest(cookieHeader, 'PUT', `/api/entries/${entryId}`, {
        version: tombstone.json.version,
        deletedAt: null,
        deletionReason: null,
    });
    assert.equal(restore.status, 200);

    const restoredList = await webRequest(cookieHeader, 'GET', `/api/entries?patientId=${patientId}`);
    assert.equal(restoredList.status, 200);
    assert.ok(restoredList.json.some((item) => item.id === entryId), 'legacy entry list should show restored records');

    const restored = await localRequest('GET', `/api/v1/patients/${patientId}/entries/${entryId}`);
    assert.equal(restored.status, 200);
    assert.equal(restored.json?.deletedAt, null);
    assert.equal(restored.json?.deletionReason, null);
    assert.equal(restored.json?.version, 4);

    scenarioResults.push({ resource: 'entry', entryId, staleStatus: stale.status, deleteStatus: deletion.status, restoreStatus: restore.status });
}

async function exerciseLegacyCheckupContract(cookieHeader, patientId) {
    const create = await webRequest(cookieHeader, 'POST', '/api/checkups', {
        id: crypto.randomUUID(),
        patientId,
        date: '2026-05-04T09:00:00.000Z',
        title: 'Legacy checkup',
        notes: 'Controllo legacy con contratto versionato',
        status: 'pending',
        source: 'manual',
    });
    assert.equal(create.status, 201);
    const checkupId = create.json?.id;
    assert.ok(typeof checkupId === 'string' && checkupId.length > 0);

    const listed = await webRequest(cookieHeader, 'GET', `/api/checkups?patientId=${patientId}`);
    assert.equal(listed.status, 200);
    const listedCheckup = listed.json.find((item) => item.id === checkupId);
    assert.equal(listedCheckup?.version, 1);
    assert.equal(listedCheckup?.deletedAt, null);

    const missingPut = await webRequest(cookieHeader, 'PUT', `/api/checkups/${crypto.randomUUID()}`, {
        version: 1,
        title: 'missing record',
    });
    assert.equal(missingPut.status, 404);
    assert.deepEqual(missingPut.json, { error: 'Not found' });

    const missingDelete = await webRequest(cookieHeader, 'DELETE', `/api/checkups/${crypto.randomUUID()}`, {
        version: 1,
        deletionReason: 'missing record',
    });
    assert.equal(missingDelete.status, 404);
    assert.deepEqual(missingDelete.json, { error: 'Not found' });

    await expectWebError(cookieHeader, 'PUT', `/api/checkups/${checkupId}`, { title: 'senza versione' }, 400, 'Version is required');

    const fresh = await webRequest(cookieHeader, 'PUT', `/api/checkups/${checkupId}`, {
        version: 1,
        title: 'Legacy checkup aggiornato',
    });
    assert.equal(fresh.status, 200);

    const stale = await webRequest(cookieHeader, 'PUT', `/api/checkups/${checkupId}`, {
        version: 1,
        title: 'stale write',
    });
    assert.equal(stale.status, 409);
    assert.equal(stale.json?.code, 'VERSION_CONFLICT');
    assert.equal(stale.json?.entity, 'checkup');
    assert.equal(stale.json?.recordId, checkupId);
    assert.equal(stale.json?.currentVersion, 2);

    await expectWebError(cookieHeader, 'DELETE', `/api/checkups/${checkupId}`, { deletionReason: 'missing version' }, 400, 'Version is required');

    const staleDelete = await webRequest(cookieHeader, 'DELETE', `/api/checkups/${checkupId}`, {
        version: 1,
        deletionReason: 'stale delete',
    });
    assert.equal(staleDelete.status, 409);
    assert.equal(staleDelete.json?.code, 'VERSION_CONFLICT');
    assert.equal(staleDelete.json?.currentVersion, 2);

    const deletion = await webRequest(cookieHeader, 'DELETE', `/api/checkups/${checkupId}`, {
        version: 2,
        deletionReason: 'legacy-checkup-delete-smoke',
    });
    assert.equal(deletion.status, 200);

    const hiddenList = await webRequest(cookieHeader, 'GET', `/api/checkups?patientId=${patientId}`);
    assert.equal(hiddenList.status, 200);
    assert.ok(!hiddenList.json.some((item) => item.id === checkupId), 'legacy checkup list should hide tombstones');

    const includedList = await webRequest(cookieHeader, 'GET', `/api/checkups?patientId=${patientId}&includeDeleted=true`);
    assert.equal(includedList.status, 200);
    assert.ok(includedList.json.some((item) => item.id === checkupId), 'legacy checkup includeDeleted should expose tombstones');

    const tombstone = await localRequest('GET', `/api/v1/patients/${patientId}/checkups/${checkupId}`);
    assert.equal(tombstone.status, 200);
    assert.ok(tombstone.json?.deletedAt, 'checkup tombstone should remain readable by id');
    assert.equal(tombstone.json?.deletionReason, 'legacy-checkup-delete-smoke');
    assert.equal(tombstone.json?.version, 3);

    const restore = await webRequest(cookieHeader, 'PUT', `/api/checkups/${checkupId}`, {
        version: tombstone.json.version,
        deletedAt: null,
        deletionReason: null,
    });
    assert.equal(restore.status, 200);

    const restoredList = await webRequest(cookieHeader, 'GET', `/api/checkups?patientId=${patientId}`);
    assert.equal(restoredList.status, 200);
    assert.ok(restoredList.json.some((item) => item.id === checkupId), 'legacy checkup list should show restored records');

    const restored = await localRequest('GET', `/api/v1/patients/${patientId}/checkups/${checkupId}`);
    assert.equal(restored.status, 200);
    assert.equal(restored.json?.deletedAt, null);
    assert.equal(restored.json?.deletionReason, null);
    assert.equal(restored.json?.version, 4);

    scenarioResults.push({ resource: 'checkup', checkupId, staleStatus: stale.status, deleteStatus: deletion.status, restoreStatus: restore.status });
}

async function assertServerReady() {
    const response = await localRequest('GET', '/api/v1/patients');
    assert.equal(response.status, 200, `Expected ${BASE_URL}/api/v1/patients to be reachable`);
}

async function login() {
    const loginResponse = await loginWithWebAuthControl(BASE_URL, { username: USERNAME, password: PIN });
    assert.equal(loginResponse.response.status, 200);
    assert.ok(loginResponse.cookieHeader);
    return loginResponse.cookieHeader;
}

async function createSeedPatient() {
    const id = crypto.randomUUID();
    const suffix = id.replace(/-/g, '').slice(0, 13).toUpperCase();
    const { status, json } = await localRequest('POST', '/api/v1/patients', {
        id,
        firstName: 'Legacy',
        lastName: 'Clinical',
        taxCode: `LCW${suffix}`,
        notes: 'legacy-clinical-writes',
        isAdi: false,
        isArchived: false,
    });

    assert.equal(status, 201);
    assert.equal(json?.id, id);
    return id;
}

async function expectWebError(cookieHeader, method, pathname, body, status, error) {
    const result = await webRequest(cookieHeader, method, pathname, body);
    assert.equal(result.status, status);
    assert.deepEqual(result.json, { error });
}

async function webRequest(cookieHeader, method, pathname, body) {
    return await request(method, pathname, {
        headers: {
            Cookie: cookieHeader,
            'Cache-Control': 'no-store',
        },
        body,
    });
}

async function localRequest(method, pathname, body) {
    return await request(method, pathname, {
        headers: {
            Authorization: `Bearer ${LOCAL_API_TOKEN}`,
            'Cache-Control': 'no-store',
        },
        body,
    });
}

async function request(method, pathname, { headers = {}, body } = {}) {
    const finalHeaders = { ...headers };
    let payload;

    if (body !== undefined) {
        finalHeaders['Content-Type'] = 'application/json';
        payload = JSON.stringify(body);
    }

    const response = await fetch(new URL(pathname, BASE_URL), {
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

    return { response, status: response.status, json, text };
}

function resolveReportPath() {
    const dataDir = process.env.MEDIFLOW_DATA_DIR || process.env.MEDIFLOW_LEGACY_CLINICAL_WRITES_DATA_DIR;
    if (dataDir) {
        return path.join(dataDir, 'reports', 'legacy-clinical-writes-report.json');
    }

    return path.join(process.cwd(), 'tmp-legacy-clinical-writes-report.json');
}
