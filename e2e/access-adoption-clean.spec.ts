import { expect, test } from '@playwright/test';
import { bootstrapUnlockedSession } from './utils';

test('a clean PIN archive adopts its passphrase and confirms cleanup again on unlock', async ({ page }) => {
  const passphrase = 'Frase sintetica per adozione U5';
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  await page.getByRole('complementary', { name: 'MediFlow', exact: true })
    .getByRole('link', { name: 'Impostazioni', exact: true }).click();
  await page.getByRole('link', { name: 'Accesso', exact: true }).click();
  await page.getByLabel('PIN attuale', { exact: true }).first().fill(process.env.E2E_PIN || '1234');
  await page.getByLabel('Nuova passphrase', { exact: true }).fill(passphrase);
  await page.getByLabel('Conferma nuova passphrase', { exact: true }).fill(passphrase);
  await page.getByRole('button', { name: 'Prepara il nuovo kit', exact: true }).click();
  const kit = page.getByTestId('recovery-kit');
  const download = page.waitForEvent('download');
  await kit.getByRole('button', { name: 'Scarica kit di recupero', exact: true }).click();
  await download;
  await kit.getByRole('checkbox').check();
  const adoption = page.waitForResponse(response => response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/api/auth/passphrase');
  await kit.getByRole('button', { name: 'Attiva la nuova passphrase', exact: true }).click();
  const adopted = await adoption;
  expect(adopted.status()).toBe(200);
  expect((await adopted.json()).earlierCopiesCleared).toBe(true);
  await expect(page.getByLabel('Passphrase', { exact: true })).toBeEnabled();
  const login = page.waitForResponse(response => response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/api/auth/login');
  await page.getByLabel('Passphrase', { exact: true }).fill(passphrase);
  await page.getByRole('button', { name: 'Sblocca', exact: true }).click();
  const unlocked = await login;
  expect(unlocked.status()).toBe(200);
  expect((await unlocked.json()).earlierCopiesCleared).toBe(true);
  await expect(page.getByLabel('MediFlow lock screen', { exact: true })).toHaveCount(0);
  await expect(page.getByTestId('pin-residue-notice')).toHaveCount(0);
  expect((await page.request.get('/api/patients')).status()).toBe(200);
});
