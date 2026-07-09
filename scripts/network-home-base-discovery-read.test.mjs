#!/usr/bin/env node
/* @Codex */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';

const BASE_URL = process.env.E2E_BASE_URL || 'http://127.0.0.1:3400';
const LOCAL_API_TOKEN = process.env.MEDIFLOW_LOCAL_API_TOKEN || 'mediflow-network-write-smoke-local-token';
const USERNAME = process.env.E2E_USERNAME || 'admin';
const PIN = process.env.E2E_PIN || '1234';
const REPORT_PATH = resolveReportPath();

const READ_PATIENTS_CAPABILITY = 'network.replica.readonly-patients';
const READ_SERVICE_CAPABILITY = 'network.replica.readonly-service-prescriptions';
const WRITE_SERVICE_CAPABILITY = 'network.replica.write-service-prescriptions';
const READ_PROSTHETIC_CAPABILITY = 'network.replica.readonly-prosthetic-prescriptions';
const WRITE_PROSTHETIC_CAPABILITY = 'network.replica.write-prosthetic-prescriptions';
const FSE_VALIDATE_CAPABILITY = 'network.fse.validate';

const scenarioResults = [];

after(() => {
    const report = {
        generatedAt: new Date().toISOString(),
        baseUrl: BASE_URL,
        scenarios: scenarioResults,
    };

    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`[network-home-base-discovery-read] Report written to ${REPORT_PATH}`);
});

test('paired and local-token discovery, public revision, identity scope, and FSE validation stay gated', async () => {
    await assertServerReady();

    const ambulatoryId = await resolveDefaultAmbulatoryId();
    await enableHomeBaseMode();
    const patientId = await createSeedPatient(ambulatoryId);
    const outsideScopePatientId = await createSeedPatient(ambulatoryId, 'DiscoveryOutscope');
    removePatientAmbulatoryMembership(outsideScopePatientId, ambulatoryId);

    try {
        const discoveryClient = await pairClient(
            [
                READ_PATIENTS_CAPABILITY,
                READ_SERVICE_CAPABILITY,
                WRITE_SERVICE_CAPABILITY,
                READ_PROSTHETIC_CAPABILITY,
                WRITE_PROSTHETIC_CAPABILITY,
                FSE_VALIDATE_CAPABILITY,
            ],
            'Desk iPad discovery fse',
        );
        const noFseClient = await pairClient([READ_PATIENTS_CAPABILITY], 'Desk iPad discovery no fse');

        const login = await request('POST', '/api/auth/login', {
            body: {
                username: USERNAME,
                password: PIN,
            },
        });
        assert.equal(login.response.status, 200);
        const sessionCookie = extractSessionCookie(login.response);
        const scopedSessionCookie = `${sessionCookie}; ambulatory_id=${ambulatoryId}`;

        const localCapabilities = await request('GET', '/api/v1/network/capabilities', {
            headers: localApiHeaders(),
        });
        assert.equal(localCapabilities.response.status, 200);
        assertCapabilities(localCapabilities.json);

        const localNode = await request('GET', '/api/v1/network/node', {
            headers: localApiHeaders(),
        });
        assert.equal(localNode.response.status, 200);
        assertNode(localNode.json);

        const localIdentity = await request('GET', '/api/v1/network/identity', {
            headers: localApiHeaders(),
        });
        assert.equal(localIdentity.response.status, 200);
        assertIdentity(localIdentity.json);
        assert.ok(['node-default', 'none'].includes(localIdentity.json?.scope?.source));

        const pairedCapabilities = await request('GET', '/api/v1/network/capabilities', {
            headers: pairedHeaders(discoveryClient),
        });
        assert.equal(pairedCapabilities.response.status, 200);
        assertCapabilities(pairedCapabilities.json);

        const pairedNode = await request('GET', '/api/v1/network/node', {
            headers: pairedHeaders(discoveryClient),
        });
        assert.equal(pairedNode.response.status, 200);
        assertNode(pairedNode.json);

        const pairedIdentityNoSession = await request('GET', '/api/v1/network/identity', {
            headers: pairedHeaders(discoveryClient),
        });
        assert.equal(pairedIdentityNoSession.response.status, 401);

        const pairedIdentity = await request('GET', '/api/v1/network/identity', {
            headers: {
                ...pairedHeaders(discoveryClient),
                Cookie: scopedSessionCookie,
            },
        });
        assert.equal(pairedIdentity.response.status, 200);
        assertIdentity(pairedIdentity.json);
        assert.equal(pairedIdentity.json?.scope?.effectiveAmbulatoryId, ambulatoryId);
        assert.equal(pairedIdentity.json?.scope?.source, 'session-context');

        const revision = await request('GET', '/api/v1/network/revision', {
            headers: pairedHeaders(discoveryClient),
        });
        assert.equal(revision.response.status, 200);
        assertRevision(revision.json);

        const fseValidation = await request('GET', `/api/v1/network/fse/validate-patient?patientId=${encodeURIComponent(patientId)}`, {
            headers: {
                ...pairedHeaders(discoveryClient),
                Cookie: scopedSessionCookie,
            },
        });
        assert.equal(fseValidation.response.status, 200);
        assertValidatePatientExportResponse(fseValidation.json, patientId);

        const fseOutsideScope = await request('GET', `/api/v1/network/fse/validate-patient?patientId=${encodeURIComponent(outsideScopePatientId)}`, {
            headers: {
                ...pairedHeaders(discoveryClient),
                Cookie: scopedSessionCookie,
            },
        });
        assert.equal(fseOutsideScope.response.status, 404);

        const fseMissingCapability = await request('GET', `/api/v1/network/fse/validate-patient?patientId=${encodeURIComponent(patientId)}`, {
            headers: {
                ...pairedHeaders(noFseClient),
                Cookie: scopedSessionCookie,
            },
        });
        assert.equal(fseMissingCapability.response.status, 403);

        scenarioResults.push({
            name: 'paired discovery revision fse read',
            ambulatoryId,
            patientId,
            localCapabilitiesStatus: localCapabilities.response.status,
            localNodeStatus: localNode.response.status,
            localIdentityStatus: localIdentity.response.status,
            pairedCapabilitiesStatus: pairedCapabilities.response.status,
            pairedNodeStatus: pairedNode.response.status,
            pairedIdentityNoSessionStatus: pairedIdentityNoSession.response.status,
            pairedIdentityStatus: pairedIdentity.response.status,
            revisionStatus: revision.response.status,
            fseValidationStatus: fseValidation.response.status,
            fseOutsideScopeStatus: fseOutsideScope.response.status,
            fseMissingCapabilityStatus: fseMissingCapability.response.status,
            pairedClientId: discoveryClient.pairedClientId,
        });
    } finally {
        await cleanupPatient(patientId);
        await cleanupPatient(outsideScopePatientId);
    }
});

function assertCapabilities(value) {
    assert.equal(typeof value?.nodeId, 'string');
    assert.equal(value.operatingMode, 'network-home-base');
    assert.equal(typeof value.protocolVersion, 'string');
    assert.ok(value.protocolVersion.length > 0);
    assert.ok(Array.isArray(value.capabilities));

    for (const key of [
        READ_SERVICE_CAPABILITY,
        WRITE_SERVICE_CAPABILITY,
        READ_PROSTHETIC_CAPABILITY,
        WRITE_PROSTHETIC_CAPABILITY,
        FSE_VALIDATE_CAPABILITY,
    ]) {
        const capability = value.capabilities.find((item) => item.key === key);
        assert.ok(capability, `Expected capability ${key}`);
        assert.equal(capability.status, 'available');
        assert.equal(capability.requiresPairing, true);
    }
}

function assertNode(value) {
    assert.equal(typeof value?.nodeId, 'string');
    assert.equal(typeof value.displayName, 'string');
    assert.equal(value.role, 'home-base-candidate');
    assert.equal(value.operatingMode, 'network-home-base');
    assert.equal(typeof value.protocolVersion, 'string');
    assert.ok(value.protocolVersion.length > 0);
    assert.deepEqual(value.transport, {
        apiBasePath: '/api/v1',
        tlsRequired: true,
        localTlsPort: 3443,
    });
}

function assertIdentity(value) {
    assert.equal(value?.identityModel, 'paired-device-plus-node-credentials');
    assert.ok(['session-bound', 'node-credentials-required'].includes(value.credentialState));
    assert.ok(Object.prototype.hasOwnProperty.call(value, 'operator'));
    assert.ok(Object.prototype.hasOwnProperty.call(value, 'audit'));
    assert.ok(Array.isArray(value.limitations));
    assert.equal(typeof value?.scope?.effectiveAmbulatoryId === 'string' || value?.scope?.effectiveAmbulatoryId === null, true);
}

function assertRevision(value) {
    assert.deepEqual(Object.keys(value).sort(), ['fingerprint', 'revision', 'sourceFingerprint']);
    assert.equal(typeof value.revision, 'string');
    assert.equal(typeof value.sourceFingerprint, 'string');
    assert.equal(typeof value.fingerprint, 'string');
    assert.equal(Object.prototype.hasOwnProperty.call(value, 'branch'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(value, 'worktreeHash'), false);
}

function assertValidatePatientExportResponse(value, patientId) {
    assert.equal(value?.patientId, patientId);
    assert.equal(typeof value.hasErrors, 'boolean');
    assert.equal(typeof value.hasWarnings, 'boolean');
    assertValidationSummary(value.therapyMedication);
    assertValidationSummary(value.observationVitals);
}

function assertValidationSummary(value) {
    assert.equal(typeof value?.total, 'number');
    assert.equal(typeof value.ok, 'number');
    assert.equal(typeof value.withErrors, 'number');
    assert.equal(typeof value.withWarnings, 'number');
    assert.equal(typeof value.errorCount, 'number');
    assert.equal(typeof value.warningCount, 'number');
    assert.ok(Array.isArray(value.items));
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
        body: { value: 'MediFlow Network Discovery Read Smoke' },
    });
    assert.equal(clinicName.response.status, 200);
}

async function pairClient(requestedCapabilities, deviceName) {
    const pairingIntent = await request('POST', '/api/v1/network/pairing-intents', {
        body: {
            deviceName,
            clientPlatform: 'ipados',
            appVersion: '0.7.1-discovery-smoke',
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

async function createSeedPatient(ambulatoryId, lastName = 'Discovery') {
    const patientId = crypto.randomUUID();
    const suffix = patientId.replace(/-/g, '').slice(0, 13).toUpperCase();
    const response = await request('POST', '/api/v1/patients', {
        headers: localApiHeaders(),
        body: {
            id: patientId,
            firstName: 'Network',
            lastName,
            taxCode: `NDS${suffix}`,
            ambulatoryId,
            notes: 'network-home-base-discovery-read-smoke',
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

function removePatientAmbulatoryMembership(patientId, ambulatoryId) {
    const db = openTestDb();
    try {
        db.prepare('DELETE FROM patients_to_ambulatories WHERE patient_id = ? AND ambulatory_id = ?').run(patientId, ambulatoryId);
    } finally {
        db.close();
    }
}

function openTestDb() {
    const dataDir = process.env.MEDIFLOW_DATA_DIR;
    assert.ok(dataDir, 'MEDIFLOW_DATA_DIR is required for the discovery smoke database');
    const dbPath = path.join(dataDir, 'medical.db');
    assert.ok(fs.existsSync(dbPath), `Expected E2E database at ${dbPath}`);
    return new Database(dbPath);
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
        return path.join(dataDir, 'reports', 'network-home-base-discovery-read-report.json');
    }

    return path.join(process.cwd(), 'tmp-network-home-base-discovery-read-report.json');
}
