#!/usr/bin/env node
/* @Codex */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';

const BASE_URL = process.env.E2E_BASE_URL || 'http://127.0.0.1:3300';
const LOCAL_API_TOKEN = process.env.MEDIFLOW_LOCAL_API_TOKEN || 'mediflow-api-v1-put-negative-token';
const REPORT_PATH = resolveReportPath();
const scenarioResults = [];

after(() => {
    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, `${JSON.stringify({
        generatedAt: new Date().toISOString(),
        baseUrl: BASE_URL,
        scenarios: scenarioResults,
    }, null, 2)}\n`);
    console.log(`[api-v1-put-negative] Report written to ${REPORT_PATH}`);
});

test('clinical PUT routes reject invalid provided fields with deterministic 400 errors', async () => {
    await assertServerReady();

    const patientId = await createSeedPatient();
    const ids = await createClinicalResources(patientId);
    const cases = [
        // WUL-308: child PUTs require optimistic concurrency, so version travels with the payload.
        ['entries missing version', `/api/v1/patients/${patientId}/entries/${ids.entryId}`, { content: 'updated' }, 400, 'Version is required'],
        ['entries invalid date', `/api/v1/patients/${patientId}/entries/${ids.entryId}`, { version: 1, date: 'bad-date', content: 'updated' }, 400, 'Invalid date'],
        ['entries no valid fields', `/api/v1/patients/${patientId}/entries/${ids.entryId}`, { version: 1 }, 400, 'No valid fields to update'],
        ['therapies missing version', `/api/v1/patients/${patientId}/therapies/${ids.therapyId}`, { dosage: '500 mg' }, 400, 'Version is required'],
        ['therapies invalid required drugName', `/api/v1/patients/${patientId}/therapies/${ids.therapyId}`, { version: 1, drugName: '', dosage: '500 mg' }, 400, 'Invalid drugName'],
        ['therapies invalid nullable diagnosisCode', `/api/v1/patients/${patientId}/therapies/${ids.therapyId}`, { version: 1, diagnosisCode: 1234, dosage: '500 mg' }, 400, 'Invalid diagnosisCode'],
        ['therapies no valid fields', `/api/v1/patients/${patientId}/therapies/${ids.therapyId}`, { version: 1 }, 400, 'No valid fields to update'],
        ['checkups missing version', `/api/v1/patients/${patientId}/checkups/${ids.checkupId}`, { title: 'Controllo' }, 400, 'Version is required'],
        ['checkups invalid required title', `/api/v1/patients/${patientId}/checkups/${ids.checkupId}`, { version: 1, title: '' }, 400, 'Invalid title'],
        ['checkups invalid nullable notes', `/api/v1/patients/${patientId}/checkups/${ids.checkupId}`, { version: 1, notes: 1234, title: 'Controllo' }, 400, 'Invalid notes'],
        ['checkups no valid fields', `/api/v1/patients/${patientId}/checkups/${ids.checkupId}`, { version: 1 }, 400, 'No valid fields to update'],
        ['observations missing version', `/api/v1/patients/${patientId}/observations/${ids.observationId}`, { value: '80' }, 400, 'Version is required'],
        ['observations invalid codeSystem', `/api/v1/patients/${patientId}/observations/${ids.observationId}`, { version: 1, codeSystem: 'SNOMED' }, 400, 'Only LOINC observations are supported'],
        ['observations invalid value', `/api/v1/patients/${patientId}/observations/${ids.observationId}`, { version: 1, value: { raw: 72 } }, 400, 'Invalid value field'],
        ['observations no valid fields', `/api/v1/patients/${patientId}/observations/${ids.observationId}`, { version: 1 }, 400, 'No valid fields to update'],
    ];

    for (const [name, pathname, body, status, error] of cases) {
        await expectError({ name, pathname, body, status, error });
    }
});

test('clinical PUT routes keep not-found precedence over payload validation', async () => {
    await assertServerReady();

    const patientId = await createSeedPatient();
    await expectError({
        name: 'therapies missing record returns 404 before invalid payload',
        pathname: `/api/v1/patients/${patientId}/therapies/${crypto.randomUUID()}`,
        body: { version: 1, drugName: '', dosage: '500 mg' },
        status: 404,
        error: 'Not found',
    });
});

// WUL-308: the four clinical sub-resources share the same optimistic-concurrency contract.
test('clinical PUT routes return 409 with a version-conflict payload on stale versions', async () => {
    await assertServerReady();

    const patientId = await createSeedPatient();
    const resources = [
        ['entries', 'entry', { content: 'Contenuto aggiornato' }],
        ['therapies', 'therapy', { dosage: '850 mg' }],
        ['checkups', 'checkup', { title: 'Controllo aggiornato' }],
        ['observations', 'observation', { value: '76' }],
    ];
    const ids = await createClinicalResources(patientId);
    const idByResource = {
        entries: ids.entryId,
        therapies: ids.therapyId,
        checkups: ids.checkupId,
        observations: ids.observationId,
    };

    for (const [resource, entity, update] of resources) {
        const pathname = `/api/v1/patients/${patientId}/${resource}/${idByResource[resource]}`;
        const fresh = await request('PUT', pathname, { ...update, version: 1 });
        assert.equal(fresh.status, 200, `${resource} PUT with matching version should succeed`);

        const stale = await request('PUT', pathname, { ...update, version: 1 });
        assert.equal(stale.status, 409, `${resource} PUT with stale version should return 409`);
        assert.equal(stale.json?.error, 'Conflict');
        assert.equal(stale.json?.code, 'VERSION_CONFLICT');
        assert.equal(stale.json?.entity, entity);
        assert.equal(stale.json?.recordId, idByResource[resource]);
        assert.equal(stale.json?.expectedVersion, 1);
        assert.equal(stale.json?.currentVersion, 2);
        assert.equal(stale.json?.currentState, 'present');

        scenarioResults.push({
            name: `${resource} stale version conflict`,
            pathname,
            status: stale.status,
            code: stale.json?.code,
        });
    }
});

// WUL-308: therapies/checkups/observations DELETE now soft-deletes like entries,
// guarded by version, and default lists hide tombstoned rows.
test('clinical DELETE soft-deletes with version guard and hides tombstones from default lists', async () => {
    await assertServerReady();

    const patientId = await createSeedPatient();
    const resources = ['entries', 'therapies', 'checkups', 'observations'];
    const ids = await createClinicalResources(patientId);
    const idByResource = {
        entries: ids.entryId,
        therapies: ids.therapyId,
        checkups: ids.checkupId,
        observations: ids.observationId,
    };

    for (const resource of resources) {
        const listPath = `/api/v1/patients/${patientId}/${resource}`;
        const detailPath = `${listPath}/${idByResource[resource]}`;

        const missingVersion = await request('DELETE', detailPath, { deletionReason: 'senza-versione' });
        assert.equal(missingVersion.status, 400, `${resource} DELETE without version should return 400`);
        assert.deepEqual(missingVersion.json, { error: 'Version is required' });

        const staleVersion = await request('DELETE', detailPath, { version: 99, deletionReason: 'versione-stantia' });
        assert.equal(staleVersion.status, 409, `${resource} DELETE with stale version should return 409`);
        assert.equal(staleVersion.json?.code, 'VERSION_CONFLICT');
        assert.equal(staleVersion.json?.currentVersion, 1);

        const deletion = await request('DELETE', detailPath, { version: 1, deletionReason: 'api-v1-lifecycle-smoke' });
        assert.equal(deletion.status, 200, `${resource} DELETE with matching version should succeed`);

        const deletedDetail = await request('GET', detailPath);
        assert.equal(deletedDetail.status, 200, `${resource} tombstone should remain readable by id`);
        assert.ok(deletedDetail.json?.deletedAt, `${resource} tombstone should carry deletedAt`);
        assert.equal(deletedDetail.json?.deletionReason, 'api-v1-lifecycle-smoke');
        assert.equal(deletedDetail.json?.version, 2);

        const hiddenList = await request('GET', listPath);
        assert.equal(hiddenList.status, 200);
        assert.ok(
            !hiddenList.json.some((item) => item.id === idByResource[resource]),
            `${resource} soft-deleted row should be hidden from the default list`,
        );

        const includedList = await request('GET', `${listPath}?includeDeleted=true`);
        assert.equal(includedList.status, 200);
        assert.ok(
            includedList.json.some((item) => item.id === idByResource[resource]),
            `${resource} includeDeleted should expose tombstoned rows`,
        );

        scenarioResults.push({
            name: `${resource} delete soft tombstone with version guard`,
            pathname: detailPath,
            missingVersionStatus: missingVersion.status,
            staleVersionStatus: staleVersion.status,
            deleteStatus: deletion.status,
        });
    }
});

test('clinical entry PUT soft-delete hides by default and restore clears tombstone fields', async () => {
    await assertServerReady();

    const patientId = await createSeedPatient();
    const entry = await createResource(`/api/v1/patients/${patientId}/entries`, {
        type: 'note',
        title: 'Nota soft delete',
        date: '2026-05-02T09:00:00.000Z',
        content: 'Voce da cancellare in modo reversibile',
    });

    const beforeList = await request('GET', `/api/v1/patients/${patientId}/entries`);
    assert.equal(beforeList.status, 200);
    assert.ok(beforeList.json.some((item) => item.id === entry.id), 'entry should be visible before soft delete');
    const beforeDetail = await request('GET', `/api/v1/patients/${patientId}/entries/${entry.id}`);
    assert.equal(beforeDetail.status, 200);

    const softDeleteAt = '2026-05-02T10:00:00.000Z';
    const softDelete = await request('PUT', `/api/v1/patients/${patientId}/entries/${entry.id}`, {
        version: beforeDetail.json.version,
        deletedAt: softDeleteAt,
        deletionReason: 'api-v1-soft-delete-smoke',
    });
    assert.equal(softDelete.status, 200);

    const deletedDetail = await request('GET', `/api/v1/patients/${patientId}/entries/${entry.id}`);
    assert.equal(deletedDetail.status, 200);
    assert.equal(deletedDetail.json?.deletedAt, softDeleteAt);
    assert.equal(deletedDetail.json?.deletionReason, 'api-v1-soft-delete-smoke');
    assert.equal(deletedDetail.json?.version, beforeDetail.json.version + 1);

    const hiddenList = await request('GET', `/api/v1/patients/${patientId}/entries`);
    assert.equal(hiddenList.status, 200);
    assert.ok(!hiddenList.json.some((item) => item.id === entry.id), 'soft-deleted entry should be hidden by default');

    const includedList = await request('GET', `/api/v1/patients/${patientId}/entries?includeDeleted=true`);
    assert.equal(includedList.status, 200);
    assert.ok(includedList.json.some((item) => item.id === entry.id), 'includeDeleted should expose tombstoned entries');

    const restore = await request('PUT', `/api/v1/patients/${patientId}/entries/${entry.id}`, {
        version: deletedDetail.json.version,
        deletedAt: null,
        deletionReason: null,
    });
    assert.equal(restore.status, 200);

    const restoredDetail = await request('GET', `/api/v1/patients/${patientId}/entries/${entry.id}`);
    assert.equal(restoredDetail.status, 200);
    assert.equal(restoredDetail.json?.deletedAt, null);
    assert.equal(restoredDetail.json?.deletionReason, null);
    assert.equal(restoredDetail.json?.version, deletedDetail.json.version + 1);

    const restoredList = await request('GET', `/api/v1/patients/${patientId}/entries`);
    assert.equal(restoredList.status, 200);
    assert.ok(restoredList.json.some((item) => item.id === entry.id), 'restored entry should be visible again');

    scenarioResults.push({
        name: 'entries soft delete restore',
        patientId,
        entryId: entry.id,
        softDeleteStatus: softDelete.status,
        restoreStatus: restore.status,
    });
});

test('clinical entry DELETE writes a validated soft-delete tombstone instead of hard-deleting', async () => {
    await assertServerReady();

    const patientId = await createSeedPatient();
    const entry = await createResource(`/api/v1/patients/${patientId}/entries`, {
        type: 'note',
        title: 'Nota DELETE soft',
        date: '2026-05-02T11:00:00.000Z',
        content: 'Voce da cancellare tramite DELETE sicuro',
    });

    const invalidDelete = await request('DELETE', `/api/v1/patients/${patientId}/entries/${entry.id}`, {
        version: 1,
        deletionReason: 1234,
    });
    assert.equal(invalidDelete.status, 400);
    assert.deepEqual(invalidDelete.json, { error: 'Invalid deletionReason' });

    const invalidDeleteDate = await request('DELETE', `/api/v1/patients/${patientId}/entries/${entry.id}`, {
        version: 1,
        deletedAt: 'not-a-date',
        deletionReason: 'invalid-date-smoke',
    });
    assert.equal(invalidDeleteDate.status, 400);
    assert.deepEqual(invalidDeleteDate.json, { error: 'Invalid deletedAt' });

    const detailBeforeDelete = await request('GET', `/api/v1/patients/${patientId}/entries/${entry.id}`);
    assert.equal(detailBeforeDelete.status, 200);
    assert.equal(detailBeforeDelete.json?.deletedAt, null);

    const deletedAt = '2026-05-02T12:00:00.000Z';
    const deletion = await request('DELETE', `/api/v1/patients/${patientId}/entries/${entry.id}`, {
        version: detailBeforeDelete.json.version,
        deletedAt,
        deletionReason: 'api-v1-delete-soft-smoke',
    });
    assert.equal(deletion.status, 200);

    const deletedDetail = await request('GET', `/api/v1/patients/${patientId}/entries/${entry.id}`);
    assert.equal(deletedDetail.status, 200);
    assert.equal(deletedDetail.json?.deletedAt, deletedAt);
    assert.equal(deletedDetail.json?.deletionReason, 'api-v1-delete-soft-smoke');
    assert.equal(deletedDetail.json?.version, detailBeforeDelete.json.version + 1);

    const hiddenList = await request('GET', `/api/v1/patients/${patientId}/entries`);
    assert.equal(hiddenList.status, 200);
    assert.ok(!hiddenList.json.some((item) => item.id === entry.id), 'DELETE tombstone should be hidden by default');

    const includedList = await request('GET', `/api/v1/patients/${patientId}/entries?includeDeleted=true`);
    assert.equal(includedList.status, 200);
    assert.ok(includedList.json.some((item) => item.id === entry.id), 'includeDeleted should include DELETE tombstones');

    scenarioResults.push({
        name: 'entries delete soft tombstone',
        patientId,
        entryId: entry.id,
        invalidDeleteStatus: invalidDelete.status,
        invalidDeleteDateStatus: invalidDeleteDate.status,
        deleteStatus: deletion.status,
    });
});

async function assertServerReady() {
    const response = await request('GET', '/api/v1/patients');
    assert.equal(response.status, 200, `Expected ${BASE_URL}/api/v1/patients to be reachable`);
}

async function createSeedPatient() {
    const id = crypto.randomUUID();
    const suffix = id.replace(/-/g, '').slice(0, 13).toUpperCase();
    const { status, json } = await request('POST', '/api/v1/patients', {
        id,
        firstName: 'Route',
        lastName: 'Negative',
        taxCode: `RTE${suffix}`,
        notes: 'api-v1-put-negative-routes',
        isAdi: false,
        isArchived: false,
    });

    assert.equal(status, 201);
    assert.equal(json?.id, id);
    return id;
}

async function createClinicalResources(patientId) {
    const [entry, therapy, checkup, observation] = await Promise.all([
        createResource(`/api/v1/patients/${patientId}/entries`, {
            type: 'visit',
            title: 'Visita',
            date: '2026-05-01T09:00:00.000Z',
            content: 'Contenuto sintetico',
        }),
        createResource(`/api/v1/patients/${patientId}/therapies`, {
            drugName: 'Metformina',
            dosage: '500 mg',
            startDate: '2026-05-01T09:00:00.000Z',
            status: 'active',
        }),
        createResource(`/api/v1/patients/${patientId}/checkups`, {
            date: '2026-05-02T09:00:00.000Z',
            title: 'Controllo diabetologico',
            status: 'pending',
            source: 'manual',
        }),
        createResource(`/api/v1/patients/${patientId}/observations`, {
            codeSystem: 'LOINC',
            code: '8867-4',
            display: 'Heart rate',
            unitSystem: 'UCUM',
            unitCode: '/min',
            value: '72',
            observedAt: '2026-05-01T09:00:00.000Z',
            source: 'manual',
        }),
    ]);

    return {
        entryId: entry.id,
        therapyId: therapy.id,
        checkupId: checkup.id,
        observationId: observation.id,
    };
}

async function createResource(pathname, body) {
    const { status, json } = await request('POST', pathname, body);
    assert.equal(status, 201, `${pathname} should create a resource`);
    assert.ok(typeof json?.id === 'string' && json.id.length > 0, `${pathname} should return an id`);
    return json;
}

async function expectError({ name, pathname, body, status, error }) {
    const result = await request('PUT', pathname, body);
    assert.equal(result.status, status, `${name} should return ${status}`);
    assert.deepEqual(result.json, { error }, `${name} should return deterministic error payload`);
    scenarioResults.push({ name, pathname, status: result.status, error: result.json?.error });
}

async function request(method, pathname, body) {
    const headers = {
        Authorization: `Bearer ${LOCAL_API_TOKEN}`,
        'Cache-Control': 'no-store',
    };
    let payload;

    if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
        payload = JSON.stringify(body);
    }

    const response = await fetch(new URL(pathname, BASE_URL), { method, headers, body: payload });
    const text = await response.text();
    return { status: response.status, json: text.length > 0 ? JSON.parse(text) : null };
}

function resolveReportPath() {
    const dataDir = process.env.MEDIFLOW_DATA_DIR || process.env.MEDIFLOW_API_V1_PUT_NEGATIVE_DATA_DIR;
    if (dataDir) {
        return path.join(dataDir, 'reports', 'api-v1-put-negative-routes-report.json');
    }

    return path.join(process.cwd(), 'tmp-api-v1-put-negative-routes-report.json');
}
