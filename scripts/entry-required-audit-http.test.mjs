/* @Codex: synthetic real HTTP proof for Web-cookie and local-token diary admission. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { loginWithWebAuthControl } from './web-auth-control-test-client.mjs';

const baseUrl = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3508';
const dataDir = process.env.MEDIFLOW_DATA_DIR;
if (!dataDir) throw new Error('Synthetic MEDIFLOW_DATA_DIR required');
const dbPath = path.join(dataDir, 'medical.db');
const token = process.env.MEDIFLOW_LOCAL_API_TOKEN ?? 'mediflow-network-write-smoke-local-token';
const username = process.env.E2E_USERNAME ?? 'admin';
const pin = process.env.E2E_PIN ?? '1234';
const writer = new Database(dbPath);
const observations = [];

after(() => {
    writer.close();
    const report = path.join(dataDir, 'reports', 'entry-required-audit-http-report.json');
    fs.mkdirSync(path.dirname(report), { recursive: true });
    fs.writeFileSync(report, `${JSON.stringify({ baseUrl, observations }, null, 2)}\n`);
});

async function request(method, pathname, { headers = {}, body, rawBody } = {}) {
    const response = await fetch(new URL(pathname, baseUrl), {
        method, headers: { ...headers, 'content-type': 'application/json' },
        body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)), cache: 'no-store',
    });
    const raw = await response.text();
    let json = null;
    try { json = raw ? JSON.parse(raw) : null; } catch { /* status remains authoritative */ }
    return { status: response.status, json };
}

function seedPatient(id, ambulatoryId) {
    const now = Math.floor(Date.now() / 1000);
    writer.prepare(`INSERT INTO patients (id, first_name, last_name, tax_code, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)`).run(id, 'Synthetic', 'Diary', `SYN${id.replaceAll('-', '').slice(0, 11)}`, now, now);
    writer.prepare('INSERT INTO patients_to_ambulatories (patient_id, ambulatory_id) VALUES (?, ?)').run(id, ambulatoryId);
}

function readBack(patientId) {
    const fresh = new Database(dbPath, { readonly: true });
    try {
        return {
            patient: fresh.prepare('SELECT * FROM patients WHERE id=?').get(patientId) ?? null,
            membership: fresh.prepare('SELECT * FROM patients_to_ambulatories WHERE patient_id=? ORDER BY ambulatory_id').all(patientId),
            entries: fresh.prepare('SELECT * FROM entries WHERE patient_id=? ORDER BY id').all(patientId),
            audit: fresh.prepare("SELECT * FROM audit_events WHERE subject_type='entry' AND subject_ref IN (SELECT id FROM entries WHERE patient_id=?) ORDER BY rowid").all(patientId),
        };
    } finally { fresh.close(); }
}

test('real cookie Web and local token diary writes are audited; 4 MiB + 1 returns 413', async () => {
    const ready = await request('GET', '/api/v1/ambulatories', { headers: { authorization: `Bearer ${token}` } });
    assert.equal(ready.status, 200);
    const ambulatory = writer.prepare('SELECT id FROM ambulatories WHERE is_default=1 LIMIT 1').get();
    assert.ok(ambulatory);
    const login = await loginWithWebAuthControl(baseUrl, { username, password: pin });
    assert.equal(login.response.status, 200);
    assert.ok(login.cookieHeader);
    for (const surface of ['web', 'v1']) {
        const patientId = randomUUID();
        const entryId = randomUUID();
        seedPatient(patientId, ambulatory.id);
        const headers = surface === 'web' ? { Cookie: login.cookieHeader } : { authorization: `Bearer ${token}` };
        const route = surface === 'web' ? '/api/entries' : `/api/v1/patients/${patientId}/entries`;
        const body = { id: entryId, ...(surface === 'web' ? { patientId } : {}), type: 'note',
            title: 'ENC:dGl0bGVpdg==:dGl0bGVjaXBoZXI=', content: 'ENC:Y29udGVudGl2:Y29udGVudGNpcGhlcg==',
            date: '2026-05-02T09:00:00.000Z' };
        const before = readBack(patientId);
        const raw = JSON.stringify(body);
        const oversized = `${raw}${' '.repeat(4_194_305 - Buffer.byteLength(raw, 'utf8'))}`;
        const denied = await request('POST', route, { headers, rawBody: oversized });
        assert.equal(denied.status, 413);
        assert.deepEqual(readBack(patientId), before);
        const created = await request('POST', route, { headers, body });
        assert.equal(created.status, 201);
        const after = readBack(patientId);
        assert.equal(after.entries.length, 1);
        assert.equal(after.audit.length, 1);
        assert.equal(after.audit[0].subject_ref, entryId);
        assert.equal(after.audit[0].event_type, 'entry.created');
        assert.equal(after.audit[0].actor_type, surface === 'web' ? 'user' : 'system');
        assert.equal(after.audit[0].source_surface, surface === 'web' ? 'web' : 'api');
        assert.deepEqual(after.membership, before.membership);
        observations.push({ surface, oversizedStatus: denied.status, createStatus: created.status,
            entryVersion: after.entries[0].version, auditCount: after.audit.length,
            sourceSurface: after.audit[0].source_surface });
    }
});
