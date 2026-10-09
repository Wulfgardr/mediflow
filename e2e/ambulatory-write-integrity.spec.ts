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
    if (!dir || !isAbsolute(dir) || url.hostname !== '127.0.0.1' || !url.port || url.port === '3000') {
        throw new Error('Dedicated synthetic data and loopback port required');
    }
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
    const originalList = await page.request.get('/api/ambulatories');
    expect(originalList.status()).toBe(200);
    const originalRoster = (await originalList.json() as Array<{ id: string }>).map(item => item.id).sort();
    const name = `Ambulatorio di prova ${Date.now()}`;
    const created = await page.request.post('/api/ambulatories', { data: { name, type: 'test' } });
    expect(created.status()).toBe(201);
    const { id } = await created.json() as { id: string };
    type OriginalPatientDestination = {
        ambulatoryId: string | null;
        memberships: Array<{ patient_id: string; ambulatory_id: string; assigned_at: number | null }>;
    };
    const patientIds: string[] = [];
    const originalDestinations = new Map<string, OriginalPatientDestination>();
    let cleanupConnection: InstanceType<typeof Database> | undefined;
    let primaryError: unknown;
    try {
        const sql = new Database(join(dir, 'medical.db'), { fileMustExist: true });
        cleanupConnection = sql;
        const list = await page.request.get('/api/ambulatories');
        expect(list.status()).toBe(200);
        const live = (await list.json() as Array<{ id: string; type: string }>).find(item => item.type === 'live');
        expect(live).toBeTruthy();
        for (const lastName of ['SoloProva', 'Condiviso']) {
            const patientId = randomUUID();
            patientIds.push(patientId);
            // @Codex: create through the authenticated Web route; its destination is
            // the active/default ambulatory, then scope these synthetic IDs below.
            const response = await page.request.post('/api/patients', { data: {
                id: patientId, firstName: 'Sintetico', lastName,
                taxCode: `AMB${patientId.replaceAll('-', '').slice(0, 13).toUpperCase()}`,
                isAdi: false,
            } });
            const originalPatient = sql.prepare('SELECT ambulatory_id FROM patients WHERE id=?')
                .get(patientId) as { ambulatory_id: string | null } | undefined;
            if (originalPatient) originalDestinations.set(patientId, {
                ambulatoryId: originalPatient.ambulatory_id,
                memberships: sql.prepare('SELECT * FROM patients_to_ambulatories WHERE patient_id=? ORDER BY ambulatory_id')
                    .all(patientId) as OriginalPatientDestination['memberships'],
            });
            expect(response.status()).toBe(201);
            expect((await response.json() as { id: string }).id).toBe(patientId);
            expect((await page.request.get(`/api/patients/${patientId}`)).status()).toBe(200);
        }
        // @Codex: fixture-only alignment; the Web legacy route selected the
        // default/active destination. Keep versions at their create value.
        sql.transaction(() => {
            for (const patientId of patientIds) {
                sql.prepare('DELETE FROM patients_to_ambulatories WHERE patient_id=?').run(patientId);
                sql.prepare('INSERT INTO patients_to_ambulatories (patient_id, ambulatory_id) VALUES (?, ?)').run(patientId, id);
                expect(sql.prepare('UPDATE patients SET ambulatory_id=? WHERE id=?').run(id, patientId).changes).toBe(1);
            }
            sql.prepare('INSERT INTO patients_to_ambulatories (patient_id, ambulatory_id) VALUES (?, ?)').run(patientIds[1], live!.id);
        })();
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
        expect(shared.deleted_at).toBeNull(); expect(shared.version).toBe(2);
        expect(shared.ambulatory_id).toBe(before.patients.find(patient => patient.id === shared.id)!.ambulatory_id);
        expect(after.memberships).toEqual(before.memberships.filter(membership => membership.ambulatory_id === live!.id));
        const addedEvents = after.events.slice(before.events.length);
        expect(addedEvents.map(event => event.event_type).sort()).toEqual(['ambulatory.cleared', 'ambulatory.cleared', 'patient.deleted', 'patient.updated']);
        const unlinkedEvents = addedEvents.filter(event => event.event_type === 'patient.updated');
        expect(unlinkedEvents).toHaveLength(1);
        expect(unlinkedEvents[0].subject_ref).toBe(shared.id);
        expect(JSON.parse(String(unlinkedEvents[0].redacted_metadata))).toEqual({
            changedFields: ['ambulatoryMemberships'], resourceVersion: 2,
            flags: ['membership:unassigned', 'auth:session'],
        });
        expect(addedEvents.every(event => event.source_surface === 'web')).toBe(true);
        expect(addedEvents.filter(event => event.subject_ref === id).map(event => JSON.parse(String(event.redacted_metadata)).resourceVersion)).toEqual([2, 3]);
        const readback = await page.request.get('/api/ambulatories');
        expect(readback.status()).toBe(200);
        expect((await readback.json() as Array<{ id: string; version: number }>).find(item => item.id === id)?.version).toBe(3);
        expect((await page.request.get(`/api/patients/${patientIds[0]}`)).status()).toBe(404);
        expect((await page.request.get(`/api/patients/${patientIds[1]}`)).status()).toBe(200);
        expect(pageErrors).toEqual([]);
        await page.screenshot({ path: testInfo.outputPath('clear-completed.png') });
        await testInfo.attach('clear-readback.json', { contentType: 'application/json', body: JSON.stringify({ actions, after }) });
    } catch (error) {
        primaryError = error;
        throw error;
    } finally {
        try {
            // Restore only this test's two synthetic patients, including
            // original membership timestamps. Keep their tested versions and audit.
            const cleanupSql = cleanupConnection ?? new Database(join(dir, 'medical.db'), { fileMustExist: true });
            try {
                cleanupSql.exec('DROP TRIGGER IF EXISTS synthetic_ambulatory_ui_audit');
                cleanupSql.transaction(() => {
                    for (const patientId of patientIds) {
                        const current = cleanupSql.prepare('SELECT id FROM patients WHERE id=?').get(patientId);
                        if (!current) continue;
                        const original = originalDestinations.get(patientId);
                        if (!original) throw new Error(`Missing original destination for synthetic patient ${patientId}`);
                        cleanupSql.prepare('DELETE FROM patients_to_ambulatories WHERE patient_id=?').run(patientId);
                        for (const membership of original.memberships) {
                            cleanupSql.prepare('INSERT INTO patients_to_ambulatories (patient_id, ambulatory_id, assigned_at) VALUES (?, ?, ?)')
                                .run(membership.patient_id, membership.ambulatory_id, membership.assigned_at);
                        }
                        expect(cleanupSql.prepare('UPDATE patients SET ambulatory_id=? WHERE id=?')
                            .run(original.ambulatoryId, patientId).changes).toBe(1);
                        expect(cleanupSql.prepare('SELECT * FROM patients_to_ambulatories WHERE patient_id=? ORDER BY ambulatory_id')
                            .all(patientId)).toEqual(original.memberships);
                    }
                    expect(cleanupSql.prepare('SELECT COUNT(*) AS count FROM patients_to_ambulatories WHERE ambulatory_id=?')
                        .get(id)).toEqual({ count: 0 });
                })();
            } finally {
                cleanupSql.close();
            }
            const currentList = await page.request.get('/api/ambulatories');
            expect(currentList.status()).toBe(200);
            const currentAmbulatory = (await currentList.json() as Array<{ id: string; version: number }>).find(item => item.id === id);
            expect(currentAmbulatory).toBeTruthy();
            const deleted = await page.request.delete(`/api/ambulatories/${id}`, { data: { version: currentAmbulatory!.version } });
            expect(deleted.status()).toBe(200);
            const finalList = await page.request.get('/api/ambulatories');
            expect(finalList.status()).toBe(200);
            const finalRoster = (await finalList.json() as Array<{ id: string }>).map(item => item.id).sort();
            expect(finalRoster).toEqual(originalRoster);
            await testInfo.attach('ambulatory-fixture-cleanup.json', {
                contentType: 'application/json',
                body: JSON.stringify({ removedAmbulatoryId: id, restoredPatientIds: patientIds, originalRoster, finalRoster }),
            });
        } catch (cleanupError) {
            try {
                await testInfo.attach('ambulatory-fixture-cleanup-error.txt', {
                    contentType: 'text/plain', body: String(cleanupError),
                });
            } catch {
                console.error('Ambulatory fixture cleanup failed:', cleanupError);
            }
            if (!primaryError) throw cleanupError;
        }
    }
});
