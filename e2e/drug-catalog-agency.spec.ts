/* J-3 (ADR 0177): catalogo farmaci di un'altra agenzia dal browser, ritorno ad AIFA, terapie salvate con i codici invariati. */
import { test, expect } from './fixtures/isolated-runtime';
import { bootstrapUnlockedSession, openPatientSection } from './utils';
import Database from 'better-sqlite3';
import { join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { Page } from '@playwright/test';

// Feed AIFA inventato: tre confezioni valide e una riga scartata.
const AIFA_CSV = readFileSync(join(__dirname, '../scripts/fixtures/aifa-confezioni-synthetic.csv'));
// Catalogo di un'agenzia inventata, con intestazioni che non coincidono con i nomi attesi: le colonne si associano a mano.
const AGENCY_CSV = Buffer.from([
  'Identificativo;Prodotto;Sostanza;Classe terapeutica;Nota interna',
  'AGX-0001;PASTIGLIA INVENTATA;Sostanza inventata;N02BE01;nessuna',
  'AGX-0002;SCIROPPO INVENTATO;Altra sostanza;R05CB01;nessuna',
  'AGX-0003;CREMA INVENTATA;Terza sostanza;D07AA02;nessuna',
  ';;Riga senza codice;;scartata',
].join('\n') + '\n', 'utf8');
const AGENCY = 'Agenzia inventata J3';

type TherapyCodes = { id: string; drug_name: string; aic: string | null; atc: string | null };

async function openRepertori(page: Page, panel: RegExp) {
  await page.goto('/settings/repertori');
  const toggle = page.getByRole('button', { name: panel });
  await expect(toggle).toBeVisible();
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
}

async function importAifa(page: Page, version: string) {
  await openRepertori(page, /^Farmaci AIFA/u);
  const aifa = page.getByTestId('aifa-catalog-guide');
  const manual = aifa.getByRole('button', { name: 'Carica un CSV già scaricato', exact: true });
  if (await manual.getAttribute('aria-expanded') !== 'true') await manual.click();
  await aifa.getByLabel('Versione dataset (caricamento manuale)').fill(version);
  await aifa.getByLabel('Data di scarico').fill('2026-11-01');
  await aifa.getByLabel('Carica file CSV AIFA').setInputFiles({ name: 'aifa-sintetico.csv', mimeType: 'text/csv', buffer: AIFA_CSV });
  await page.getByRole('dialog').getByRole('button', { name: 'Importa', exact: true }).click();
  await expect(aifa.getByText('Ultimo catalogo osservato', { exact: true })).toBeVisible();
  await expect(aifa.getByText(`Versione di acquisizione: ${version}`)).toHaveCount(1);
}

async function saveTherapyFromCatalog(page: Page, patientId: string, query: string, drugName: string) {
  await page.goto(`/patients/${patientId}/modules`);
  await openPatientSection(page, 'terapie');
  const pane = page.locator('#terapie');
  await pane.getByRole('button', { name: 'Nuova terapia', exact: true }).click();
  await page.locator(`#therapy-drug-${patientId}`).fill(query);
  await page.getByRole('option', { name: `Seleziona ${drugName}`, exact: true }).click();
  await page.locator(`#therapy-dosage-${patientId}`).fill('1 compressa al mattino');
  await pane.getByRole('button', { name: 'Salva terapia', exact: true }).click();
  await expect(pane.getByRole('row').filter({ hasText: drugName })).toBeVisible();
}

test('J-3: catalogo di un’altra agenzia con fonte, colonne, anteprima e conferma; ritorno ad AIFA con le terapie salvate invariate', async ({ page, isolatedRuntime }, info) => {
  test.setTimeout(240_000);
  const evidence = process.env.DRUG_CATALOG_EVIDENCE_DIR || info.outputPath('catalogo-farmaci');
  mkdirSync(evidence, { recursive: true });
  await bootstrapUnlockedSession(page, '314159');
  const patientId = await page.evaluate(async () => {
    const response = await fetch('/api/patients', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ firstName: 'Catalogo', lastName: 'Agenzia', taxCode: 'CTLGNZ80A01H501W', birthDate: '1980-01-01T00:00:00.000Z', diagnoses: [] }) });
    if (!response.ok) throw new Error(`Synthetic patient: HTTP ${response.status}`);
    return (await response.json() as { id: string }).id;
  });
  const status = async () => {
    const response = await page.request.get('/api/drugs?count=1');
    expect(response.status()).toBe(200);
    return await response.json() as { count: number; state: string; manifest: { version: string } | null; source?: { kind: string; agency: string; codeSystem: string; version: string } };
  };
  const db = new Database(join(isolatedRuntime.dataDirectory, 'medical.db'), { fileMustExist: true });
  const therapies = () => db.prepare('SELECT id, drug_name, aic, atc FROM therapies WHERE patient_id=? ORDER BY drug_name').all(patientId) as TherapyCodes[];
  try {
    // 1. Catalogo AIFA (inventato) e una terapia scelta da lì.
    await importAifa(page, 'Feed sintetico J3 uno');
    expect(await status()).toMatchObject({ count: 3, state: 'ready', manifest: { version: 'Feed sintetico J3 uno' } });
    await saveTherapyFromCatalog(page, patientId, 'ACIDO', 'ACIDO SINTETICO');
    const aifaTherapy = therapies();
    expect(aifaTherapy).toEqual([expect.objectContaining({ drug_name: 'ACIDO SINTETICO', aic: '000000101', atc: 'B01AC06' })]);

    // 2. Catalogo di un'altra agenzia: fonte, file, colonne, anteprima, conferma.
    await openRepertori(page, /^Farmaci da un’altra agenzia/u);
    const panel = page.getByRole('region', { name: 'Catalogo farmaci di un’altra agenzia', exact: true });
    await panel.getByLabel('Agenzia o ente').fill(AGENCY);
    await panel.getByLabel('Codifica dei farmaci').fill('AGX');
    await panel.getByLabel('Versione').fill('2026.1');
    await panel.getByLabel('Data del catalogo').fill('2026-10-15');
    await panel.getByLabel('URL della fonte (facoltativo)').fill('https://example.invalid/agenzia-inventata.csv');
    await panel.getByLabel('File del catalogo (.csv, UTF-8)').setInputFiles({ name: 'agenzia-inventata.csv', mimeType: 'text/csv', buffer: AGENCY_CSV });
    const columns = panel.getByRole('group', { name: 'Associazione delle colonne', exact: true });
    await expect(columns).toContainText('Colonne di agenzia-inventata.csv');
    await expect(columns.getByLabel(/^Separatore/u)).toHaveValue(';');
    // Nessuna intestazione è riconosciuta: le obbligatorie restano da associare e l'anteprima è ferma.
    await expect(columns.getByLabel(/^Codice \(obbligatorio\)/u)).toHaveValue('');
    await expect(columns.getByRole('button', { name: 'Genera anteprima', exact: true })).toBeDisabled();
    await columns.getByLabel(/^Codice \(obbligatorio\)/u).selectOption({ label: 'Identificativo' });
    await columns.getByLabel(/^Denominazione \(obbligatorio\)/u).selectOption({ label: 'Prodotto' });
    await columns.getByLabel(/^Principio attivo/u).selectOption({ label: 'Sostanza' });
    await columns.getByLabel(/^ATC/u).selectOption({ label: 'Classe terapeutica' });
    await page.screenshot({ path: join(evidence, 'colonne.png'), fullPage: true });
    await columns.getByRole('button', { name: 'Genera anteprima', exact: true }).click();
    const preview = panel.getByLabel('Anteprima catalogo farmaci', { exact: true });
    await expect(preview).toContainText('3 voci importabili su 4 righe, 1 riga scartata.');
    await expect(preview).toContainText('Catalogo attuale: AIFA Feed sintetico J3 uno, 3 confezioni.');
    await expect(preview.getByRole('row').filter({ hasText: 'AGX-0001' })).toContainText('PASTIGLIA INVENTATA');
    await expect(preview.getByRole('row').filter({ hasText: 'AGX-0001' })).toContainText('N02BE01');
    const importButton = preview.getByRole('button', { name: 'Importa catalogo', exact: true });
    await expect(importButton).toBeDisabled();
    // Nulla è scritto finché l'anteprima non è confermata.
    expect((await status()).manifest?.version).toBe('Feed sintetico J3 uno');
    await page.screenshot({ path: join(evidence, 'anteprima.png'), fullPage: true });
    await preview.getByLabel('Ho controllato fonte, colonne e anteprima.').check();
    await importButton.click();
    await expect(panel.getByRole('status')).toHaveText(`Catalogo attivo: ${AGENCY}, AGX 2026.1, 3 voci.`);
    expect(await status()).toMatchObject({ count: 3, state: 'ready', manifest: null, source: { kind: 'file', agency: AGENCY, codeSystem: 'AGX', version: '2026.1' } });
    expect(therapies(), 'J-3 terapia AIFA invariata dopo il catalogo di un’altra agenzia').toEqual(aifaTherapy);
    await openRepertori(page, /^Farmaci AIFA/u);
    await expect(page.getByTestId('aifa-catalog-guide')).toContainText('Catalogo attivo da un’altra agenzia');
    await expect(page.getByTestId('aifa-catalog-guide')).toContainText(`${AGENCY} · AGX 2026.1 del 2026-10-15 · 3 voci`);

    // Con il catalogo dell'agenzia il codice resta nel catalogo e non diventa un AIC.
    await saveTherapyFromCatalog(page, patientId, 'PASTIGLIA', 'PASTIGLIA INVENTATA');
    const beforeReturn = therapies();
    expect(beforeReturn).toEqual([
      expect.objectContaining({ drug_name: 'ACIDO SINTETICO', aic: '000000101', atc: 'B01AC06' }),
      expect.objectContaining({ drug_name: 'PASTIGLIA INVENTATA', aic: '', atc: 'N02BE01' }),
    ]);

    // 3. Ritorno ad AIFA: il catalogo dell'agenzia è sostituito, le terapie no.
    await importAifa(page, 'Feed sintetico J3 due');
    const back = await status();
    expect(back).toMatchObject({ count: 3, state: 'ready', manifest: { version: 'Feed sintetico J3 due' } });
    expect(back.source).toBeUndefined();
    await expect(page.getByTestId('aifa-catalog-guide')).not.toContainText('Catalogo attivo da un’altra agenzia');
    expect(therapies(), 'J-3 terapie invariate dopo il ritorno ad AIFA').toEqual(beforeReturn);

    await page.goto(`/patients/${patientId}/modules`);
    await openPatientSection(page, 'terapie');
    const pane = page.locator('#terapie');
    await expect(pane.getByRole('row').filter({ hasText: 'ACIDO SINTETICO' })).toContainText('AIC 000000101');
    await expect(pane.getByRole('row').filter({ hasText: 'ACIDO SINTETICO' })).toContainText('ATC B01AC06');
    const agencyRow = pane.getByRole('row').filter({ hasText: 'PASTIGLIA INVENTATA' });
    await expect(agencyRow).toContainText('ATC N02BE01');
    await expect(agencyRow).not.toContainText('AIC');
    await page.screenshot({ path: join(evidence, 'terapie-dopo-ritorno.png'), fullPage: true });
    writeFileSync(join(evidence, 'terapie.json'), JSON.stringify({ aifaTherapy, beforeReturn, after: therapies() }, null, 2));
  } finally { db.close(); }
});
