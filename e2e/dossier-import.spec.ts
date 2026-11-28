/* WUL-804: dossier from a folder through the real local Web route, writers, extraction and OCR. Synthetic data only. */
import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';

import { bootstrapUnlockedSession, openUnlockedDocument, unlockIfNeeded } from './utils';
import { test as isolatedTest } from './fixtures/isolated-runtime';
import { randomSyntheticTaxCode as syntheticTaxCode, syntheticTaxCode as fixtureTaxCode } from '../lib/patient-identity.test-support.ts';

const PIN = process.env.E2E_PIN || '1234';

isolatedTest('Dossier senza CF: crea dalla fonte e richiede la conferma al collegamento', async ({ page }) => {
    isolatedTest.setTimeout(120_000);
    const pin = '314159';
    await bootstrapUnlockedSession(page, pin);
    const root = mkdtempSync(path.join(tmpdir(), 'mediflow-dossier-no-identifier-'));
    const fileName = 'referto-senza-identificativo.pdf';
    try {
        writeFileSync(path.join(root, fileName), await textPdf(['Referto sintetico', 'Cognome: Inventata', 'Nome: Lucia', 'Data di nascita: 03/02/1980']));
        await openUnlockedDocument(page, '/patients/import/dossier', pin);
        const panel = page.getByTestId('dossier-import');
        await panel.getByTestId('dossier-folder').setInputFiles(root);
        const group = panel.getByTestId('dossier-group');
        await expect(group).toHaveAttribute('data-identity', 'no_document_cf', { timeout: 60_000 });
        const destination = group.getByLabel('Scheda di destinazione');
        await expect(destination).toHaveValue('');
        await group.getByRole('button', { name: 'Crea la scheda da questo documento' }).click();
        const create = group.getByTestId('patient-document-create');
        await create.getByRole('button', { name: 'Avvia la revisione del documento' }).click();
        await expect(create.getByRole('heading', { name: 'Revisione dei dati' })).toBeVisible({ timeout: 60_000 });
        await expect(create.getByLabel('Nome', { exact: true })).toHaveValue('');
        await create.getByLabel('Nome', { exact: true }).fill('Lucia');
        await create.getByLabel('Cognome', { exact: true }).fill('Inventata');
        await create.getByLabel('Data di nascita', { exact: true }).fill('1980-02-03');
        await create.getByLabel('Identificativo', { exact: true }).selectOption('none');
        await create.getByRole('button', { name: 'Prosegui alla conferma' }).click();
        await create.getByLabel('PIN di conferma').fill(pin);
        await create.getByRole('button', { name: 'Conferma creazione con PIN' }).click();
        await expect(create.getByRole('heading', { name: 'Scheda creata', exact: true })).toBeVisible({ timeout: 30_000 });
        await expect(destination).not.toHaveValue('');
        const patientId = await destination.inputValue();
        await expect(group).toHaveAttribute('data-identity', 'no_document_cf');
        const save = group.getByRole('button', { name: 'Salva 1 originale nella scheda', exact: true });
        await expect(save).toBeDisabled();
        expect(await attachmentCount(page, patientId)).toBe(1);
        await group.getByLabel('Ho controllato le fonti e confermo che appartengono alla scheda scelta.').check();
        await save.click();
        await expect(group.getByTestId('dossier-acquire-outcome')).toHaveText('Già in MediFlow: riusato, non duplicato', { timeout: 60_000 });
        expect(await attachmentCount(page, patientId)).toBe(1);
        await page.reload();
        await unlockIfNeeded(page, pin);
        await panel.getByTestId('dossier-folder').setInputFiles(root);
        await expect(group).toHaveAttribute('data-identity', 'no_document_cf', { timeout: 60_000 });
        await expect(destination).toHaveValue('');
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

isolatedTest('Dossier: un PIN per cinque gruppi, tre schede e due rifiuti motivati', async ({ page, isolatedRuntime }, info) => {
    isolatedTest.setTimeout(150_000);
    const pin = '314159';
    const root = mkdtempSync(path.join(tmpdir(), 'mediflow-dossier-batch-'));
    const codes = [191, 192, 193, 194, 195].map(fixtureTaxCode);
    const invalid = codes[2].slice(0, -1) + (codes[2].endsWith('A') ? 'B' : 'A');
    try {
        await bootstrapUnlockedSession(page, pin);
        for (const [index, firstName] of ['Ada', 'Iris', 'Lia', 'Zoe', 'Eva'].entries()) {
            const folder = path.join(root, `Gruppo-${index + 1}`);
            mkdirSync(folder);
            writeFileSync(path.join(folder, 'documento.pdf'), await textPdf([
                'Documento sintetico', `Nome: ${firstName}`, 'Cognome: Esempio', 'Data di nascita: 01/01/1980',
                `Codice fiscale paziente: ${index === 2 ? invalid : codes[index]}`,
            ]));
        }
        await openUnlockedDocument(page, '/patients/import/dossier', pin);
        const panel = page.getByTestId('dossier-import');
        await panel.getByTestId('dossier-folder').setInputFiles(root);
        const groups = panel.getByTestId('dossier-group');
        await expect(groups).toHaveCount(5, { timeout: 60_000 });
        for (const group of await groups.all()) await expect(group.getByLabel('Scheda di destinazione')).toHaveValue('');
        await panel.getByRole('button', { name: 'Continua senza backup' }).click();
        await createPatient(page, codes[1]);
        const database = new Database(path.join(isolatedRuntime.dataDirectory, 'medical.db'), { readonly: true, fileMustExist: true });
        try {
            const audits = () => database.prepare("SELECT subject_ref, source_surface FROM audit_events WHERE event_type = 'patient.created' ORDER BY rowid").all();
            const before = audits().length;
            const batch = panel.getByTestId('dossier-batch');
            await batch.getByRole('button', { name: 'Rivedi le nuove schede (5)' }).click();
            const rows = batch.getByTestId('dossier-batch-row');
            const first = rows.filter({ hasText: 'Gruppo-1/documento.pdf' });
            await expect(first.getByLabel('Nome', { exact: true })).toHaveValue('Ada');
            await expect(first.getByLabel('Codice fiscale')).toHaveValue(codes[0]);
            await expect(first.getByLabel('Data di nascita')).toHaveValue('1980-01-01');
            await first.getByLabel('Escludi').check();
            await batch.getByRole('button', { name: 'Prosegui alla conferma (4)' }).click();
            await batch.getByLabel('PIN di conferma').fill(pin);
            await batch.getByRole('button', { name: 'Torna alla revisione' }).click();
            await first.getByLabel('Escludi').uncheck();
            await first.getByLabel('Nome', { exact: true }).fill('Aurora');
            await batch.getByRole('button', { name: 'Prosegui alla conferma (5)' }).click();
            await expect(batch.getByLabel('PIN di conferma')).toHaveValue('');
            await expect(rows).toHaveCount(5);
            await expect(first).toContainText('Aurora');
            await info.attach('dossier-conferma', { body: await batch.screenshot(), contentType: 'image/png' });
            const operations: string[] = [];
            page.on('request', request => {
                if (new URL(request.url()).pathname === '/api/patients/document-create') {
                    operations.push((request.postDataJSON() as { operation: string }).operation);
                }
            });
            await batch.getByLabel('PIN di conferma').fill(pin);
            await batch.getByRole('button', { name: 'Conferma con PIN (5)' }).click();
            const results = batch.getByTestId('dossier-batch-results');
            await expect(results.getByRole('status')).toHaveText('Create 3, non create 2.', { timeout: 90_000 });
            await expect(results).toContainText('Codice fiscale già presente nell’ambulatorio.');
            await expect(results).toContainText('Codice fiscale non valido.');
            await expect(results.getByRole('link', { name: 'Apri la scheda' })).toHaveCount(3);
            expect(operations.filter(operation => operation === 'batch-confirm' || operation === 'execute')).toEqual(['batch-confirm']);
            expect(operations.filter(operation => operation === 'batch-execute')).toHaveLength(3);
            expect(audits().slice(before)).toHaveLength(3);
            expect(database.prepare('SELECT first_name FROM patients WHERE tax_code = ?').get(codes[0])).toEqual({ first_name: 'Aurora' });
            expect(database.prepare('SELECT COUNT(*) AS n FROM patients WHERE tax_code = ?').get(codes[1])).toEqual({ n: 1 });
            expect(database.prepare('SELECT COUNT(*) AS n FROM patients WHERE tax_code = ?').get(invalid)).toEqual({ n: 0 });
            const createdIds = (audits().slice(before) as { subject_ref: string; source_surface: string }[])
                .map(event => {
                    expect(event.source_surface).toBe('web');
                    return event.subject_ref;
                });
            for (const patientId of createdIds) expect(await attachmentCount(page, patientId)).toBe(1);
            await info.attach('dossier-esito', { body: await results.screenshot(), contentType: 'image/png' });
        } finally { database.close(); }
    } finally { rmSync(root, { recursive: true, force: true }); }
});

isolatedTest('Dossier: l’esito incerto di una riga lascia proseguire e si può ritirare dopo il reload', async ({ page }, info) => {
    isolatedTest.setTimeout(120_000);
    const pin = '314159';
    const root = mkdtempSync(path.join(tmpdir(), 'mediflow-dossier-batch-receipt-'));
    try {
        await bootstrapUnlockedSession(page, pin);
        for (const [index, firstName] of ['Elia', 'Nora'].entries()) {
            const folder = path.join(root, `Gruppo-${index + 1}`);
            mkdirSync(folder);
            writeFileSync(path.join(folder, 'documento.pdf'), await textPdf([
                'Documento sintetico', `Nome: ${firstName}`, 'Cognome: Prova', 'Data di nascita: 01/01/1980',
                `Codice fiscale paziente: ${fixtureTaxCode(201 + index)}`,
            ]));
        }
        await openUnlockedDocument(page, '/patients/import/dossier', pin);
        const panel = page.getByTestId('dossier-import');
        await panel.getByTestId('dossier-folder').setInputFiles(root);
        const batch = panel.getByTestId('dossier-batch');
        await batch.getByRole('button', { name: 'Rivedi le nuove schede (2)' }).click({ timeout: 60_000 });
        await batch.getByRole('button', { name: 'Prosegui alla conferma (2)' }).click();
        await batch.getByLabel('PIN di conferma').fill(pin);
        let lost = false;
        await page.route('**/api/patients/document-create', async route => {
            if (!lost && (route.request().postDataJSON() as { operation: string }).operation === 'batch-execute') {
                lost = true;
                await route.abort('failed');
            } else await route.continue();
        });
        await batch.getByRole('button', { name: 'Conferma con PIN (2)' }).click();
        const results = batch.getByTestId('dossier-batch-results');
        await expect(results.getByRole('status')).toHaveText('Create 1, non create 0, da verificare 1.', { timeout: 60_000 });
        await expect(results.getByRole('button', { name: 'Rileggi esito' })).toBeVisible();
        await info.attach('dossier-esito-incerto', { body: await results.screenshot(), contentType: 'image/png' });
        await page.reload();
        await unlockIfNeeded(page, pin);
        await batch.getByRole('button', { name: 'Rileggi esito' }).click();
        await expect(batch.getByText('Esito da verificare')).toBeVisible();
        await batch.getByRole('button', { name: 'Ritira', exact: true }).click();
        await expect(batch.getByText('Lavorazione ritirata.')).toBeVisible();
        await expect(batch.getByRole('button', { name: 'Rileggi esito' })).toHaveCount(0);
    } finally { rmSync(root, { recursive: true, force: true }); }
});

const CF_A = syntheticTaxCode();
let CF_B = syntheticTaxCode();
while (CF_B === CF_A) CF_B = syntheticTaxCode();
let CF_C = syntheticTaxCode();
while (CF_C === CF_A || CF_C === CF_B) CF_C = syntheticTaxCode();

async function textPdf(lines: string[], spacing = 18): Promise<Uint8Array> {
    const document = await PDFDocument.create();
    const font = await document.embedFont(StandardFonts.Helvetica);
    const page = document.addPage([595, 842]);
    lines.forEach((line, index) => page.drawText(line, { x: 40, y: 800 - index * spacing, size: 11, font }));
    return document.save();
}

/** Referto di laboratorio impaginato a colonne, come i referti reali: AnyDoc tende a unirne le righe. */
async function labPdf(taxCode: string): Promise<Uint8Array> {
    const document = await PDFDocument.create();
    const font = await document.embedFont(StandardFonts.Helvetica);
    const page = document.addPage([595, 842]);
    ['Referto di laboratorio sintetico', `Sig. Mario Rossi C.F.: ${taxCode}`, 'Data prelievo: 10/01/2025']
        .forEach((line, index) => page.drawText(line, { x: 40, y: 800 - index * 18, size: 11, font }));
    [['Creatinina', '0,9', 'mg/dL', '0,6-1,2'], ['Sodio', '140', 'mmol/L', '135-145']]
        .forEach((row, index) => row.forEach((cell, column) => page.drawText(cell, { x: 40 + column * 130, y: 700 - index * 18, size: 11, font })));
    return document.save();
}

async function blankPdf(): Promise<Uint8Array> {
    const document = await PDFDocument.create();
    document.addPage([595, 842]);
    return document.save();
}

/** Scansione sintetica: testo reso dal browser locale, fotografato e messo in un PDF di sola immagine. */
async function scannedPdf(page: Page, lines: string[]): Promise<Uint8Array> {
    const scan = await page.context().newPage();
    try {
        await scan.setViewportSize({ width: 1240, height: 1754 });
        await scan.setContent(`<html><body style="margin:0;background:#fff;color:#000;font:48px/1.6 Helvetica,Arial,sans-serif;padding:96px">${
            lines.map((line) => `<p style="margin:0 0 24px">${line}</p>`).join('')}</body></html>`);
        const png = await scan.screenshot({ type: 'png' });
        const document = await PDFDocument.create();
        const image = await document.embedPng(png);
        const sheet = document.addPage([595, 842]);
        sheet.drawImage(image, { x: 0, y: 0, width: 595, height: 842 });
        return document.save();
    } finally { await scan.close(); }
}

async function createPatient(page: Page, taxCode: string): Promise<string> {
    return page.evaluate(async (code) => {
        const response = await fetch('/api/patients', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ firstName: 'Mario', lastName: 'Rossi', taxCode: code, birthDate: '1980-01-01T00:00:00.000Z', diagnoses: [] }) });
        if (!response.ok) throw new Error(`Synthetic patient: HTTP ${response.status}`);
        return (await response.json() as { id: string }).id;
    }, taxCode);
}

async function attachmentCount(page: Page, patientId: string): Promise<number> {
    return page.evaluate(async (id) => {
        const response = await fetch(`/api/attachments?patientId=${encodeURIComponent(id)}&metadata=true`, { cache: 'no-store' });
        return (await response.json() as Array<{ patientId: string }>).filter((row) => row.patientId === id).length;
    }, patientId);
}

async function observations(page: Page, patientId: string) {
    return page.evaluate(async (id) => (await (await fetch(`/api/observations?patientId=${encodeURIComponent(id)}`, { cache: 'no-store' })).json()) as
        Array<{ code: string; value: string | number; unitCode: string; patientId: string }>, patientId);
}

test('Dossier: cartella sintetica, aggiornamento di una scheda, nuova scheda da documento, OCR, revisione e ripresa senza duplicati', async ({ page, baseURL }) => {
    test.skip(process.env.E2E_DOCUMENTS_SYNTHETIC_ONLY !== '1', 'Requires explicit isolated synthetic data');
    test.setTimeout(300_000);
    expect(new URL(baseURL!).hostname).toMatch(/^(localhost|127\.0\.0\.1)$/);
    const root = mkdtempSync(path.join(tmpdir(), 'mediflow-dossier-e2e-'));
    try {
        await bootstrapUnlockedSession(page, PIN);
        const folder = path.join(root, 'Dossier', 'Rossi');
        const newcomer = path.join(root, 'Dossier', 'Nuovo');
        mkdirSync(folder, { recursive: true }); mkdirSync(newcomer, { recursive: true });
        const lab = await labPdf(CF_B);
        writeFileSync(path.join(folder, '2025-01-10__laboratorio__esami.pdf'), lab);
        writeFileSync(path.join(folder, 'copia-esami.pdf'), lab);
        writeFileSync(path.join(folder, 'lettera.pdf'), await textPdf(['ASST sintetica - Medicina', 'Sig. Mario Rossi, inviato dal medico', `C.F.: ${CF_B}`,
            'Data referto: 02/02/2025', 'Anamnesi: madre deceduta per ca. mammella ICD-10 C50',
            'Diagnosi: ICD-10 I10 Ipertensione essenziale', 'Nega diabete ICD-10 E11.9 diabete mellito',
            'Terapia domiciliare: Ramipril 5 mg 1 cp al mattino; Bisoprololo 2,5 mg 1 cp', 'Ausili prescritti: deambulatore ISO 12.06.06']));
        writeFileSync(path.join(folder, 'scansione-leggibile.pdf'), await scannedPdf(page, ['Valutazione geriatrica sintetica', 'Data referto: 03/03/2025', 'Indice di Barthel 60/100']));
        writeFileSync(path.join(folder, 'scansione.pdf'), await blankPdf());
        writeFileSync(path.join(folder, 'firmato.pdf.p7m'), Buffer.from('busta firmata sintetica, contenuto non estratto'));
        writeFileSync(path.join(newcomer, 'referto-nuovo.pdf'), await textPdf(['Referto sintetico per una nuova scheda', 'Cognome: Bianchi', 'Nome: Anna',
            `Codice fiscale paziente: ${CF_C}`, 'Data referto: 05/05/2025', 'Diagnosi: asma bronchiale'], 40));

        const patientA = await createPatient(page, CF_A);
        const patientB = await createPatient(page, CF_B);

        // Accesso dal percorso reale: Nuova scheda → Importa documenti da cartella.
        await openUnlockedDocument(page, '/patients/new');
        await page.getByRole('link', { name: 'Importa documenti da cartella' }).click();
        await expect(page).toHaveURL(/\/patients\/import\/dossier$/u);
        const panel = page.getByTestId('dossier-import');
        await panel.getByTestId('dossier-folder').setInputFiles(path.join(root, 'Dossier'));
        const groups = panel.getByTestId('dossier-group');
        await expect(groups).toHaveCount(2, { timeout: 180_000 });
        const rossi = panel.locator('[data-testid="dossier-group"][data-group="Rossi"]');
        const nuovo = panel.locator('[data-testid="dossier-group"][data-group="Nuovo"]');
        await expect(rossi.getByTestId('dossier-source')).toHaveCount(6);
        await expect(rossi.locator('[data-source-status="duplicate_in_selection"]')).toHaveCount(1);
        await expect(rossi.getByTestId('dossier-source').filter({ hasText: 'lettera.pdf' })).toContainText('attribuzione da verificare');
        await expect(rossi.getByTestId('dossier-source').filter({ hasText: 'lettera.pdf' })).not.toContainText('Nessun CF');

        // Omonimi: il codice del documento preseleziona B; A è discordante e non si può salvare.
        const destination = rossi.getByLabel('Scheda di destinazione');
        await expect(destination).toHaveValue(patientB);
        await expect(rossi).toHaveAttribute('data-identity', 'matched');
        await destination.selectOption(patientA);
        await expect(rossi).toHaveAttribute('data-identity', 'discordant');
        await expect(rossi.getByRole('button', { name: /^Salva .* nella scheda$/u })).toBeDisabled();
        await destination.selectOption(patientB);
        await rossi.getByLabel('Ho controllato le fonti e confermo che appartengono alla scheda scelta.').check();
        await rossi.getByRole('button', { name: /^Salva 5 originali nella scheda$/u }).click();
        await expect(rossi.getByTestId('dossier-acquire-outcome').filter({ hasText: 'Originale salvato e riletto identico' })).toHaveCount(5, { timeout: 60_000 });
        expect(await attachmentCount(page, patientA)).toBe(0);
        expect(await attachmentCount(page, patientB)).toBe(5);

        const documents = panel.getByTestId('dossier-document');
        await expect(documents).toHaveCount(5);
        await expect(panel.getByTestId('dossier-summary')).toContainText('0 di 5 documenti completi');
        await expect(documents.filter({ hasText: 'scansione.pdf' }).getByTestId('dossier-gaps')).toContainText('Estrazione non riuscita');
        await expect(documents.filter({ hasText: 'scansione.pdf' }).getByRole('button', { name: 'Riprova l’estrazione dall’originale' })).toBeVisible();
        await expect(documents.filter({ hasText: 'firmato.pdf.p7m' }).getByTestId('dossier-gaps')).toContainText('Formato senza estrazione');
        for (const name of ['esami.pdf', 'lettera.pdf']) await expect(documents.filter({ hasText: name }).getByTestId('dossier-storage')).toContainText('misurati all’acquisizione');

        // Scansione leggibile: testo dall'OCR locale e scala riportata proposta, non somministrata.
        const scan = documents.filter({ hasText: 'scansione-leggibile.pdf' });
        await expect(scan).toContainText('con OCR locale');
        const barthel = scan.locator('[data-testid="dossier-fact"][data-kind="reported_scale"]');
        await expect(barthel.getByLabel('Scala')).toHaveValue('Barthel');
        await expect(barthel.getByLabel('Totale trascritto')).toHaveValue('60');
        await expect(barthel.getByTestId('dossier-qualifier')).toContainText(['Totale trascritto: non diventa una scala somministrata']);

        // Lettera: diagnosi con negazione, farmaci con posologia scritta e storici per default, ausilio con codice ISO esplicito.
        const letter = documents.filter({ hasText: 'lettera.pdf' });
        const diagnosis = (code: string) => letter.locator('[data-testid="dossier-fact"][data-kind="diagnosis"]').filter({ has: page.locator(`input[value="${code}"]`) });
        await expect(diagnosis('E11.9').getByLabel('Il testo nega questa informazione')).toBeChecked();
        await expect(diagnosis('I10').getByLabel('Il testo nega questa informazione')).not.toBeChecked();
        await expect(diagnosis('C50')).toHaveCount(0);
        await expect(letter.locator('[data-testid="dossier-fact"][data-kind="anamnesis"]').filter({ hasText: 'ICD-10 C50' })).not.toHaveCount(0);
        const ramipril = letter.locator('[data-testid="dossier-fact"][data-kind="therapy"]').filter({ has: page.locator('input[value="Ramipril"]') });
        await expect(ramipril.getByLabel('Posologia')).toHaveValue('5 mg 1 cp al mattino');
        await expect(ramipril.getByLabel('Stato')).toHaveValue('completed');
        await expect(ramipril.getByLabel('Inizio')).toHaveValue('');
        const aid = letter.locator('[data-testid="dossier-fact"][data-kind="prosthetic"]');
        await expect(aid.getByLabel('Codice ISO (solo se scritto)')).toHaveValue('12.06.06');

        // Referto di laboratorio: codice LOINC e unità UCUM dal catalogo locale, nessun valore ricopiato a mano.
        const exams = documents.filter({ hasText: 'esami.pdf' });
        const creatinine = exams.locator('[data-testid="dossier-fact"][data-kind="observation"]').filter({ has: page.locator('input[value="Creatinina"]') });
        await expect(creatinine.getByLabel('Codice LOINC')).toHaveValue('2160-0');
        await expect(creatinine.getByLabel('Unità UCUM')).toHaveValue('mg/dL');
        await expect(creatinine.getByLabel('Data del prelievo')).toHaveValue('2025-01-10');
        await creatinine.getByLabel('Decisione').selectOption('accepted');
        await exams.locator('[data-testid="dossier-fact"][data-kind="document_entry"]').getByLabel('Decisione').selectOption('accepted');
        for (const select of await exams.getByLabel('Decisione').all()) {
            if (await select.inputValue() === 'pending') await select.selectOption('rejected');
        }
        await exams.getByLabel(/^Ho letto il testo/u).check();
        await exams.getByRole('button', { name: 'Salva revisione' }).click();
        const apply = exams.getByRole('button', { name: 'Applica 2 fatti accettati' });
        await expect(apply).toBeEnabled();
        await apply.click();
        await expect(page.getByTestId('dossier-apply-result')).toContainText('Applicazione completata', { timeout: 30_000 });
        await expect(panel.getByTestId('dossier-document').filter({ hasText: 'esami.pdf' })).toHaveAttribute('data-complete', 'true');
        const written = (await observations(page, patientB)).filter((item) => item.patientId === patientB);
        expect(written.map((item) => [item.code, String(item.value), item.unitCode])).toEqual([['2160-0', '0.9', 'mg/dL']]);

        // Nuova scheda da documento: proposta d'identità, revisione, PIN, poi lo stesso lotto riprende sulla scheda creata.
        await expect(nuovo).toHaveAttribute('data-identity', 'unmatched_cf');
        await nuovo.getByRole('button', { name: 'Crea la scheda da questo documento' }).click();
        const create = nuovo.getByTestId('patient-document-create');
        await create.getByRole('button', { name: 'Avvia la revisione del documento' }).click();
        await expect(create.getByRole('heading', { name: 'Revisione dei dati' })).toBeVisible({ timeout: 60_000 });
        for (const label of ['Nome', 'Cognome', 'Codice fiscale']) await expect(create.getByLabel(label, { exact: true })).toHaveValue('');
        await create.getByRole('button', { name: 'Usa per codice fiscale' }).click();
        await create.getByRole('button', { name: 'Usa per cognome' }).click();
        await create.getByRole('button', { name: 'Usa per nome' }).click();
        await expect(create.getByLabel('Codice fiscale', { exact: true })).toHaveValue(CF_C);
        await expect(create.getByLabel('Cognome', { exact: true })).toHaveValue('Bianchi');
        await expect(create.getByLabel('Nome', { exact: true })).toHaveValue('Anna');
        await create.getByRole('button', { name: 'Prosegui alla conferma' }).click();
        await create.getByLabel('PIN di conferma').fill(PIN);
        await create.getByRole('button', { name: 'Conferma creazione con PIN' }).click();
        await expect(create.getByRole('heading', { name: 'Scheda creata', exact: true })).toBeVisible({ timeout: 30_000 });
        const newDestination = nuovo.getByLabel('Scheda di destinazione');
        await expect(newDestination).not.toHaveValue('');
        const patientC = await newDestination.inputValue();
        await expect(nuovo).toHaveAttribute('data-identity', 'matched');
        expect(await attachmentCount(page, patientC)).toBe(1);
        await nuovo.getByLabel('Ho controllato le fonti e confermo che appartengono alla scheda scelta.').check();
        await nuovo.getByRole('button', { name: /^Salva 1 originale nella scheda$/u }).click();
        await expect(nuovo.getByTestId('dossier-acquire-outcome')).toHaveText('Già in MediFlow: riusato, non duplicato', { timeout: 60_000 });
        expect(await attachmentCount(page, patientC)).toBe(1);
        await expect(panel.getByTestId('dossier-document')).toHaveCount(1);
        const asthma = panel.locator('[data-testid="dossier-fact"][data-kind="diagnosis"]').filter({ has: page.locator('input[value="asma bronchiale"]') });
        await expect(asthma.getByLabel('Data')).toHaveValue('2025-05-05');

        // Ripresa: la pagina si rilegge dalla scheda; la stessa cartella non duplica gli originali.
        await openUnlockedDocument(page, `/patients/import/dossier?patientId=${encodeURIComponent(patientB)}`);
        await expect(panel.getByTestId('dossier-document')).toHaveCount(5, { timeout: 30_000 });
        await expect(panel.getByTestId('dossier-summary')).toContainText('1 di 5 documenti completi');
        await panel.getByTestId('dossier-folder').setInputFiles(path.join(root, 'Dossier'));
        await expect(rossi.getByTestId('dossier-source')).toHaveCount(6, { timeout: 180_000 });
        await rossi.getByLabel('Ho controllato le fonti e confermo che appartengono alla scheda scelta.').check();
        await rossi.getByRole('button', { name: /^Salva 5 originali nella scheda$/u }).click();
        await expect(rossi.getByTestId('dossier-acquire-outcome').filter({ hasText: 'Già in MediFlow: riusato, non duplicato' })).toHaveCount(5, { timeout: 60_000 });
        expect(await attachmentCount(page, patientB)).toBe(5);
        expect((await observations(page, patientB)).filter((item) => item.patientId === patientB)).toHaveLength(1);

        const receipt = await panel.getByTestId('dossier-receipt').textContent();
        for (const forbidden of [CF_A, CF_B, CF_C, 'Rossi', 'Bianchi', 'esami.pdf', patientB]) expect(receipt).not.toContain(forbidden);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

async function countOf(page: Page, resource: 'therapies' | 'entries', patientId: string): Promise<number> {
    return page.evaluate(async ([kind, id]) => {
        const rows = await (await fetch(`/api/${kind}?patientId=${encodeURIComponent(id)}`, { cache: 'no-store' })).json() as Array<{ patientId: string; deletedAt?: unknown }>;
        return rows.filter((row) => row.patientId === id && !row.deletedAt).length;
    }, [resource, patientId] as const);
}

test('Dossier: estrazione preparata su una cartella mista di più pazienti, citazioni verificate e accettazione in blocco', async ({ page, baseURL }) => {
    test.skip(process.env.E2E_DOCUMENTS_SYNTHETIC_ONLY !== '1', 'Requires explicit isolated synthetic data');
    test.setTimeout(300_000);
    expect(new URL(baseURL!).hostname).toMatch(/^(localhost|127\.0\.0\.1)$/);
    const root = mkdtempSync(path.join(tmpdir(), 'mediflow-dossier-prepared-e2e-'));
    // Codici propri di questo caso: il caso precedente ha già creato schede con CF_A e CF_B.
    let CF_P = syntheticTaxCode();
    while ([CF_A, CF_B, CF_C].includes(CF_P)) CF_P = syntheticTaxCode();
    let CF_Q = syntheticTaxCode();
    while ([CF_A, CF_B, CF_C, CF_P].includes(CF_Q)) CF_Q = syntheticTaxCode();
    try {
        await bootstrapUnlockedSession(page, PIN);
        const inbox = path.join(root, 'Settimana');
        mkdirSync(inbox, { recursive: true });
        const today = new Date();
        const day = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`;
        const iso = today.toISOString().slice(0, 10);
        const letter = (code: string, drug: string) => textPdf(['Lettera di dimissione sintetica', `Codice fiscale paziente: ${code}`, `Data referto: ${day}`,
            'Diagnosi: Ipertensione arteriosa essenziale', `Terapia: ${drug}`, 'Il paziente riferisce dispnea da sforzo da circa due mesi.']);
        const a = await letter(CF_P, 'Ramipril 5 mg 1 cp al mattino');
        const b = await letter(CF_Q, 'Bisoprololo 2,5 mg 1 cp');
        writeFileSync(path.join(inbox, 'lettera-a.pdf'), a);
        writeFileSync(path.join(inbox, 'lettera-b.pdf'), b);
        writeFileSync(path.join(inbox, 'appunto.pdf'), await textPdf(['Appunto sintetico senza estrazione preparata.']));
        const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
        const entry = (bytes: Uint8Array, code: string, drug: string, dosage: string, quote: string) => ({
            sha256: sha(bytes), fileName: 'lettera.pdf', documentDate: iso, documentType: 'lettera_dimissione',
            patient: { taxCode: code, lastName: 'Rossi', firstName: 'Mario' },
            summary: { title: 'Dimissione sintetica', text: 'Ricovero per ipertensione; dispnea da sforzo da circa due mesi.' },
            coverage: { pages: 1, unreadablePages: [], complete: true },
            facts: [
                { kind: 'diagnosis', values: { description: 'Ipertensione arteriosa essenziale' }, quote: 'Diagnosi: Ipertensione arteriosa essenziale' },
                { kind: 'therapy', values: { drugName: drug, activePrinciple: drug.toLowerCase(), dosage, status: 'active' }, quote },
                { kind: 'therapy', values: { drugName: 'Metformina', dosage: '500 mg' }, quote: 'Metformina 500 mg due volte al giorno' },
            ],
        });
        const preparedPath = path.join(root, 'estrazione.json');
        writeFileSync(preparedPath, JSON.stringify({ schema: 'mediflow.dossier_prepared_extraction.v1', preparedAt: today.toISOString(), preparedBy: 'e2e', sources: [
            entry(a, CF_P, 'Ramipril', '5 mg 1 cp al mattino', 'Terapia: Ramipril 5 mg 1 cp al mattino'),
            entry(b, CF_Q, 'Bisoprololo', '2,5 mg 1 cp', 'Terapia: Bisoprololo 2,5 mg 1 cp'),
        ] }));
        const patientA = await createPatient(page, CF_P);
        const patientB = await createPatient(page, CF_Q);

        await openUnlockedDocument(page, '/patients/import/dossier');
        const panel = page.getByTestId('dossier-import');
        await panel.getByTestId('dossier-prepared').setInputFiles(preparedPath);
        await expect(panel.getByTestId('dossier-prepared-status')).toContainText('2 documenti');
        await panel.getByTestId('dossier-folder').setInputFiles(inbox);
        // La cartella mista si divide per paziente; il file non coperto dall'estrazione lo dichiara.
        await expect(panel.getByTestId('dossier-group')).toHaveCount(3, { timeout: 180_000 });
        const groupA = panel.locator(`[data-testid="dossier-group"][data-group="cf:${CF_P}"]`);
        const groupB = panel.locator(`[data-testid="dossier-group"][data-group="cf:${CF_Q}"]`);
        // Il CF suggerisce la scheda, che viene preselezionata: il collegamento resta da confermare.
        await expect(groupA).toHaveAttribute('data-identity', 'matched');
        await expect(groupB).toHaveAttribute('data-identity', 'matched');
        await expect(panel.getByTestId('dossier-source').filter({ hasText: 'appunto.pdf' })).toContainText('Assente dall’estrazione preparata');
        await expect(groupA.getByLabel('Scheda di destinazione')).toHaveValue(patientA);
        await expect(groupB.getByLabel('Scheda di destinazione')).toHaveValue(patientB);

        for (const [group, patientId] of [[groupB, patientB], [groupA, patientA]] as const) {
            await group.getByLabel('Ho controllato le fonti e confermo che appartengono alla scheda scelta.').check();
            await group.getByRole('button', { name: /^Salva 1 originale nella scheda$/u }).click();
            await expect(group.getByTestId('dossier-acquire-outcome')).toHaveText('Originale salvato e riletto identico', { timeout: 60_000 });
            expect(await attachmentCount(page, patientId)).toBe(1);
        }

        // Scheda A: la citazione inventata resta da decidere, il resto si accetta e si applica in un gesto.
        const document = panel.getByTestId('dossier-document');
        await expect(document).toHaveCount(1);
        const invented = document.locator('[data-testid="dossier-fact"][data-kind="therapy"][data-origin="prepared"]').filter({ has: page.locator('input[value="Metformina"]') });
        await expect(invented).toContainText('Citazione non trovata nel testo del documento');
        const ramipril = document.locator('[data-testid="dossier-fact"][data-kind="therapy"][data-origin="prepared"]').filter({ has: page.locator('input[value="Ramipril"]') });
        await expect(ramipril).toContainText('Citazione e valori trovati nel testo del documento');
        await expect(ramipril.getByLabel('Principio attivo')).toHaveValue('ramipril');
        await expect(ramipril.getByLabel('Stato')).toHaveValue('active');
        const diagnosis = document.locator('[data-testid="dossier-fact"][data-kind="diagnosis"][data-origin="prepared"]');
        await expect(diagnosis).toHaveCount(1);
        const fullText = document.locator('details').filter({ has: page.getByText('Testo completo', { exact: true }) });
        const mark = fullText.locator('mark');
        await expect(invented.getByRole('button', { name: 'Mostra nel testo' })).toHaveCount(0);
        await expect(fullText).not.toHaveAttribute('open');
        await ramipril.getByRole('button', { name: 'Mostra nel testo' }).press('Enter');
        await expect(fullText).toHaveAttribute('open', '');
        await expect(mark).toHaveText('Terapia: Ramipril 5 mg 1 cp al mattino');
        await expect(mark).toBeInViewport();
        await expect(mark).toBeFocused();
        await diagnosis.getByRole('button', { name: 'Mostra nel testo' }).click();
        await expect(mark).toHaveText('Diagnosi: Ipertensione arteriosa essenziale');
        await expect(mark).toBeInViewport();
        // Le sintesi si accettano solo con la scelta esplicita di averle lette.
        await panel.getByTestId('dossier-bulk-summaries').check();
        await panel.getByTestId('dossier-bulk').click();
        await expect(panel.getByTestId('dossier-bulk-result')).toContainText('3 proposte accettate', { timeout: 60_000 });
        await expect(panel.getByTestId('dossier-bulk-result')).toContainText('1 resta da decidere');
        await expect(panel.getByTestId('dossier-bulk-result')).toContainText('3 scritture confermate');
        await expect(panel.getByTestId('dossier-gaps')).toHaveText(/Fatti da decidere/u);
        // Le proposte del parser dello stesso tipo restano visibili come sostituite, la voce col testo intero idem.
        await expect(document.locator('[data-testid="dossier-fact"][data-origin="parser:section"][data-decision="pending"]')).toHaveCount(0);
        await expect(document.locator('[data-testid="dossier-fact"][data-origin="parser:document"]')).toHaveAttribute('data-decision', 'rejected');
        expect(await countOf(page, 'therapies', patientA)).toBe(1);
        expect(await countOf(page, 'entries', patientA)).toBe(1);
        expect(await countOf(page, 'therapies', patientB)).toBe(0);

        // Il medico rifiuta la proposta inventata: il documento è completo. Ripetere non duplica.
        await invented.getByLabel('Decisione').selectOption('rejected');
        await document.getByRole('button', { name: 'Salva revisione' }).click();
        await expect(panel.getByTestId('dossier-document')).toHaveAttribute('data-complete', 'true', { timeout: 30_000 });
        await panel.getByTestId('dossier-bulk').isDisabled();
        expect(await countOf(page, 'therapies', patientA)).toBe(1);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

async function auditSubjects(page: Page, eventType: string): Promise<string[]> {
    return page.evaluate(async (type) => {
        const rows = await (await fetch(`/api/system/audit?eventType=${encodeURIComponent(type)}&limit=200`, { cache: 'no-store' })).json() as Array<{ subjectRef: string | null }>;
        return rows.map((row) => row.subjectRef ?? '');
    }, eventType);
}

async function attachmentIds(page: Page, patientId: string): Promise<string[]> {
    return page.evaluate(async (id) => {
        const rows = await (await fetch(`/api/attachments?patientId=${encodeURIComponent(id)}&metadata=true`, { cache: 'no-store' })).json() as Array<{ id: string; patientId: string }>;
        return rows.filter((row) => row.patientId === id).map((row) => row.id);
    }, patientId);
}

test('WUL-927 Dossier: «Accetta il verificato» lascia aperte solo le sintesi, mette da parte doppione e lettura errata, e il medico le recupera', async ({ page, baseURL }, testInfo) => {
    test.skip(process.env.E2E_DOCUMENTS_SYNTHETIC_ONLY !== '1', 'Requires explicit isolated synthetic data');
    test.setTimeout(240_000);
    expect(new URL(baseURL!).hostname).toMatch(/^(localhost|127\.0\.0\.1)$/);
    const root = mkdtempSync(path.join(tmpdir(), 'mediflow-dossier-wul927-'));
    let code = syntheticTaxCode();
    while ([CF_A, CF_B, CF_C].includes(code)) code = syntheticTaxCode();
    try {
        await bootstrapUnlockedSession(page, PIN);
        const inbox = path.join(root, 'Scheda');
        mkdirSync(inbox, { recursive: true });
        const yesterday = new Date(Date.now() - 86_400_000);
        const day = { it: `${String(yesterday.getDate()).padStart(2, '0')}/${String(yesterday.getMonth() + 1).padStart(2, '0')}/${yesterday.getFullYear()}`,
            iso: `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}` };
        const letter = await textPdf(['Lettera di dimissione sintetica', `Codice fiscale paziente: ${code}`, `Data referto: ${day.it}`,
            'Diagnosi: Ipertensione arteriosa essenziale', 'Terapia: Ramipril 5 mg 1 cp al mattino', 'Indice di Barthel 60/100',
            'Il paziente riferisce dispnea da sforzo da circa due mesi.']);
        const reminder = await textPdf(['Promemoria terapia sintetico', `Codice fiscale paziente: ${code}`, `Data referto: ${day.it}`,
            'Terapia: Ramipril 5 mg 1 cp al mattino']);
        writeFileSync(path.join(inbox, 'lettera.pdf'), letter);
        writeFileSync(path.join(inbox, 'promemoria.pdf'), reminder);
        const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
        const ramipril = { kind: 'therapy', values: { drugName: 'Ramipril', activePrinciple: 'ramipril', dosage: '5 mg 1 cp al mattino', status: 'active' }, quote: 'Terapia: Ramipril 5 mg 1 cp al mattino' };
        const source = (bytes: Uint8Array, fileName: string, documentDate: string, facts: unknown[]) => ({ sha256: sha(bytes), fileName, documentDate,
            patient: { taxCode: code, lastName: 'Rossi', firstName: 'Mario' }, summary: { title: `Sintesi ${fileName}`, text: 'Sintesi sintetica del documento.' },
            coverage: { pages: 1, unreadablePages: [], complete: true }, facts });
        const preparedPath = path.join(root, 'estrazione.json');
        writeFileSync(preparedPath, JSON.stringify({ schema: 'mediflow.dossier_prepared_extraction.v1', preparedAt: new Date().toISOString(), preparedBy: 'e2e', sources: [
            source(letter, 'lettera.pdf', day.iso, [{ kind: 'diagnosis', values: { description: 'Ipertensione arteriosa essenziale' }, quote: 'Diagnosi: Ipertensione arteriosa essenziale' }, ramipril]),
            source(reminder, 'promemoria.pdf', day.iso, [ramipril]),
        ] }));
        const patientId = await createPatient(page, code);

        await openUnlockedDocument(page, '/patients/import/dossier');
        const panel = page.getByTestId('dossier-import');
        await panel.getByTestId('dossier-prepared').setInputFiles(preparedPath);
        await panel.getByTestId('dossier-folder').setInputFiles(inbox);
        const group = panel.locator(`[data-testid="dossier-group"][data-group="cf:${code}"]`);
        await expect(group).toHaveAttribute('data-identity', 'matched', { timeout: 180_000 });
        await group.getByLabel('Ho controllato le fonti e confermo che appartengono alla scheda scelta.').check();
        await group.getByRole('button', { name: /^Salva 2 originali nella scheda$/u }).click();
        await expect(group.getByTestId('dossier-acquire-outcome')).toHaveText(['Originale salvato e riletto identico', 'Originale salvato e riletto identico'], { timeout: 60_000 });
        await expect(panel.getByTestId('dossier-document')).toHaveCount(2);
        const attachments = await attachmentIds(page, patientId);
        expect(attachments).toHaveLength(2);
        const updatedBefore = await auditSubjects(page, 'attachment.updated');

        await expect(panel.getByTestId('dossier-bulk-summaries')).not.toBeChecked();
        await panel.getByTestId('dossier-bulk').click();
        await expect(panel.getByTestId('dossier-bulk-result')).toContainText('2 restano da decidere', { timeout: 60_000 });
        const facts = panel.getByTestId('dossier-fact');
        const pending = panel.locator('[data-testid="dossier-fact"][data-decision="pending"]');
        await expect(pending).toHaveCount(2);
        await expect(panel.locator('[data-testid="dossier-fact"][data-decision="pending"][data-kind="document_entry"][data-origin="prepared"]')).toHaveCount(2);
        const decided = panel.locator('[data-testid="dossier-fact"]:not([data-decision="pending"])');
        await expect(decided).toHaveCount(await facts.count() - 2);
        await expect(panel.locator('[data-testid="dossier-fact"]:not([data-decision="pending"]):not([data-decided-by="accept_verified"])')).toHaveCount(0);
        const wholeDocuments = panel.locator('[data-testid="dossier-fact"][data-origin="parser:document"]');
        await expect(wholeDocuments).toHaveCount(2);
        for (const row of await wholeDocuments.all()) await expect(row).toHaveAttribute('data-decision', 'accepted');
        const preparedRamipril = panel.locator('[data-testid="dossier-fact"][data-kind="therapy"][data-origin="prepared"]');
        await expect(preparedRamipril.and(panel.locator('[data-decision="accepted"]'))).toHaveCount(1);
        const duplicate = preparedRamipril.and(panel.locator('[data-decision="already_present"]'));
        await expect(duplicate).toHaveCount(1);
        await expect(duplicate.getByTestId('dossier-fact-decided-by')).toHaveText(/^Da «Accetta il verificato»: Doppione di una voce accettata di «(lettera|promemoria)\.pdf»\.$/u);
        const misread = panel.locator('[data-testid="dossier-fact"][data-origin="parser:scale"]');
        await expect(misread).toHaveAttribute('data-decision', 'rejected');
        await expect(misread.getByTestId('dossier-fact-decided-by')).toHaveText('Da «Accetta il verificato»: Lettura automatica non verificata.');
        await expect(panel.locator('[data-testid="dossier-fact"][data-decision="rejected"]:not(:has([data-testid="dossier-fact-decided-by"]))')).toHaveCount(0);
        await page.setViewportSize({ width: 1280, height: 6000 });
        await page.screenshot({ path: testInfo.outputPath('wul-927-dopo-il-gesto.png') });
        await page.setViewportSize({ width: 1280, height: 720 });

        expect(await countOf(page, 'therapies', patientId)).toBe(1);
        expect(await countOf(page, 'entries', patientId)).toBe(2);
        const updatedAfter = await auditSubjects(page, 'attachment.updated');
        for (const id of attachments) {
            expect(updatedAfter.filter((ref) => ref === id).length, 'decisioni salvate come la revisione ordinaria').toBeGreaterThan(updatedBefore.filter((ref) => ref === id).length);
        }
        expect((await auditSubjects(page, 'therapy.created')).length).toBeGreaterThanOrEqual(1);
        expect((await auditSubjects(page, 'entry.created')).length).toBeGreaterThanOrEqual(2);

        const letterDocument = panel.getByTestId('dossier-document').filter({ has: page.locator('[data-testid="dossier-fact"][data-origin="parser:scale"]') });
        await misread.getByLabel('Decisione').selectOption('accepted');
        await letterDocument.getByRole('button', { name: 'Salva revisione' }).click();
        await expect(misread).toHaveAttribute('data-decision', 'accepted', { timeout: 30_000 });
        await expect(misread).not.toHaveAttribute('data-decided-by', /./u);
        await letterDocument.getByRole('button', { name: 'Applica 1 fatto accettato' }).click();
        await expect(misread.getByTestId('dossier-applied-outcome')).toHaveText('Ultima scrittura: applied', { timeout: 30_000 });
        expect(await countOf(page, 'entries', patientId)).toBe(3);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

isolatedTest('WUL-928: il medico conferma, corregge o scarta il codice ICD-11 del kit', async ({ page, isolatedRuntime }, info) => {
    isolatedTest.setTimeout(150_000);
    const pin = '314159';
    const root = mkdtempSync(path.join(tmpdir(), 'mediflow-dossier-icd11-'));
    const inbox = path.join(root, 'dossier');
    mkdirSync(inbox);
    const codeA = fixtureTaxCode(228);
    const codeB = fixtureTaxCode(229);
    const auditDbPath = path.join(isolatedRuntime.dataDirectory, 'medical.db');
    const candidates = [
        { description: 'Diabete mellito di tipo 2', proposedCode: '5A11' },
        { description: 'Asma bronchiale persistente', proposedCode: 'CA22' },
        { description: 'Ipertensione arteriosa essenziale', proposedCode: 'BA00' },
        { description: 'Dolore lombare persistente', proposedCode: 'E11.9' },
        { description: 'Reflusso gastroesofageo cronico', proposedCode: 'DA22', codeStatus: 'confermato' },
        { description: 'Ipotiroidismo acquisito stabile', proposedCode: '5A00', proposedSystem: 'ICD-10' },
    ];
    try {
        await bootstrapUnlockedSession(page, pin);
        const patientA = await createPatient(page, codeA);
        const patientB = await createPatient(page, codeB);
        async function makeSource(fileName: string, taxCode: string, diagnoses: typeof candidates) {
            const bytes = await textPdf(['Nota sintetica', `Codice fiscale paziente: ${taxCode}`, 'Data visita: 07/01/2026',
                ...diagnoses.map(({ description }) => `Osservato: ${description}.`)]);
            writeFileSync(path.join(inbox, fileName), bytes);
            return { sha256: createHash('sha256').update(bytes).digest('hex'), fileName, patient: { taxCode }, documentDate: '2026-01-07',
                facts: diagnoses.map(values => ({ kind: 'diagnosis',
                    values: { proposedSystem: 'ICD-11', codeStatus: 'proposto', proposedTitle: 'Titolo del depositante', ...values },
                    quote: `Osservato: ${values.description}.` })) };
        }
        const preparedPath = path.join(root, 'estrazione-preparata.json');
        writeFileSync(preparedPath, JSON.stringify({ schema: 'mediflow.dossier_prepared_extraction.v1', sources: [
            await makeSource('nota-a.pdf', codeA, candidates),
            await makeSource('nota-b.pdf', codeB, [candidates[0]]),
        ] }));
        await openUnlockedDocument(page, '/patients/import/dossier', pin);
        const panel = page.getByTestId('dossier-import');
        await panel.getByTestId('dossier-prepared').setInputFiles(preparedPath);
        await panel.getByTestId('dossier-folder').setInputFiles(inbox);
        for (const code of [codeA, codeB]) {
            const group = panel.locator(`[data-testid="dossier-group"][data-group="cf:${code}"]`);
            await expect(group).toHaveAttribute('data-identity', 'matched', { timeout: 60_000 });
            await group.getByLabel('Ho controllato le fonti e confermo che appartengono alla scheda scelta.').check();
            await group.getByRole('button', { name: 'Salva 1 originale nella scheda' }).click();
            await expect(group.getByTestId('dossier-acquire-outcome')).toHaveText('Originale salvato e riletto identico', { timeout: 60_000 });
        }
        const document = panel.getByTestId('dossier-document');
        const selectPatient = panel.getByLabel('Scheda', { exact: true });
        const fact = (description: string) => document.locator('[data-testid="dossier-fact"][data-kind="diagnosis"][data-origin="prepared"]')
            .filter({ has: page.locator(`input[value="${description}"]`) });
        const proposed = fact(candidates[0].description);
        const decision = (description: string) => fact(description).getByLabel('Decisione', { exact: true });
        const field = (description: string) => fact(description).getByLabel('Codice ICD-11 da registrare');
        const save = document.getByRole('button', { name: 'Salva revisione' });
        const clinicalAudit = () => {
            const database = new Database(auditDbPath, { readonly: true, fileMustExist: true });
            try {
                return (database.prepare("SELECT subject_ref, source_surface, outcome, redacted_metadata FROM audit_events WHERE event_type = 'patient.updated' ORDER BY rowid")
                    .all() as Array<{ subject_ref: string; source_surface: string; outcome: string; redacted_metadata: string }>).map(row => {
                    expect(row).toMatchObject({ source_surface: 'web', outcome: 'success' });
                    expect(JSON.parse(row.redacted_metadata).changedFields).toContain('diagnoses');
                    return row.subject_ref;
                });
            } finally { database.close(); }
        };
        expect(clinicalAudit()).toEqual([]);
        await expect(proposed).toContainText('Proposta ICD-11: 5A11 · Type 2 diabetes mellitus');
        await expect(field(candidates[0].description)).toHaveValue('');
        await proposed.getByRole('button', { name: 'Usa il codice proposto' }).click();
        await decision(candidates[0].description).selectOption({ label: 'Accetta con codice ICD-11' });
        await save.click();
        await expect(save).toBeDisabled();
        await panel.getByTestId('dossier-bulk').click();
        await expect(panel.getByTestId('dossier-bulk-result')).toBeVisible();
        expect(clinicalAudit()).toEqual([]);
        await document.getByRole('button', { name: 'Applica 1 fatto accettato' }).click();
        await expect(proposed.getByTestId('dossier-applied-outcome')).toHaveText('Ultima scrittura: applied');
        expect(clinicalAudit()).toEqual([patientB]);

        await selectPatient.selectOption(patientA);
        await expect(document).toContainText('nota-a.pdf');
        await expect(proposed).toHaveAttribute('data-decision', 'pending');
        await expect(field(candidates[0].description)).toHaveValue('');
        await expect(proposed).not.toContainText('Titolo del depositante');
        for (const { description } of candidates.slice(3)) {
            await expect(fact(description)).not.toContainText('Proposta ICD-11:');
            await expect(fact(description).getByLabel('Codice (solo se scritto nel documento)')).toHaveValue('');
        }
        await panel.getByTestId('dossier-bulk').click();
        await expect(panel.getByTestId('dossier-bulk-result')).toBeVisible();
        await expect(proposed).toHaveAttribute('data-decision', 'pending');
        expect(clinicalAudit().filter(id => id === patientA)).toHaveLength(3);

        const [accept, correct, refuse] = candidates.map(({ description }) => description);
        await proposed.getByRole('button', { name: 'Usa il codice proposto' }).click();
        await decision(accept).selectOption({ label: 'Accetta con codice ICD-11' });
        await field(correct).fill('E11.9');
        await decision(correct).selectOption({ label: 'Accetta con codice ICD-11' });
        await decision(refuse).selectOption({ label: 'Accetta diagnosi senza codice' });
        await info.attach('revisione-icd11', { body: await document.screenshot(), contentType: 'image/png' });
        await save.click();
        await document.getByRole('button', { name: 'Applica 3 fatti accettati' }).click();
        await expect(fact(correct)).toContainText('Impossibile verificare il codice ICD-11 nel catalogo WHO');
        expect(clinicalAudit().filter(id => id === patientA)).toHaveLength(5);
        await field(correct).fill('CA23');
        await decision(correct).selectOption({ label: 'Accetta con codice ICD-11' });
        await save.click();
        await document.getByRole('button', { name: 'Applica 1 fatto accettato' }).click();
        await expect(fact(correct).getByTestId('dossier-applied-outcome')).toHaveText('Ultima scrittura: applied');
        expect(clinicalAudit()).toEqual([patientB, patientA, patientA, patientA, patientA, patientA, patientA]);
        const database = new Database(auditDbPath, { readonly: true, fileMustExist: true });
        try {
            const rows = database.prepare('SELECT id, diagnoses, version FROM patients ORDER BY id').all() as Array<{ id: string; diagnoses: string; version: number }>;
            expect(rows.map(row => [row.id, row.version])).toEqual([[patientA, 7], [patientB, 2]].sort());
            for (const { diagnoses } of rows) expect(diagnoses).toMatch(/^ENC:/u);
            const checks = database.prepare("SELECT redacted_metadata FROM audit_events WHERE event_type = 'reference_data.icd11.code_check'").all() as Array<{ redacted_metadata: string }>;
            const flags = checks.map(({ redacted_metadata }) => JSON.parse(redacted_metadata).flags as string[]);
            expect(flags).toHaveLength(8);
            expect(flags.filter(row => row.includes('found:false'))).toHaveLength(2);
            for (const row of flags) expect(row).toContain('source:embedded');
        } finally {
            database.close();
        }
        expect(await attachmentCount(page, patientA)).toBe(1);
        expect(await attachmentCount(page, patientB)).toBe(1);
        for (const [patient, expected] of [
            [patientA, [[accept, '5A11'], [correct, 'CA23'], [refuse, ''], ...candidates.slice(3).map(({ description }) => [description, ''])]],
            [patientB, [[accept, '5A11']]],
        ] as const) {
            await openUnlockedDocument(page, `/patients/${patient}/edit`, pin);
            const descriptions = page.locator('input[name^="diagnoses."][name$=".description"]');
            const codes = page.locator('input[name^="diagnoses."][name$=".code"]');
            const systems = page.locator('input[name^="diagnoses."][name$=".system"]');
            const dates = page.locator('input[name^="diagnoses."][name$=".date"]');
            await expect(descriptions).toHaveCount(expected.length);
            const actual = await Promise.all((await descriptions.evaluateAll(inputs => inputs.map(input => (input as HTMLInputElement).value)))
                .map(async (description, index) => [description, await codes.nth(index).inputValue(), await systems.nth(index).inputValue(),
                    new Date(await dates.nth(index).inputValue()).toISOString()]));
            expect(actual.sort()).toEqual(expected.map(([description, code]) => [description, code, code ? 'ICD-11' : '', '2026-01-07T00:00:00.000Z']).sort());
        }
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});
