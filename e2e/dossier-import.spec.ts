/* WUL-804: dossier from a folder through the real local Web route, writers and extraction. Synthetic data only. */
import { expect, test, type Page } from '@playwright/test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';

import { bootstrapUnlockedSession } from './utils';
import { isValidItalianTaxCodeChecksum } from '../lib/domain/documents/document-identity-resolution';

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

async function textPdf(lines: string[]): Promise<Uint8Array> {
    const document = await PDFDocument.create();
    const font = await document.embedFont(StandardFonts.Helvetica);
    const page = document.addPage([595, 842]);
    lines.forEach((line, index) => page.drawText(line, { x: 40, y: 800 - index * 40, size: 11, font }));
    return document.save();
}

async function blankPdf(): Promise<Uint8Array> {
    const document = await PDFDocument.create();
    document.addPage([595, 842]);
    return document.save();
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
        return (await response.json() as unknown[]).length;
    }, patientId);
}

test('Dossier: cartella sintetica, identità per codice, originali riletti, revisione e applicazione senza duplicati', async ({ page, baseURL }) => {
    test.skip(process.env.E2E_DOCUMENTS_SYNTHETIC_ONLY !== '1', 'Requires explicit isolated synthetic data');
    test.setTimeout(180_000);
    expect(new URL(baseURL!).hostname).toMatch(/^(localhost|127\.0\.0\.1)$/);
    const root = mkdtempSync(path.join(tmpdir(), 'mediflow-dossier-e2e-'));
    try {
        const folder = path.join(root, 'Dossier', 'Rossi');
        mkdirSync(folder, { recursive: true });
        const lab = await textPdf(['Referto di laboratorio sintetico', `Paziente: Mario Rossi codice fiscale ${CF_B}`, 'Data prelievo: 10/01/2025',
            'Glucosio 110 mg/dL 70-99 H', 'Creatinina 0,9 mg/dL 0,6-1,2', 'Nota sintetica non strutturabile.']);
        writeFileSync(path.join(folder, '2025-01-10__laboratorio__esami.pdf'), lab);
        writeFileSync(path.join(folder, 'copia-esami.pdf'), lab);
        writeFileSync(path.join(folder, 'lettera.pdf'), await textPdf(['Lettera specialistica sintetica', `Assistito: Mario Rossi codice fiscale ${CF_B}`,
            'Data referto: 02/02/2025', 'Diagnosi: ICD-10 I10 Ipertensione essenziale', 'Nega diabete ICD-10 E11.9 diabete mellito']));
        writeFileSync(path.join(folder, 'scansione.pdf'), await blankPdf());
        writeFileSync(path.join(folder, 'firmato.pdf.p7m'), Buffer.from('busta firmata sintetica, contenuto non estratto'));

        await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
        const patientA = await createPatient(page, CF_A);
        const patientB = await createPatient(page, CF_B);

        // Accesso dal percorso reale: Nuova scheda → Importa documenti da cartella.
        await page.goto('/patients/new');
        await page.getByRole('link', { name: 'Importa documenti da cartella' }).click();
        await expect(page).toHaveURL(/\/patients\/import\/dossier$/u);
        const panel = page.getByTestId('dossier-import');
        await panel.getByTestId('dossier-folder').setInputFiles(path.join(root, 'Dossier'));
        const group = panel.getByTestId('dossier-group');
        await expect(group).toHaveCount(1, { timeout: 120_000 });
        await expect(group.getByTestId('dossier-source')).toHaveCount(5);
        // Il codice del documento preseleziona B fra gli omonimi; resta da confermare.
        const destination = group.getByLabel('Scheda di destinazione');
        await expect(destination).toHaveValue(patientB);
        await expect(group).toHaveAttribute('data-identity', 'matched');
        await expect(group.locator('[data-source-status="duplicate_in_selection"]')).toHaveCount(1);

        // L'omonimo A: identità discordante, salvataggio impossibile.
        await destination.selectOption(patientA);
        await expect(group).toHaveAttribute('data-identity', 'discordant');
        await expect(group.getByRole('button', { name: /^Salva .* nella scheda$/u })).toBeDisabled();
        await destination.selectOption(patientB);
        await group.getByLabel('Ho controllato le fonti e confermo che appartengono alla scheda scelta.').check();
        await group.getByRole('button', { name: /^Salva 4 originali nella scheda$/u }).click();
        await expect(group.getByTestId('dossier-acquire-outcome').filter({ hasText: 'Originale salvato e riletto identico' })).toHaveCount(4, { timeout: 60_000 });
        expect(await attachmentCount(page, patientA)).toBe(0);
        expect(await attachmentCount(page, patientB)).toBe(4);

        const documents = panel.getByTestId('dossier-document');
        await expect(documents).toHaveCount(4);
        await expect(documents.filter({ hasText: 'scansione.pdf' }).getByTestId('dossier-gaps')).toContainText('Estrazione non riuscita');
        await expect(documents.filter({ hasText: 'firmato.pdf.p7m' }).getByTestId('dossier-gaps')).toContainText('Formato senza estrazione');
        await expect(panel.getByTestId('dossier-summary')).toContainText('0 di 4 documenti completi');
        const letter = documents.filter({ hasText: 'lettera.pdf' });
        const diagnosis = (code: string) => letter.locator('[data-testid="dossier-fact"][data-kind="diagnosis"]').filter({ has: page.locator(`input[value="${code}"]`) });
        await expect(diagnosis('E11.9').getByLabel('Il testo nega questa informazione')).toBeChecked();
        await expect(diagnosis('I10').getByLabel('Il testo nega questa informazione')).not.toBeChecked();

        // Revisione dell'esame. AnyDoc può unire le righe del PDF nativo: il parser per righe
        // allora non propone valori, il testo resta integro e il medico aggiunge ciò che manca.
        const exams = documents.filter({ hasText: 'esami.pdf' });
        await exams.getByLabel('Aggiungi un’informazione omessa').selectOption('observation');
        await exams.getByRole('button', { name: 'Aggiungi', exact: true }).click();
        const glucose = exams.locator('[data-testid="dossier-fact"][data-kind="observation"]').filter({ hasText: 'Aggiunta dal medico' });
        await glucose.getByLabel('Esame').fill('Glucosio');
        await glucose.getByLabel('Valore').fill('110');
        await glucose.getByLabel('Unità nel documento').fill('mg/dL');
        await glucose.getByLabel('Codice LOINC').fill('2345-7');
        await glucose.getByLabel('Unità UCUM').fill('mg/dL');
        await glucose.getByLabel('Data del prelievo').fill('2025-01-10');
        await glucose.getByLabel('Decisione').selectOption('accepted');
        await exams.locator('[data-testid="dossier-fact"][data-kind="document_entry"]').getByLabel('Decisione').selectOption('accepted');
        // Ogni altra proposta va decisa esplicitamente prima che il documento risulti completo.
        for (const select of await exams.getByLabel('Decisione').all()) {
            if (await select.inputValue() === 'pending') await select.selectOption('rejected');
        }
        await exams.getByLabel(/^Ho letto il testo/u).check();
        await exams.getByRole('button', { name: 'Salva revisione' }).click();
        const apply = exams.getByRole('button', { name: 'Applica 2 fatti accettati' });
        await expect(apply).toBeEnabled();
        await apply.click();
        await expect(page.getByTestId('dossier-apply-result')).toContainText('Applicazione completata', { timeout: 30_000 });
        await expect(exams).toHaveAttribute('data-complete', 'true');

        const observations = await page.evaluate(async (id) => (await (await fetch(`/api/observations?patientId=${encodeURIComponent(id)}`, { cache: 'no-store' })).json()) as Array<{ code: string; value: string | number; patientId: string }>, patientB);
        expect(observations.filter((item) => item.patientId === patientB).map((item) => [item.code, String(item.value)])).toEqual([['2345-7', '110']]);

        // Ripresa: la pagina si rilegge dalla scheda; la stessa cartella non duplica gli originali.
        await page.goto(`/patients/import/dossier?patientId=${encodeURIComponent(patientB)}`);
        await expect(panel.getByTestId('dossier-document')).toHaveCount(4, { timeout: 30_000 });
        await expect(panel.getByTestId('dossier-summary')).toContainText('1 di 4 documenti completi');
        await panel.getByTestId('dossier-folder').setInputFiles(path.join(root, 'Dossier'));
        await expect(group.getByTestId('dossier-source')).toHaveCount(5, { timeout: 120_000 });
        await group.getByLabel('Ho controllato le fonti e confermo che appartengono alla scheda scelta.').check();
        await group.getByRole('button', { name: /^Salva 4 originali nella scheda$/u }).click();
        await expect(group.getByTestId('dossier-acquire-outcome').filter({ hasText: 'Già in MediFlow: riusato, non duplicato' })).toHaveCount(4, { timeout: 60_000 });
        expect(await attachmentCount(page, patientB)).toBe(4);
        const again = await page.evaluate(async (id) => (await (await fetch(`/api/observations?patientId=${encodeURIComponent(id)}`, { cache: 'no-store' })).json()) as Array<{ patientId: string }>, patientB);
        expect(again.filter((item) => item.patientId === patientB)).toHaveLength(1);

        const receipt = await panel.getByTestId('dossier-receipt').textContent();
        for (const forbidden of [CF_A, CF_B, 'Rossi', 'esami.pdf', patientB]) expect(receipt).not.toContain(forbidden);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});
