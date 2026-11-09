/* J-2 e J-4 (ADR 0177): il nucleo senza Lombardia, provato nel browser su un runtime isolato. */
import { test, expect } from './fixtures/isolated-runtime';
import { bootstrapUnlockedSession, openPatientSection } from './utils';
import { trustedArchiveWebRequestHeaders } from './fixtures/trusted-web-request';
import { switchPreset } from './fixtures/territorial-preset';
import Database from 'better-sqlite3';
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { Page } from '@playwright/test';

async function createPatient(page: Page, firstName: string, taxCode: string): Promise<string> {
  return page.evaluate(async ({ firstName, taxCode }) => {
    const response = await fetch('/api/patients', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ firstName, lastName: 'Nucleo', taxCode, birthDate: '1980-01-01T00:00:00.000Z', diagnoses: [] }) });
    if (!response.ok) throw new Error(`Synthetic patient: HTTP ${response.status}`);
    return (await response.json() as { id: string }).id;
  }, { firstName, taxCode });
}

const SYNTHETIC_SISS_SESSION = { status: 'unavailable', source: 'synthetic', checkedAt: '2026-11-09T10:00:00Z', browserProfile: null,
  warning: 'Stato sintetico: nessuna osservazione reale.', sessionHealth: 'none', lastModule: null, lastModuleLabel: null, lastModuleAt: null, checkpoints: [] };

test('J-2: con il solo nucleo SISS, portali e PRREG spariscono dalla scheda e i writer si fermano; lo storico resta e torna con la Lombardia', async ({ page, isolatedRuntime }, info) => {
  test.setTimeout(240_000);
  const evidence = process.env.TERRITORIAL_EVIDENCE_DIR || info.outputPath('territoriale');
  mkdirSync(evidence, { recursive: true });
  // Lo stato della sessione SISS legge la cronologia del browser dell'host: qui resta sintetico.
  await page.route('**/api/siss/session-status', route => route.fulfill({ json: SYNTHETIC_SISS_SESSION }));
  await bootstrapUnlockedSession(page, '314159');
  await switchPreset(page, 'core+it+lom');
  const patientId = await createPatient(page, 'Lombardia', 'LMBNCL80A01H501K');
  const navigation = page.getByRole('navigation', { name: 'Sezioni della vista', exact: true });
  const pane = page.locator('#siss');
  const scheda = async () => {
    await page.goto(`/patients/${patientId}/modules`);
    await expect(navigation).toBeVisible();
  };
  const reason = 'Passaggio sintetico J-2 da conservare';
  const handoffRow = pane.locator('[data-siss-handoff-id]').filter({ hasText: 'Anagrafe' });
  const openDiary = async () => {
    const diary = pane.getByRole('button', { name: /^Diario locale dei passaggi/u });
    if (await diary.getAttribute('aria-expanded') !== 'true') await diary.click();
  };
  const archived = async () => {
    const response = await page.request.get(`/api/siss-handoffs?patientId=${patientId}`);
    expect(response.status()).toBe(200);
    return await response.json() as { id: string; action: string; outcome: string }[];
  };
  const db = new Database(join(isolatedRuntime.dataDirectory, 'medical.db'), { fileMustExist: true });
  try {
    await scheda();
    await openPatientSection(page, 'siss');
    await expect(pane).toContainText('SISS e FSE');
    // Superfici lombarde presenti: le stesse che con il solo nucleo devono sparire.
    await expect(pane.getByRole('region', { name: 'Passaggio al portale regionale', exact: true }), 'J-2 portali presenti con Lombardia').toBeVisible();
    await expect(pane.getByRole('button', { name: 'Apri Prescrittivo Regionale (PRREG), fuori da MediFlow', exact: true }), 'J-2 PRREG presente con Lombardia').toBeVisible();

    // Un passaggio registrato dalla UI con il modulo lombardo attivo.
    await openDiary();
    await pane.getByRole('button', { name: 'Registra passaggio', exact: true }).first().click();
    const form = pane.getByRole('form', { name: 'Registra passaggio locale', exact: true });
    await form.getByLabel('Perché ho aperto il portale', { exact: true }).fill(reason);
    await form.getByRole('button', { name: 'Salva voce', exact: true }).click();
    await expect(handoffRow).toBeVisible();
    const seeded = await archived();
    expect(seeded).toHaveLength(1);
    const handoffId = seeded[0].id;
    await expect(handoffRow).toHaveAttribute('data-siss-handoff-id', handoffId);
    await page.screenshot({ path: join(evidence, 'lombardia.png'), fullPage: true });

    await switchPreset(page, 'core');
    await scheda();
    await navigation.getByRole('button', { name: 'Altro', exact: true }).click();
    await expect(navigation.locator('a[href="#protesica"]')).toBeVisible();
    await expect(navigation.locator('a[href="#siss"]'), 'J-2 SISS assente dalla navigazione con il solo nucleo').toHaveCount(0);
    await page.screenshot({ path: join(evidence, 'nucleo.png'), fullPage: true });
    await page.goto(`/patients/${patientId}/modules#siss`);
    await expect(navigation).toBeVisible();
    await expect(pane, 'J-2 sezione SISS assente con il solo nucleo').toHaveCount(0);
    await expect(page.getByText('SISS e FSE', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Passaggio al portale regionale', exact: true }), 'J-2 portali assenti con il solo nucleo').toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Apri (FSE|Anagrafe|Menu SISS|Protesica-RL), fuori da MediFlow$/u }), 'J-2 aperture dei portali assenti con il solo nucleo').toHaveCount(0);
    await expect(page.getByText(/Prescrittivo Regionale \(PRREG\)/u), 'J-2 PRREG assente con il solo nucleo').toHaveCount(0);
    await expect(page.locator(`[data-siss-handoff-id="${handoffId}"]`)).toHaveCount(0);

    // Lo storico resta nell'archivio: rilettura via API e nel database del runtime isolato.
    expect((await archived()).map(row => row.id), 'J-2 storico conservato con il solo nucleo (API)').toEqual([handoffId]);
    expect(db.prepare('SELECT id FROM siss_handoff_events WHERE patient_id=?').pluck().all(patientId), 'J-2 storico conservato con il solo nucleo (database)').toEqual([handoffId]);

    const headers = await trustedArchiveWebRequestHeaders(page);
    const writers: unknown[] = [];
    for (const [path, data] of [
      ['/api/siss/context', { patientId }],
      ['/api/siss/prescription', { patientId }],
      ['/api/siss-handoffs', { patientId, action: 'registry.lookup', outcome: 'completed' }],
    ] as const) {
      const response = await page.request.post(path, { headers, data });
      expect(response.status()).toBe(403);
      expect(await response.json()).toEqual({ code: 'TERRITORIAL_PACK_DISABLED', error: 'Pacchetto Lombardia non attivo' });
      writers.push({ path, status: 403 });
    }
    expect(db.prepare('SELECT COUNT(*) FROM siss_handoff_events WHERE patient_id=?').pluck().get(patientId)).toBe(1);

    await switchPreset(page, 'core+it+lom');
    await scheda();
    await openPatientSection(page, 'siss');
    await expect(pane).toContainText('SISS e FSE');
    await openDiary();
    await expect(handoffRow, 'J-2 passaggio di nuovo visibile al ritorno della Lombardia').toHaveAttribute('data-siss-handoff-id', handoffId);
    await handoffRow.getByRole('button', { name: 'Dettagli del passaggio', exact: true }).click();
    await expect(handoffRow).toContainText(reason);
    await page.screenshot({ path: join(evidence, 'ritorno-lombardia.png'), fullPage: true });
    writeFileSync(join(evidence, 'writer-nucleo.json'), JSON.stringify({ writers, handoffId }, null, 2));
  } finally { db.close(); }
});

test('J-4: con il solo nucleo la protesica chiede un prontuario con fonte dichiarata, poi registra la voce', async ({ page, isolatedRuntime }, info) => {
  test.setTimeout(180_000);
  const evidence = process.env.TERRITORIAL_EVIDENCE_DIR || info.outputPath('protesica-nucleo');
  mkdirSync(evidence, { recursive: true });
  await bootstrapUnlockedSession(page, '314159');
  await switchPreset(page, 'core');
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
