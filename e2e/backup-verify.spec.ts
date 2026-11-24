import { expect, test } from '@playwright/test';
import { documentRequests } from './fixtures/trusted-web-request';
import { unlockIfNeeded, bootstrapUnlockedSession } from './utils';

test('un backup scaricato si verifica senza ripristinarlo e un file alterato viene rifiutato', async ({ page }) => {
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  await page.goto('/settings/backup'); await unlockIfNeeded(page, process.env.E2E_PIN || '1234');

  const outcome = page.getByTestId('backup-outcome');
  const verifyInput = page.getByTestId('backup-verify-input');
  const exportButton = page.getByRole('button', { name: 'Scarica Backup' });
  await expect(exportButton).toBeDisabled();
  await page.getByRole('checkbox', { name: /Il file portabile contiene categorie leggibili in chiaro/ }).check();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Scarica Backup' }).click();
  await download;
  await expect(outcome).toContainText('Backup creato');
  await expect(outcome).toContainText('Non è ancora verificato');

  const artifact = await (await documentRequests(page).get('/api/system/backup-restore')).text();
  await verifyInput.setInputFiles({ name: 'verifica.mediflow', mimeType: 'application/json', buffer: Buffer.from(artifact) });
  await expect(outcome).toContainText('Backup verificato');
  await expect(outcome).toContainText('Verificato non significa provato');

  const altered = JSON.parse(artifact) as { manifest: { checksum: string } };
  altered.manifest.checksum = '0'.repeat(64);
  await verifyInput.setInputFiles({ name: 'alterato.mediflow', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(altered)) });
  await expect(outcome).toContainText('Backup non valido');
  await expect(page.getByTestId('restore-confirmation-panel')).toHaveCount(0);
});
