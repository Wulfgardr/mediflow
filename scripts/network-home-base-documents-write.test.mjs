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
const READ_DOCUMENTS_CAPABILITY = 'network.replica.readonly-documents';
const WRITE_DOCUMENTS_CAPABILITY = 'network.replica.write-documents';
const VISIT_DRAFT_CAPABILITY = 'network.compute.visit-draft';
const scenarioResults = [];

after(() => {
    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, `${JSON.stringify({ generatedAt: new Date().toISOString(), baseUrl: BASE_URL, scenarios: scenarioResults }, null, 2)}\n`);
    console.log(`[network-home-base-documents-write] Report written to ${REPORT_PATH}`);
});

test('paired document projection persists sealed payloads and legacy pairing requires re-approval', async () => {
    await assertServerReady();
    const ambulatoryId = await resolveDefaultAmbulatoryId();
    await enableHomeBaseMode();
    const patientId = await createSeedPatient(ambulatoryId);
    const createdAttachmentIds = [];

    try {
        const legacyClient = await pairClient([READ_PATIENTS_CAPABILITY], 'Desk iPad W5 legacy');
        const approvedClient = await pairClient(
            [READ_PATIENTS_CAPABILITY, READ_DOCUMENTS_CAPABILITY, WRITE_DOCUMENTS_CAPABILITY, VISIT_DRAFT_CAPABILITY],
            'Desk iPad W5 re-approved',
        );
        const sessionCookie = await login();

        const legacyDocuments = await request('GET', `/api/v1/network/patients/${patientId}/attachments`, {
            headers: { ...pairedHeaders(legacyClient), Cookie: sessionCookie },
        });
        assert.equal(legacyDocuments.response.status, 403, 'Legacy pairing without document capability must receive 403');

        const legacyVisitDraft = await request('POST', '/api/v1/network/visit-draft', {
            headers: { ...pairedHeaders(legacyClient), Cookie: sessionCookie },
            body: { transcript: 'S: sintomo sintetico. P: controllo programmato.' },
        });
        assert.equal(legacyVisitDraft.response.status, 403, 'Legacy pairing without visit-draft capability must receive 403');

        const payload = sealedDocumentProjection();
        const created = await request('POST', `/api/v1/network/patients/${patientId}/attachments`, {
            headers: { ...pairedHeaders(approvedClient), Cookie: sessionCookie }, body: payload,
        });
        assert.equal(created.response.status, 201, 'Re-approved paired client must create a sealed document projection');
        assert.ok(typeof created.json?.id === 'string' && created.json.id.length > 0, 'Document create response must include an id');
        const attachmentId = created.json.id;
        createdAttachmentIds.push(attachmentId);

        const listed = await request('GET', `/api/v1/network/patients/${patientId}/attachments`, {
            headers: { ...pairedHeaders(approvedClient), Cookie: sessionCookie },
        });
        assert.equal(listed.response.status, 200, 'Re-approved paired client must list documents');
        const summary = listed.json?.find((item) => item.id === attachmentId);
        assert.ok(summary, 'Created document must appear in the paired list');
        assert.equal(Object.hasOwn(summary, 'data'), false, 'Paired document list must omit encrypted data');

        const detail = await request('GET', `/api/v1/network/patients/${patientId}/attachments/${attachmentId}`, {
            headers: { ...pairedHeaders(approvedClient), Cookie: sessionCookie },
        });
        assert.equal(detail.response.status, 200, 'Re-approved paired client must fetch document detail');
        assert.equal(detail.json?.data, payload.data, 'Paired document detail must return the sealed data envelope unchanged');

        const persisted = readPersistedAttachment(attachmentId);
        assert.equal(persisted?.ocr_queue_state, 'pending', 'Paired document must persist pending OCR queue state');
        assert.equal(persisted?.ocr_queue_reason, 'paired_upload', 'Paired document must persist paired_upload OCR queue reason');

        const forbidden = await request('POST', `/api/v1/network/patients/${patientId}/attachments`, {
            headers: { ...pairedHeaders(approvedClient), Cookie: sessionCookie },
            body: { ...sealedDocumentProjection(), summarySnapshot: 'forbidden-client-derived-value' },
        });
        assert.equal(forbidden.response.status, 400, 'Document create must reject summarySnapshot by presence');

        const plaintext = await request('POST', `/api/v1/network/patients/${patientId}/attachments`, {
            headers: { ...pairedHeaders(approvedClient), Cookie: sessionCookie },
            body: { ...sealedDocumentProjection(), data: 'data:text/plain;base64,c3ludGhldGlj' },
        });
        assert.equal(plaintext.response.status, 400, 'Document create must reject plaintext data');

        const oversized = await request('POST', `/api/v1/network/patients/${patientId}/attachments`, {
            headers: { ...pairedHeaders(approvedClient), Cookie: sessionCookie },
            body: { ...sealedDocumentProjection(), data: `ENC:${'A'.repeat(2_048)}:QQ==` },
        });
        assert.equal(oversized.response.status, 413, 'Document create must enforce the configured wire-size limit before parsing');

        const visitDraft = await request('POST', '/api/v1/network/visit-draft', {
            headers: { ...pairedHeaders(approvedClient), Cookie: sessionCookie },
            body: { transcript: 'S: sintomo sintetico. P: controllo programmato.' },
        });
        assert.equal(visitDraft.response.status, 200, 'Re-approved paired client must access visit draft');

        scenarioResults.push({
            name: 'paired documents and legacy re-approval', patientId, attachmentId,
            legacyDocumentStatus: legacyDocuments.response.status, legacyVisitDraftStatus: legacyVisitDraft.response.status,
            documentCreateStatus: created.response.status, oversizedStatus: oversized.response.status,
            reApprovedVisitDraftStatus: visitDraft.response.status,
        });
    } finally {
        purgeAttachmentsFromTestDb(createdAttachmentIds);
        await cleanupPatient(patientId);
    }
});

function sealedDocumentProjection() {
    return {
        name: 'ENC:c3ludGhldGljLXBheWxvYWQ=:bmFtZQ==', path: 'ENC:c3ludGhldGljLXBheWxvYWQ=:cGF0aA==',
        data: 'ENC:c3ludGhldGljLXBheWxvYWQ=:ZGF0YQ==', type: 'text/plain', size: 9,
    };
}

async function assertServerReady() {
    const response = await request('GET', '/api/v1/ambulatories', { headers: localApiHeaders() });
    assert.equal(response.response.status, 200, `Expected ${BASE_URL}/api/v1/ambulatories to be reachable`);
}

async function resolveDefaultAmbulatoryId() {
    const response = await request('GET', '/api/v1/ambulatories', { headers: localApiHeaders() });
    assert.equal(response.response.status, 200);
    const ambulatory = response.json?.find((item) => item.isDefault) ?? response.json?.[0];
    assert.ok(ambulatory?.id, 'Smoke database must have a default ambulatory');
    return ambulatory.id;
}

async function enableHomeBaseMode() {
    const response = await request('PUT', '/api/settings/network.mode', { headers: localApiHeaders(), body: { value: 'network-home-base' } });
    assert.equal(response.response.status, 200);
}

async function pairClient(requestedCapabilities, deviceName) {
    const intent = await request('POST', '/api/v1/network/pairing-intents', {
        body: { deviceName, clientPlatform: 'ipados', appVersion: '0.7.2-w5-smoke', requestedCapabilities },
    });
    assert.equal(intent.response.status, 201, 'Pairing intent must be created');
    const confirmed = await request('POST', `/api/v1/network/pairing-intents/${intent.json?.intentId}/confirm`, { headers: localApiHeaders() });
    assert.equal(confirmed.response.status, 201, 'Pairing intent must be approved by the home base');
    assert.ok(confirmed.json?.pairedClient?.clientId, 'Approved pairing must return a client id');
    assert.ok(confirmed.json?.pairedClientToken, 'Approved pairing must return a client token');
    return { pairedClientId: confirmed.json.pairedClient.clientId, pairedClientToken: confirmed.json.pairedClientToken };
}

async function login() {
    const response = await loginWithWebAuthControl(BASE_URL, { username: USERNAME, password: PIN });
    assert.equal(response.response.status, 200, 'Smoke operator login must succeed');
    assert.ok(response.sessionCookie, 'Operator login must set mediflow_session');
    return response.sessionCookie;
}

async function createSeedPatient(ambulatoryId) {
    const id = crypto.randomUUID();
    const suffix = id.replace(/-/g, '').slice(0, 13).toUpperCase();
    const response = await request('POST', '/api/v1/patients', {
        headers: localApiHeaders(),
        body: { id, firstName: 'Network', lastName: 'Document', taxCode: `NWD${suffix}`, ambulatoryId, isAdi: false, isArchived: false },
    });
    assert.equal(response.response.status, 201, 'Synthetic document-smoke patient must be created');
    return id;
}

function readPersistedAttachment(attachmentId) {
    const db = openSmokeDatabase();
    try { return db.prepare('SELECT ocr_queue_state, ocr_queue_reason FROM attachments WHERE id = ?').get(attachmentId); } finally { db.close(); }
}

function purgeAttachmentsFromTestDb(attachmentIds) {
    if (attachmentIds.length === 0) return;
    const db = openSmokeDatabase();
    try { for (const attachmentId of attachmentIds) db.prepare('DELETE FROM attachments WHERE id = ?').run(attachmentId); } finally { db.close(); }
}

function openSmokeDatabase() {
    const dataDir = process.env.MEDIFLOW_DATA_DIR;
    assert.ok(dataDir, 'MEDIFLOW_DATA_DIR is required for document persistence checks');
    return new Database(path.join(dataDir, 'medical.db'));
}

async function cleanupPatient(patientId) {
    const detail = await request('GET', `/api/v1/patients/${patientId}`, { headers: localApiHeaders() });
    if (detail.response.status !== 200) return;
    const deletion = await request('DELETE', `/api/v1/patients/${patientId}`, { headers: localApiHeaders(), body: { version: detail.json?.version } });
    assert.equal(deletion.response.status, 200, 'Synthetic document-smoke patient must be deleted');
}

function localApiHeaders() { return { Authorization: `Bearer ${LOCAL_API_TOKEN}`, 'Cache-Control': 'no-store' }; }
function pairedHeaders(client) { return { 'x-mediflow-paired-client-id': client.pairedClientId, 'x-mediflow-paired-client-token': client.pairedClientToken }; }

async function request(method, pathname, { headers = {}, body } = {}) {
    const finalHeaders = { ...headers };
    if (body !== undefined) finalHeaders['Content-Type'] = 'application/json';
    const response = await fetch(new URL(pathname, BASE_URL), { method, headers: finalHeaders, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    return { response, json, text };
}

function resolveReportPath() {
    const dataDir = process.env.MEDIFLOW_DATA_DIR || process.env.MEDIFLOW_NETWORK_WRITE_DATA_DIR;
    return dataDir ? path.join(dataDir, 'reports', 'network-home-base-documents-write-report.json') : path.join(process.cwd(), 'tmp-network-home-base-documents-write-report.json');
}
