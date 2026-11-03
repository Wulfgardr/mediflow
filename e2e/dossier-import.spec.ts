/* WUL-804: dossier from a folder through the real local Web route, writers, extraction and OCR. Synthetic data only. */
import { expect, test, type Page } from '@playwright/test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';

import { bootstrapUnlockedSession } from './utils';
import { isValidItalianTaxCodeChecksum } from '../lib/domain/documents/document-identity-resolution';

const PIN = process.env.E2E_PIN || '1234';

// Codici fiscali sintetici, nuovi a ogni esecuzione, con carattere di controllo valido.
function syntheticTaxCode(): string {
    const digits = () => String(Math.floor(Math.random() * 100)).padStart(2, '0');
    const prefix = `RSSMRA${digits()}A${digits()}Z${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`;
    const check = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].find((letter) => isValidItalianTaxCodeChecksum(prefix + letter));
    if (!check) throw new Error('Synthetic tax code unavailable');
    return prefix + check;
}
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
    ['Referto di laboratorio sintetico', `Paziente: Mario Rossi codice fiscale ${taxCode}`, 'Data prelievo: 10/01/2025']
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
        writeFileSync(path.join(folder, 'lettera.pdf'), await textPdf(['Lettera specialistica sintetica', `Assistito: Mario Rossi codice fiscale ${CF_B}`,
            'Data referto: 02/02/2025', 'Diagnosi: ICD-10 I10 Ipertensione essenziale', 'Nega diabete ICD-10 E11.9 diabete mellito',
            'Terapia domiciliare: Ramipril 5 mg 1 cp al mattino; Bisoprololo 2,5 mg 1 cp', 'Ausili prescritti: deambulatore ISO 12.06.06']));
        writeFileSync(path.join(folder, 'scansione-leggibile.pdf'), await scannedPdf(page, ['Valutazione geriatrica sintetica', 'Data referto: 03/03/2025', 'Indice di Barthel 60/100']));
        writeFileSync(path.join(folder, 'scansione.pdf'), await blankPdf());
        writeFileSync(path.join(folder, 'firmato.pdf.p7m'), Buffer.from('busta firmata sintetica, contenuto non estratto'));
        writeFileSync(path.join(newcomer, 'referto-nuovo.pdf'), await textPdf(['Referto sintetico per una nuova scheda', 'Cognome: Bianchi', 'Nome: Anna',
            `Codice fiscale paziente: ${CF_C}`, 'Data referto: 05/05/2025', 'Diagnosi: asma bronchiale'], 40));

        const patientA = await createPatient(page, CF_A);
        const patientB = await createPatient(page, CF_B);

        // Accesso dal percorso reale: Nuova scheda → Importa documenti da cartella.
        await page.goto('/patients/new');
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
        await page.goto(`/patients/import/dossier?patientId=${encodeURIComponent(patientB)}`);
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
