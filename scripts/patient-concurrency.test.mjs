#!/usr/bin/env node
/* @Codex */

import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { loginWithWebAuthControl } from './web-auth-control-test-client.mjs';

const BASE_URL = process.env.E2E_BASE_URL || 'http://127.0.0.1:3100';
const LOCAL_API_TOKEN = process.env.MEDIFLOW_LOCAL_API_TOKEN || 'mediflow-e2e-local-token';
const USERNAME = process.env.E2E_USERNAME || 'admin';
const PIN = process.env.E2E_PIN || '1234';
const REPORT_PATH = resolveReportPath();

const scenarioResults = [];
const authContextPromise = createAuthContext();

class LaneClient {
    constructor(label, basePath, authHeaders = {}) {
        this.label = label;
        this.basePath = basePath;
        this.authHeaders = authHeaders;
    }

    async createPatient(payload) {
        const { response, json } = await this.request('POST', '', payload);
        assert.equal(response.status, 201, `${this.label} create patient should return 201`);
        assert.ok(typeof json?.id === 'string' && json.id.length > 0, `${this.label} create patient should return an id`);
        return json.id;
    }

    async getPatient(id) {
        const { response, json } = await this.request('GET', `/${id}`);
        if (response.status === 404) return null;
        assert.equal(response.status, 200, `${this.label} get patient should return 200`);
        assert.ok(typeof json?.version === 'number', `${this.label} get patient should expose a numeric version`);
        return json;
    }

    async updatePatient(id, payload) {
        return this.request('PUT', `/${id}`, payload);
    }

    async deletePatient(id, version) {
        return this.request('DELETE', `/${id}`, { version });
    }

    async request(method, suffix, body) {
        const url = new URL(`${this.basePath}${suffix}`, BASE_URL);
        const headers = { ...this.authHeaders };
        let payload;

        if (body !== undefined) {
            headers['Content-Type'] = 'application/json';
            payload = JSON.stringify(body);
        }

        const response = await fetch(url, {
            method,
            headers,
            body: payload
        });

        const text = await response.text();
        const json = text.length > 0 ? JSON.parse(text) : null;
        return { response, json };
    }
}

after(() => {
    const report = {
        generatedAt: new Date().toISOString(),
        baseUrl: BASE_URL,
        scenarios: scenarioResults
    };

    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

    console.log('');
    console.log('[patient-concurrency] Scenario summary');
    for (const scenario of scenarioResults) {
        console.log(
            `- ${scenario.name}: winner=${scenario.winner}, loser=${scenario.loser}, loserOperation=${scenario.loserOperation}, conflictStatus=${scenario.conflictStatus}, currentVersion=${scenario.currentVersion}`
        );
    }
    console.log(`[patient-concurrency] Report written to ${REPORT_PATH}`);
});

test('web update wins over native stale update', async () => {
    await runConflictScenario({
        name: 'web update wins over native stale update',
        winnerLane: 'web',
        loserLane: 'native-v1',
        loserOperation: 'update'
    });
});

test('native update wins over web stale update', async () => {
    await runConflictScenario({
        name: 'native update wins over web stale update',
        winnerLane: 'native-v1',
        loserLane: 'web',
        loserOperation: 'update'
    });
});

test('web update wins over native stale delete', async () => {
    await runConflictScenario({
        name: 'web update wins over native stale delete',
        winnerLane: 'web',
        loserLane: 'native-v1',
        loserOperation: 'delete'
    });
});

test('native update wins over web stale delete', async () => {
    await runConflictScenario({
        name: 'native update wins over web stale delete',
        winnerLane: 'native-v1',
        loserLane: 'web',
        loserOperation: 'delete'
    });
});

test('bulk move waits for a concurrent writer and preserves unrelated memberships', async () => {
    const context = await authContextPromise;
    const dataDir = process.env.MEDIFLOW_DATA_DIR || process.env.MEDIFLOW_E2E_DATA_DIR;
    assert.ok(dataDir, 'patient concurrency test requires a dedicated data directory');

    const sourceAmbulatoryId = crypto.randomUUID();
    const targetAmbulatoryId = crypto.randomUUID();
    const preservedAmbulatoryId = crypto.randomUUID();
    const ambulatoryIds = [sourceAmbulatoryId, targetAmbulatoryId, preservedAmbulatoryId];
    const writer = new Database(path.join(dataDir, 'medical.db'));
    writer.pragma('busy_timeout = 5000');
    writer.pragma('foreign_keys = ON');

    let patientId = null;
    let transactionOpen = false;
    let movePromise = null;
    try {
        const insertAmbulatory = writer.prepare(`
            INSERT INTO ambulatories (id, name, type, is_default, version, created_at)
            VALUES (?, ?, 'live', 0, 1, ?)
        `);
        const createdAt = Math.floor(Date.now() / 1000);
        for (const [index, ambulatoryId] of ambulatoryIds.entries()) {
            insertAmbulatory.run(ambulatoryId, `Bulk move ${index + 1}`, createdAt);
        }

        patientId = await context.web.createPatient({
            ...buildPatientPayload('bulk move concurrency'),
            ambulatoryId: sourceAmbulatoryId,
        });
        writer.prepare('UPDATE patients SET ambulatory_id = ? WHERE id = ?')
            .run(sourceAmbulatoryId, patientId);
        writer.prepare('DELETE FROM patients_to_ambulatories WHERE patient_id = ?')
            .run(patientId);
        const insertMembership = writer.prepare(`
            INSERT INTO patients_to_ambulatories (patient_id, ambulatory_id, assigned_at)
            VALUES (?, ?, ?)
        `);
        insertMembership.run(patientId, sourceAmbulatoryId, createdAt);
        insertMembership.run(patientId, preservedAmbulatoryId, createdAt);

        const invalid = await context.web.request('POST', '/move', {
            patientIds: [patientId],
            targetAmbulatoryId,
        });
        assert.equal(invalid.response.status, 400, 'move should require the exact version map');

        writer.exec('BEGIN IMMEDIATE');
        transactionOpen = true;
        const competingWrite = writer.prepare(
            'UPDATE patients SET version = version + 1 WHERE id = ?',
        ).run(patientId);
        assert.equal(competingWrite.changes, 1);

        let requestSettled = false;
        movePromise = context.web.request('POST', '/move', {
            patientIds: [patientId],
            patientVersions: { [patientId]: 1 },
            targetAmbulatoryId,
            sourceAmbulatoryId,
        }).finally(() => {
            requestSettled = true;
        });

        await delay(500);
        assert.equal(requestSettled, false, 'move should wait before taking its read snapshot');

        writer.exec('COMMIT');
        transactionOpen = false;

        const conflict = await movePromise;
        assert.equal(conflict.response.status, 409);
        assert.equal(conflict.json?.code, 'VERSION_CONFLICT');
        assert.equal(conflict.json?.recordId, patientId);
        assert.equal(conflict.json?.expectedVersion, 1);
        assert.equal(conflict.json?.currentVersion, 2);

        assert.deepEqual(readPatient(writer, patientId), {
            ambulatoryId: sourceAmbulatoryId,
            version: 2,
        });
        assert.deepEqual(
            readMemberships(writer, patientId),
            [preservedAmbulatoryId, sourceAmbulatoryId].sort(),
        );

        const retry = await context.web.request('POST', '/move', {
            patientIds: [patientId],
            patientVersions: { [patientId]: 2 },
            targetAmbulatoryId,
            sourceAmbulatoryId,
        });
        assert.equal(retry.response.status, 200);
        assert.equal(retry.json?.patientVersions?.[patientId], 3);
        assert.deepEqual(readPatient(writer, patientId), {
            ambulatoryId: targetAmbulatoryId,
            version: 3,
        });
        assert.deepEqual(
            readMemberships(writer, patientId),
            [preservedAmbulatoryId, targetAmbulatoryId].sort(),
        );

        scenarioResults.push({
            name: 'bulk move waits for a concurrent writer',
            winner: 'concurrent-writer',
            loser: 'bulk-move',
            loserOperation: 'move',
            conflictStatus: conflict.response.status,
            currentVersion: conflict.json?.currentVersion,
        });
    } finally {
        if (transactionOpen) writer.exec('ROLLBACK');
        if (movePromise) await movePromise.catch(() => undefined);
        if (patientId) {
            writer.prepare('DELETE FROM patients_to_ambulatories WHERE patient_id = ?').run(patientId);
            writer.prepare('DELETE FROM patients WHERE id = ?').run(patientId);
        }
        const deleteAmbulatory = writer.prepare('DELETE FROM ambulatories WHERE id = ?');
        for (const ambulatoryId of ambulatoryIds) deleteAmbulatory.run(ambulatoryId);
        writer.close();
    }
});

async function runConflictScenario({ name, winnerLane, loserLane, loserOperation }) {
    const context = await authContextPromise;
    const winner = context[winnerLane];
    const loser = context[loserLane];

    assert.ok(winner instanceof LaneClient, `Unknown winner lane: ${winnerLane}`);
    assert.ok(loser instanceof LaneClient, `Unknown loser lane: ${loserLane}`);

    const patientId = await context.web.createPatient(buildPatientPayload(name));

    try {
        const winnerSnapshot = await winner.getPatient(patientId);
        const loserSnapshot = await loser.getPatient(patientId);

        assert.ok(winnerSnapshot, `${winner.label} should read the seeded patient`);
        assert.ok(loserSnapshot, `${loser.label} should read the seeded patient`);
        assert.equal(winnerSnapshot.version, loserSnapshot.version, 'Both lanes should start from the same version');

        const winnerResult = await winner.updatePatient(patientId, {
            version: winnerSnapshot.version,
            notes: `winner:${winner.label}:${name}`
        });
        assert.equal(winnerResult.response.status, 200, `${winner.label} update should succeed`);
        assert.deepEqual(winnerResult.json, { success: true }, `${winner.label} update should return success payload`);

        const loserResult = loserOperation === 'update'
            ? await loser.updatePatient(patientId, {
                version: loserSnapshot.version,
                notes: `loser:${loser.label}:${name}`
            })
            : await loser.deletePatient(patientId, loserSnapshot.version);

        assert.equal(loserResult.response.status, 409, `${loser.label} stale ${loserOperation} should conflict`);

        const conflict = loserResult.json;
        assert.equal(conflict?.error, 'Conflict');
        assert.equal(conflict?.code, 'VERSION_CONFLICT');
        assert.equal(conflict?.entity, 'patient');
        assert.equal(conflict?.recordId, patientId);
        assert.equal(conflict?.expectedVersion, loserSnapshot.version);
        assert.equal(conflict?.currentState, 'present');
        assert.equal(conflict?.currentVersion, winnerSnapshot.version + 1);
        assert.equal(conflict?.currentSnapshot?.id, patientId);
        assert.equal(conflict?.currentSnapshot?.version, winnerSnapshot.version + 1);

        const latest = await winner.getPatient(patientId);
        assert.ok(latest, 'Patient should still exist after stale conflict');
        assert.equal(latest.version, winnerSnapshot.version + 1, 'Winning update should advance patient version');

        scenarioResults.push({
            name,
            winner: winner.label,
            loser: loser.label,
            loserOperation,
            conflictStatus: loserResult.response.status,
            expectedVersion: loserSnapshot.version,
            currentVersion: conflict.currentVersion,
            currentState: conflict.currentState
        });
    } finally {
        await cleanupPatient(context.native, patientId);
    }
}

async function createAuthContext() {
    await assertServerReady();
    const nativeAuthHeaders = {
        Authorization: `Bearer ${LOCAL_API_TOKEN}`
    };
    const sessionCookie = await login();

    const nativeLane = new LaneClient('native-v1', '/api/v1/patients', {
        ...nativeAuthHeaders
    });

    return {
        web: new LaneClient('web', '/api/patients', { Cookie: sessionCookie }),
        'native-v1': nativeLane,
        native: nativeLane
    };
}

async function login() {
    const result = await loginWithWebAuthControl(BASE_URL, { username: USERNAME, password: PIN });
    assert.equal(result.response.status, 200, 'web concurrency lane should authenticate');
    assert.ok(result.sessionCookie, 'login should return the mediflow_session cookie');
    return result.sessionCookie;
}

async function cleanupPatient(nativeLane, patientId) {
    const latest = await nativeLane.getPatient(patientId);
    if (!latest) return;

    const result = await nativeLane.deletePatient(patientId, latest.version);
    assert.equal(result.response.status, 200, `Cleanup delete should succeed for ${patientId}`);
}

function readPatient(database, patientId) {
    return database.prepare(
        'SELECT ambulatory_id AS ambulatoryId, version FROM patients WHERE id = ?',
    ).get(patientId);
}

function readMemberships(database, patientId) {
    return database.prepare(`
        SELECT ambulatory_id AS ambulatoryId
        FROM patients_to_ambulatories
        WHERE patient_id = ?
        ORDER BY ambulatory_id
    `).all(patientId).map((row) => row.ambulatoryId);
}

async function delay(milliseconds) {
    await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function assertServerReady() {
    const response = await fetch(new URL('/api/v1/patients', BASE_URL), {
        headers: {
            Authorization: `Bearer ${LOCAL_API_TOKEN}`,
            'Cache-Control': 'no-store'
        }
    });

    assert.equal(response.status, 200, `Expected ${BASE_URL}/api/v1/patients to be reachable`);
}

function buildPatientPayload(name) {
    const suffix = crypto.randomUUID().replace(/-/g, '').toUpperCase();
    return {
        id: crypto.randomUUID(),
        firstName: 'Concurrency',
        lastName: suffix.slice(0, 8),
        taxCode: `TST${suffix.slice(0, 13)}`,
        address: null,
        phone: null,
        caregiver: null,
        isAdi: false,
        isArchived: false,
        notes: `seed:${name}`
    };
}

function resolveReportPath() {
    const dataDir = process.env.MEDIFLOW_DATA_DIR || process.env.MEDIFLOW_E2E_DATA_DIR;
    if (dataDir) {
        return path.join(dataDir, 'reports', 'patient-concurrency-report.json');
    }

    return path.join(process.cwd(), 'tmp-patient-concurrency-report.json');
}
