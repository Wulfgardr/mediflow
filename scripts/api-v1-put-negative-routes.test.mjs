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
        ['entries invalid date', `/api/v1/patients/${patientId}/entries/${ids.entryId}`, { date: 'bad-date', content: 'updated' }, 400, 'Invalid date'],
        ['entries no valid fields', `/api/v1/patients/${patientId}/entries/${ids.entryId}`, {}, 400, 'No valid fields to update'],
        ['therapies invalid required drugName', `/api/v1/patients/${patientId}/therapies/${ids.therapyId}`, { drugName: '', dosage: '500 mg' }, 400, 'Invalid drugName'],
        ['therapies invalid nullable diagnosisCode', `/api/v1/patients/${patientId}/therapies/${ids.therapyId}`, { diagnosisCode: 1234, dosage: '500 mg' }, 400, 'Invalid diagnosisCode'],
        ['therapies no valid fields', `/api/v1/patients/${patientId}/therapies/${ids.therapyId}`, {}, 400, 'No valid fields to update'],
        ['checkups invalid required title', `/api/v1/patients/${patientId}/checkups/${ids.checkupId}`, { title: '' }, 400, 'Invalid title'],
        ['checkups invalid nullable notes', `/api/v1/patients/${patientId}/checkups/${ids.checkupId}`, { notes: 1234, title: 'Controllo' }, 400, 'Invalid notes'],
        ['checkups no valid fields', `/api/v1/patients/${patientId}/checkups/${ids.checkupId}`, {}, 400, 'No valid fields to update'],
        ['observations invalid codeSystem', `/api/v1/patients/${patientId}/observations/${ids.observationId}`, { codeSystem: 'SNOMED' }, 400, 'Only LOINC observations are supported'],
        ['observations invalid value', `/api/v1/patients/${patientId}/observations/${ids.observationId}`, { value: { raw: 72 } }, 400, 'Invalid value field'],
        ['observations no valid fields', `/api/v1/patients/${patientId}/observations/${ids.observationId}`, {}, 400, 'No valid fields to update'],
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
        body: { drugName: '', dosage: '500 mg' },
        status: 404,
        error: 'Not found',
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
