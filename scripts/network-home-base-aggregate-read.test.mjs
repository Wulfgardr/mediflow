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
const READ_AGENDA_CAPABILITY = 'network.replica.readonly-agenda';
const READ_GLOBAL_DIARY_CAPABILITY = 'network.replica.readonly-clinical-diary-global';

const scenarioResults = [];

after(() => {
    const report = {
        generatedAt: new Date().toISOString(),
        baseUrl: BASE_URL,
        assertionsCovered: [
            'network capabilities expose agenda and global diary as available in network-home-base mode',
            'network checkups apply date window, status filter, ascending order, limit, and ambulatory scope',
            'network entries apply descending order, default limit 50, include soft-deleted entries, preserve ambulatory scope, and return ENC ciphertext',
            'network patients omit diagnoses by default and include ENC diagnoses only with include=diagnoses',
        ],
        scenarios: scenarioResults,
    };

    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`[network-home-base-aggregate-read] Report written to ${REPORT_PATH}`);
});

test('paired aggregate reads cover agenda, global diary, diagnoses opt-in, and capabilities', async () => {
    await assertServerReady();

    const ambulatoryId = await resolveDefaultAmbulatoryId();
    await enableHomeBaseMode();
    const outsideAmbulatoryId = createOutsideAmbulatory();
    const scopedPatientId = await createSeedPatient(ambulatoryId, 'Aggregate');
    const outsidePatientId = await createSeedPatient(outsideAmbulatoryId, 'Outside');

    const seeded = seedAggregateReadData({ scopedPatientId, outsidePatientId });

    try {
        const pairedClient = await pairClient(
            [READ_PATIENTS_CAPABILITY, READ_AGENDA_CAPABILITY, READ_GLOBAL_DIARY_CAPABILITY],
            'Desk iPad aggregate reader',
        );

        const login = await loginWithWebAuthControl(BASE_URL, { username: USERNAME, password: PIN });
        assert.equal(login.response.status, 200);
        const sessionCookie = extractSessionCookie(login.response);
        const authenticatedPairedHeaders = {
            ...pairedHeaders(pairedClient),
            Cookie: sessionCookie,
        };

        const capabilities = await request('GET', '/api/v1/network/capabilities', {
            headers: localApiHeaders(),
        });
        assert.equal(capabilities.response.status, 200);
        assert.equal(capabilities.json?.operatingMode, 'network-home-base');
        assertCapabilityAvailable(capabilities.json, READ_AGENDA_CAPABILITY);
        assertCapabilityAvailable(capabilities.json, READ_GLOBAL_DIARY_CAPABILITY);

        const checkups = await request(
            'GET',
            '/api/v1/network/checkups?dateFrom=2036-01-10T00:00:00.000Z&dateTo=2036-01-20T23:59:59.999Z&status=pending&limit=2',
            { headers: authenticatedPairedHeaders },
        );
        assert.equal(checkups.response.status, 200);
        assert.ok(Array.isArray(checkups.json));
        assert.equal(checkups.json.length, 2);
        assert.deepEqual(
            checkups.json.map((item) => item.id),
            [seeded.checkups.inWindowEarly, seeded.checkups.inWindowLate],
        );
        assertDatesSorted(checkups.json, 'asc');
        assert.equal(checkups.json.some((item) => item.id === seeded.checkups.outOfWindow), false);
        assert.equal(checkups.json.some((item) => item.id === seeded.checkups.completedInWindow), false);
        assert.equal(checkups.json.some((item) => item.patientId === outsidePatientId), false);

        const entries = await request('GET', '/api/v1/network/entries', {
            headers: authenticatedPairedHeaders,
        });
        assert.equal(entries.response.status, 200);
        assert.ok(Array.isArray(entries.json));
        assert.equal(entries.json.length, 50);
        assertDatesSorted(entries.json, 'desc');
        assert.ok(
            entries.json.some((entry) => entry.id === seeded.entries.softDeleted && entry.deletedAt),
            'soft-deleted scoped entry should be present in the global diary feed',
        );
        assert.equal(entries.json.some((entry) => entry.patientId === outsidePatientId), false);
        for (const entry of entries.json.filter((item) => seeded.entries.scopedIds.includes(item.id))) {
            assertEncrypted(entry.title, `entry ${entry.id} title`);
            assertEncrypted(entry.content, `entry ${entry.id} content`);
        }

        const patientsDefault = await request('GET', '/api/v1/network/patients', {
            headers: authenticatedPairedHeaders,
        });
        assert.equal(patientsDefault.response.status, 200);
        const defaultSummary = patientsDefault.json.find((patient) => patient.id === scopedPatientId);
        assert.ok(defaultSummary);
        assert.equal(Object.hasOwn(defaultSummary, 'diagnoses'), false);

        const patientsWithDiagnoses = await request('GET', '/api/v1/network/patients?include=diagnoses', {
            headers: authenticatedPairedHeaders,
        });
        assert.equal(patientsWithDiagnoses.response.status, 200);
        const diagnosisSummary = patientsWithDiagnoses.json.find((patient) => patient.id === scopedPatientId);
        assert.ok(diagnosisSummary);
        assertEncrypted(diagnosisSummary.diagnoses, 'patient diagnoses');

        scenarioResults.push({
            name: 'paired aggregate read contracts',
            ambulatoryId,
            outsideAmbulatoryId,
            scopedPatientId,
            outsidePatientId,
            pairedClientId: pairedClient.pairedClientId,
            capabilitiesStatus: capabilities.response.status,
            checkupsStatus: checkups.response.status,
            checkupIds: checkups.json.map((item) => item.id),
            entriesStatus: entries.response.status,
            entriesCount: entries.json.length,
            softDeletedEntryIncluded: entries.json.some((entry) => entry.id === seeded.entries.softDeleted),
            patientsDefaultStatus: patientsDefault.response.status,
            patientsWithDiagnosesStatus: patientsWithDiagnoses.response.status,
        });
    } finally {
        purgeAggregateRows(seeded);
        await cleanupPatient(scopedPatientId);
        await cleanupPatient(outsidePatientId);
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
        body: { value: 'MediFlow Network Aggregate Read Smoke' },
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

async function createSeedPatient(ambulatoryId, lastNameSuffix) {
    const patientId = crypto.randomUUID();
    const suffix = patientId.replace(/-/g, '').slice(0, 13).toUpperCase();
    const response = await request('POST', '/api/v1/patients', {
        headers: localApiHeaders(),
        body: {
            id: patientId,
            firstName: 'Network',
            lastName: lastNameSuffix,
            taxCode: `NTA${suffix}`,
            ambulatoryId,
            notes: 'network-home-base-aggregate-read-smoke',
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

function createOutsideAmbulatory() {
    const ambulatoryId = crypto.randomUUID();
    withDb((db) => {
        db.prepare(
            `INSERT INTO ambulatories (id, name, type, is_default, created_at)
             VALUES (?, ?, 'test', 0, ?)`
        ).run(ambulatoryId, 'Network Aggregate Read Outside Scope', nowSeconds());
    });
    return ambulatoryId;
}

function seedAggregateReadData({ scopedPatientId, outsidePatientId }) {
    const now = nowSeconds();
    const checkups = {
        inWindowEarly: `aggregate-checkup-${crypto.randomUUID()}`,
        inWindowLate: `aggregate-checkup-${crypto.randomUUID()}`,
        limitOverflow: `aggregate-checkup-${crypto.randomUUID()}`,
        outOfWindow: `aggregate-checkup-${crypto.randomUUID()}`,
        completedInWindow: `aggregate-checkup-${crypto.randomUUID()}`,
        outsideScope: `aggregate-checkup-${crypto.randomUUID()}`,
    };
    const entries = {
        scopedIds: [],
        softDeleted: `aggregate-entry-${crypto.randomUUID()}`,
        outsideScope: `aggregate-entry-${crypto.randomUUID()}`,
    };

    withDb((db) => {
        db.prepare('UPDATE patients SET diagnoses = ?, updated_at = ? WHERE id = ?')
            .run('ENC:iv:aggregate-diagnoses-ciphertext', now, scopedPatientId);

        const insertCheckup = db.prepare(
            `INSERT INTO checkups
             (id, patient_id, date, title, notes, status, source, version, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, 'manual', 1, ?, ?)`
        );
        insertCheckup.run(
            checkups.inWindowEarly,
            scopedPatientId,
            toEpochSeconds('2036-01-11T09:00:00.000Z'),
            'Agenda pending early',
            'ENC:iv:checkup-notes-early',
            'pending',
            now,
            now,
        );
        insertCheckup.run(
            checkups.inWindowLate,
            scopedPatientId,
            toEpochSeconds('2036-01-12T09:00:00.000Z'),
            'Agenda pending late',
            'ENC:iv:checkup-notes-late',
            'pending',
            now,
            now,
        );
        insertCheckup.run(
            checkups.limitOverflow,
            scopedPatientId,
            toEpochSeconds('2036-01-13T09:00:00.000Z'),
            'Agenda pending overflow',
            'ENC:iv:checkup-notes-overflow',
            'pending',
            now,
            now,
        );
        insertCheckup.run(
            checkups.outOfWindow,
            scopedPatientId,
            toEpochSeconds('2036-01-25T09:00:00.000Z'),
            'Agenda outside window',
            'ENC:iv:checkup-notes-outside-window',
            'pending',
            now,
            now,
        );
        insertCheckup.run(
            checkups.completedInWindow,
            scopedPatientId,
            toEpochSeconds('2036-01-11T10:00:00.000Z'),
            'Agenda completed in window',
            'ENC:iv:checkup-notes-completed',
            'completed',
            now,
            now,
        );
        insertCheckup.run(
            checkups.outsideScope,
            outsidePatientId,
            toEpochSeconds('2036-01-11T08:00:00.000Z'),
            'Agenda outside scope',
            'ENC:iv:checkup-notes-scope-leak',
            'pending',
            now,
            now,
        );

        const insertEntry = db.prepare(
            `INSERT INTO entries
             (id, patient_id, type, title, date, content, setting, metadata, attachments, deleted_at, deletion_reason, version, created_at, updated_at)
             VALUES (?, ?, 'note', ?, ?, ?, 'ambulatory', ?, NULL, ?, ?, 1, ?, ?)`
        );
        insertEntry.run(
            entries.softDeleted,
            scopedPatientId,
            'ENC:iv:entry-title-soft-deleted',
            toEpochSeconds('2036-02-28T12:00:00.000Z'),
            'ENC:iv:entry-content-soft-deleted',
            JSON.stringify({ lane: 'aggregate-read-smoke', index: 'soft-deleted' }),
            toEpochSeconds('2036-03-01T12:00:00.000Z'),
            'network-aggregate-read-soft-delete',
            now,
            now,
        );
        entries.scopedIds.push(entries.softDeleted);

        for (let index = 0; index < 54; index += 1) {
            const entryId = `aggregate-entry-${crypto.randomUUID()}`;
            entries.scopedIds.push(entryId);
            insertEntry.run(
                entryId,
                scopedPatientId,
                `ENC:iv:entry-title-${index}`,
                toEpochSeconds(new Date(Date.parse('2036-02-27T12:00:00.000Z') - (index * 60 * 60 * 1000)).toISOString()),
                `ENC:iv:entry-content-${index}`,
                JSON.stringify({ lane: 'aggregate-read-smoke', index }),
                null,
                null,
                now,
                now,
            );
        }

        insertEntry.run(
            entries.outsideScope,
            outsidePatientId,
            'ENC:iv:entry-title-scope-leak',
            toEpochSeconds('2036-02-28T13:00:00.000Z'),
            'ENC:iv:entry-content-scope-leak',
            JSON.stringify({ lane: 'aggregate-read-smoke', index: 'outside-scope' }),
            null,
            null,
            now,
            now,
        );
    });

    return { checkups, entries };
}

function purgeAggregateRows(seeded) {
    withDb((db) => {
        const checkupIds = Object.values(seeded.checkups);
        const entryIds = [...seeded.entries.scopedIds, seeded.entries.outsideScope];
        for (const id of checkupIds) {
            db.prepare('DELETE FROM checkups WHERE id = ?').run(id);
        }
        for (const id of entryIds) {
            db.prepare('DELETE FROM entries WHERE id = ?').run(id);
        }
    });
}

function assertCapabilityAvailable(payload, capabilityKey) {
    const capability = payload?.capabilities?.find((item) => item.key === capabilityKey);
    assert.ok(capability, `Expected ${capabilityKey} capability in response`);
    assert.equal(capability.status, 'available');
}

function assertDatesSorted(items, direction) {
    for (let index = 1; index < items.length; index += 1) {
        const previous = Date.parse(items[index - 1].date);
        const current = Date.parse(items[index].date);
        if (direction === 'asc') {
            assert.ok(previous <= current, `Expected ascending dates at index ${index}`);
        } else {
            assert.ok(previous >= current, `Expected descending dates at index ${index}`);
        }
    }
}

function assertEncrypted(value, label) {
    assert.equal(typeof value, 'string', `${label} should be a string`);
    assert.ok(value.startsWith('ENC:'), `${label} should remain ciphertext`);
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

function withDb(callback) {
    const dataDir = process.env.MEDIFLOW_DATA_DIR;
    assert.ok(dataDir, 'MEDIFLOW_DATA_DIR is required for aggregate read smoke seed data');
    const dbPath = path.join(dataDir, 'medical.db');
    assert.ok(fs.existsSync(dbPath), `Expected smoke database at ${dbPath}`);

    const db = new Database(dbPath);
    try {
        return callback(db);
    } finally {
        db.close();
    }
}

function toEpochSeconds(value) {
    return Math.floor(Date.parse(value) / 1000);
}

function nowSeconds() {
    return Math.floor(Date.now() / 1000);
}

function resolveReportPath() {
    if (process.env.MEDIFLOW_NETWORK_WRITE_REPORT_PATH) {
        return process.env.MEDIFLOW_NETWORK_WRITE_REPORT_PATH;
    }

    const dataDir = process.env.MEDIFLOW_DATA_DIR || process.env.MEDIFLOW_NETWORK_WRITE_DATA_DIR;
    if (dataDir) {
        return path.join(dataDir, 'reports', 'network-home-base-aggregate-read-report.json');
    }

    return path.join(process.cwd(), 'tmp-network-home-base-aggregate-read-report.json');
}
