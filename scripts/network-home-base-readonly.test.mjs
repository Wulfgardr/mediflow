#!/usr/bin/env node
/* @Codex */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';

const BASE_URL = process.env.E2E_BASE_URL || 'http://127.0.0.1:3200';
const LOCAL_API_TOKEN = process.env.MEDIFLOW_LOCAL_API_TOKEN || 'mediflow-network-smoke-local-token';
const USERNAME = process.env.E2E_USERNAME || 'admin';
const PIN = process.env.E2E_PIN || '1234';
const REPORT_PATH = resolveReportPath();

const scenarioResults = [];

after(() => {
    const report = {
        generatedAt: new Date().toISOString(),
        baseUrl: BASE_URL,
        scenarios: scenarioResults,
    };

    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`[network-home-base-readonly] Report written to ${REPORT_PATH}`);
});

test('home-base read-only pairing flow works end-to-end', async () => {
    await assertServerReady();

    const ambulatoryId = await resolveDefaultAmbulatoryId();
    await enableHomeBaseMode();

    const seededPatientId = await createSeedPatient(ambulatoryId);

    try {
        const initialSession = await request('GET', '/api/v1/network/session', {
            headers: localApiHeaders(),
        });
        assert.equal(initialSession.response.status, 200);
        assert.equal(initialSession.json?.sessionState, 'network-unpaired');
        assert.equal(initialSession.json?.pairingState, 'required');

        const pairingIntent = await request('POST', '/api/v1/network/pairing-intents', {
            body: {
                deviceName: 'Desk iPad',
                clientPlatform: 'ipados',
                appVersion: '0.5.0-smoke',
                requestedCapabilities: ['network.replica.readonly-patients'],
            },
        });
        assert.equal(pairingIntent.response.status, 201);
        assert.equal(pairingIntent.json?.status, 'pending-home-base-confirmation');
        const intentId = pairingIntent.json?.intentId;
        assert.ok(typeof intentId === 'string' && intentId.length > 0);

        const pendingIntents = await request('GET', '/api/v1/network/pairing-intents', {
            headers: localApiHeaders(),
        });
        assert.equal(pendingIntents.response.status, 200);
        assert.ok(Array.isArray(pendingIntents.json));
        assert.ok(pendingIntents.json.some((intent) => intent.intentId === intentId));

        const pairingConfirmation = await request(
            'POST',
            `/api/v1/network/pairing-intents/${intentId}/confirm`,
            {
                headers: localApiHeaders(),
            },
        );
        assert.equal(pairingConfirmation.response.status, 201);
        assert.equal(pairingConfirmation.json?.status, 'paired');
        const pairedClientId = pairingConfirmation.json?.pairedClient?.clientId;
        const pairedClientToken = pairingConfirmation.json?.pairedClientToken;
        assert.ok(typeof pairedClientId === 'string' && pairedClientId.length > 0);
        assert.ok(typeof pairedClientToken === 'string' && pairedClientToken.length > 0);

        const pairedSession = await request('GET', '/api/v1/network/session', {
            headers: localApiHeaders(),
        });
        assert.equal(pairedSession.response.status, 200);
        assert.equal(pairedSession.json?.sessionState, 'network-paired-online');
        assert.equal(pairedSession.json?.pairingState, 'paired');
        assert.equal(pairedSession.json?.trustedSession, true);

        const login = await request('POST', '/api/auth/login', {
            body: {
                username: USERNAME,
                password: PIN,
            },
        });
        assert.equal(login.response.status, 200);
        const sessionCookie = extractSessionCookie(login.response);
        assert.ok(sessionCookie);

        const pairedHeaders = {
            'x-mediflow-paired-client-id': pairedClientId,
            'x-mediflow-paired-client-token': pairedClientToken,
        };

        const missingSession = await request('GET', '/api/v1/network/patients', {
            headers: pairedHeaders,
        });
        assert.equal(missingSession.response.status, 401);

        const missingPairedClient = await request('GET', '/api/v1/network/patients', {
            headers: {
                Cookie: sessionCookie,
            },
        });
        assert.equal(missingPairedClient.response.status, 401);

        const patientList = await request('GET', '/api/v1/network/patients', {
            headers: {
                ...pairedHeaders,
                Cookie: sessionCookie,
            },
        });
        assert.equal(patientList.response.status, 200);
        assert.ok(Array.isArray(patientList.json));
        const listItem = patientList.json.find((patient) => patient.id === seededPatientId);
        assert.ok(listItem, 'Seeded patient should be visible through the network data plane');

        const patientDetail = await request('GET', `/api/v1/network/patients/${seededPatientId}`, {
            headers: {
                ...pairedHeaders,
                Cookie: sessionCookie,
            },
        });
        assert.equal(patientDetail.response.status, 200);
        assert.equal(patientDetail.json?.id, seededPatientId);
        assert.equal(patientDetail.json?.ambulatoryId, ambulatoryId);

        // A18: the paired ambulatory scope list rides on the same read capability.
        const ambulatoriesMissingClient = await request('GET', '/api/v1/network/ambulatories', {
            headers: { Cookie: sessionCookie },
        });
        assert.equal(ambulatoriesMissingClient.response.status, 401);

        const ambulatories = await request('GET', '/api/v1/network/ambulatories', {
            headers: {
                ...pairedHeaders,
                Cookie: sessionCookie,
            },
        });
        assert.equal(ambulatories.response.status, 200);
        assert.ok(Array.isArray(ambulatories.json));
        assert.ok(
            ambulatories.json.some((amb) => amb.id === ambulatoryId),
            'Seeded ambulatory should be visible through the network scope list'
        );

        scenarioResults.push({
            name: 'home-base read-only pairing flow',
            ambulatoryId,
            patientId: seededPatientId,
            intentId,
            pairedClientId,
            loginStatus: login.response.status,
            patientListStatus: patientList.response.status,
            patientDetailStatus: patientDetail.response.status,
        });
    } finally {
        await cleanupPatient(seededPatientId);
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
        body: { value: 'MediFlow Network Smoke' },
    });
    assert.equal(clinicName.response.status, 200);
}

async function createSeedPatient(ambulatoryId) {
    const patientId = crypto.randomUUID();
    const suffix = patientId.replace(/-/g, '').slice(0, 13).toUpperCase();
    const response = await request('POST', '/api/v1/patients', {
        headers: localApiHeaders(),
        body: {
            id: patientId,
            firstName: 'Network',
            lastName: 'Smoke',
            taxCode: `NET${suffix}`,
            ambulatoryId,
            notes: 'network-home-base-readonly-smoke',
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
    const dataDir = process.env.MEDIFLOW_DATA_DIR || process.env.MEDIFLOW_E2E_DATA_DIR;
    if (dataDir) {
        return path.join(dataDir, 'reports', 'network-home-base-readonly-report.json');
    }

    return path.join(process.cwd(), 'tmp-network-home-base-readonly-report.json');
}
