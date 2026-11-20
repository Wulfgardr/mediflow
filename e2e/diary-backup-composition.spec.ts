import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { bootstrapUnlockedSession, onboardingPassphrase, openPatientSection, unlockIfNeeded } from './utils';
import { expect, test } from './fixtures/isolated-runtime';
import { documentRequests } from './fixtures/trusted-web-request';

const backupPath = '/api/system/backup-restore';
const patient = 'synthetic-diary-backup-patient';
const item = 'synthetic-diary-backup-item';
const prescription = 'synthetic-diary-backup-prescription';
const observation = 'synthetic-diary-backup-observation';

test('il backup ripristina insieme rettifiche, osservazione e prestazione dello stesso paziente', async ({ page, isolatedRuntime }, info) => {
    test.setTimeout(120_000);
    const runtime = await page.request.get('/api/system/revision');
    expect(runtime.ok()).toBe(true);
    const running = await runtime.json();
    const identityPath = process.env.MEDIFLOW_Q8_PACKAGE_IDENTITY;
    if (identityPath) {
        const { revision, sourceTree, sourceFingerprint } = JSON.parse(await readFile(identityPath, 'utf8'));
        expect(revision).toMatch(/^[a-f0-9]{40}$/u);
        expect(sourceTree).toMatch(/^[a-f0-9]{40}$/u);
        expect(running).toMatchObject({ revision, sourceFingerprint, fingerprint: sourceFingerprint });
        expect(running.sourceFingerprint).toContain(sourceTree);
        await info.attach('identita-pacchetto-eseguito.json', { contentType: 'application/json',
            body: JSON.stringify({ revision, sourceTree, running }) });
    }

    const pin = process.env.E2E_PIN || '1234';
    await bootstrapUnlockedSession(page, pin);
    const web = documentRequests(page);
    const openDiary = async () => {
        const navigation = page.getByRole('navigation', { name: 'Navigazione principale', exact: true });
        await navigation.getByRole('link', { name: 'Agenda', exact: true }).click();
        await navigation.getByRole('link', { name: 'Pazienti', exact: true }).click();
        await page.getByRole('searchbox', { name: 'Cerca nella lista pazienti' }).fill(patient);
        await page.getByRole('option').filter({ hasText: 'Diario' }).click();
        await page.getByRole('link', { name: 'Apri scheda paziente', exact: true }).click();
        await openPatientSection(page, 'diario');
    };
    const db = new Database(join(isolatedRuntime.dataDirectory, 'medical.db'), { fileMustExist: true });
    try {
        db.transaction(() => {
            const site = (db.prepare('SELECT id FROM ambulatories WHERE is_default = 1').get() as { id?: string } | undefined)?.id ?? null;
            db.prepare("INSERT INTO patients (id,first_name,last_name,tax_code,ambulatory_id) VALUES (?,'Diario','Sintetico',?,?)").run(patient, patient, site);
            if (site) db.prepare('INSERT INTO patients_to_ambulatories (patient_id,ambulatory_id) VALUES (?,?)').run(patient, site);
            db.prepare("INSERT INTO service_prescriptions (id,patient_id,prescribed_at,service_name) VALUES (?,?,100,'Prestazione sintetica')").run(prescription, patient);
            db.prepare("INSERT INTO service_prescription_items (id,prescription_id,patient_id,service_name) VALUES (?,?,?,'Prestazione sintetica')").run(item, prescription, patient);
            db.prepare("INSERT INTO observations (id,patient_id,code_system,code,display,unit_system,unit_code,value,observed_at,service_prescription_item_id) VALUES (?,?,'synthetic','obs','Osservazione sintetica','synthetic','u','1',100,?)").run(observation, patient, item);
        })();
        await openDiary();
        await page.getByRole('link', { name: 'Nuova voce', exact: true }).click();
        const texts = ['Prima nota sintetica della composizione.', 'Seconda nota sintetica della composizione.', 'Terza nota sintetica della composizione.'];
        await page.getByRole('textbox', { name: 'Resoconto clinico', exact: true }).fill(texts[0]);
        await page.getByRole('button', { name: 'Rivedi', exact: true }).click();
        await page.getByRole('button', { name: 'Conferma e registra', exact: true }).click();
        await page.getByRole('link', { name: 'Chiudi la voce', exact: true }).click();
        const entry = db.prepare('SELECT id, content FROM entries WHERE patient_id=?').get(patient) as { id: string; content: string };
        const legacyTitle = 'Nota sintetica da un archivio precedente';
        db.prepare('UPDATE entries SET title=?, content=?, recorded_by=NULL WHERE id=?').run(legacyTitle, texts[0], entry.id);
        await openDiary();
        const row = page.locator('#diario article').first();
        await expect(row).toContainText(texts[0]);
        const oldRequest = await web.put(`/api/entries/${entry.id}`, {
            data: { version: 1, content: entry.content },
        });
        expect(oldRequest.status(), await oldRequest.text()).toBe(409);
        expect((await oldRequest.json()).code).toBe('ENTRY_LEGACY_REVISION_REQUIRED');
        await row.getByRole('button', { name: 'Rettifica', exact: true }).click();
        await row.getByRole('textbox', { name: 'Testo della rettifica' }).fill('Testo sintetico annullato.');
        await row.getByRole('button', { name: 'Annulla', exact: true }).click();
        expect(db.prepare('SELECT version, content, recorded_by FROM entries WHERE id=?').get(entry.id))
            .toEqual({ version: 1, content: texts[0], recorded_by: null });
        expect(db.prepare('SELECT count(*) FROM entry_revisions WHERE entry_id=?').pluck().get(entry.id)).toBe(0);
        expect(db.prepare("SELECT count(*) FROM audit_events WHERE subject_ref=? AND event_type='entry.updated'").pluck().get(entry.id)).toBe(0);
        for (const text of texts.slice(1)) {
            await row.getByRole('button', { name: 'Rettifica', exact: true }).click();
            await row.getByRole('textbox', { name: 'Testo della rettifica' }).fill(text);
            await row.getByRole('button', { name: 'Salva rettifica' }).click();
            await expect(row).toContainText(text);
        }
        const source = await web.get(backupPath);
        expect(source.status(), await source.text()).toBe(200);
        const body = await source.body();
        const { payload } = JSON.parse(body.toString());
        expect(payload.entryRevisions.map((entry: { version: number }) => entry.version).sort()).toEqual([1, 2]);
        expect(payload.entryRevisions.find((revision: { version: number }) => revision.version === 1)).toMatchObject({
            entryId: entry.id, title: expect.stringMatching(/^ENCD1:/), content: expect.stringMatching(/^ENCD1:/),
        });
        expect(JSON.stringify(payload.entryRevisions)).not.toContain(texts[0]);
        expect(payload.observations).toContainEqual(expect.objectContaining({ id: observation, patientId: patient, servicePrescriptionItemId: item }));
        expect(payload.servicePrescriptionItems).toContainEqual(expect.objectContaining({ id: item, patientId: patient, prescriptionId: prescription }));
        expect(payload.servicePrescriptions).toContainEqual(expect.objectContaining({ id: prescription, patientId: patient }));

        db.pragma('foreign_keys=ON');
        db.transaction(() => {
            db.prepare('DELETE FROM observations WHERE id=?').run(observation);
            db.prepare('DELETE FROM service_prescription_items WHERE id=?').run(item);
            db.prepare('DELETE FROM service_prescriptions WHERE id=?').run(prescription);
            db.prepare('DELETE FROM entries WHERE patient_id=?').run(patient);
        })();
        expect(db.prepare('SELECT count(*) FROM entry_revisions').pluck().get()).toBe(0);
        await page.getByRole('link', { name: 'Impostazioni', exact: true }).click();
        await page.locator('a[href="/settings/backup"]:visible').first().click();
        const input = page.getByText('Seleziona file .mediflow v1', { exact: true }).locator('input');
        const [preview] = await Promise.all([
            page.waitForResponse(response => new URL(response.url()).pathname === backupPath + '/verify'),
            input.setInputFiles({ name: 'rettifiche-e-prestazione.mediflow', mimeType: 'application/json', buffer: body }),
        ]);
        expect(preview.status(), await preview.text()).toBe(200);
        const { expectedSnapshot, sourceChecksum } = await preview.json();
        await page.getByTestId('restore-confirmation-input').fill('RIPRISTINA');
        await page.getByLabel('Passphrase amministrativa', { exact: true }).fill(onboardingPassphrase(pin));
        const reloaded = page.waitForEvent('framenavigated', { predicate: frame => frame === page.mainFrame() });
        const [restored] = await Promise.all([
            page.waitForResponse(response => new URL(response.url()).pathname === backupPath && response.request().method() === 'POST'),
            page.getByTestId('restore-confirmation-submit').click(),
        ]);
        expect(restored.status(), await restored.text()).toBe(200);
        expect(await restored.request().headerValue('x-mediflow-restore-snapshot')).toBe(expectedSnapshot);
        expect(await restored.request().headerValue('x-mediflow-restore-source-checksum')).toBe(sourceChecksum);
        expect(db.pragma('foreign_key_check')).toEqual([]);
        expect(db.prepare(`
            SELECT o.patient_id AS observation, i.patient_id AS item, p.patient_id AS prescription
            FROM observations o JOIN service_prescription_items i ON o.service_prescription_item_id = i.id
            JOIN service_prescriptions p ON i.prescription_id = p.id WHERE o.id = ?
        `).get(observation)).toEqual({ observation: patient, item: patient, prescription: patient });

        await reloaded;
        await expect(page.getByRole('heading', { name: 'Sblocca MediFlow' })).toBeVisible();
        await unlockIfNeeded(page, pin);
        await openDiary();
        await row.getByRole('button', { name: 'Storico delle rettifiche' }).click();
        const history = row.getByRole('region', { name: 'Versioni della nota' });
        for (const [index, label] of ['Versione 1', 'Versione 2', 'Versione attuale 3'].entries()) {
            await history.getByRole('button', { name: label, exact: true }).click();
            await expect(history).toContainText(texts[index]);
            if (index === 0) await expect(history).toContainText(legacyTitle);
        }
    } finally { db.close(); }
});
