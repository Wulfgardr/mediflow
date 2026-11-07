/* J-2 e J-4 (ADR 0177): il nucleo senza Lombardia, provato nel browser su un runtime isolato. */
import { test, expect } from './fixtures/isolated-runtime';
import { bootstrapUnlockedSession, openPatientSection } from './utils';
import { trustedArchiveWebRequestHeaders } from './fixtures/trusted-web-request';
import Database from 'better-sqlite3';
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { Page } from '@playwright/test';

const PACKS = 'territorial.packs';

function seedPreset(dataDirectory: string, preset: 'core' | 'core+it' | 'core+it+lom') {
  const db = new Database(join(dataDirectory, 'medical.db'), { fileMustExist: true });
  try {
    const setting = db.prepare('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
    setting.run(PACKS, JSON.stringify({ schemaVersion: 'mediflow.territorial-packs.v1', revision: 1, preset }));
    setting.run('territorial.packs.initialization', 'synthetic');
  } finally { db.close(); }
}

async function createPatient(page: Page, firstName: string, taxCode: string): Promise<string> {
  return page.evaluate(async ({ firstName, taxCode }) => {
    const response = await fetch('/api/patients', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ firstName, lastName: 'Nucleo', taxCode, birthDate: '1980-01-01T00:00:00.000Z', diagnoses: [] }) });
    if (!response.ok) throw new Error(`Synthetic patient: HTTP ${response.status}`);
    return (await response.json() as { id: string }).id;
  }, { firstName, taxCode });
}

async function applyPreset(page: Page, label: string) {
  await page.goto('/settings/profilo');
  await page.getByRole('radio', { name: new RegExp(`^${label}`, 'u') }).check();
  await page.getByRole('button', { name: 'Applica assetto', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cambia assetto', exact: true }).click();
  await expect(page.getByText(`Assetto attivo: ${label}.`, { exact: true })).toBeVisible();
}

test('J-2: con il solo nucleo SISS, portali e PRREG spariscono dalla scheda e i writer si fermano; riattivando la Lombardia tornano', async ({ page, isolatedRuntime }, info) => {
  test.setTimeout(180_000);
  const evidence = process.env.TERRITORIAL_EVIDENCE_DIR || info.outputPath('territoriale');
  mkdirSync(evidence, { recursive: true });
  await bootstrapUnlockedSession(page, '314159');
  seedPreset(isolatedRuntime.dataDirectory, 'core+it+lom');
  const patientId = await createPatient(page, 'Lombardia', 'LMBNCL80A01H501K');
  const scheda = async () => {
    await page.goto(`/patients/${patientId}/modules`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  };

  await scheda();
  await expect(page.locator('#siss')).toHaveCount(1);
  await page.screenshot({ path: join(evidence, 'lombardia.png'), fullPage: true });

  await applyPreset(page, 'Nucleo internazionale');
  await scheda();
  await expect(page.locator('#siss')).toHaveCount(0);
  await expect(page.locator('[href="#siss"]')).toHaveCount(0);
  await expect(page.getByText('SISS e FSE', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: join(evidence, 'nucleo.png'), fullPage: true });

  const headers = await trustedArchiveWebRequestHeaders(page);
  const writers: unknown[] = [];
  for (const path of ['/api/siss/context', '/api/siss/prescription']) {
    const response = await page.request.post(path, { headers, data: { patientId } });
    expect(response.status()).toBe(403);
    expect(await response.json()).toEqual({ code: 'TERRITORIAL_PACK_DISABLED', error: 'Pacchetto Lombardia non attivo' });
    writers.push({ path, status: 403 });
  }

  await applyPreset(page, 'Italia e Lombardia');
  await scheda();
  await expect(page.locator('#siss')).toHaveCount(1);
  writeFileSync(join(evidence, 'writer-nucleo.json'), JSON.stringify(writers, null, 2));
});

test('J-4: con il solo nucleo la protesica chiede un prontuario con fonte dichiarata, poi registra la voce', async ({ page, isolatedRuntime }, info) => {
  test.setTimeout(180_000);
  const evidence = process.env.TERRITORIAL_EVIDENCE_DIR || info.outputPath('protesica-nucleo');
  mkdirSync(evidence, { recursive: true });
  await bootstrapUnlockedSession(page, '314159');
  seedPreset(isolatedRuntime.dataDirectory, 'core');
  const patientId = await createPatient(page, 'Protesica', 'PRTNCL80A01H501Q');
  const name = 'Deambulatore sintetico J4';
  const db = new Database(join(isolatedRuntime.dataDirectory, 'medical.db'), { fileMustExist: true });
  try {
    await page.goto(`/patients/${patientId}/modules`); await openPatientSection(page, 'protesica');
    const pane = page.locator('#protesica');
    await pane.getByRole('button', { name: /^Nuova voce(?: protesica)?$/u }).click();
    await pane.getByLabel('Descrizione ausilio').fill(name);
    await pane.getByRole('button', { name: 'Salva voce', exact: true }).click();
    const refusal = pane.getByRole('alert');
    await expect(refusal).toHaveText('Carica un prontuario protesico con fonte dichiarata nei Repertori prima di registrare prescrizioni di ausili.');
    await expect(pane.getByText(/Failed to add item|PROSTHETICS_CATALOG_REQUIRED/u)).toHaveCount(0);
    await page.screenshot({ path: join(evidence, 'senza-prontuario.png'), fullPage: true });
    expect(db.prepare('SELECT COUNT(*) FROM prosthetic_prescriptions WHERE patient_id=?').pluck().get(patientId)).toBe(0);

    const source = await page.evaluate(async (name) => {
      const sourceName = `Fonte J4 sintetica ${crypto.randomUUID().slice(0, 8)}`;
      const csv = `codice_sistema,codice,descrizione,versione,fonte,ambito,data_inizio,data_fine\nSistema inventato,J4-SYNTH,${name},v1,${sourceName},Dimostrazione,,\n`;
      const body = { sourceName: 'j4-repertorio-sintetico.csv', base64: btoa(csv) };
      const post = async (path: string, payload: unknown) => {
        const response = await fetch(`/api/prosthetics/catalog/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
        const value = await response.json(); if (!response.ok) throw new Error(`Synthetic catalog ${path}: ${response.status} ${JSON.stringify(value)}`); return value;
      };
      const preview = await post('preview', body);
      await post('commit', { ...body, proof: preview.proof, acceptSubset: true });
      const sources = await (await fetch('/api/prosthetics/catalog/sources')).json();
      return sources.sources.find((row: { name: string }) => row.name === sourceName) as { id: string; name: string };
    }, name);

    await page.reload(); await openPatientSection(page, 'protesica');
    await pane.getByRole('button', { name: /^Nuova voce(?: protesica)?$/u }).click();
    await pane.getByRole('button', { name: 'Cerca un ausilio nel repertorio', exact: true }).click();
    await pane.getByRole('combobox', { name: 'Fonte', exact: true }).selectOption(source.id);
    await pane.getByLabel('Codice, descrizione o codifica', { exact: true }).fill('J4-SYNTH');
    await pane.getByRole('button', { name: 'Cerca nel repertorio', exact: true }).click();
    await pane.getByRole('button', { name: 'Usa voce nella bozza', exact: true }).click();
    await expect(pane.getByLabel('Descrizione ausilio')).toHaveValue(name);
    await pane.getByRole('button', { name: 'Salva voce', exact: true }).click();
    const row = pane.getByRole('row').filter({ has: page.locator('td > strong').filter({ hasText: name }) });
    await expect(row).toBeVisible();
    await expect(row).toContainText(`Fonte: ${source.name} · v1`);
    await page.screenshot({ path: join(evidence, 'con-prontuario.png'), fullPage: true });
    expect(db.prepare('SELECT COUNT(*) FROM prosthetic_prescriptions WHERE patient_id=?').pluck().get(patientId)).toBe(1);
  } finally { db.close(); }
});
