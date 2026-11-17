import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'mediflow-v1-sealed-synthetic-'));
process.env.MEDIFLOW_DATA_DIR = dir;
process.env.MEDIFLOW_LOCAL_API_TOKEN = 'synthetic-sealed-token';
const load = createRequire(import.meta.url);
const { dbServer, openDbServer } = load('./db-server.ts') as typeof import('./db-server');
openDbServer();
const sealed = 'ENC:c3ludGhldGlj:c3ludGhldGlj';
const families = [
    { path: '', table: 'patients', item: '[id]', field: 'notes', body: { firstName: 'Persona', lastName: 'Sintetica', taxCode: '', identifierType: 'none', birthYear: 1980 } },
    { path: '/entries', table: 'entries', item: '[entryId]', field: 'content', body: { type: 'note', title: sealed, content: sealed, date: '2026-01-01' } },
    { path: '/therapies', table: 'therapies', item: '[therapyId]', field: 'motivation', body: { drugName: 'Farmaco sintetico', dosage: '1', status: 'active', startDate: '2026-01-01' } },
    { path: '/observations', table: 'observations', item: '[observationId]', field: 'notes', body: { codeSystem: 'LOINC', code: '2345-7', unitSystem: 'UCUM', display: 'Sintetico', value: '1', unitCode: 'mg', observedAt: '2026-01-01' } },
    { path: '/checkups', table: 'checkups', item: '[checkupId]', field: 'notes', body: { title: 'Sintetico', date: '2026-01-01', status: 'pending' } },
];
let serial = 0;
function request(method: string, body: unknown) {
    return new Request('http://127.0.0.1/api/v1/patients', { method, headers: {
        authorization: 'Bearer synthetic-sealed-token', 'content-type': 'application/json',
    }, body: JSON.stringify(body) });
}
function snapshot() {
    return JSON.stringify(['patients', 'entries', 'therapies', 'observations', 'checkups', 'audit_events'].map(table =>
        dbServer.$client.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()));
}
for (const family of families) {
    const base = family.path ? `../app/api/v1/patients/[id]${family.path}` : '../app/api/v1/patients';
    const collection = load(`${base}/route.ts`);
    const item = load(`${base}/${family.item}/route.ts`);
    for (const method of ['POST', 'PUT', 'DELETE'] as const) {
        test(`${family.table} ${method} rejects plaintext without data or success audit`, async () => {
            const id = `synthetic-sealed-${++serial}`;
            dbServer.$client.prepare('INSERT INTO patients (id,first_name,last_name,tax_code,identifier_type) VALUES (?,?,?,?,?)')
                .run(id, 'Persona', 'Sintetica', '', 'none');
            let itemId = id;
            if (method !== 'POST' && family.path) {
                itemId = `${id}-item`;
                const created = await collection.POST(request('POST', { ...family.body, id: itemId, [family.field]: sealed }), { params: Promise.resolve({ id }) });
                assert.equal(created.status, 201, await created.text());
            }
            const params = Promise.resolve({ id, [family.item.slice(1, -1)]: itemId });
            const body = method === 'POST' ? { ...family.body, [family.field]: 'Solo testo sintetico' }
                : method === 'PUT' ? { version: 1, [family.field]: 'Solo testo sintetico' }
                    : { version: 1, deletionReason: 'Solo testo sintetico' };
            const before = snapshot();
            const response = await (method === 'POST' ? collection : item)[method](request(method, body), { params });
            if (method === 'POST' && family.table === 'entries' && response.status === 201) {
                const row = dbServer.$client.prepare('SELECT content FROM entries WHERE patient_id=?').get(id) as { content: string };
                assert.equal(row.content, 'Solo testo sintetico');
            }
            assert.equal(response.status, 422, await response.text());
            assert.equal(snapshot(), before);
            const accepted = { ...body, [method === 'DELETE' ? 'deletionReason' : family.field]: sealed };
            const success = await (method === 'POST' ? collection : item)[method](request(method, accepted), { params });
            assert.equal(success.status, method === 'POST' ? 201 : 200, await success.text());
        });
    }
    test(`${family.table} DELETE accepts the server default and rejects plaintext without effects`, async () => {
        const id = `synthetic-sealed-${++serial}`;
        dbServer.$client.prepare('INSERT INTO patients (id,first_name,last_name,tax_code,identifier_type) VALUES (?,?,?,?,?)')
            .run(id, 'Persona', 'Sintetica', '', 'none');
        const itemId = family.path ? `${id}-item` : id;
        if (family.path) {
            const created = await collection.POST(request('POST', { ...family.body, id: itemId, [family.field]: sealed }), { params: Promise.resolve({ id }) });
            assert.equal(created.status, 201, await created.text());
        }
        const params = Promise.resolve({ id, [family.item.slice(1, -1)]: itemId });
        const before = snapshot();
        const rejected = await item.DELETE(request('DELETE', { version: 1, deletionReason: 'Solo testo sintetico' }), { params });
        assert.equal(rejected.status, 422, await rejected.text());
        assert.equal(snapshot(), before);
        const accepted = await item.DELETE(request('DELETE', { version: 1 }), { params });
        assert.equal(accepted.status, 200, await accepted.text());
        const row = dbServer.$client.prepare(`SELECT deletion_reason, version FROM ${family.table} WHERE id=?`).get(itemId) as { deletion_reason: string; version: number };
        assert.equal(row.deletion_reason, 'api-v1-delete');
        assert.equal(row.version, 2);
    });
    test(`${family.table} POST accepts sealed input`, async () => {
        const id = `synthetic-sealed-${++serial}`;
        dbServer.$client.prepare('INSERT INTO patients (id,first_name,last_name,tax_code,identifier_type) VALUES (?,?,?,?,?)')
            .run(id, 'Persona', 'Sintetica', '', 'none');
        const response = await collection.POST(request('POST', { ...family.body, [family.field]: sealed }), { params: Promise.resolve({ id }) });
        assert.equal(response.status, 201, await response.text());
    });
}
test.after(() => { dbServer.$client.close(); rmSync(dir, { recursive: true, force: true }); });

test('every encrypted field rejects malformed envelopes and structured plaintext', () => {
    const { rejectUnsealedV1Write } = load('./api/v1/sealed-write.ts') as typeof import('./api/v1/sealed-write');
    const fields = load('./backup-encrypted-fields.json');
    for (const family of families) {
        for (const field of fields[family.table]) {
            for (const value of ['', 'ENC:', 'ENC:bad', 'ENC:a:b:extra', [], {}, 1]) {
                assert.equal(rejectUnsealedV1Write(family.table as 'patients', { [field]: value })?.status, 422);
            }
            assert.equal(rejectUnsealedV1Write(family.table as 'patients', { [field]: sealed }), null);
            assert.equal(rejectUnsealedV1Write(family.table as 'patients', { [field]: null }), null);
        }
    }
});

test('local diary creation requires a client-sealed title instead of a plaintext server default', async () => {
    const collection = load('../app/api/v1/patients/[id]/entries/route.ts');
    const before = snapshot();
    const response = await collection.POST(request('POST', { type: 'note', content: sealed, date: '2026-01-01' }),
        { params: Promise.resolve({ id: 'synthetic-missing-title' }) });
    assert.equal(response.status, 422);
    assert.equal(snapshot(), before);
});
