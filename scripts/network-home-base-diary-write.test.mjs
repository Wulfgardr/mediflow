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
const READ_DIARY_CAPABILITY = 'network.replica.readonly-clinical-diary';
const WRITE_DIARY_CAPABILITY = 'network.replica.write-clinical-diary';
const VISIT_DRAFT_CAPABILITY = 'network.compute.visit-draft';
const SEALED_TITLE = 'ENC:dGl0bGVpdg==:dGl0bGVjaXBoZXI=';
const SEALED_CONTENT = 'ENC:Y29udGVudGl2:Y29udGVudGNpcGhlcg==';
const SEALED_UPDATED_CONTENT = 'ENC:dXBkYXRlaXY=:dXBkYXRlY2lwaGVy';
const SEALED_METADATA = 'ENC:bWV0YWRhdGFpdg==:bWV0YWRhdGFjaXBoZXI=';
const SEALED_DELETION_REASON = 'ENC:ZGVsZXRlaXY=:ZGVsZXRlY2lwaGVy';

const scenarioResults = [];

after(() => {
    const report = {
        generatedAt: new Date().toISOString(),
        baseUrl: BASE_URL,
        scenarios: scenarioResults,
    };

    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`[network-home-base-diary-write] Report written to ${REPORT_PATH}`);
});

test('paired diary write requires capability, session, scope, version, and PHI-safe audit', async () => {
    await assertServerReady();

    const ambulatoryId = await resolveDefaultAmbulatoryId();
    await enableHomeBaseMode();
    const patientId = await createSeedPatient(ambulatoryId);

    try {
        const readOnlyClient = await pairClient(
            [READ_PATIENTS_CAPABILITY, READ_DIARY_CAPABILITY],
            'Desk iPad diary readonly',
        );
        const diaryWriter = await pairClient(
            [READ_PATIENTS_CAPABILITY, READ_DIARY_CAPABILITY, WRITE_DIARY_CAPABILITY, VISIT_DRAFT_CAPABILITY],
            'Desk iPad diary writer',
        );

        const login = await request('POST', '/api/auth/login', {
            body: {
                username: USERNAME,
                password: PIN,
            },
        });
        assert.equal(login.response.status, 200);
        const sessionCookie = extractSessionCookie(login.response);

        await setNetworkMode('local-only');
        const disabledDiaryRead = await request('GET', `/api/v1/network/patients/${patientId}/entries`, {
            headers: {
                ...pairedHeaders(diaryWriter),
                Cookie: sessionCookie,
            },
        });
        assert.equal(disabledDiaryRead.response.status, 403);
        assert.equal(disabledDiaryRead.json?.code, 'NETWORK_MODE_DISABLED');
        await setNetworkMode('network-home-base');

        const localAiRuntime = await request('GET', '/api/v1/network/ai-runtime', {
            headers: localApiHeaders(),
        });
        assert.equal(localAiRuntime.response.status, 200, 'Local API token must retain AI runtime discovery access');

        const pairedAiRuntime = await request('GET', '/api/v1/network/ai-runtime', {
            headers: pairedHeaders(diaryWriter),
        });
        assert.equal(pairedAiRuntime.response.status, 200, 'Paired client must receive AI runtime discovery');
        for (const key of ['patientInsight', 'documentSynthesis', 'smartImport', 'treatmentReasoning']) {
            assert.ok(['enabled', 'disabled'].includes(pairedAiRuntime.json?.killSwitches?.[key]), `AI runtime kill switch ${key} must be enabled or disabled`);
        }
        assert.ok(pairedAiRuntime.json?.surfaces?.includes('treatment-reasoning'), 'AI runtime must advertise treatment-reasoning');

        const auditBeforeVisitDraft = await listAuditEvents(sessionCookie);
        const patientScopedVisitDraft = await request('POST', '/api/v1/network/visit-draft', {
            headers: {
                ...pairedHeaders(diaryWriter),
                Cookie: sessionCookie,
            },
            body: {
                patientId,
                transcript: 'P: continuare terapia',
            },
        });
        assert.equal(patientScopedVisitDraft.response.status, 400, 'Visit draft must reject a patientId presence claim');

        const emptyVisitDraft = await request('POST', '/api/v1/network/visit-draft', {
            headers: {
                ...pairedHeaders(diaryWriter),
                Cookie: sessionCookie,
            },
            body: {},
        });
        assert.equal(emptyVisitDraft.response.status, 400, 'Visit draft must reject an empty transcript');

        const tooLongVisitDraft = await request('POST', '/api/v1/network/visit-draft', {
            headers: {
                ...pairedHeaders(diaryWriter),
                Cookie: sessionCookie,
            },
            body: { transcript: 'x'.repeat(12_001) },
        });
        assert.equal(tooLongVisitDraft.response.status, 413);

        const visitDraft = await request('POST', '/api/v1/network/visit-draft', {
            headers: {
                ...pairedHeaders(diaryWriter),
                Cookie: sessionCookie,
            },
            body: {
                transcript: 'S: tosse persistente. P: continuare terapia e rivalutare.',
                events: [{ type: 'start', atMs: 0 }, { type: 'stop', atMs: 180000 }],
            },
        });
        assert.equal(visitDraft.response.status, 200, 'Paired visit draft must accept a synthetic transcript');
        assert.equal(typeof visitDraft.json?.draftText, 'string', 'Visit draft response must include draftText');
        assert.ok(visitDraft.json?.sections && typeof visitDraft.json.sections === 'object' && !Array.isArray(visitDraft.json.sections), 'Visit draft response must include section groups');
        assert.ok(Array.isArray(visitDraft.json?.medications), 'Visit draft response must include medications');
        assert.equal(visitDraft.json?.safety?.reviewRequired, true);
        assert.equal(visitDraft.json?.safety?.rawAudioPersisted, false);
        assert.deepEqual(visitDraft.json?.safety?.writesPerformed, []);
        assert.deepEqual(await listAuditEvents(sessionCookie), auditBeforeVisitDraft);

        const readOnlyCreate = await request('POST', `/api/v1/network/patients/${patientId}/entries`, {
            headers: {
                ...pairedHeaders(readOnlyClient),
                Cookie: sessionCookie,
            },
            body: {
                type: 'note',
                title: 'Diario rete',
                date: '2026-05-02T09:00:00.000Z',
                content: 'prima nota',
            },
        });
        assert.equal(readOnlyCreate.response.status, 403);

        const missingSession = await request('POST', `/api/v1/network/patients/${patientId}/entries`, {
            headers: pairedHeaders(diaryWriter),
            body: {
                type: 'note',
                title: 'Diario rete',
                date: '2026-05-02T09:00:00.000Z',
                content: 'prima nota',
            },
        });
        assert.equal(missingSession.response.status, 401);

        const plaintextClinicalField = await request('POST', `/api/v1/network/patients/${patientId}/entries`, {
            headers: {
                ...pairedHeaders(diaryWriter),
                Cookie: sessionCookie,
            },
            body: {
                type: 'note',
                title: 'Diario rete',
                date: '2026-05-02T09:00:00.000Z',
                content: SEALED_CONTENT,
            },
        });
        assert.equal(plaintextClinicalField.response.status, 400);
        assert.equal(plaintextClinicalField.json?.error, 'Network diary title must be sealed with ENC:');

        const createBody = {
            id: `network-diary-${crypto.randomUUID()}`,
            type: 'note',
            title: SEALED_TITLE,
            date: '2026-05-02T09:00:00.000Z',
            content: SEALED_CONTENT,
            setting: 'ambulatory',
            metadata: SEALED_METADATA,
            attachments: 'ENC:aXY=:c2VhbGVkcmVmcw==',
        };
        const create = await request('POST', `/api/v1/network/patients/${patientId}/entries`, {
            headers: {
                ...pairedHeaders(diaryWriter),
                Cookie: sessionCookie,
            },
            body: createBody,
        });
        assert.equal(create.response.status, 201);
        const entryId = create.json?.id;
        assert.ok(typeof entryId === 'string' && entryId.length > 0);
        assert.equal(entryId, createBody.id);
        assert.equal(create.json?.version, 1);

        const idempotentCreate = await request('POST', `/api/v1/network/patients/${patientId}/entries`, {
            headers: {
                ...pairedHeaders(diaryWriter),
                Cookie: sessionCookie,
            },
            body: createBody,
        });
        assert.equal(idempotentCreate.response.status, 200);
        assert.equal(idempotentCreate.json?.id, entryId);
        assert.equal(idempotentCreate.json?.version, 1);
        assert.equal(idempotentCreate.json?.idempotent, true);

        const conflictingCreate = await request('POST', `/api/v1/network/patients/${patientId}/entries`, {
            headers: {
                ...pairedHeaders(diaryWriter),
                Cookie: sessionCookie,
            },
            body: {
                ...createBody,
                content: SEALED_UPDATED_CONTENT,
            },
        });
        assert.equal(conflictingCreate.response.status, 409);

        const detail = await request('GET', `/api/v1/network/patients/${patientId}/entries/${entryId}`, {
            headers: {
                ...pairedHeaders(diaryWriter),
                Cookie: sessionCookie,
            },
        });
        assert.equal(detail.response.status, 200);
        assert.equal(detail.json?.id, entryId);
        assert.equal(detail.json?.version, 1);
        assert.equal(detail.json?.title, SEALED_TITLE);
        assert.equal(detail.json?.setting, 'ambulatory');
        assert.equal(detail.json?.attachments, createBody.attachments);

        const plaintextAttachmentArray = await request('PUT', `/api/v1/network/patients/${patientId}/entries/${entryId}`, {
            headers: {
                ...pairedHeaders(diaryWriter),
                Cookie: sessionCookie,
            },
            body: {
                version: 1,
                attachments: [{ id: 'plaintext-reference' }],
            },
        });
        assert.equal(plaintextAttachmentArray.response.status, 400);
        assert.equal(plaintextAttachmentArray.json?.error, 'Network diary attachment references must be sealed with ENC:');

        const plaintextAttachmentJson = await request('PUT', `/api/v1/network/patients/${patientId}/entries/${entryId}`, {
            headers: {
                ...pairedHeaders(diaryWriter),
                Cookie: sessionCookie,
            },
            body: {
                version: 1,
                attachments: '["plaintext-reference"]',
            },
        });
        assert.equal(plaintextAttachmentJson.response.status, 400);
        assert.equal(plaintextAttachmentJson.json?.error, 'Network diary attachment references must be sealed with ENC:');

        const emptyAttachmentArray = await request('PUT', `/api/v1/network/patients/${patientId}/entries/${entryId}`, {
            headers: {
                ...pairedHeaders(diaryWriter),
                Cookie: sessionCookie,
            },
            body: {
                version: 1,
                attachments: [],
            },
        });
        assert.equal(emptyAttachmentArray.response.status, 400, 'Even an empty plaintext array must be rejected');
        assert.equal(emptyAttachmentArray.json?.error, 'Network diary attachment references must be sealed with ENC:');

        const detailAfterRejectedArray = await request('GET', `/api/v1/network/patients/${patientId}/entries/${entryId}`, {
            headers: {
                ...pairedHeaders(diaryWriter),
                Cookie: sessionCookie,
            },
        });
        assert.equal(detailAfterRejectedArray.response.status, 200);
        assert.equal(detailAfterRejectedArray.json?.attachments, createBody.attachments);
        assert.equal(detailAfterRejectedArray.json?.version, 1);

        const clearAttachments = await request('PUT', `/api/v1/network/patients/${patientId}/entries/${entryId}`, {
            headers: {
                ...pairedHeaders(diaryWriter),
                Cookie: sessionCookie,
            },
            body: {
                version: 1,
                attachments: null,
            },
        });
        assert.equal(clearAttachments.response.status, 200, 'Null is the documented clear representation');
        assert.deepEqual(clearAttachments.json, { success: true });

        const clearDetail = await request('GET', `/api/v1/network/patients/${patientId}/entries/${entryId}`, {
            headers: {
                ...pairedHeaders(diaryWriter),
                Cookie: sessionCookie,
            },
        });
        assert.equal(clearDetail.response.status, 200);
        assert.equal(clearDetail.json?.attachments, null);
        assert.equal(clearDetail.json?.version, 2);

        const update = await request('PUT', `/api/v1/network/patients/${patientId}/entries/${entryId}`, {
            headers: {
                ...pairedHeaders(diaryWriter),
                Cookie: sessionCookie,
            },
            body: {
                version: 2,
                content: SEALED_UPDATED_CONTENT,
            },
        });
        assert.equal(update.response.status, 200);
        assert.deepEqual(update.json, { success: true });

        const updatedDetail = await request('GET', `/api/v1/network/patients/${patientId}/entries/${entryId}`, {
            headers: {
                ...pairedHeaders(diaryWriter),
                Cookie: sessionCookie,
            },
        });
        assert.equal(updatedDetail.response.status, 200);
        assert.equal(updatedDetail.json?.content, SEALED_UPDATED_CONTENT);
        assert.equal(updatedDetail.json?.version, 3);

        const conflict = await request('PUT', `/api/v1/network/patients/${patientId}/entries/${entryId}`, {
            headers: {
                ...pairedHeaders(diaryWriter),
                Cookie: sessionCookie,
            },
            body: {
                version: 2,
                content: SEALED_CONTENT,
            },
        });
        assert.equal(conflict.response.status, 409);
        assert.equal(conflict.json?.code, 'VERSION_CONFLICT');
        assert.equal(conflict.json?.entity, 'entry');
        assert.equal(conflict.json?.currentVersion, 3);
        assert.equal(Object.prototype.hasOwnProperty.call(conflict.json?.currentSnapshot ?? {}, 'content'), false);

        const aiField = await request('PUT', `/api/v1/network/patients/${patientId}/entries/${entryId}`, {
            headers: {
                ...pairedHeaders(diaryWriter),
                Cookie: sessionCookie,
            },
            body: {
                version: 3,
                documentInsights: 'blocked remote document-derived field',
            },
        });
        assert.equal(aiField.response.status, 403);
        assert.equal(aiField.json?.error, 'Network diary write boundary excludes AI/document-derived fields');

        const softDelete = await request('PUT', `/api/v1/network/patients/${patientId}/entries/${entryId}`, {
            headers: {
                ...pairedHeaders(diaryWriter),
                Cookie: sessionCookie,
            },
            body: {
                version: 3,
                deletedAt: '2026-05-02T10:00:00.000Z',
                deletionReason: SEALED_DELETION_REASON,
            },
        });
        assert.equal(softDelete.response.status, 200);

        const deletedDetail = await request('GET', `/api/v1/network/patients/${patientId}/entries/${entryId}`, {
            headers: {
                ...pairedHeaders(diaryWriter),
                Cookie: sessionCookie,
            },
        });
        assert.equal(deletedDetail.response.status, 200);
        assert.equal(deletedDetail.json?.version, 4);
        assert.equal(deletedDetail.json?.deletedAt, '2026-05-02T10:00:00.000Z');

        const createdAudit = await findAuditEvent('entry.created', entryId, sessionCookie);
        assert.equal(createdAudit.actorType, 'user');
        assert.equal(createdAudit.sourceSurface, 'native');
        assert.ok(createdAudit.redactedMetadata?.flags?.includes('auth:paired-client'));
        assert.ok(createdAudit.redactedMetadata?.flags?.includes(`paired-client:${diaryWriter.pairedClientId}`));
        assert.deepEqual(createdAudit.redactedMetadata?.changedFields, ['type', 'title', 'date', 'content', 'setting', 'metadata', 'attachments']);
        assert.equal(createdAudit.redactedMetadata?.resourceVersion, 1);

        const updatedAudit = await findAuditEvent('entry.updated', entryId, sessionCookie, ['content']);
        assert.deepEqual(updatedAudit.redactedMetadata?.changedFields, ['content']);
        assert.equal(updatedAudit.redactedMetadata?.resourceVersion, 3);

        const deletedAudit = await findAuditEvent('entry.deleted', entryId, sessionCookie);
        assert.deepEqual(deletedAudit.redactedMetadata?.changedFields, ['deletedAt', 'deletionReason']);
        assert.equal(deletedAudit.redactedMetadata?.resourceVersion, 4);

        scenarioResults.push({
            name: 'paired clinical diary write',
            ambulatoryId,
            patientId,
            entryId,
            readOnlyForbiddenStatus: readOnlyCreate.response.status,
            missingSessionStatus: missingSession.response.status,
            localAiRuntimeStatus: localAiRuntime.response.status,
            pairedAiRuntimeStatus: pairedAiRuntime.response.status,
            disabledDiaryReadStatus: disabledDiaryRead.response.status,
            disabledDiaryReadCode: disabledDiaryRead.json?.code,
            patientScopedVisitDraftStatus: patientScopedVisitDraft.response.status,
            emptyVisitDraftStatus: emptyVisitDraft.response.status,
            tooLongVisitDraftStatus: tooLongVisitDraft.response.status,
            visitDraftStatus: visitDraft.response.status,
            createStatus: create.response.status,
            idempotentCreateStatus: idempotentCreate.response.status,
            conflictingCreateStatus: conflictingCreate.response.status,
            updateStatus: update.response.status,
            conflictStatus: conflict.response.status,
            plaintextAttachmentArrayStatus: plaintextAttachmentArray.response.status,
            plaintextAttachmentJsonStatus: plaintextAttachmentJson.response.status,
            clearAttachmentsStatus: clearAttachments.response.status,
            aiFieldStatus: aiField.response.status,
            softDeleteStatus: softDelete.response.status,
            pairedClientId: diaryWriter.pairedClientId,
        });
    } finally {
        await cleanupPatient(patientId);
    }
});

async function findAuditEvent(eventType, subjectRef, sessionCookie, changedFields) {
    const auditEvents = await listAuditEvents(sessionCookie, `eventType=${eventType}&subjectType=entry&limit=20`);
    const event = auditEvents.find((row) => row.subjectRef === subjectRef
        && (!changedFields || JSON.stringify(row.redactedMetadata?.changedFields) === JSON.stringify(changedFields)));
    assert.ok(event, `Expected ${eventType} audit event for ${subjectRef}`);
    return event;
}

async function listAuditEvents(sessionCookie, query = 'limit=500') {
    const audit = await request('GET', `/api/system/audit?${query}`, {
        headers: {
            Cookie: sessionCookie,
        },
    });
    assert.equal(audit.response.status, 200);
    assert.ok(Array.isArray(audit.json));
    return audit.json;
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
    await setNetworkMode('network-home-base');

    const clinicName = await request('PUT', '/api/settings/clinicName', {
        headers: localApiHeaders(),
        body: { value: 'MediFlow Network Diary Write Smoke' },
    });
    assert.equal(clinicName.response.status, 200);
}

async function setNetworkMode(value) {
    const networkMode = await request('PUT', '/api/settings/network.mode', {
        headers: localApiHeaders(),
        body: { value },
    });
    assert.equal(networkMode.response.status, 200);
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
            lastName: 'Diary',
            taxCode: `NTD${suffix}`,
            ambulatoryId,
            notes: 'network-home-base-diary-write-smoke',
            isAdi: false,
            isArchived: false,
        },
    });

    assert.equal(response.response.status, 201);
    assert.equal(response.json?.id, patientId);
    return patientId;
}

async function cleanupPatient(patientId) {
    const entries = await request('GET', `/api/v1/patients/${patientId}/entries?includeDeleted=true`, {
        headers: localApiHeaders(),
    });
    if (entries.response.status === 200 && Array.isArray(entries.json)) {
        for (const entry of entries.json) {
            if (!entry?.id || entry.deletedAt) continue;
            const deletion = await request('DELETE', `/api/v1/patients/${patientId}/entries/${entry.id}`, {
                headers: localApiHeaders(),
                // WUL-308: child DELETEs require optimistic concurrency.
                body: { version: entry.version, deletionReason: 'network-home-base-diary-write-cleanup' },
            });
            assert.equal(deletion.response.status, 200);
        }
    }
    purgePatientEntriesFromTestDb(patientId);

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

/* @Codex */
function purgePatientEntriesFromTestDb(patientId) {
    const dataDir = process.env.MEDIFLOW_DATA_DIR;
    if (!dataDir) return;
    const dbPath = path.join(dataDir, 'medical.db');
    if (!fs.existsSync(dbPath)) return;

    const db = new Database(dbPath);
    try {
        db.prepare('DELETE FROM entries WHERE patient_id = ?').run(patientId);
    } finally {
        db.close();
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
        return path.join(dataDir, 'reports', 'network-home-base-diary-write-report.json');
    }

    return path.join(process.cwd(), 'tmp-network-home-base-diary-write-report.json');
}
