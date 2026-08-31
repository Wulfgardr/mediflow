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

const READ_PATIENTS_CAPABILITY = 'network.replica.readonly-patients';
const READ_SERVICE_CAPABILITY = 'network.replica.readonly-service-prescriptions';
const WRITE_SERVICE_CAPABILITY = 'network.replica.write-service-prescriptions';
const READ_PROSTHETIC_CAPABILITY = 'network.replica.readonly-prosthetic-prescriptions';
const WRITE_PROSTHETIC_CAPABILITY = 'network.replica.write-prosthetic-prescriptions';

const scenarioResults = [];

after(() => {
    const report = {
        generatedAt: new Date().toISOString(),
        baseUrl: BASE_URL,
        scenarios: scenarioResults,
    };

    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`[network-home-base-prescriptions-write] Report written to ${REPORT_PATH}`);
});

test('paired prescriptions and prosthetics write smoke covers capability, scope, version, catalog, and absent remote delete', async () => {
    await assertServerReady();

    const ambulatoryId = await resolveDefaultAmbulatoryId();
    await enableHomeBaseMode();
    await seedServiceCatalog();
    const patientId = await createSeedPatient(ambulatoryId);
    const outsideScopePatientId = await createSeedPatient(ambulatoryId, 'PrescriptionsOutscope');
    removePatientAmbulatoryMembership(outsideScopePatientId, ambulatoryId);

    try {
        const readOnlyClient = await pairClient(
            [READ_PATIENTS_CAPABILITY, READ_SERVICE_CAPABILITY, READ_PROSTHETIC_CAPABILITY],
            'Desk iPad prescriptions readonly',
        );
        const writerClient = await pairClient(
            [
                READ_PATIENTS_CAPABILITY,
                READ_SERVICE_CAPABILITY,
                WRITE_SERVICE_CAPABILITY,
                READ_PROSTHETIC_CAPABILITY,
                WRITE_PROSTHETIC_CAPABILITY,
            ],
            'Desk iPad prescriptions writer',
        );

        const login = await loginWithWebAuthControl(BASE_URL, { username: USERNAME, password: PIN });
        assert.equal(login.response.status, 200);
        const cookieHeader = login.cookieHeader;

        const readOnlyServiceCreate = await request('POST', '/api/v1/network/service-prescriptions', {
            headers: {
                ...pairedHeaders(readOnlyClient),
                Cookie: cookieHeader,
            },
            body: servicePrescriptionPayload(patientId),
        });
        assert.equal(readOnlyServiceCreate.response.status, 403);

        const outsideScopeServiceCreate = await request('POST', '/api/v1/network/service-prescriptions', {
            headers: {
                ...pairedHeaders(writerClient),
                Cookie: cookieHeader,
            },
            body: servicePrescriptionPayload(outsideScopePatientId),
        });
        assert.equal(outsideScopeServiceCreate.response.status, 404);

        const serviceCreate = await request('POST', '/api/v1/network/service-prescriptions', {
            headers: {
                ...pairedHeaders(writerClient),
                Cookie: cookieHeader,
            },
            body: servicePrescriptionPayload(patientId),
        });
        assert.equal(serviceCreate.response.status, 201);
        const servicePrescriptionId = serviceCreate.json?.id;
        assert.ok(typeof servicePrescriptionId === 'string' && servicePrescriptionId.length > 0);
        assert.equal(serviceCreate.json?.version, 1);

        const itemA = await request('POST', '/api/v1/network/service-prescription-items', {
            headers: {
                ...pairedHeaders(writerClient),
                Cookie: cookieHeader,
            },
            body: servicePrescriptionItemPayload(servicePrescriptionId, 1, 'Emocromo completo', '90.62.2'),
        });
        assert.equal(itemA.response.status, 201);
        assert.equal(itemA.json?.version, 1);

        const itemB = await request('POST', '/api/v1/network/service-prescription-items', {
            headers: {
                ...pairedHeaders(writerClient),
                Cookie: cookieHeader,
            },
            body: servicePrescriptionItemPayload(servicePrescriptionId, 2, 'Creatinina', '90.16.3'),
        });
        assert.equal(itemB.response.status, 201);
        assert.equal(itemB.json?.version, 1);

        const serviceList = await request('GET', `/api/v1/network/service-prescriptions?patientId=${encodeURIComponent(patientId)}`, {
            headers: {
                ...pairedHeaders(writerClient),
                Cookie: cookieHeader,
            },
        });
        assert.equal(serviceList.response.status, 200);
        assert.ok(Array.isArray(serviceList.json));
        const listedService = serviceList.json.find((item) => item.id === servicePrescriptionId);
        assert.ok(listedService, 'Expected created service prescription in scoped list');
        assert.equal(listedService.version, 1);

        const itemList = await request('GET', `/api/v1/network/service-prescription-items?prescriptionId=${encodeURIComponent(servicePrescriptionId)}`, {
            headers: {
                ...pairedHeaders(writerClient),
                Cookie: cookieHeader,
            },
        });
        assert.equal(itemList.response.status, 200);
        assert.ok(Array.isArray(itemList.json));
        const postedItems = itemList.json.filter((item) => [itemA.json?.id, itemB.json?.id].includes(item.id));
        assert.equal(postedItems.length, 2);
        assert.deepEqual(postedItems.map((item) => item.ordinal), [1, 2]);

        const serviceUpdate = await request('PUT', `/api/v1/network/service-prescriptions/${servicePrescriptionId}`, {
            headers: {
                ...pairedHeaders(writerClient),
                Cookie: cookieHeader,
            },
            body: {
                version: 1,
                status: 'performed',
                performedAt: '2026-07-08T09:30:00.000Z',
                reportReceivedAt: '2026-07-08T10:30:00.000Z',
                outcomeNote: 'Referto ricevuto smoke test',
            },
        });
        assert.equal(serviceUpdate.response.status, 200);
        assert.deepEqual(serviceUpdate.json, { success: true });

        const staleServiceUpdate = await request('PUT', `/api/v1/network/service-prescriptions/${servicePrescriptionId}`, {
            headers: {
                ...pairedHeaders(writerClient),
                Cookie: cookieHeader,
            },
            body: {
                version: 1,
                status: 'cancelled',
            },
        });
        assert.equal(staleServiceUpdate.response.status, 409);
        assert.equal(staleServiceUpdate.json?.code, 'VERSION_CONFLICT');
        assert.equal(staleServiceUpdate.json?.entity, 'service_prescription');
        assert.equal(staleServiceUpdate.json?.currentVersion, 2);

        const serviceCatalog = await request('GET', '/api/v1/network/service-catalog?q=emocromo&limit=10', {
            headers: {
                ...pairedHeaders(writerClient),
                Cookie: cookieHeader,
            },
        });
        assert.equal(serviceCatalog.response.status, 200);
        assert.ok(Array.isArray(serviceCatalog.json));

        const remoteServiceDelete = await request('DELETE', `/api/v1/network/service-prescriptions/${servicePrescriptionId}`, {
            headers: {
                ...pairedHeaders(writerClient),
                Cookie: cookieHeader,
            },
            body: {
                version: 2,
            },
        });
        assert.equal(remoteServiceDelete.response.status, 405);

        const readOnlyProstheticCreate = await request('POST', '/api/v1/network/prosthetic-prescriptions', {
            headers: {
                ...pairedHeaders(readOnlyClient),
                Cookie: cookieHeader,
            },
            body: prostheticPrescriptionPayload(patientId),
        });
        assert.equal(readOnlyProstheticCreate.response.status, 403);

        const outsideScopeProstheticCreate = await request('POST', '/api/v1/network/prosthetic-prescriptions', {
            headers: {
                ...pairedHeaders(writerClient),
                Cookie: cookieHeader,
            },
            body: prostheticPrescriptionPayload(outsideScopePatientId),
        });
        assert.equal(outsideScopeProstheticCreate.response.status, 404);

        const prostheticCreate = await request('POST', '/api/v1/network/prosthetic-prescriptions', {
            headers: {
                ...pairedHeaders(writerClient),
                Cookie: cookieHeader,
            },
            body: prostheticPrescriptionPayload(patientId),
        });
        assert.equal(prostheticCreate.response.status, 201);
        const prostheticPrescriptionId = prostheticCreate.json?.id;
        assert.ok(typeof prostheticPrescriptionId === 'string' && prostheticPrescriptionId.length > 0);
        assert.equal(prostheticCreate.json?.version, 1);

        const prostheticUpdate = await request('PUT', `/api/v1/network/prosthetic-prescriptions/${prostheticPrescriptionId}`, {
            headers: {
                ...pairedHeaders(writerClient),
                Cookie: cookieHeader,
            },
            body: {
                version: 1,
                status: 'tested',
                collaudoAt: '2026-07-08T11:00:00.000Z',
                collaudoOutcome: 'Collaudo registrato in MediFlow.',
            },
        });
        assert.equal(prostheticUpdate.response.status, 200);
        assert.deepEqual(prostheticUpdate.json, { success: true });

        const staleProstheticUpdate = await request('PUT', `/api/v1/network/prosthetic-prescriptions/${prostheticPrescriptionId}`, {
            headers: {
                ...pairedHeaders(writerClient),
                Cookie: cookieHeader,
            },
            body: {
                version: 1,
                status: 'cancelled',
            },
        });
        assert.equal(staleProstheticUpdate.response.status, 409);
        assert.equal(staleProstheticUpdate.json?.code, 'VERSION_CONFLICT');
        assert.equal(staleProstheticUpdate.json?.entity, 'prosthetic_prescription');
        assert.equal(staleProstheticUpdate.json?.currentVersion, 2);

        const prostheticList = await request('GET', `/api/v1/network/prosthetic-prescriptions?patientId=${encodeURIComponent(patientId)}`, {
            headers: {
                ...pairedHeaders(writerClient),
                Cookie: cookieHeader,
            },
        });
        assert.equal(prostheticList.response.status, 200);
        assert.ok(Array.isArray(prostheticList.json));
        const listedProsthetic = prostheticList.json.find((item) => item.id === prostheticPrescriptionId);
        assert.ok(listedProsthetic, 'Expected created prosthetic prescription in scoped list');
        assert.equal(listedProsthetic.status, 'tested');
        assert.equal(listedProsthetic.version, 2);

        const remoteProstheticDelete = await request('DELETE', `/api/v1/network/prosthetic-prescriptions/${prostheticPrescriptionId}`, {
            headers: {
                ...pairedHeaders(writerClient),
                Cookie: cookieHeader,
            },
            body: {
                version: 2,
            },
        });
        assert.equal(remoteProstheticDelete.response.status, 405);

        scenarioResults.push({
            name: 'paired prescriptions and prosthetics write',
            ambulatoryId,
            patientId,
            servicePrescriptionId,
            serviceItemIds: [itemA.json?.id, itemB.json?.id],
            prostheticPrescriptionId,
            readOnlyServiceCreateStatus: readOnlyServiceCreate.response.status,
            outsideScopeServiceCreateStatus: outsideScopeServiceCreate.response.status,
            serviceCreateStatus: serviceCreate.response.status,
            serviceUpdateStatus: serviceUpdate.response.status,
            staleServiceUpdateStatus: staleServiceUpdate.response.status,
            serviceCatalogStatus: serviceCatalog.response.status,
            remoteServiceDeleteStatus: remoteServiceDelete.response.status,
            readOnlyProstheticCreateStatus: readOnlyProstheticCreate.response.status,
            outsideScopeProstheticCreateStatus: outsideScopeProstheticCreate.response.status,
            prostheticCreateStatus: prostheticCreate.response.status,
            prostheticUpdateStatus: prostheticUpdate.response.status,
            staleProstheticUpdateStatus: staleProstheticUpdate.response.status,
            remoteProstheticDeleteStatus: remoteProstheticDelete.response.status,
            pairedClientId: writerClient.pairedClientId,
        });
    } finally {
        await cleanupPatient(patientId);
        await cleanupPatient(outsideScopePatientId);
    }
});

function servicePrescriptionPayload(patientId) {
    return {
        patientId,
        prescribedAt: '2026-07-08T08:00:00.000Z',
        status: 'prescribed',
        category: 'lab',
        priority: 'routine',
        codeSystem: 'NTR',
        serviceCode: '90.62.2',
        serviceName: 'Esami ematochimici smoke',
        clinicalQuestion: 'Controllo periodico smoke',
        provider: 'Ambulatorio smoke',
        requestReference: 'W2-S3-SMOKE',
        source: 'manual',
        notes: 'network-home-base-prescriptions-write-smoke',
    };
}

function servicePrescriptionItemPayload(prescriptionId, ordinal, serviceName, serviceCode) {
    return {
        prescriptionId,
        ordinal,
        status: 'prescribed',
        category: 'lab',
        codeSystem: 'NTR',
        serviceCode,
        serviceName,
        catalogDisplayName: serviceName,
        matchStatus: 'manual',
        confidence: 'high',
        evidence: 'smoke test',
        notes: `item ${ordinal}`,
    };
}

function prostheticPrescriptionPayload(patientId) {
    return {
        patientId,
        prescribedAt: '2026-07-08T08:15:00.000Z',
        status: 'submitted',
        category: 'standard',
        isoCode: '12.22.03.003',
        description: 'Ausilio protesico smoke',
        measures: 'Taglia M',
        clinicalReason: 'Supporto funzionale smoke',
        regionalPrescriptionId: 'RL-SMOKE-001',
        supplier: 'Fornitore smoke',
        collaudoAt: null,
        source: 'manual',
        notes: 'network-home-base-prescriptions-write-smoke',
    };
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
        body: { value: 'MediFlow Network Prescriptions Write Smoke' },
    });
    assert.equal(clinicName.response.status, 200);
}

async function seedServiceCatalog() {
    const response = await request('POST', '/api/service-catalog', {
        headers: localApiHeaders(),
        body: [
            {
                serviceCode: '90.62.2',
                displayName: 'Emocromo completo smoke',
                category: 'lab',
                codeSystem: 'NTR',
                synonyms: 'emocromo,esame sangue',
                source: 'network-home-base-prescriptions-write-smoke',
            },
        ],
    });
    if (response.response.status === 404 || response.response.status === 405) return;
    assert.equal(response.response.status, 200);
}

async function pairClient(requestedCapabilities, deviceName) {
    const pairingIntent = await request('POST', '/api/v1/network/pairing-intents', {
        body: {
            deviceName,
            clientPlatform: 'ipados',
            appVersion: '0.7.1-prescriptions-smoke',
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

async function createSeedPatient(ambulatoryId, lastName = 'Prescriptions') {
    const patientId = crypto.randomUUID();
    const suffix = patientId.replace(/-/g, '').slice(0, 13).toUpperCase();
    const response = await request('POST', '/api/v1/patients', {
        headers: localApiHeaders(),
        body: {
            id: patientId,
            firstName: 'Network',
            lastName,
            taxCode: `NPS${suffix}`,
            ambulatoryId,
            notes: 'network-home-base-prescriptions-write-smoke',
            isAdi: false,
            isArchived: false,
        },
    });
    assert.equal(response.response.status, 201);
    assert.equal(response.json?.id, patientId);
    return patientId;
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
    assert.ok(dataDir, 'MEDIFLOW_DATA_DIR is required for the prescriptions smoke database');
    const dbPath = path.join(dataDir, 'medical.db');
    assert.ok(fs.existsSync(dbPath), `Expected E2E database at ${dbPath}`);
    return new Database(dbPath);
}

async function cleanupPatient(patientId) {
    await cleanupServicePrescriptions(patientId);
    await cleanupProstheticPrescriptions(patientId);

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

async function cleanupServicePrescriptions(patientId) {
    const list = await request('GET', `/api/service-prescriptions?patientId=${encodeURIComponent(patientId)}`, {
        headers: localApiHeaders(),
    });
    if (list.response.status !== 200 || !Array.isArray(list.json)) return;
    for (const prescription of list.json) {
        if (!prescription?.id) continue;
        const deletion = await request('DELETE', `/api/service-prescriptions/${prescription.id}`, {
            headers: localApiHeaders(),
            body: { version: prescription.version },
        });
        assert.equal(deletion.response.status, 200);
    }
}

async function cleanupProstheticPrescriptions(patientId) {
    const list = await request('GET', `/api/prosthetic-prescriptions?patientId=${encodeURIComponent(patientId)}`, {
        headers: localApiHeaders(),
    });
    if (list.response.status !== 200 || !Array.isArray(list.json)) return;
    for (const prescription of list.json) {
        if (!prescription?.id) continue;
        const deletion = await request('DELETE', `/api/prosthetic-prescriptions/${prescription.id}`, {
            headers: localApiHeaders(),
            body: { version: prescription.version },
        });
        assert.equal(deletion.response.status, 200);
    }
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
        return path.join(dataDir, 'reports', 'network-home-base-prescriptions-write-report.json');
    }

    return path.join(process.cwd(), 'tmp-network-home-base-prescriptions-write-report.json');
}
