import { generateMasterKey, wrapMasterKeyVersioned } from '../lib/security/security';
import { test, expect } from './fixtures/isolated-runtime';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

test.describe.configure({ retries: 0 });
test('GPUI local authority restores with confirmation, atomic snapshot and durable receipt after new login', async ({ request, isolatedRuntime, baseURL }) => {
    test.setTimeout(120_000);
    const base = new URL(baseURL!);
    if (base.port === '3000' || base.hostname !== '127.0.0.1') throw new Error('Isolated loopback outside port 3000 required');
    const data = isolatedRuntime.dataDirectory;
    function syntheticDatabase() {
        const real = fs.realpathSync(data);
        if (!real.startsWith(fs.realpathSync(os.tmpdir()) + path.sep) || path.basename(real) !== 'data'
            || !path.basename(path.dirname(real)).startsWith('mediflow-e2e-isolated-')) throw new Error('Owned temporary synthetic archive required');
        return new Database(path.join(real, 'medical.db'), { fileMustExist: true });
    }
    syntheticDatabase().close();
    const transport = { Origin: base.origin, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' };
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const encryptedMasterKey = await wrapMasterKeyVersioned(await generateMasterKey(), '1234', salt);
    const control = await request.get('/api/auth/check');
    const setup = await request.post('/api/auth/setup', { headers: { ...transport, 'If-Match': control.headers().etag, 'Idempotency-Key': randomUUID() }, data: {
        username: 'admin', password: '1234', displayName: 'Medico Sintetico GPUI', ambulatoryName: 'Studio Sintetico GPUI', encryptedMasterKey, salt: Buffer.from(salt).toString('base64'),
    } });
    expect(setup.status(), await setup.text()).toBe(200);
    const setupSession = await request.get('/api/auth/check');
    const retiredSetup = await request.post('/api/auth/local-client/logout', { headers: { ...transport, 'If-Match': setupSession.headers().etag, 'Idempotency-Key': randomUUID() }, data: {} });
    expect(retiredSetup.status()).toBe(204);
    const login = async () => {
        const checked = await request.get('/api/auth/check');
        const response = await request.post('/api/auth/local-client/login', { headers: { ...transport, 'If-Match': checked.headers().etag, 'Idempotency-Key': randomUUID() }, data: { username: process.env.E2E_USERNAME || 'admin', password: process.env.E2E_PIN || '1234' } });
        expect(response.status(), await response.text()).toBe(200);
        return { ...transport, 'x-mediflow-archive-generation': (await response.json()).archiveGeneration };
    };
    const restore = (headers: Record<string, string>, backup: unknown) => {
        syntheticDatabase().close();
        return request.post('/api/system/backup-restore', { headers: { ...headers, 'x-mediflow-restore-credential': JSON.stringify({ pin: process.env.E2E_PIN || '1234' }) }, data: backup });
    };
    let headers = await login();
    const forge = async (key: string, value: string, auth: Record<string, string>) => {
        syntheticDatabase().close();
        expect((await request.put('/api/settings/' + key, { headers: auth, data: { value } })).status()).toBe(403);
        syntheticDatabase().close();
        expect((await request.post('/api/settings', { headers: auth, data: { key, value } })).status()).toBe(403);
        expect((await request.get('/api/settings/' + key, { headers: auth })).status()).toBe(403);
    };
    const nonexistent = randomUUID();
    await forge('archive.restore.receipt.' + nonexistent, '{}', headers);
    expect((await request.get('/api/system/backup-restore/receipts/' + nonexistent, { headers })).status()).toBe(404);

    const created = await request.post('/api/patients', { headers, data: { firstName: 'Persona', lastName: 'Sintetica recupero GPUI', taxCode: 'SYN-' + randomUUID() } });
    expect(created.status(), await created.text()).toBe(201);
    const patient = (await created.json()).id;
    const backup = await (await request.get('/api/system/backup-restore')).json();
    const verified = await request.post('/api/system/backup-restore/verify', { headers: { ...headers, 'x-mediflow-restore-credential': JSON.stringify({ pin: process.env.E2E_PIN || '1234' }) }, data: backup });
    expect(verified.status(), await verified.text()).toBe(200);
    const preview = await verified.json();
    const id = randomUUID();
    let intent = { ...headers, 'x-mediflow-restore-id': id, 'x-mediflow-restore-snapshot': preview.expectedSnapshot, 'x-mediflow-restore-confirmation': 'RIPRISTINA' };
    const db = syntheticDatabase();
    const before = db.prepare('SELECT * FROM patients ORDER BY id').all();
    const keys = db.prepare('SELECT * FROM users ORDER BY id').all();
    const history = db.prepare('SELECT * FROM audit_events ORDER BY event_id').all();
    try {
        // Cancel means no mutation request; both data and receipt are checked independently.
        expect((await request.get(`/api/system/backup-restore/receipts/${id}`)).status()).toBe(404);
        expect(db.prepare('SELECT * FROM patients ORDER BY id').all()).toEqual(before);
        for (const missing of ['x-mediflow-restore-confirmation', 'x-mediflow-restore-snapshot', 'x-mediflow-restore-id']) {
            const invalid = { ...intent }; delete invalid[missing as keyof typeof intent];
            const denied = await restore(invalid, backup);
            expect(denied.status(), await denied.text()).toBe(400);
            expect(db.prepare('SELECT * FROM patients ORDER BY id').all()).toEqual(before);
        }
        syntheticDatabase().close();
        db.prepare('UPDATE patients SET version=version+1 WHERE id=?').run(patient);
        const conflict = await restore(intent, backup);
        expect(conflict.status(), await conflict.text()).toBe(409);
        expect((await conflict.json()).reason).toBe('snapshot');
        expect((await request.get(`/api/system/backup-restore/receipts/${id}`)).status()).toBe(404);
        const fresh = await (await request.post('/api/system/backup-restore/verify', { headers: { ...headers, 'x-mediflow-restore-credential': JSON.stringify({ pin: process.env.E2E_PIN || '1234' }) }, data: backup })).json();
        intent = { ...intent, 'x-mediflow-restore-snapshot': fresh.expectedSnapshot };
        const restored = await restore(intent, backup);
        expect(restored.status(), await restored.text()).toBe(200);
        expect((await restored.json()).receipt.id).toBe(id);
        const stale = await restore(intent, backup);
        expect([401, 409]).toContain(stale.status());
        expect((await request.get(`/api/system/backup-restore/receipts/${id}`)).status()).toBe(401);
        headers = await login();
        const replaced = await restore({ ...headers, 'x-mediflow-archive-generation': intent['x-mediflow-archive-generation'] }, backup);
        expect(replaced.status()).toBe(409); expect((await replaced.json()).code).toBe('ARCHIVE_REPLACED');
        const receipt = await request.get(`/api/system/backup-restore/receipts/${id}`, { headers });
        expect(receipt.status()).toBe(200);
        expect(await receipt.json()).toMatchObject({ id, sourceChecksum: backup.manifest.checksum, archiveGeneration: headers['x-mediflow-archive-generation'] });
        const persisted = await receipt.json();
        await forge('archive.restore.receipt.' + id, '{}', headers);
        expect(await (await request.get(`/api/system/backup-restore/receipts/${id}`, { headers })).json()).toEqual(persisted);
        expect(db.prepare('SELECT * FROM patients ORDER BY id').all()).toEqual(before);
        expect(db.prepare('SELECT * FROM users ORDER BY id').all()).toEqual(keys);
        const finalHistory = db.prepare('SELECT * FROM audit_events ORDER BY event_id').all();
        for (const event of history) expect(finalHistory).toContainEqual(event);
        expect(finalHistory.length).toBeGreaterThan(history.length);
    } finally { db.close(); }
});
