/* Assetto territoriale (ADR 0158, 0177) cambiato dall'interfaccia di Impostazioni, come farebbe il titolare. */
import { expect, type Page } from '@playwright/test';
import { documentRequests } from './trusted-web-request';

export const TERRITORIAL_PRESET_LABELS = { core: 'Nucleo internazionale', 'core+it': 'Italia', 'core+it+lom': 'Italia e Lombardia' } as const;
export type TerritorialPreset = keyof typeof TERRITORIAL_PRESET_LABELS;

export async function currentPreset(page: Page): Promise<string> {
  const response = await documentRequests(page).get('/api/system/territorial-packs');
  expect(response.status()).toBe(200);
  const capability = await response.json();
  expect(capability.status).toBe('ready');
  return capability.preset;
}

async function applyPreset(page: Page, label: string) {
  if (new URL(page.url()).pathname !== '/settings/profilo') {
    const profile = page.getByRole('link', { name: 'Profilo', exact: true });
    if (!await profile.isVisible()) await page.locator('a[href="/settings"]:visible').first().click();
    await profile.click();
  }
  await page.getByRole('button', { name: 'Personalizzazione territoriale', exact: true }).click();
  await page.getByRole('radio', { name: new RegExp(`^${label}( \\(attivo\\))?(?! e )`, 'u') }).check();
  await page.getByRole('button', { name: 'Applica assetto', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cambia assetto', exact: true }).click();
  await expect(page.getByText(`Assetto attivo: ${label}.`, { exact: true })).toBeVisible();
}

export async function switchPreset(page: Page, preset: TerritorialPreset) {
  if (await currentPreset(page) !== preset) await applyPreset(page, TERRITORIAL_PRESET_LABELS[preset]);
  expect(await currentPreset(page)).toBe(preset);
}
