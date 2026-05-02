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
const WRITE_CAPABILITY = 'network.replica.write-patient-profile';

const scenarioResults = [];

after(() => {
    const report = {
        generatedAt: new Date().toISOString(),
        baseUrl: BASE_URL,
        scenarios: scenarioResults,
    };

    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`[network-home-base-write] Report written to ${REPORT_PATH}`);
});

test('paired patient profile write requires write capability, session, scope, and version', async () => {
    await assertServerReady();

    const ambulatoryId = await resolveDefaultAmbulatoryId();
    await enableHomeBaseMode();
    const patientId = await createSeedPatient(ambulatoryId);

    try {
        const readOnlyClient = await pairClient(['network.replica.readonly-patients'], 'Desk iPad readonly');
        const writeClient = await pairClient([READ_CAPABILITY, WRITE_CAPABILITY], 'Desk iPad writer');

        const login = await request('POST', '/api/auth/login', {
            body: {
                username: USERNAME,
                password: PIN,
            },
        });
        assert.equal(login.response.status, 200);
        const sessionCookie = extractSessionCookie(login.response);

        const readOnlyWrite = await request('PUT', `/api/v1/network/patients/${patientId}`, {
            headers: {
                ...pairedHeaders(readOnlyClient),
                Cookie: sessionCookie,
            },
            body: {
                version: 1,
                phone: '+39 333 0000001',
            },
        });
        assert.equal(readOnlyWrite.response.status, 403);

        const missingSession = await request('PUT', `/api/v1/network/patients/${patientId}`, {
            headers: pairedHeaders(writeClient),
            body: {
                version: 1,
                phone: '+39 333 0000001',
            },
        });
        assert.equal(missingSession.response.status, 401);

        const update = await request('PUT', `/api/v1/network/patients/${patientId}`, {
            headers: {
                ...pairedHeaders(writeClient),
                Cookie: sessionCookie,
            },
            body: {
                version: 1,
                phone: '+39 333 0000001',
                isArchived: true,
            },
        });
        assert.equal(update.response.status, 200);
        assert.deepEqual(update.json, { success: true });

        const detail = await request('GET', `/api/v1/network/patients/${patientId}`, {
            headers: {
                ...pairedHeaders(writeClient),
                Cookie: sessionCookie,
            },
        });
        assert.equal(detail.response.status, 200);
        assert.equal(detail.json?.phone, '+39 333 0000001');
        assert.equal(detail.json?.isArchived, true);
        assert.equal(detail.json?.version, 2);

        const conflict = await request('PUT', `/api/v1/network/patients/${patientId}`, {
            headers: {
                ...pairedHeaders(writeClient),
                Cookie: sessionCookie,
            },
            body: {
                version: 1,
                phone: '+39 333 0000002',
            },
        });
        assert.equal(conflict.response.status, 409);
        assert.equal(conflict.json?.code, 'VERSION_CONFLICT');
        assert.equal(conflict.json?.currentVersion, 2);

        const aiField = await request('PUT', `/api/v1/network/patients/${patientId}`, {
            headers: {
                ...pairedHeaders(writeClient),
                Cookie: sessionCookie,
            },
            body: {
                version: 2,
                aiSummary: 'blocked remote AI field',
            },
        });
        assert.equal(aiField.response.status, 403);
        assert.equal(aiField.json?.error, 'Network patient write boundary excludes AI fields');

        const audit = await request('GET', `/api/system/audit?eventType=patient.updated&subjectType=patient&limit=20`, {
            headers: localApiHeaders(),
        });
        assert.equal(audit.response.status, 200);
        assert.ok(Array.isArray(audit.json));
        const event = audit.json.find((row) => row.subjectRef === patientId);
        assert.ok(event, 'Expected a patient.updated audit event for the network write');
        assert.equal(event.actorType, 'user');
        assert.equal(event.sourceSurface, 'native');
        assert.deepEqual(event.redactedMetadata?.changedFields, ['phone', 'isArchived']);
        assert.ok(event.redactedMetadata?.flags?.includes('auth:paired-client'));
        assert.ok(event.redactedMetadata?.flags?.includes(`paired-client:${writeClient.pairedClientId}`));

        scenarioResults.push({
            name: 'paired patient profile write',
            ambulatoryId,
            patientId,
            readOnlyForbiddenStatus: readOnlyWrite.response.status,
            missingSessionStatus: missingSession.response.status,
            updateStatus: update.response.status,
            conflictStatus: conflict.response.status,
            aiFieldStatus: aiField.response.status,
            pairedClientId: writeClient.pairedClientId,
        });
    } finally {
        await cleanupPatient(patientId);
    }
});

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
        body: { value: 'MediFlow Network Write Smoke' },
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
            lastName: 'Writer',
            taxCode: `NTW${suffix}`,
            ambulatoryId,
            notes: 'network-home-base-write-smoke',
            isAdi: false,
            isArchived: false,
        },
    });

    assert.equal(response.response.status, 201);
    assert.equal(response.json?.id, patientId);
    return patientId;
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
        return path.join(dataDir, 'reports', 'network-home-base-write-report.json');
    }

    return path.join(process.cwd(), 'tmp-network-home-base-write-report.json');
}
