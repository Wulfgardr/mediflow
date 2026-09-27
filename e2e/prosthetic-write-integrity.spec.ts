/* @Codex: synthetic ordinary Web workflow, real HTTP and SQLite readback. */
import { expect, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { isAbsolute, join } from 'node:path';
import { bootstrapUnlockedSession, openPatientSection } from './utils';

test('Web creates, records testing, and removes a prosthetic prescription with one audit per action', async ({ page, baseURL }, testInfo) => {
    test.skip(process.env.MF085_SYNTHETIC_E2E !== '1', 'Requires an isolated synthetic server.');
    const dir = process.env.MEDIFLOW_DATA_DIR;
    const url = new URL(baseURL!);
    if (!dir || !isAbsolute(dir) || url.hostname !== '127.0.0.1' || !url.port || url.port === '3000') throw new Error('Dedicated synthetic data and loopback port required');
    await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
    const patientId = await page.evaluate(async () => {
        const suffix = Date.now().toString().slice(-8);
        const response = await fetch('/api/patients', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ firstName: 'Ausilio', lastName: 'Sintetico', taxCode: `PRO${suffix.padStart(13, '0')}`,
                birthDate: '1980-01-01T00:00:00.000Z', diagnoses: [] }) });
        if (response.status !== 201) throw new Error(`Synthetic patient create: ${response.status}`);
        return (await response.json()).id as string;
    });
    const read = (id: string) => {
        const db = new Database(join(dir, 'medical.db'), { readonly: true, fileMustExist: true });
        try { return { row: db.prepare('SELECT * FROM prosthetic_prescriptions WHERE id=?').get(id) as Record<string, unknown> | undefined,
            events: db.prepare('SELECT event_type, actor_ref, source_surface, redacted_metadata FROM audit_events WHERE subject_ref=? ORDER BY rowid').all(id) as Array<Record<string, unknown>> }; }
        finally { db.close(); }
    };
    const http = async () => {
        const response = await page.request.get(`/api/prosthetic-prescriptions?patientId=${patientId}`);
        expect(response.status()).toBe(200); return await response.json() as Array<{ id: string; version: number; status: string }>;
    };
    await page.goto(`/patients/${patientId}/modules`);
    await openPatientSection(page, 'protesica');
    const pane = page.locator('#protesica');
    await pane.getByRole('button', { name: 'Nuova voce', exact: true }).click();
    await pane.getByLabel('Descrizione ausilio').fill('Ausilio sintetico di verifica');
    await pane.getByLabel('Motivazione clinico-funzionale', { exact: true }).fill('Motivazione sintetica riservata');
    // @Codex: a rejected audit must keep the draft and permit a deliberate retry.
    const faultDb = new Database(join(dir, 'medical.db'), { fileMustExist: true });
    try {
        faultDb.exec("CREATE TRIGGER synthetic_prosthetic_ui_audit BEFORE INSERT ON audit_events WHEN NEW.event_type='prosthetic.prescription.created' BEGIN SELECT RAISE(IGNORE); END");
        const failed = page.waitForResponse(r => new URL(r.url()).pathname === '/api/prosthetic-prescriptions' && r.request().method() === 'POST');
        await pane.getByRole('button', { name: 'Salva voce', exact: true }).click();
        expect((await failed).status()).toBe(500);
        await expect(pane.getByLabel('Descrizione ausilio')).toHaveValue('Ausilio sintetico di verifica');
        expect(faultDb.prepare('SELECT count(*) AS n FROM prosthetic_prescriptions WHERE patient_id=?').get(patientId)).toEqual({ n: 0 });
        expect(await http()).toHaveLength(0);
    } finally { faultDb.exec('DROP TRIGGER IF EXISTS synthetic_prosthetic_ui_audit'); faultDb.close(); }
    const create = page.waitForResponse(r => new URL(r.url()).pathname === '/api/prosthetic-prescriptions' && r.request().method() === 'POST');
    await pane.getByRole('button', { name: 'Salva voce', exact: true }).click();
    const created = await create; expect(created.status()).toBe(201);
    const { id } = await created.json() as { id: string };
    await expect(pane.getByRole('heading', { name: 'Ausilio sintetico di verifica', exact: true })).toBeVisible();
    const initial = read(id); expect(initial.row).toMatchObject({ version: 1, patient_id: patientId });
    expect(String(initial.row?.clinical_reason)).toMatch(/^ENC:/u);
    expect(initial.events.map(x => x.event_type)).toEqual(['prosthetic.prescription.created']);
    expect((await http()).find(x => x.id === id)?.version).toBe(1);
    const update = page.waitForResponse(r => new URL(r.url()).pathname === `/api/prosthetic-prescriptions/${id}` && r.request().method() === 'PUT');
    await pane.getByRole('button', { name: 'Collaudo', exact: true }).click();
    expect((await update).status()).toBe(200);
    await expect(pane.getByText('Collaudata', { exact: true })).toBeVisible();
    const updated = read(id); expect(updated.row).toMatchObject({ version: 2, status: 'tested' });
    expect(updated.row?.clinical_reason).toBe(initial.row?.clinical_reason);
    expect(updated.events.map(x => x.event_type)).toEqual(['prosthetic.prescription.created', 'prosthetic.prescription.updated']);
    expect(updated.events.map(x => JSON.parse(String(x.redacted_metadata)).resourceVersion)).toEqual([1, 2]);
    expect((await http()).find(x => x.id === id)).toMatchObject({ version: 2, status: 'tested' });
    const remove = page.waitForResponse(r => new URL(r.url()).pathname === `/api/prosthetic-prescriptions/${id}` && r.request().method() === 'DELETE');
    await pane.getByRole('button', { name: 'Elimina Ausilio sintetico di verifica', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Elimina', exact: true }).click();
    expect((await remove).status()).toBe(200);
    await expect(pane.getByRole('heading', { name: 'Ausilio sintetico di verifica', exact: true })).toHaveCount(0);
    const deleted = read(id); expect(deleted.row).toBeUndefined(); expect((await http()).find(x => x.id === id)).toBeUndefined();
    expect(deleted.events.map(x => x.event_type)).toEqual(['prosthetic.prescription.created', 'prosthetic.prescription.updated', 'prosthetic.prescription.deleted']);
    expect(deleted.events.every(x => x.source_surface === 'web')).toBe(true);
    expect(deleted.events.map(x => JSON.parse(String(x.redacted_metadata)).resourceVersion)).toEqual([1, 2, 2]);
    expect(JSON.stringify(deleted.events)).not.toContain('Motivazione sintetica');
    expect(JSON.stringify(deleted.events)).not.toContain('ENC:');
    await testInfo.attach('readback.json', { contentType: 'application/json', body: JSON.stringify({ id, events: deleted.events, hardDeleted: true }) });
});
