import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import path from 'node:path';
import test from 'node:test';
import { loginWithWebAuthControl } from './web-auth-control-test-client.mjs';

const base = process.env.E2E_BASE_URL || 'http://127.0.0.1:3400';
const local = { Authorization: `Bearer ${process.env.MEDIFLOW_LOCAL_API_TOKEN}` };
const dataDir = process.env.MEDIFLOW_DATA_DIR;
assert.ok(dataDir, 'Dedicated synthetic archive required');
const db = new Database(path.join(dataDir, 'medical.db'));
test.after(() => db.close());
async function call(method, route, body, headers = local) {
    const response = await fetch(base + route, { method, headers: { ...headers, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null, response };
}
const date = '2026-10-31T10:00:00.000Z';
const sealed = 'ENC:c3ludGhldGlj:bm90ZQ==';
const cases = [
    ['attachments', 'documents', { name: sealed, path: sealed, data: sealed, type: 'text/plain', size: 4 }],
    ['checkups', 'checkups', { date, title: 'Synthetic control', status: 'pending', source: 'manual' }],
    ['therapies', 'therapies', { drugName: sealed, dosage: sealed, status: 'active', startDate: date }],
    ['observations', 'observations', { codeSystem: 'LOINC', code: '8480-6', display: 'Synthetic pressure', unitSystem: 'UCUM', unitCode: 'mm[Hg]', value: 128, observedAt: date, source: 'manual' }],
    ['service-prescriptions', 'service-prescriptions', { prescribedAt: date, serviceName: 'Synthetic service', source: 'manual' }],
    ['prosthetic-prescriptions', 'prosthetic-prescriptions', { prescribedAt: date, description: 'Synthetic device', category: 'standard', status: 'submitted', source: 'manual' }],
];

test('revocation during a slow HTTP body leaves clinical rows and success audit unchanged', async t => {
    const ambulatories = await call('GET', '/api/v1/ambulatories');
    assert.equal(ambulatories.status, 200);
    const ambulatoryId = ambulatories.body.find(row => row.isDefault).id;
    assert.equal((await call('PUT', '/api/settings/network.mode', { value: 'network-home-base' })).status, 200);
    const login = await loginWithWebAuthControl(base, { username: 'admin', password: '1234' });
    assert.equal(login.response.status, 200);
    for (const [resource, capability, payload] of cases) await t.test(resource, async () => {
        const patientId = randomUUID();
        assert.equal((await call('POST', '/api/v1/patients', { id: patientId, firstName: 'Synthetic', lastName: 'Revocation', taxCode: patientId, ambulatoryId })).status, 201);
        const intent = await call('POST', '/api/v1/network/pairing-intents', { deviceName: 'Synthetic revocation', clientPlatform: 'ipados', appVersion: 'test', requestedCapabilities: [`network.replica.write-${capability}`, 'network.replica.readonly-patients'] });
        assert.equal(intent.status, 201);
        const pairing = await call('POST', `/api/v1/network/pairing-intents/${intent.body.intentId}/confirm`);
        assert.equal(pairing.status, 201);
        const clientId = pairing.body.pairedClient.clientId;
        const headers = { Origin: base, 'Sec-Fetch-Site': 'same-origin', ...login.webHeaders, 'x-mediflow-paired-client-id': clientId, 'x-mediflow-paired-client-token': pairing.body.pairedClientToken };
        const route = ['service-prescriptions', 'prosthetic-prescriptions'].includes(resource)
            ? `/api/v1/network/${resource}?patientId=${patientId}` : `/api/v1/network/patients/${patientId}/${resource}`;
        const body = { ...payload, ...(['service-prescriptions', 'prosthetic-prescriptions'].includes(resource) ? { patientId } : {}) };
        // A successful control warms the route and proves the exact payload and authority work.
        const control = await call('POST', route, body, headers);
        assert.equal(control.status, 201, JSON.stringify(control.body));
        const tables = [resource.replaceAll('-', '_'), 'audit_events'];
        const snapshot = () => tables.map(table => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
        const before = snapshot();
        const wire = JSON.stringify(body);
        let request;
        const pending = new Promise((resolve, reject) => {
            request = http.request(new URL(route, base), { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(wire) } }, response => {
                let text = ''; response.on('data', chunk => text += chunk); response.on('end', () => resolve({ status: response.statusCode, text }));
            });
            request.on('error', reject); request.write(wire.slice(0, -1));
        });
        await new Promise(resolve => setTimeout(resolve, 1000));
        assert.equal((await call('DELETE', `/api/v1/network/pairing-clients/${clientId}`)).status, 200);
        request.end(wire.slice(-1));
        const result = await pending;
        assert.equal(result.status, 401, result.text);
        assert.deepEqual(snapshot(), before, 'Denied request must leave no clinical row or success audit');
    });
});
