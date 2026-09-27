/* @Codex: ordinary Web journey with SQLite audit failure and authoritative readback. */
import { expect, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { isAbsolute, join } from 'node:path';
import { bootstrapUnlockedSession, openPatientSection } from './utils';

test('Web service prescriptions and items retain the draft on audit failure and persist each accepted action', async ({ page, baseURL }, testInfo) => {
    test.skip(process.env.MF085_SYNTHETIC_E2E !== '1', 'Requires an isolated synthetic server.');
    const dir = process.env.MEDIFLOW_DATA_DIR;
    const url = new URL(baseURL!);
    if (!dir || !isAbsolute(dir) || url.hostname !== '127.0.0.1' || !url.port || url.port === '3000') throw new Error('Dedicated synthetic data and loopback port required');
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
    const patientId = await page.evaluate(async () => {
        const suffix = Date.now().toString().slice(-8);
        const response = await fetch('/api/patients', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ firstName: 'Prestazione', lastName: 'Sintetica', taxCode: `PRE${suffix.padStart(13, '0')}`,
                birthDate: '1980-01-01T00:00:00.000Z', diagnoses: [] }) });
        if (response.status !== 201) throw new Error(`Synthetic patient create: ${response.status}`);
        return (await response.json()).id as string;
    });
    const read = () => {
        const db = new Database(join(dir, 'medical.db'), { readonly: true, fileMustExist: true });
        try { return {
            rows: db.prepare('SELECT * FROM service_prescriptions WHERE patient_id=?').all(patientId) as Array<Record<string, unknown>>,
            items: db.prepare('SELECT * FROM service_prescription_items WHERE patient_id=? ORDER BY ordinal').all(patientId) as Array<Record<string, unknown>>,
            events: db.prepare("SELECT event_type, subject_ref, actor_ref, source_surface, redacted_metadata FROM audit_events WHERE event_type LIKE 'service.prescription%' ORDER BY rowid").all() as Array<Record<string, unknown>>,
        }; } finally { db.close(); }
    };
    const http = async (kind: string) => {
        const response = await page.request.get(`/api/${kind}?patientId=${patientId}`);
        expect(response.status()).toBe(200); return await response.json() as Array<{ id: string; version: number; status: string }>;
    };
    await page.goto(`/patients/${patientId}/modules`);
    await openPatientSection(page, 'prestazioni');
    const pane = page.locator('#prestazioni');
    await pane.getByRole('button', { name: 'Nuova prestazione', exact: true }).click();
    await pane.getByLabel('Nome prestazione (raggruppa le voci)').fill('Controllo sintetico di verifica');
    await pane.getByLabel('Voci richieste - una per riga, opzionale CODICE NOME').fill('Voce sintetica uno\nVoce sintetica due');
    await pane.getByPlaceholder('Motivazione e quesito alla base della richiesta').fill('Quesito sintetico riservato');
    const before = read();
    const faultDb = new Database(join(dir, 'medical.db'), { fileMustExist: true });
    try {
        faultDb.exec("CREATE TRIGGER synthetic_service_ui_audit BEFORE INSERT ON audit_events WHEN NEW.event_type='service.prescription.created' BEGIN SELECT RAISE(IGNORE); END");
        const failed = page.waitForResponse(r => new URL(r.url()).pathname === '/api/service-prescriptions' && r.request().method() === 'POST');
        await pane.getByRole('button', { name: 'Salva prestazione', exact: true }).click();
        expect((await failed).status()).toBe(500);
        await expect(pane.getByLabel('Nome prestazione (raggruppa le voci)')).toHaveValue('Controllo sintetico di verifica');
        expect(read()).toEqual(before);
        expect(await http('service-prescriptions')).toHaveLength(0);
    } finally { faultDb.exec('DROP TRIGGER IF EXISTS synthetic_service_ui_audit'); faultDb.close(); }
    const created = page.waitForResponse(r => new URL(r.url()).pathname === '/api/service-prescriptions' && r.request().method() === 'POST');
    await pane.getByRole('button', { name: 'Salva prestazione', exact: true }).click();
    expect((await created).status()).toBe(201);
    await expect(pane.getByRole('heading', { name: 'Controllo sintetico di verifica', exact: true })).toBeVisible();
    await expect.poll(() => read().items.length).toBe(2);
    const initial = read();
    expect(initial.rows).toHaveLength(1);
    const parentId = String(initial.rows[0].id);
    const itemIds = initial.items.map(item => String(item.id));
    const refs = [parentId, ...itemIds];
    const ownedEvents = (state: ReturnType<typeof read>) => state.events.filter(event => refs.includes(String(event.subject_ref)));
    expect(initial.rows[0]).toMatchObject({ version: 1, patient_id: patientId });
    expect(String(initial.rows[0].clinical_question)).toMatch(/^ENC:/u);
    expect(ownedEvents(initial).map(event => event.event_type).sort()).toEqual(['service.prescription.created', 'service.prescription_item.created', 'service.prescription_item.created']);
    expect(await http('service-prescriptions')).toHaveLength(1);
    expect(await http('service-prescription-items')).toHaveLength(2);
    const updated = page.waitForResponse(r => new URL(r.url()).pathname === `/api/service-prescriptions/${parentId}` && r.request().method() === 'PUT');
    await pane.getByRole('button', { name: 'Segna eseguita', exact: true }).click();
    expect((await updated).status()).toBe(200);
    await expect.poll(() => read().items.every(item => item.status === 'performed' && item.version === 2)).toBe(true);
    const afterUpdate = read();
    expect(afterUpdate.rows[0]).toMatchObject({ version: 2, status: 'performed' });
    expect(afterUpdate.rows[0].clinical_question).toBe(initial.rows[0].clinical_question);
    expect(ownedEvents(afterUpdate)).toHaveLength(6);
    for (const ref of refs) expect(ownedEvents(afterUpdate).filter(event => event.subject_ref === ref).map(event => JSON.parse(String(event.redacted_metadata)).resourceVersion)).toEqual([1, 2]);
    expect((await http('service-prescriptions'))[0]).toMatchObject({ version: 2, status: 'performed' });
    expect((await http('service-prescription-items')).every(item => item.version === 2 && item.status === 'performed')).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('service-performed.png'), fullPage: false });
    const removed = page.waitForResponse(r => new URL(r.url()).pathname === `/api/service-prescriptions/${parentId}` && r.request().method() === 'DELETE');
    await pane.getByRole('button', { name: 'Elimina voce', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Elimina', exact: true }).click();
    expect((await removed).status()).toBe(200);
    await expect(pane.getByRole('heading', { name: 'Controllo sintetico di verifica', exact: true })).toHaveCount(0);
    const deleted = read();
    expect(deleted.rows).toHaveLength(0); expect(deleted.items).toHaveLength(0);
    expect(await http('service-prescriptions')).toHaveLength(0); expect(await http('service-prescription-items')).toHaveLength(0);
    const events = ownedEvents(deleted);
    expect(events).toHaveLength(7);
    expect(events.at(-1)).toMatchObject({ event_type: 'service.prescription.deleted', subject_ref: parentId });
    expect(JSON.parse(String(events.at(-1)?.redacted_metadata)).resourceVersion).toBe(2);
    expect(events.every(event => event.source_surface === 'web')).toBe(true);
    expect(JSON.stringify(events)).not.toContain('Quesito sintetico'); expect(JSON.stringify(events)).not.toContain('ENC:');
    expect(errors).toEqual([]);
    await testInfo.attach('readback.json', { contentType: 'application/json', body: JSON.stringify({ parentId, itemIds, events, cascadeDeleted: true }) });
});
