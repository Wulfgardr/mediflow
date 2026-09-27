/* @Codex: real settings recovery and currentness with isolated synthetic SQLite. */
import { expect, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { isAbsolute, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { bootstrapUnlockedSession } from './utils';

test('ambulatory clear rolls back audit failure, preserves live patients and reloads the accepted version', async ({ page, baseURL }, testInfo) => {
    test.skip(process.env.MF085_SYNTHETIC_E2E !== '1', 'Requires an isolated synthetic server.');
    const dir = process.env.MEDIFLOW_DATA_DIR;
    const url = new URL(baseURL!);
    const token = process.env.MEDIFLOW_LOCAL_API_TOKEN;
    if (!dir || !isAbsolute(dir) || !token || url.hostname !== '127.0.0.1' || !url.port || url.port === '3000') {
        throw new Error('Dedicated synthetic data, local authorization and loopback port required');
    }
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
    const name = `Ambulatorio di prova ${Date.now()}`;
    const created = await page.request.post('/api/ambulatories', { data: { name, type: 'test' } });
    expect(created.status()).toBe(201);
    const { id } = await created.json() as { id: string };
    const list = await page.request.get('/api/ambulatories');
    expect(list.status()).toBe(200);
    const live = (await list.json() as Array<{ id: string; type: string }>).find(item => item.type === 'live');
    expect(live).toBeTruthy();
    const headers = { Authorization: `Bearer ${token}` };
    const patientIds: string[] = [];
    for (const lastName of ['SoloProva', 'Condiviso']) {
        const patientId = randomUUID();
        const response = await page.request.post('/api/v1/patients', { headers, data: {
            id: patientId, firstName: 'Sintetico', lastName,
            taxCode: `AMB${patientId.replaceAll('-', '').slice(0, 13).toUpperCase()}`,
            ambulatoryId: id, isAdi: false,
        } });
        expect(response.status()).toBe(201);
        patientIds.push(patientId);
    }
    const sql = new Database(join(dir, 'medical.db'), { fileMustExist: true });
    try {
        sql.prepare('INSERT INTO patients_to_ambulatories (patient_id, ambulatory_id) VALUES (?, ?)').run(patientIds[1], live!.id);
        const read = () => ({
            ambulatory: sql.prepare('SELECT * FROM ambulatories WHERE id=?').get(id) as Record<string, unknown>,
            patients: sql.prepare('SELECT * FROM patients WHERE id IN (?, ?) ORDER BY id').all(...patientIds) as Array<Record<string, unknown>>,
            memberships: sql.prepare('SELECT * FROM patients_to_ambulatories WHERE patient_id IN (?, ?) ORDER BY patient_id, ambulatory_id').all(...patientIds) as Array<Record<string, unknown>>,
            events: sql.prepare('SELECT event_type, subject_ref, actor_ref, source_surface, redacted_metadata FROM audit_events WHERE subject_ref IN (?, ?, ?) ORDER BY rowid').all(id, ...patientIds) as Array<Record<string, unknown>>,
        });
        const before = read();
        await page.goto('/settings/ambulatories');
        const row = page.getByRole('treeitem').filter({ has: page.getByRole('heading', { name: new RegExp(name) }) });
        const actions: Array<{ submittedVersion: number; status: number }> = [];
        const clear = async () => {
            await row.getByRole('button', { name: 'Svuota ambiente di test', exact: true }).click();
            const dialog = page.getByRole('dialog');
            await expect(dialog).toContainText('saranno spostati nel Cestino');
            await expect(dialog).toContainText('sedi operative resteranno disponibili');
            if (!actions.length) await page.screenshot({ path: testInfo.outputPath('clear-confirmation.png') });
            const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/ambulatories/clear' && r.request().method() === 'POST');
            await dialog.getByRole('button', { name: 'Svuota', exact: true }).click();
            const result = await response;
            actions.push({ submittedVersion: result.request().postDataJSON().version as number, status: result.status() });
            await expect(dialog).toHaveCount(0);
            await expect(row.getByRole('button', { name: 'Svuota ambiente di test', exact: true })).toBeEnabled();
            return result.status();
        };
        sql.exec("CREATE TRIGGER synthetic_ambulatory_ui_audit BEFORE INSERT ON audit_events WHEN NEW.event_type='patient.deleted' BEGIN SELECT RAISE(IGNORE); END");
        expect(await clear()).toBe(500);
        expect(read()).toEqual(before);
        await expect(page.getByText('Errore durante lo svuotamento', { exact: true })).toBeVisible();
        sql.exec('DROP TRIGGER synthetic_ambulatory_ui_audit');
        // @Codex: the genuine accepted POST must remain current if its list reread fails.
        let failedReads = 0;
        await page.route('**/api/ambulatories', async route => {
            if (route.request().method() === 'GET') {
                failedReads++;
                await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic read failure' }) });
            } else await route.continue();
        });
        expect(await clear()).toBe(200);
        expect(failedReads).toBe(1);
        await page.unroute('**/api/ambulatories');
        expect(await clear()).toBe(200);
        expect(actions).toEqual([{ submittedVersion: 1, status: 500 }, { submittedVersion: 1, status: 200 }, { submittedVersion: 2, status: 200 }]);
        const after = read();
        expect(after.ambulatory.version).toBe(3);
        const onlyTest = after.patients.find(patient => patient.id === patientIds[0])!;
        const shared = after.patients.find(patient => patient.id === patientIds[1])!;
        expect(onlyTest.deleted_at).not.toBeNull(); expect(onlyTest.version).toBe(2);
        expect(shared.deleted_at).toBeNull(); expect(shared.version).toBe(1);
        expect(after.memberships).toEqual(before.memberships.filter(membership => membership.ambulatory_id === live!.id));
        const addedEvents = after.events.slice(before.events.length);
        expect(addedEvents.map(event => event.event_type).sort()).toEqual(['ambulatory.cleared', 'ambulatory.cleared', 'patient.deleted']);
        expect(addedEvents.every(event => event.source_surface === 'web')).toBe(true);
        expect(addedEvents.filter(event => event.subject_ref === id).map(event => JSON.parse(String(event.redacted_metadata)).resourceVersion)).toEqual([2, 3]);
        const readback = await page.request.get('/api/ambulatories');
        expect(readback.status()).toBe(200);
        expect((await readback.json() as Array<{ id: string; version: number }>).find(item => item.id === id)?.version).toBe(3);
        expect((await page.request.get(`/api/v1/patients/${patientIds[0]}`, { headers })).status()).toBe(404);
        expect((await page.request.get(`/api/v1/patients/${patientIds[1]}`, { headers })).status()).toBe(200);
        expect(pageErrors).toEqual([]);
        await page.screenshot({ path: testInfo.outputPath('clear-completed.png') });
        await testInfo.attach('clear-readback.json', { contentType: 'application/json', body: JSON.stringify({ actions, after }) });
    } finally { sql.exec('DROP TRIGGER IF EXISTS synthetic_ambulatory_ui_audit'); sql.close(); }
});
