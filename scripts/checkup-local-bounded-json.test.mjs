import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { loginWithWebAuthControl } from './web-auth-control-test-client.mjs';

const base = process.env.E2E_BASE_URL || 'http://127.0.0.1:3400';
const token = process.env.MEDIFLOW_LOCAL_API_TOKEN || 'mediflow-network-write-smoke-local-token';
const cap = 4194304;
const records = [];
const localHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const dataDir = process.env.MEDIFLOW_DATA_DIR;
assert.ok(dataDir, 'An explicit synthetic MEDIFLOW_DATA_DIR is required');
const report = path.join(dataDir, 'reports/checkup-local-bounded-json-report.json');
test.after(() => {
    fs.mkdirSync(path.dirname(report), { recursive: true });
    fs.writeFileSync(report, `${JSON.stringify({ cap, records }, null, 2)}\n`);
});
function snapshot() {
    const db = new Database(path.join(dataDir, 'medical.db'), { readonly: true });
    try {
        const value = Object.fromEntries(['checkups', 'patients', 'patients_to_ambulatories'].map(table =>
            [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
        value.audit = db.prepare("SELECT * FROM audit_events WHERE subject_type='checkup' ORDER BY rowid").all();
        return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
    } finally { db.close(); }
}
function notesBody(body, size) {
    const empty = JSON.stringify({ ...body, notes: 'ENC:' });
    const budget = size - Buffer.byteLength(empty);
    const notes = 'ENC:' + '🩺'.repeat(Math.floor(budget / 4)) + 'x'.repeat(budget % 4);
    const raw = JSON.stringify({ ...body, notes });
    assert.equal(Buffer.byteLength(raw), size);
    return raw;
}
async function send(method, url, headers, raw, chunked = false) {
    const body = chunked ? (async function* () {
        const bytes = Buffer.from(raw);
        for (let i = 0; i < bytes.length; i += 16381) yield bytes.subarray(i, i + 16381);
    })() : raw;
    const response = await fetch(`${base}${url}`, { method, headers, body, ...(chunked ? { duplex: 'half' } : {}) });
    const json = await response.json();
    return { response, json };
}

test('four local checkup POST/PUT paths enforce the new object/byte boundary over HTTP', async () => {
    const login = await loginWithWebAuthControl(base, { username: process.env.E2E_USERNAME || 'admin', password: process.env.E2E_PIN || '1234' });
    assert.equal(login.response.status, 200);
    const ambResponse = await fetch(`${base}/api/v1/ambulatories`, { headers: localHeaders });
    assert.equal(ambResponse.status, 200);
    const ambulatoryId = (await ambResponse.json())[0].id;
    for (const surface of ['web', 'v1']) {
        const patientId = crypto.randomUUID();
        const patient = await send('POST', '/api/v1/patients', localHeaders, JSON.stringify({ id: patientId,
            firstName: 'Synthetic', lastName: 'Envelope', taxCode: `SYN${patientId.replaceAll('-', '').slice(0, 13).toUpperCase()}`, ambulatoryId }));
        assert.equal(patient.response.status, 201);
        const headers = surface === 'web' ? { 'Content-Type': 'application/json', Cookie: login.cookieHeader } : localHeaders;
        const checkupId = crypto.randomUUID();
        const createBody = { id: checkupId, ...(surface === 'web' ? { patientId } : {}), date: '2026-05-02T09:00:00.000Z',
            title: 'Synthetic checkup', notes: 'ENC:synthetic:notes', status: 'pending', source: 'manual' };
        const collection = surface === 'web' ? '/api/checkups' : `/api/v1/patients/${patientId}/checkups`;
        const item = surface === 'web' ? `/api/checkups/${checkupId}` : `${collection}/${checkupId}`;
        for (const operation of ['POST', 'PUT']) {
            const url = operation === 'POST' ? collection : item;
            const body = operation === 'POST' ? createBody : { version: 1, title: 'Synthetic update', notes: 'ENC:synthetic:notes' };
            for (const [name, raw, expected, chunked] of [
                ['malformed', '{', 400, false], ['null', 'null', 400, false], ['array', '[]', 400, false],
                ['scalar', '42', 400, false], ['oversize-declared', notesBody(body, cap + 1), 413, false],
                ['oversize-chunked', notesBody(body, cap + 1), 413, true],
            ]) {
                const before = snapshot();
                const { response, json } = await send(operation, url, headers, raw, chunked);
                assert.equal(response.status, expected, `${surface} ${operation} ${name}`);
                assert.deepEqual(json, expected === 413 ? { error: 'JSON payload too large', code: 'JSON_BODY_TOO_LARGE' } : { error: 'Invalid JSON body' });
                assert.equal(snapshot(), before, 'No row/version/membership/audit effect on body denial');
                records.push({ surface, operation, name, status: response.status, unchanged: true });
            }
            const beforeUnauthorized = snapshot();
            const unauthorized = await send(operation, url, { 'Content-Type': 'application/json' }, notesBody(body, cap + 1));
            assert.equal(unauthorized.response.status, 401); assert.equal(snapshot(), beforeUnauthorized);
            // A real successful POST supplies the target for the subsequent PUT.
            const raw = notesBody(body, cap);
            const accepted = await send(operation, url, headers, raw, true);
            assert.equal(accepted.response.status, operation === 'POST' ? 201 : 200);
            if (operation === 'POST') assert.deepEqual(accepted.json, { id: checkupId, version: 1 });
            const detail = await fetch(`${base}/api/v1/patients/${patientId}/checkups/${checkupId}`, { headers: localHeaders });
            assert.equal(detail.status, 200);
            const row = await detail.json();
            assert.equal(row.notes, JSON.parse(raw).notes); assert.equal(row.version, operation === 'POST' ? 1 : 2);
            records.push({ surface, operation, name: 'inclusive-cap-multibyte-chunked', status: accepted.response.status });
            if (operation === 'PUT') {
                const before = snapshot();
                const missing = surface === 'web' ? '/api/checkups/synthetic-missing' : `${collection}/synthetic-missing`;
                assert.equal((await send('PUT', missing, headers, '{"version":1,"title":42}')).response.status, 404);
                assert.equal((await send('PUT', item, headers, '{"version":1,"title":"stale"}')).response.status, 409);
                assert.equal(snapshot(), before);
            }
        }
    }
});
