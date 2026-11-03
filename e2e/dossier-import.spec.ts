/* WUL-804: dossier from a folder through the real local Web route, writers, extraction and OCR. Synthetic data only. */
import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
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
        writeFileSync(path.join(inbox, 'appunto.txt'), 'Appunto sintetico senza estrazione preparata.');
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

        await page.goto('/patients/import/dossier');
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
        await expect(panel.getByTestId('dossier-source').filter({ hasText: 'appunto.txt' })).toContainText('Assente dall’estrazione preparata');
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
        await expect(document.locator('[data-testid="dossier-fact"][data-kind="diagnosis"][data-origin="prepared"]')).toHaveCount(1);
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
