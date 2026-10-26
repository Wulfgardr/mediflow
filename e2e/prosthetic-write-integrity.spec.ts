/* synthetic ordinary Web workflow, real HTTP and SQLite readback. */
import { expect, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { isAbsolute, join } from 'node:path';
import { bootstrapUnlockedSession, openPatientSection } from './utils';
import { trustedArchiveWebRequestHeaders } from './fixtures/trusted-web-request';

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
    await page.evaluate(async () => {
        const body = { sourceName: 'repertorio-sintetico.csv', base64: btoa('codice_sistema,codice,descrizione,versione,fonte,ambito,data_inizio,data_fine\nSistema inventato,DEMO-E2E,Ausilio sintetico di verifica,v1,Fonte sintetica E2E,Dimostrazione,,\n') };
        const preview = await fetch('/api/prosthetics/catalog/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const value = await preview.json();
        if (!value.proof) throw new Error('Anteprima sintetica non valida');
        const commit = await fetch('/api/prosthetics/catalog/commit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, proof: value.proof, acceptSubset: true }) });
        if (!commit.ok) throw new Error('Import sintetico non riuscito');
    });
    await page.goto(`/patients/${patientId}/modules`);
    await openPatientSection(page, 'protesica');
    const pane = page.locator('#protesica');
    await pane.getByRole('button', { name: 'Nuova voce protesica', exact: true }).click();
    await pane.getByText('Cerca un ausilio nel repertorio', { exact: true }).click();
    await pane.getByLabel('Codice, descrizione o codifica', { exact: true }).fill('DEMO-E2E');
    await pane.getByRole('button', { name: 'Cerca nel repertorio', exact: true }).click();
    await pane.getByRole('button', { name: 'Usa voce nella bozza', exact: true }).click();
    await expect(pane.getByLabel('Descrizione ausilio')).toHaveValue('Ausilio sintetico di verifica');
    await pane.getByLabel('Motivazione clinico-funzionale', { exact: true }).fill('Motivazione sintetica riservata');
    // a rejected audit must keep the draft and permit a deliberate retry.
    const faultDb = new Database(join(dir, 'medical.db'), { fileMustExist: true });
    try {
        expect(faultDb.prepare('SELECT id FROM patients WHERE id=?').get(patientId)).toEqual({ id: patientId });
        faultDb.exec("CREATE TRIGGER synthetic_prosthetic_ui_audit BEFORE INSERT ON audit_events WHEN NEW.event_type='prosthetic.prescription.created' BEGIN SELECT RAISE(IGNORE); END");
        expect(faultDb.prepare("SELECT name FROM sqlite_schema WHERE type='trigger' AND name='synthetic_prosthetic_ui_audit'").get()).toEqual({ name: 'synthetic_prosthetic_ui_audit' });
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
    await expect(pane.locator('td > strong').filter({ hasText: /^Ausilio sintetico di verifica$/u })).toBeVisible();
    const initial = read(id); expect(initial.row).toMatchObject({ version: 1, patient_id: patientId });
    expect(JSON.parse(String(initial.row?.catalog_snapshot))).toMatchObject({ code: 'DEMO-E2E', source: { name: 'Fonte sintetica E2E', version: 'v1' } });
    expect(String(initial.row?.clinical_reason)).toMatch(/^ENC:/u);
    expect(initial.events.map(x => x.event_type)).toEqual(['prosthetic.prescription.created']);
    expect((await http()).find(x => x.id === id)?.version).toBe(1);
    const update = page.waitForResponse(r => new URL(r.url()).pathname === `/api/prosthetic-prescriptions/${id}` && r.request().method() === 'PUT');
    await pane.getByRole('button', { name: 'Collaudo', exact: true }).click();
    expect((await update).status()).toBe(200);
    await expect(pane.getByText('Collaudata', { exact: true })).toBeVisible();
    const updated = read(id); expect(updated.row).toMatchObject({ version: 2, status: 'tested' });
    expect(updated.row?.catalog_snapshot).toBe(initial.row?.catalog_snapshot);
    expect(updated.row?.clinical_reason).toBe(initial.row?.clinical_reason);
    expect(updated.events.map(x => x.event_type)).toEqual(['prosthetic.prescription.created', 'prosthetic.prescription.updated']);
    expect(updated.events.map(x => JSON.parse(String(x.redacted_metadata)).resourceVersion)).toEqual([1, 2]);
    expect((await http()).find(x => x.id === id)).toMatchObject({ version: 2, status: 'tested' });
    const remove = page.waitForResponse(r => new URL(r.url()).pathname === `/api/prosthetic-prescriptions/${id}` && r.request().method() === 'DELETE');
    await pane.getByRole('button', { name: 'Azioni voce protesica Ausilio sintetico di verifica', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Elimina voce protesica', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Elimina', exact: true }).click();
    expect((await remove).status()).toBe(200);
    await expect(pane.locator('td > strong').filter({ hasText: /^Ausilio sintetico di verifica$/u })).toHaveCount(0);
    const deleted = read(id); expect(deleted.row).toBeUndefined(); expect((await http()).find(x => x.id === id)).toBeUndefined();
    expect(deleted.events.map(x => x.event_type)).toEqual(['prosthetic.prescription.created', 'prosthetic.prescription.updated', 'prosthetic.prescription.deleted']);
    expect(deleted.events.every(x => x.source_surface === 'web')).toBe(true);
    expect(deleted.events.map(x => JSON.parse(String(x.redacted_metadata)).resourceVersion)).toEqual([1, 2, 2]);
    expect(JSON.stringify(deleted.events)).not.toContain('Motivazione sintetica');
    expect(JSON.stringify(deleted.events)).not.toContain('ENC:');
    await testInfo.attach('readback.json', { contentType: 'application/json', body: JSON.stringify({ id, events: deleted.events, hardDeleted: true }) });
});


test('HTTP attraverso il proxy conserva originali protesici da 8 e 25 MiB', async ({ page, baseURL }) => {
    test.setTimeout(120_000);
    test.skip(process.env.MF085_SYNTHETIC_E2E !== '1', 'Requires an isolated synthetic server.');
    const dir = process.env.MEDIFLOW_DATA_DIR, url = new URL(baseURL!);
    if (!dir || !isAbsolute(dir) || url.hostname !== '127.0.0.1' || !url.port || url.port === '3000') throw new Error('Dedicated synthetic data and loopback port required');
    await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
    const body = { sourceName: 'trasporto-inventato.csv', base64: Buffer.from('codice_sistema,codice,descrizione,versione,fonte,ambito,data_inizio,data_fine\nSistema inventato,TRASPORTO,Ausilio inventato,v1,Fonte trasporto sintetica,Dimostrazione,,\n').toString('base64') };
    const preview = await page.request.post('/api/prosthetics/catalog/preview', { data: body }); expect(preview.status()).toBe(200);
    const p = await preview.json(); expect(p.proof).toBeTruthy();
    const commit = await page.request.post('/api/prosthetics/catalog/commit', { data: { ...body, proof: p.proof, acceptSubset: true } }); expect(commit.status()).toBe(200);
    const sourcesResponse = await page.request.get('/api/prosthetics/catalog/sources'); expect(sourcesResponse.status()).toBe(200);
    const sources = await sourcesResponse.json();
    const sourceId = sources.sources.find((source: { name: string }) => source.name === 'Fonte trasporto sintetica').id;
    const originals: Array<{ id: string; sha256: string; size: number }> = [];
    for (const mib of [8, 25]) {
        const bytes = Buffer.alloc(mib * 1024 * 1024, mib);
        const status = await page.request.get('/api/prosthetics/catalog/status'); expect(status.status()).toBe(200);
        const upload = await page.request.post('/api/prosthetics/catalog/documents', { data: { sourceId, revision: (await status.json()).revision, name: `originale-${mib}.bin`, base64: bytes.toString('base64'), page: null } });
        expect(upload.status(), await upload.text()).toBe(200);
        const doc = await upload.json(); expect(doc.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
        originals.push({ id: doc.id, sha256: doc.sha256, size: bytes.length });
        const download = await page.request.get(`/api/prosthetics/catalog/documents?id=${doc.id}&sha256=${doc.sha256}`); expect(download.status()).toBe(200);
        expect(await download.body()).toEqual(bytes);
        const db = new Database(join(dir, 'medical.db'), { readonly: true, fileMustExist: true });
        try { expect(db.prepare('SELECT typeof(bytes) AS type,length(bytes) AS size FROM prosthetics_catalog_documents WHERE id=?').get(doc.id)).toEqual({ type: 'blob', size: bytes.length }); }
        finally { db.close(); }
    }
    const headers = await trustedArchiveWebRequestHeaders(page);
    const exported = await page.request.get('/api/system/backup-restore'); expect(exported.status()).toBe(200);
    const artifact = await exported.body(); expect(artifact.length).toBeGreaterThan(35 * 1024 * 1024);
    const verified = await page.request.post('/api/system/backup-restore/verify', { headers: { ...headers, 'Content-Type': 'application/json' }, data: artifact });
    expect(verified.status(), await verified.text()).toBe(200);
    expect((await verified.json()).success).toBe(true);
    const db = new Database(join(dir, 'medical.db'), { fileMustExist: true });
    try {
        for (const original of originals) db.prepare('DELETE FROM prosthetics_catalog_documents WHERE id=?').run(original.id);
        const restored = await page.request.post('/api/system/backup-restore', { headers: { ...headers, 'Content-Type': 'application/json' }, data: artifact });
        expect(restored.status(), await restored.text()).toBe(200);
        expect((await restored.json()).success).toBe(true);
        for (const original of originals) {
            const row = db.prepare('SELECT bytes FROM prosthetics_catalog_documents WHERE id=?').get(original.id) as { bytes: Buffer } | undefined;
            expect(row, `Originale ripristinato assente nella connessione SQLite: ${original.id}`).toBeDefined();
            expect(row!.bytes.length).toBe(original.size);
            expect(createHash('sha256').update(row!.bytes).digest('hex')).toBe(original.sha256);
        }
    } finally { db.close(); }
    await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
    for (const original of originals) {
        const download = await page.request.get(`/api/prosthetics/catalog/documents?id=${original.id}&sha256=${original.sha256}`);
        expect(download.status()).toBe(200);
        const bytes = await download.body();
        expect(bytes.length).toBe(original.size);
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(original.sha256);
    }
});
