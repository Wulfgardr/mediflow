import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { bancoPaths, readBancoReference } from './banco-paths.mjs';
import { openPatientSection, unlockIfNeeded, isVisible } from '../../e2e/utils';
const paths = bancoPaths();
const output = process.env.MF_BANCO_CAPTURES || process.env.MF_BANCO_CAPTURE_DIR || (paths.needsContainer
  ? join(homedir(), 'Antigravity', 'mf-ui-identita-20261107', 'web')
  : join(paths.scratch, 'web'));

test.beforeEach(async ({ page }, info) => {
  const theme = info.project.name.startsWith('giorno') ? 'light' : 'dark';
  await page.addInitScript(t => localStorage.setItem('mediflow-theme', t), theme);
});

test('sequenza canonica 01-07', async ({ page }, info) => {
  const { referenceId, emptyId } = readBancoReference(paths);
  fs.mkdirSync(output, { recursive: true });
  const theme = info.project.name.startsWith('giorno') ? 'light' : 'dark';
  const capture = async (name: string) => {
    await expect(page.locator('html')).toHaveClass(new RegExp(theme));
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${output}/${name}-${info.project.name}.png`, fullPage: false, animations: 'disabled' });
  };
  const navigate = async (url: string) => {
    await page.goto(url);
    if (await isVisible(page.getByLabel('PIN operatore').first(), 2500)) await unlockIfNeeded(page, '314159');
    await expect(page.getByLabel('MediFlow lock screen')).toBeHidden();
  };
  await navigate('/?area=incarico');
  await expect(page.getByText('Rossi Sintetica Maria', { exact: true }).first()).toBeVisible();
  await capture('01-elenco');
  await navigate(`/patients/${referenceId}/modules`);
  await expect(page.getByText('Rossi Sintetica Maria', { exact: true }).first()).toBeVisible();
  await capture('02-scheda');
  await openPatientSection(page, 'diario');
  await expect(page.locator('#diario')).toContainText('Pressione 132/78');
  await capture('03-diario');
  await navigate(`/patients/${referenceId}/modules?voce=nuova`);
  const editor = page.locator('[contenteditable="true"]').first();
  await expect(editor).toBeVisible();
  await editor.fill('Nota sintetica in preparazione: controllo clinico programmato.');
  await capture('04-nuova-voce');
  await navigate('/settings');
  await expect(page.getByRole('heading').first()).toBeVisible();
  await capture('05-impostazioni');
  await navigate(`/patients/${emptyId}/modules`);
  await openPatientSection(page, 'diario');
  await expect(page.locator('#diario')).toContainText(/Nessun|Non ci sono|vuoto/i);
  await capture('06-vuoto');
  await page.route('**/api/patients/synthetic-nonexistent-patient**', route => route.abort('connectionrefused'));
  await navigate('/patients/synthetic-nonexistent-patient/modules');
  await expect(page.getByText(/Impossibile leggere la scheda paziente/i).first()).toBeVisible();
  await capture('07-errore');
});


test('allergie: pillola dal campo strutturato e modifica della scheda', async ({ page }, info) => {
  const { referenceId, emptyId } = readBancoReference(paths);
  await page.goto(`/patients/${referenceId}/modules`);
  if (await isVisible(page.getByLabel('PIN operatore').first(), 2500)) await unlockIfNeeded(page, '314159');
  await expect(page.getByRole('list', { name: 'Allergie', exact: true })).toContainText('Amoxicillina');
  await expect(page.getByRole('list', { name: 'Allergie', exact: true })).toContainText('▲');
  fs.mkdirSync(output, { recursive: true });
  await page.screenshot({ path: join(output, `08-allergia-strutturata-${info.project.name}.png`), animations: 'disabled' });
  await page.goto(`/patients/${emptyId}/modules`);
  await expect(page.getByText('Allergie: nessuna registrata', { exact: true })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Allergie', exact: true })).toHaveCount(0);
  await page.goto(`/patients/${emptyId}/edit`);
  await page.getByRole('button', { name: 'Aggiungi allergia', exact: true }).click();
  await page.getByLabel('Sostanza *', { exact: true }).fill('Lattice sintetico');
  await page.getByLabel('Reazione', { exact: true }).fill('Orticaria sintetica');
  await page.getByLabel('Gravità della reazione', { exact: true }).selectOption('moderate');
  await page.getByRole('button', { name: 'Aggiorna scheda', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/patients/${emptyId}/modules`));
  await expect(page.getByRole('list', { name: 'Allergie', exact: true })).toContainText('Lattice sintetico');
  await page.goto(`/patients/${emptyId}/edit`);
  await expect(page.getByLabel('Sostanza *', { exact: true })).toHaveValue('Lattice sintetico');
  await expect(page.getByLabel('Reazione', { exact: true })).toHaveValue('Orticaria sintetica');
  const severity = page.getByLabel('Gravità della reazione', { exact: true });
  await expect(severity).toHaveValue('moderate');
  await severity.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(output, `09-allergia-persistita-${info.project.name}.png`), animations: 'disabled' });
  await page.getByLabel('Sostanza *', { exact: true }).fill('Nichel sintetico');
  await page.getByRole('button', { name: 'Aggiorna scheda', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/patients/${emptyId}/modules`));
  await expect(page.getByRole('list', { name: 'Allergie', exact: true })).toContainText('Nichel sintetico');
  await page.goto(`/patients/${emptyId}/edit`);
  await page.getByRole('button', { name: 'Rimuovi allergia 1', exact: true }).click();
  await page.getByRole('button', { name: 'Aggiorna scheda', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/patients/${emptyId}/modules`));
  await expect(page.getByText('Allergie: nessuna registrata', { exact: true })).toBeVisible();
});
