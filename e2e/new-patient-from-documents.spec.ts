import type { Locator, Page, TestInfo } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';

import { expect, test } from './fixtures/isolated-runtime';
import { bootstrapUnlockedSession, openUnlockedDocument } from './utils';
import { omocodicVariant, randomSyntheticTaxCode } from '../lib/patient-identity.test-support';

test.describe.configure({ retries: 0 });
const pin = '314159';

async function textPdf(lines: string[]): Promise<number[]> {
    const document = await PDFDocument.create();
    const font = await document.embedFont(StandardFonts.Helvetica);
    const page = document.addPage([595, 842]);
    lines.forEach((line, index) => page.drawText(line, { x: 40, y: 800 - index * 40, size: 11, font }));
    return [...await document.save()];
}

async function labPdf(taxCode: string): Promise<number[]> {
    const document = await PDFDocument.create();
    const font = await document.embedFont(StandardFonts.Helvetica);
    const page = document.addPage([595, 842]);
    ['Referto di laboratorio sintetico', `Codice fiscale paziente: ${taxCode}`, 'Data prelievo: 10/01/2025']
        .forEach((line, index) => page.drawText(line, { x: 40, y: 800 - index * 18, size: 11, font }));
    [['Creatinina', '0,9', 'mg/dL', '0,6-1,2'], ['Sodio', '140', 'mmol/L', '135-145']]
        .forEach((row, index) => row.forEach((cell, column) => page.drawText(cell, { x: 40 + column * 130, y: 700 - index * 18, size: 11, font })));
    return [...await document.save()];
}

async function letterPdf(taxCode: string): Promise<number[]> {
    return textPdf(['Lettera di dimissione sintetica', 'Cognome: Sintetica', 'Nome: Elena', 'Data di nascita: 03/02/1950',
        `Codice fiscale paziente: ${taxCode}`, 'Data referto: 02/02/2025', 'Diagnosi: ICD-10 I10 Ipertensione essenziale',
        'Anamnesi familiare: madre con diabete mellito', 'Terapia domiciliare: Ramipril 5 mg 1 cp al mattino']);
}

async function dropFiles(target: Locator, files: Array<{ name: string; bytes: number[] }>) {
    const transfer = await target.page().evaluateHandle((items) => {
        const data = new DataTransfer();
        for (const item of items) data.items.add(new File([new Uint8Array(item.bytes)], item.name, { type: 'application/pdf' }));
        return data;
    }, files);
    await target.dispatchEvent('dragover', { dataTransfer: transfer });
    await target.dispatchEvent('drop', { dataTransfer: transfer });
}

async function countOf(page: Page, resource: string, patientId: string): Promise<number> {
    return page.evaluate(async ([name, id]) => {
        const response = await fetch(`/api/${name}?patientId=${encodeURIComponent(id)}${name === 'attachments' ? '&metadata=true' : ''}`, { cache: 'no-store' });
        return (await response.json() as Array<{ patientId: string }>).filter((row) => row.patientId === id).length;
    }, [resource, patientId] as const);
}

async function capture(info: TestInfo, page: Page, name: string) {
    await info.attach(name, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
}

const dropZone = (page: Page) => page.getByTestId('patient-document-create').locator('section[aria-labelledby="patient-document-create-title"]');

test('nuova scheda: trascino due documenti, confermo l’anagrafica proposta e il resto è già in revisione con la fonte', async ({ page }, info) => {
    test.setTimeout(240_000);
    const taxCode = randomSyntheticTaxCode();
    await bootstrapUnlockedSession(page, pin);
    await openUnlockedDocument(page, '/patients/new', pin);
    await capture(info, page, '1-nuova-scheda.png');

    await dropFiles(dropZone(page), [{ name: 'esami.pdf', bytes: await labPdf(taxCode) }, { name: 'lettera.pdf', bytes: await letterPdf(taxCode) }]);
    const panel = page.getByTestId('dossier-import');
    const group = panel.getByTestId('dossier-group');
    await expect(group).toHaveAttribute('data-identity', 'unmatched_cf', { timeout: 120_000 });
    await expect(group.getByTestId('dossier-source')).toHaveCount(2);
    await expect(page.locator('#dati')).toBeHidden();

    const create = group.getByTestId('dossier-new-patient').getByTestId('patient-document-create');
    await expect(create).toContainText('lettera.pdf');
    await create.getByRole('button', { name: 'Avvia la revisione del documento' }).click();
    await expect(create.getByRole('heading', { name: 'Revisione dei dati' })).toBeVisible({ timeout: 60_000 });
    for (const label of ['Nome', 'Cognome', 'Codice fiscale']) await expect(create.getByLabel(label, { exact: true })).toHaveValue('');
    await expect(create.getByTestId('patient-document-dossier-proposals')).toContainText('Cognome: Sintetica');
    await capture(info, page, '2-anagrafica-proposta.png');
    for (const field of ['codice fiscale', 'cognome', 'nome', 'data di nascita']) await create.getByRole('button', { name: `Usa per ${field}` }).click();
    await expect(create.getByLabel('Codice fiscale', { exact: true })).toHaveValue(taxCode);
    await expect(create.getByLabel('Nome', { exact: true })).toHaveValue('Elena');
    await create.getByLabel('Nome', { exact: true }).fill('Elena Maria');
    await create.getByRole('button', { name: 'Prosegui alla conferma' }).click();
    await create.getByLabel('PIN di conferma').fill(pin);
    await create.getByRole('button', { name: 'Conferma creazione con PIN' }).click();
    await expect(create.getByRole('heading', { name: 'Scheda creata', exact: true })).toBeVisible({ timeout: 30_000 });

    const destination = group.getByLabel('Scheda di destinazione');
    await expect(destination).not.toHaveValue('');
    const patientId = await destination.inputValue();
    await expect(group).toHaveAttribute('data-identity', 'matched');
    expect(await countOf(page, 'attachments', patientId)).toBe(1);
    const save = group.getByRole('button', { name: 'Salva 2 originali nella scheda', exact: true });
    await expect(save).toBeDisabled();
    await group.getByLabel('Ho controllato le fonti e confermo che appartengono alla scheda scelta.').check();
    await save.click();
    await expect(group.getByTestId('dossier-acquire-outcome')).toHaveText(['Originale salvato e riletto identico', 'Già in MediFlow: riusato, non duplicato'], { timeout: 60_000 });
    expect(await countOf(page, 'attachments', patientId)).toBe(2);

    await expect(panel.getByRole('heading', { name: 'Rivedi e applica i dati clinici' })).toBeVisible();
    await expect(panel.getByTestId('dossier-document')).toHaveCount(2, { timeout: 30_000 });
    const letter = panel.getByTestId('dossier-document').filter({ hasText: 'lettera.pdf' });
    const exams = panel.getByTestId('dossier-document').filter({ hasText: 'esami.pdf' });
    const hypertension = letter.locator('[data-testid="dossier-fact"][data-kind="diagnosis"]').filter({ has: page.locator('input[value="I10"]') });
    await expect(hypertension).toHaveCount(1);
    await expect(hypertension).toContainText('Diagnosi: ICD-10 I10 Ipertensione essenziale');
    await expect(letter.locator('[data-testid="dossier-fact"][data-kind="therapy"]').filter({ has: page.locator('input[value="Ramipril"]') })).toHaveCount(1);
    await expect(exams.locator('[data-testid="dossier-fact"][data-kind="observation"]').filter({ has: page.locator('input[value="Creatinina"]') })).toHaveCount(1);
    await hypertension.getByRole('button', { name: 'Mostra nel testo' }).click();
    await expect(letter.locator('details[open]')).toContainText('Ipertensione essenziale');
    await capture(info, page, '3-dati-clinici-in-revisione.png');

    const patient = await page.evaluate(async (id) => (await fetch(`/api/patients/${id}`, { cache: 'no-store' })).json(), patientId);
    expect(patient).toMatchObject({ firstName: 'Elena Maria', lastName: 'Sintetica', taxCode, birthDate: '1950-02-03T00:00:00.000Z' });
    for (const resource of ['therapies', 'observations']) expect(await countOf(page, resource, patientId)).toBe(0);
});

test('nuova scheda: documenti di due pazienti, omocodia o scheda già esistente non avviano la creazione', async ({ page }, info) => {
    test.setTimeout(240_000);
    const taxCode = randomSyntheticTaxCode();
    let other = randomSyntheticTaxCode();
    while (other === taxCode) other = randomSyntheticTaxCode();
    await bootstrapUnlockedSession(page, pin);
    await openUnlockedDocument(page, '/patients/new', pin);
    const panel = page.getByTestId('dossier-import');
    const group = panel.getByTestId('dossier-group');
    const cases: Array<{ name: string; files: Array<{ name: string; bytes: number[] }>; identity: string }> = [
        { name: 'due-codici', files: [{ name: 'lettera.pdf', bytes: await letterPdf(taxCode) }, { name: 'esami-altro.pdf', bytes: await labPdf(other) }], identity: 'mixed' },
        { name: 'omocodia', files: [{ name: 'lettera.pdf', bytes: await letterPdf(taxCode) }, { name: 'esami.pdf', bytes: await labPdf(omocodicVariant(taxCode)) }], identity: 'mixed' },
    ];
    for (const item of cases) {
        await dropFiles(dropZone(page), item.files);
        await expect(group).toHaveAttribute('data-identity', item.identity, { timeout: 120_000 });
        await expect(group.getByTestId('dossier-identity')).toHaveAttribute('role', 'alert');
        await expect(group.getByTestId('dossier-new-patient')).toHaveCount(0);
        await expect(group.getByRole('button', { name: /^Salva .* nella scheda$/u })).toBeDisabled();
        await expect(page.locator('#dati')).toBeVisible();
        await capture(info, page, `fermo-${item.name}.png`);
        await panel.getByRole('button', { name: 'Scegli altri documenti' }).click();
    }

    const existing = await page.evaluate(async (code) => {
        const response = await fetch('/api/patients', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ firstName: 'Elena', lastName: 'Sintetica', taxCode: code, birthDate: '1950-02-03T00:00:00.000Z', diagnoses: [] }) });
        return (await response.json() as { id: string }).id;
    }, taxCode);
    await openUnlockedDocument(page, '/patients/new', pin);
    await dropFiles(dropZone(page), [{ name: 'lettera.pdf', bytes: await letterPdf(taxCode) }]);
    await expect(group).toHaveAttribute('data-identity', /^(suggested|matched)$/u, { timeout: 120_000 });
    await expect(group.getByLabel('Scheda di destinazione')).toHaveValue(existing);
    await expect(group.getByTestId('dossier-new-patient').getByTestId('patient-document-create')).toHaveCount(0);
    await capture(info, page, 'scheda-esistente.png');
    expect(await countOf(page, 'attachments', existing)).toBe(0);
});
