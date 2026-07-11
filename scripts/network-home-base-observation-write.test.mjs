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
const READ_PATIENTS_CAPABILITY = 'network.replica.readonly-patients';
const READ_OBSERVATIONS_CAPABILITY = 'network.replica.readonly-observations';
const WRITE_OBSERVATIONS_CAPABILITY = 'network.replica.write-observations';
const SEALED_NOTES = 'ENC:bm90ZXNpdg==:bm90ZXNjaXBoZXI=';

const scenarioResults = [];

after(() => {
    const report = {
        generatedAt: new Date().toISOString(),
        baseUrl: BASE_URL,
        scenarios: scenarioResults,
    };

    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`[network-home-base-observation-write] Report written to ${REPORT_PATH}`);
});

test('paired observation write requires capability, session, scope, version, and PHI-safe audit', async () => {
    await assertServerReady();

    const ambulatoryId = await resolveDefaultAmbulatoryId();
    await enableHomeBaseMode();
    const patientId = await createSeedPatient(ambulatoryId);

    try {
        const readOnlyClient = await pairClient(
            [READ_PATIENTS_CAPABILITY, READ_OBSERVATIONS_CAPABILITY],
            'Desk iPad observation readonly',
        );
        const observationWriter = await pairClient(
            [READ_PATIENTS_CAPABILITY, READ_OBSERVATIONS_CAPABILITY, WRITE_OBSERVATIONS_CAPABILITY],
            'Desk iPad observation writer',
        );

        const login = await request('POST', '/api/auth/login', {
            body: {
                username: USERNAME,
                password: PIN,
            },
        });
        assert.equal(login.response.status, 200);
        const sessionCookie = extractSessionCookie(login.response);

        const readOnlyCreate = await request('POST', `/api/v1/network/patients/${patientId}/observations`, {
            headers: {
                ...pairedHeaders(readOnlyClient),
                Cookie: sessionCookie,
            },
            body: {
                codeSystem: 'LOINC',
                code: '8480-6',
                display: 'Systolic blood pressure',
                unitSystem: 'UCUM',
                unitCode: 'mm[Hg]',
                value: 128,
                observedAt: '2026-05-02T09:00:00.000Z',
                notes: 'smoke-test',
                source: 'manual',
            },
        });
        assert.equal(readOnlyCreate.response.status, 403);

        const missingSession = await request('POST', `/api/v1/network/patients/${patientId}/observations`, {
            headers: pairedHeaders(observationWriter),
            body: {
                codeSystem: 'LOINC',
                code: '8480-6',
                display: 'Systolic blood pressure',
                unitSystem: 'UCUM',
                unitCode: 'mm[Hg]',
                value: 128,
                observedAt: '2026-05-02T09:00:00.000Z',
                notes: 'smoke-test',
                source: 'manual',
            },
        });
        assert.equal(missingSession.response.status, 401);

        const plaintextNotes = await request('POST', `/api/v1/network/patients/${patientId}/observations`, {
            headers: {
                ...pairedHeaders(observationWriter),
                Cookie: sessionCookie,
            },
            body: {
                codeSystem: 'LOINC',
                code: '8480-6',
                display: 'Systolic blood pressure',
                unitSystem: 'UCUM',
                unitCode: 'mm[Hg]',
                value: 128,
                observedAt: '2026-05-02T09:00:00.000Z',
                notes: 'smoke-test',
                source: 'manual',
            },
        });
        assert.equal(plaintextNotes.response.status, 400);
        assert.equal(plaintextNotes.json?.error, 'Network observation notes must be sealed with ENC:');

        const create = await request('POST', `/api/v1/network/patients/${patientId}/observations`, {
            headers: {
                ...pairedHeaders(observationWriter),
                Cookie: sessionCookie,
            },
            body: {
                codeSystem: 'LOINC',
                code: '8480-6',
                display: 'Systolic blood pressure',
                unitSystem: 'UCUM',
                unitCode: 'mm[Hg]',
                value: 128,
                observedAt: '2026-05-02T09:00:00.000Z',
                notes: SEALED_NOTES,
                source: 'manual',
            },
        });
        assert.equal(create.response.status, 201);
        const observationId = create.json?.id;
        assert.ok(typeof observationId === 'string' && observationId.length > 0);
        assert.equal(create.json?.version, 1);

        const detail = await request('GET', `/api/v1/network/patients/${patientId}/observations/${observationId}`, {
            headers: {
                ...pairedHeaders(observationWriter),
                Cookie: sessionCookie,
            },
        });
        assert.equal(detail.response.status, 200);
        assert.equal(detail.json?.id, observationId);
        assert.equal(detail.json?.version, 1);
        assert.equal(detail.json?.codeSystem, 'LOINC');
        assert.equal(detail.json?.code, '8480-6');
        assert.equal(detail.json?.unitSystem, 'UCUM');
        assert.equal(detail.json?.unitCode, 'mm[Hg]');
        assert.equal(detail.json?.value, '128');
        assert.equal(detail.json?.observedAt, '2026-05-02T09:00:00.000Z');
        assert.equal(detail.json?.deletedAt, null);

        const update = await request('PUT', `/api/v1/network/patients/${patientId}/observations/${observationId}`, {
            headers: {
                ...pairedHeaders(observationWriter),
                Cookie: sessionCookie,
            },
            body: {
                version: 1,
                value: 132,
            },
        });
        assert.equal(update.response.status, 200);
        assert.deepEqual(update.json, { success: true });

        const updatedDetail = await request('GET', `/api/v1/network/patients/${patientId}/observations/${observationId}`, {
            headers: {
                ...pairedHeaders(observationWriter),
                Cookie: sessionCookie,
            },
        });
        assert.equal(updatedDetail.response.status, 200);
        assert.equal(updatedDetail.json?.value, '132');
        assert.equal(updatedDetail.json?.version, 2);

        const conflict = await request('PUT', `/api/v1/network/patients/${patientId}/observations/${observationId}`, {
            headers: {
                ...pairedHeaders(observationWriter),
                Cookie: sessionCookie,
            },
            body: {
                version: 1,
                value: 135,
            },
        });
        assert.equal(conflict.response.status, 409);
        assert.equal(conflict.json?.code, 'VERSION_CONFLICT');
        assert.equal(conflict.json?.entity, 'observation');
        assert.equal(conflict.json?.currentVersion, 2);
        assert.equal(Object.prototype.hasOwnProperty.call(conflict.json?.currentSnapshot ?? {}, 'value'), false);
        assert.equal(Object.prototype.hasOwnProperty.call(conflict.json?.currentSnapshot ?? {}, 'notes'), false);

        const aiField = await request('PUT', `/api/v1/network/patients/${patientId}/observations/${observationId}`, {
            headers: {
                ...pairedHeaders(observationWriter),
                Cookie: sessionCookie,
            },
            body: {
                version: 2,
                documentInsights: 'blocked remote document-derived field',
            },
        });
        assert.equal(aiField.response.status, 403);
        assert.equal(aiField.json?.error, 'Network observation write boundary excludes AI/document-derived fields');

        const softDelete = await request('PUT', `/api/v1/network/patients/${patientId}/observations/${observationId}`, {
            headers: {
                ...pairedHeaders(observationWriter),
                Cookie: sessionCookie,
            },
            body: {
                version: 2,
                deletedAt: '2026-05-02T10:00:00.000Z',
                deletionReason: 'network-smoke-soft-delete',
            },
        });
        assert.equal(softDelete.response.status, 200);

        const deletedDetail = await request('GET', `/api/v1/network/patients/${patientId}/observations/${observationId}`, {
            headers: {
                ...pairedHeaders(observationWriter),
                Cookie: sessionCookie,
            },
        });
        assert.equal(deletedDetail.response.status, 200);
        assert.equal(deletedDetail.json?.version, 3);
        assert.equal(deletedDetail.json?.deletedAt, '2026-05-02T10:00:00.000Z');

        const remoteHardDelete = await request('DELETE', `/api/v1/network/patients/${patientId}/observations/${observationId}`, {
            headers: {
                ...pairedHeaders(observationWriter),
                Cookie: sessionCookie,
            },
            body: {
                version: 3,
            },
        });
        assert.equal(remoteHardDelete.response.status, 405);

        const createdAudit = await findAuditEvent('observation.created', observationId, sessionCookie);
        assert.equal(createdAudit.actorType, 'user');
        assert.equal(createdAudit.sourceSurface, 'native');
        assert.ok(createdAudit.redactedMetadata?.flags?.includes('auth:paired-client'));
        assert.ok(createdAudit.redactedMetadata?.flags?.includes(`paired-client:${observationWriter.pairedClientId}`));
        assert.deepEqual(createdAudit.redactedMetadata?.changedFields, ['codeSystem', 'code', 'display', 'unitSystem', 'unitCode', 'value', 'observedAt', 'notes', 'source']);
        assert.equal(createdAudit.redactedMetadata?.resourceVersion, 1);

        const updatedAudit = await findAuditEvent('observation.updated', observationId, sessionCookie);
        assert.deepEqual(updatedAudit.redactedMetadata?.changedFields, ['value']);
        assert.equal(updatedAudit.redactedMetadata?.resourceVersion, 2);

        const deletedAudit = await findAuditEvent('observation.deleted', observationId, sessionCookie);
        assert.deepEqual(deletedAudit.redactedMetadata?.changedFields, ['deletedAt', 'deletionReason']);
        assert.equal(deletedAudit.redactedMetadata?.resourceVersion, 3);

        scenarioResults.push({
            name: 'paired observation write',
            ambulatoryId,
            patientId,
            observationId,
            readOnlyForbiddenStatus: readOnlyCreate.response.status,
            missingSessionStatus: missingSession.response.status,
            createStatus: create.response.status,
            updateStatus: update.response.status,
            conflictStatus: conflict.response.status,
            aiFieldStatus: aiField.response.status,
            softDeleteStatus: softDelete.response.status,
            remoteHardDeleteStatus: remoteHardDelete.response.status,
            pairedClientId: observationWriter.pairedClientId,
        });
    } finally {
        await cleanupPatient(patientId);
    }
});

test('web clinical lifecycle rejects stale writes, preserves observation tombstones, and refuses creates for deleted patients', async () => {
    await assertServerReady();

    const ambulatoryId = await resolveDefaultAmbulatoryId();
    const patientId = await createSeedPatient(ambulatoryId);
    const login = await request('POST', '/api/auth/login', {
        body: { username: USERNAME, password: PIN },
    });
    assert.equal(login.response.status, 200);
    const sessionCookie = extractSessionCookie(login.response);

    try {
        const therapy = await request('POST', '/api/therapies', {
            headers: { Cookie: sessionCookie },
            body: {
                patientId,
                drugName: 'Lifecycle test therapy',
                dosage: '1 compressa',
                startDate: '2026-05-02T09:00:00.000Z',
            },
        });
        assert.equal(therapy.response.status, 201);

        const therapyUpdate = await request('PUT', `/api/therapies/${therapy.json.id}`, {
            headers: { Cookie: sessionCookie },
            body: { version: 1, status: 'suspended' },
        });
        assert.equal(therapyUpdate.response.status, 200);

        const staleTherapyUpdate = await request('PUT', `/api/therapies/${therapy.json.id}`, {
            headers: { Cookie: sessionCookie },
            body: { version: 1, status: 'completed' },
        });
        assert.equal(staleTherapyUpdate.response.status, 409);
        assert.equal(staleTherapyUpdate.json?.code, 'VERSION_CONFLICT');
        assert.equal(staleTherapyUpdate.json?.entity, 'therapy');
        assert.equal(staleTherapyUpdate.json?.currentVersion, 2);

        const observation = await request('POST', '/api/observations', {
            headers: { Cookie: sessionCookie },
            body: {
                patientId,
                codeSystem: 'LOINC',
                code: '8480-6',
                display: 'Systolic blood pressure',
                unitSystem: 'UCUM',
                unitCode: 'mm[Hg]',
                value: 128,
                observedAt: '2026-05-02T09:00:00.000Z',
                source: 'manual',
            },
        });
        assert.equal(observation.response.status, 201);

        const observationDelete = await request('DELETE', `/api/observations/${observation.json.id}`, {
            headers: { Cookie: sessionCookie },
            body: { version: 1 },
        });
        assert.equal(observationDelete.response.status, 200);

        const deletedObservations = await request('GET', `/api/observations?patientId=${patientId}&includeDeleted=true`, {
            headers: { Cookie: sessionCookie },
        });
        assert.equal(deletedObservations.response.status, 200);
        const deletedObservation = deletedObservations.json.find((item) => item.id === observation.json.id);
        assert.ok(deletedObservation, 'Soft-deleted observation must remain recoverable');
        assert.ok(deletedObservation.deletedAt, 'Soft-deleted observation must have deletedAt');
        assert.equal(deletedObservation.version, 2);

        const patient = await request('GET', `/api/v1/patients/${patientId}`, {
            headers: localApiHeaders(),
        });
        assert.equal(patient.response.status, 200);
        const patientDelete = await request('DELETE', `/api/v1/patients/${patientId}`, {
            headers: localApiHeaders(),
            body: { version: patient.json.version },
        });
        assert.equal(patientDelete.response.status, 200);

        const webCreates = [
            ['/api/entries', { patientId, type: 'note', date: '2026-05-02T09:00:00.000Z', content: 'blocked' }],
            ['/api/therapies', { patientId, drugName: 'Blocked therapy', dosage: '1 compressa', startDate: '2026-05-02T09:00:00.000Z' }],
            ['/api/checkups', { patientId, title: 'Blocked checkup', date: '2026-05-02T09:00:00.000Z' }],
            ['/api/observations', { patientId, codeSystem: 'LOINC', code: '8480-6', display: 'Systolic blood pressure', unitSystem: 'UCUM', unitCode: 'mm[Hg]', value: 128, observedAt: '2026-05-02T09:00:00.000Z', source: 'manual' }],
        ];
        for (const [pathname, body] of webCreates) {
            const response = await request('POST', pathname, { headers: { Cookie: sessionCookie }, body });
            assert.equal(response.response.status, 404, `Expected deleted patient create guard for ${pathname}`);
        }

        const v1Creates = [
            [`/api/v1/patients/${patientId}/entries`, { type: 'note', date: '2026-05-02T09:00:00.000Z', content: 'blocked' }],
            [`/api/v1/patients/${patientId}/therapies`, { drugName: 'Blocked therapy', dosage: '1 compressa', startDate: '2026-05-02T09:00:00.000Z' }],
            [`/api/v1/patients/${patientId}/checkups`, { title: 'Blocked checkup', date: '2026-05-02T09:00:00.000Z' }],
            [`/api/v1/patients/${patientId}/observations`, { codeSystem: 'LOINC', code: '8480-6', display: 'Systolic blood pressure', unitSystem: 'UCUM', unitCode: 'mm[Hg]', value: 128, observedAt: '2026-05-02T09:00:00.000Z', source: 'manual' }],
        ];
        for (const [pathname, body] of v1Creates) {
            const response = await request('POST', pathname, { headers: localApiHeaders(), body });
            assert.equal(response.response.status, 404, `Expected deleted patient create guard for ${pathname}`);
        }

        scenarioResults.push({
            name: 'web clinical lifecycle',
            patientId,
            staleTherapyStatus: staleTherapyUpdate.response.status,
            observationDeleteStatus: observationDelete.response.status,
            deletedPatientCreateStatus: 404,
        });
    } finally {
        await cleanupPatient(patientId);
    }
});

async function findAuditEvent(eventType, subjectRef, sessionCookie) {
    const audit = await request('GET', `/api/system/audit?eventType=${eventType}&subjectType=observation&limit=20`, {
        headers: {
            Cookie: sessionCookie,
        },
    });
    assert.equal(audit.response.status, 200);
    assert.ok(Array.isArray(audit.json));
    const event = audit.json.find((row) => row.subjectRef === subjectRef);
    assert.ok(event, `Expected ${eventType} audit event for ${subjectRef}`);
    return event;
}

async function assertServerReady() {
    const response = await request('GET', '/api/v1/ambulatories', {
        headers: localApiHeaders(),
    });
    assert.equal(response.response.status, 200, `Expected ${BASE_URL}/api/v1/ambulatories to be reachable`);
}

async function resolveDefaultAmbulatoryId() {
    const response = await request('GET', '/api/v1/ambulatories', {
        headers: localApiHeaders(),
    });
    assert.equal(response.response.status, 200);
    assert.ok(Array.isArray(response.json));
    const defaultAmbulatory = response.json.find((item) => item.isDefault) ?? response.json[0];
    assert.ok(defaultAmbulatory?.id, 'Expected at least one ambulatory in the smoke database');
    return defaultAmbulatory.id;
}

async function enableHomeBaseMode() {
    const networkMode = await request('PUT', '/api/settings/network.mode', {
        headers: localApiHeaders(),
        body: { value: 'network-home-base' },
    });
    assert.equal(networkMode.response.status, 200);

    const clinicName = await request('PUT', '/api/settings/clinicName', {
        headers: localApiHeaders(),
        body: { value: 'MediFlow Network Observation Write Smoke' },
    });
    assert.equal(clinicName.response.status, 200);
}

async function pairClient(requestedCapabilities, deviceName) {
    const pairingIntent = await request('POST', '/api/v1/network/pairing-intents', {
        body: {
            deviceName,
            clientPlatform: 'ipados',
            appVersion: '0.5.0-smoke',
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

async function createSeedPatient(ambulatoryId) {
    const patientId = crypto.randomUUID();
    const suffix = patientId.replace(/-/g, '').slice(0, 13).toUpperCase();
    const response = await request('POST', '/api/v1/patients', {
        headers: localApiHeaders(),
        body: {
            id: patientId,
            firstName: 'Network',
            lastName: 'Observation',
            taxCode: `NTT${suffix}`,
            ambulatoryId,
            notes: 'network-home-base-observation-write-smoke',
            isAdi: false,
            isArchived: false,
        },
    });

    assert.equal(response.response.status, 201);
    assert.equal(response.json?.id, patientId);
    return patientId;
}

async function cleanupPatient(patientId) {
    const observations = await request('GET', `/api/v1/patients/${patientId}/observations`, {
        headers: localApiHeaders(),
    });
    if (observations.response.status === 200 && Array.isArray(observations.json)) {
        for (const observation of observations.json) {
            if (!observation?.id) continue;
            const deletion = await request('DELETE', `/api/v1/patients/${patientId}/observations/${observation.id}`, {
                headers: localApiHeaders(),
                // WUL-308: child DELETEs require optimistic concurrency.
                body: { version: observation.version },
            });
            assert.equal(deletion.response.status, 200);
        }
    }

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

function extractSessionCookie(response) {
    const setCookies = typeof response.headers.getSetCookie === 'function'
        ? response.headers.getSetCookie()
        : [];
    const cookieSource = setCookies.find((cookie) => cookie.startsWith('mediflow_session='))
        ?? response.headers.get('set-cookie');
    if (!cookieSource) {
        throw new Error('mediflow_session cookie was not returned by /api/auth/login');
    }

    return cookieSource.split(';')[0];
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
        return path.join(dataDir, 'reports', 'network-home-base-observation-write-report.json');
    }

    return path.join(process.cwd(), 'tmp-network-home-base-observation-write-report.json');
}
