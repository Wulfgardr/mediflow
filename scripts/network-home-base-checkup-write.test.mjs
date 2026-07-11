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
const READ_CHECKUPS_CAPABILITY = 'network.replica.readonly-checkups';
const WRITE_CHECKUPS_CAPABILITY = 'network.replica.write-checkups';
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
    console.log(`[network-home-base-checkup-write] Report written to ${REPORT_PATH}`);
});

test('paired checkup write requires capability, session, scope, version, and PHI-safe audit', async () => {
    await assertServerReady();

    const ambulatoryId = await resolveDefaultAmbulatoryId();
    await enableHomeBaseMode();
    const patientId = await createSeedPatient(ambulatoryId);

    try {
        const readOnlyClient = await pairClient(
            [READ_PATIENTS_CAPABILITY, READ_CHECKUPS_CAPABILITY],
            'Desk iPad checkup readonly',
        );
        const checkupWriter = await pairClient(
            [READ_PATIENTS_CAPABILITY, READ_CHECKUPS_CAPABILITY, WRITE_CHECKUPS_CAPABILITY],
            'Desk iPad checkup writer',
        );

        const login = await request('POST', '/api/auth/login', {
            body: {
                username: USERNAME,
                password: PIN,
            },
        });
        assert.equal(login.response.status, 200);
        const sessionCookie = extractSessionCookie(login.response);

        const readOnlyCreate = await request('POST', `/api/v1/network/patients/${patientId}/checkups`, {
            headers: {
                ...pairedHeaders(readOnlyClient),
                Cookie: sessionCookie,
            },
            body: {
                date: '2026-05-02T09:00:00.000Z',
                title: 'Controllo rete',
                status: 'pending',
                notes: 'smoke-test',
                source: 'manual',
            },
        });
        assert.equal(readOnlyCreate.response.status, 403);

        const missingSession = await request('POST', `/api/v1/network/patients/${patientId}/checkups`, {
            headers: pairedHeaders(checkupWriter),
            body: {
                date: '2026-05-02T09:00:00.000Z',
                title: 'Controllo rete',
                status: 'pending',
                notes: 'smoke-test',
                source: 'manual',
            },
        });
        assert.equal(missingSession.response.status, 401);

        const plaintextNotes = await request('POST', `/api/v1/network/patients/${patientId}/checkups`, {
            headers: {
                ...pairedHeaders(checkupWriter),
                Cookie: sessionCookie,
            },
            body: {
                date: '2026-05-02T09:00:00.000Z',
                title: 'Controllo rete',
                status: 'pending',
                notes: 'smoke-test',
                source: 'manual',
            },
        });
        assert.equal(plaintextNotes.response.status, 400);
        assert.equal(plaintextNotes.json?.error, 'Network checkup notes must be sealed with ENC:');

        const create = await request('POST', `/api/v1/network/patients/${patientId}/checkups`, {
            headers: {
                ...pairedHeaders(checkupWriter),
                Cookie: sessionCookie,
            },
            body: {
                date: '2026-05-02T09:00:00.000Z',
                title: 'Controllo rete',
                status: 'pending',
                notes: SEALED_NOTES,
                source: 'manual',
            },
        });
        assert.equal(create.response.status, 201);
        const checkupId = create.json?.id;
        assert.ok(typeof checkupId === 'string' && checkupId.length > 0);
        assert.equal(create.json?.version, 1);

        const detail = await request('GET', `/api/v1/network/patients/${patientId}/checkups/${checkupId}`, {
            headers: {
                ...pairedHeaders(checkupWriter),
                Cookie: sessionCookie,
            },
        });
        assert.equal(detail.response.status, 200);
        assert.equal(detail.json?.id, checkupId);
        assert.equal(detail.json?.version, 1);
        assert.equal(detail.json?.title, 'Controllo rete');
        assert.equal(detail.json?.status, 'pending');
        assert.equal(detail.json?.date, '2026-05-02T09:00:00.000Z');
        assert.equal(detail.json?.deletedAt, null);

        const update = await request('PUT', `/api/v1/network/patients/${patientId}/checkups/${checkupId}`, {
            headers: {
                ...pairedHeaders(checkupWriter),
                Cookie: sessionCookie,
            },
            body: {
                version: 1,
                status: 'completed',
            },
        });
        assert.equal(update.response.status, 200);
        assert.deepEqual(update.json, { success: true });

        const updatedDetail = await request('GET', `/api/v1/network/patients/${patientId}/checkups/${checkupId}`, {
            headers: {
                ...pairedHeaders(checkupWriter),
                Cookie: sessionCookie,
            },
        });
        assert.equal(updatedDetail.response.status, 200);
        assert.equal(updatedDetail.json?.status, 'completed');
        assert.equal(updatedDetail.json?.version, 2);

        const conflict = await request('PUT', `/api/v1/network/patients/${patientId}/checkups/${checkupId}`, {
            headers: {
                ...pairedHeaders(checkupWriter),
                Cookie: sessionCookie,
            },
            body: {
                version: 1,
                title: 'stale update',
            },
        });
        assert.equal(conflict.response.status, 409);
        assert.equal(conflict.json?.code, 'VERSION_CONFLICT');
        assert.equal(conflict.json?.entity, 'checkup');
        assert.equal(conflict.json?.currentVersion, 2);
        assert.equal(Object.prototype.hasOwnProperty.call(conflict.json?.currentSnapshot ?? {}, 'title'), false);
        assert.equal(Object.prototype.hasOwnProperty.call(conflict.json?.currentSnapshot ?? {}, 'notes'), false);

        const aiField = await request('PUT', `/api/v1/network/patients/${patientId}/checkups/${checkupId}`, {
            headers: {
                ...pairedHeaders(checkupWriter),
                Cookie: sessionCookie,
            },
            body: {
                version: 2,
                documentInsights: 'blocked remote document-derived field',
            },
        });
        assert.equal(aiField.response.status, 403);
        assert.equal(aiField.json?.error, 'Network checkup write boundary excludes AI/document-derived fields');

        const plaintextDeletionReason = await request('PUT', `/api/v1/network/patients/${patientId}/checkups/${checkupId}`, {
            headers: {
                ...pairedHeaders(checkupWriter),
                Cookie: sessionCookie,
            },
            body: {
                version: 2,
                deletedAt: '2026-05-02T10:00:00.000Z',
                deletionReason: 'network-smoke-soft-delete',
            },
        });
        assert.equal(plaintextDeletionReason.response.status, 400);
        assert.equal(plaintextDeletionReason.json?.error, 'Network delete requires a sealed deletion reason');

        const sealedDeletionReason = 'ENC:aXY=:cmVhc29u';
        const softDelete = await request('PUT', `/api/v1/network/patients/${patientId}/checkups/${checkupId}`, {
            headers: {
                ...pairedHeaders(checkupWriter),
                Cookie: sessionCookie,
            },
            body: {
                version: 2,
                deletedAt: '2026-05-02T10:00:00.000Z',
                deletionReason: sealedDeletionReason,
            },
        });
        assert.equal(softDelete.response.status, 200);

        const deletedDetail = await request('GET', `/api/v1/network/patients/${patientId}/checkups/${checkupId}`, {
            headers: {
                ...pairedHeaders(checkupWriter),
                Cookie: sessionCookie,
            },
        });
        assert.equal(deletedDetail.response.status, 200);
        assert.equal(deletedDetail.json?.version, 3);
        assert.equal(deletedDetail.json?.deletedAt, '2026-05-02T10:00:00.000Z');
        assert.equal(deletedDetail.json?.deletionReason, sealedDeletionReason);

        const remoteHardDelete = await request('DELETE', `/api/v1/network/patients/${patientId}/checkups/${checkupId}`, {
            headers: {
                ...pairedHeaders(checkupWriter),
                Cookie: sessionCookie,
            },
            body: {
                version: 3,
            },
        });
        assert.equal(remoteHardDelete.response.status, 405);

        const createdAudit = await findAuditEvent('checkup.created', checkupId, sessionCookie);
        assert.equal(createdAudit.actorType, 'user');
        assert.equal(createdAudit.sourceSurface, 'native');
        assert.ok(createdAudit.redactedMetadata?.flags?.includes('auth:paired-client'));
        assert.ok(createdAudit.redactedMetadata?.flags?.includes(`paired-client:${checkupWriter.pairedClientId}`));
        assert.deepEqual(createdAudit.redactedMetadata?.changedFields, ['date', 'title', 'status', 'notes', 'source']);
        assert.equal(createdAudit.redactedMetadata?.resourceVersion, 1);

        const updatedAudit = await findAuditEvent('checkup.updated', checkupId, sessionCookie);
        assert.deepEqual(updatedAudit.redactedMetadata?.changedFields, ['status']);
        assert.equal(updatedAudit.redactedMetadata?.resourceVersion, 2);

        const deletedAudit = await findAuditEvent('checkup.deleted', checkupId, sessionCookie);
        assert.deepEqual(deletedAudit.redactedMetadata?.changedFields, ['deletedAt', 'deletionReason']);
        assert.equal(deletedAudit.redactedMetadata?.resourceVersion, 3);

        scenarioResults.push({
            name: 'paired checkup write',
            ambulatoryId,
            patientId,
            checkupId,
            readOnlyForbiddenStatus: readOnlyCreate.response.status,
            missingSessionStatus: missingSession.response.status,
            createStatus: create.response.status,
            updateStatus: update.response.status,
            conflictStatus: conflict.response.status,
            aiFieldStatus: aiField.response.status,
            plaintextDeletionReasonStatus: plaintextDeletionReason.response.status,
            softDeleteStatus: softDelete.response.status,
            remoteHardDeleteStatus: remoteHardDelete.response.status,
            pairedClientId: checkupWriter.pairedClientId,
        });
    } finally {
        await cleanupPatient(patientId);
    }
});

async function findAuditEvent(eventType, subjectRef, sessionCookie) {
    const audit = await request('GET', `/api/system/audit?eventType=${eventType}&subjectType=checkup&limit=20`, {
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
        body: { value: 'MediFlow Network Checkup Write Smoke' },
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
            lastName: 'Checkup',
            taxCode: `NTT${suffix}`,
            ambulatoryId,
            notes: 'network-home-base-checkup-write-smoke',
            isAdi: false,
            isArchived: false,
        },
    });

    assert.equal(response.response.status, 201);
    assert.equal(response.json?.id, patientId);
    return patientId;
}

async function cleanupPatient(patientId) {
    const checkups = await request('GET', `/api/v1/patients/${patientId}/checkups`, {
        headers: localApiHeaders(),
    });
    if (checkups.response.status === 200 && Array.isArray(checkups.json)) {
        for (const checkup of checkups.json) {
            if (!checkup?.id) continue;
            const deletion = await request('DELETE', `/api/v1/patients/${patientId}/checkups/${checkup.id}`, {
                headers: localApiHeaders(),
                // WUL-308: child DELETEs require optimistic concurrency.
                body: { version: checkup.version },
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
        return path.join(dataDir, 'reports', 'network-home-base-checkup-write-report.json');
    }

    return path.join(process.cwd(), 'tmp-network-home-base-checkup-write-report.json');
}
