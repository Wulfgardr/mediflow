import { expect, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { isAbsolute, join } from 'node:path';
import { bootstrapUnlockedSession } from './utils';
import { trustedArchiveWebRequestHeaders } from './fixtures/trusted-web-request';

test('HTTP ripristina un backup oltre 35 MiB con allegati paziente e conserva i controlli di accesso', async ({ page, request, baseURL }) => {
    test.skip(process.env.MF085_SYNTHETIC_E2E !== '1', 'Richiede un server sintetico isolato.');
    test.setTimeout(120_000);
    const dir = process.env.MEDIFLOW_DATA_DIR, url = new URL(baseURL!);
    if (!dir || !isAbsolute(dir) || url.hostname !== '127.0.0.1' || !url.port || url.port === '3000') throw new Error('Dedicated synthetic data and loopback port required');
    await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
    const headers = await trustedArchiveWebRequestHeaders(page);
    const patientId = randomUUID(), attachmentId = randomUUID();
    const data = `data:application/octet-stream;base64,${Buffer.alloc(28 * 1024 * 1024, 7).toString('base64')}`;
    const digest = createHash('sha256').update(data).digest('hex');
    const db = new Database(join(dir, 'medical.db'), { fileMustExist: true });
    try {
        db.transaction(() => {
            db.prepare('INSERT INTO patients(id,first_name,last_name,tax_code) VALUES (?,?,?,?)')
                .run(patientId, 'Persona', 'Sintetica', patientId);
            db.prepare(`INSERT INTO attachments(id,patient_id,name,type,size,path,data,document_source_ref,document_revision,document_freshness_epoch)
                VALUES (?,?,?,?,?,?,?,?,1,1)`).run(attachmentId, patientId, 'sintetico.bin', 'application/octet-stream', 28 * 1024 * 1024,
                `attachments/${attachmentId}.bin`, data, digest);
        })();
        const exported = await page.request.get('/api/system/backup-restore'); expect(exported.status()).toBe(200);
        const artifact = await exported.body(); expect(artifact.length).toBeGreaterThan(35 * 1024 * 1024);
        const verified = await page.request.post('/api/system/backup-restore/verify', { headers: { ...headers, 'Content-Type': 'application/json' }, data: artifact });
        expect(verified.status(), await verified.text()).toBe(200);
        expect((await verified.json()).success).toBe(true);
        const before = db.prepare('SELECT * FROM attachments WHERE id=?').get(attachmentId);
        const anonymous = await request.post('/api/system/backup-restore', { data: {}, headers }); expect(anonymous.status()).toBe(401);
        for (const [transport, expectedStatus] of [
            [{ ...headers, Origin: 'http://example.invalid' }, 403],
            [{ ...headers, 'Sec-Fetch-Site': 'cross-site' }, 403],
            [{ ...headers, 'Content-Type': 'text/plain' }, 403],
            [{ ...headers, 'x-mediflow-archive-generation': 'stale' }, 409],
        ] as const) {
            const denied = await page.request.post('/api/system/backup-restore', { data: {}, headers: transport });
            expect(denied.status()).toBe(expectedStatus);
            expect(db.prepare('SELECT * FROM attachments WHERE id=?').get(attachmentId)).toEqual(before);
        }
        db.prepare('DELETE FROM attachments WHERE id=?').run(attachmentId);
        const restored = await page.request.post('/api/system/backup-restore', { headers: { ...headers, 'Content-Type': 'application/json' }, data: artifact });
        expect(restored.status(), await restored.text()).toBe(200);
        expect((await restored.json()).success).toBe(true);
        expect(db.prepare('SELECT * FROM attachments WHERE id=?').get(attachmentId)).toEqual(before);
    } finally { db.close(); }
});
