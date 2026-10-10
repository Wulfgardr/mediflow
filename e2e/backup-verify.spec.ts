/* WUL-730, criterio 6. Un backup creato non e' un backup verificato: la verifica
   passa per la rotta che non scrive e un file alterato viene dichiarato non
   valido. Il ripristino non viene mai avviato da questo test. */
import { expect, test } from '@playwright/test';
import { bootstrapUnlockedSession } from './utils';

test('un backup scaricato si verifica senza ripristinarlo e un file alterato viene rifiutato', async ({ page }) => {
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  await page.goto('/settings/backup');

  const outcome = page.getByTestId('backup-outcome');
  const verifyInput = page.getByTestId('backup-verify-input');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Scarica Backup' }).click();
  await download;
  await expect(outcome).toContainText('Backup creato');
  await expect(outcome).toContainText('Non è ancora verificato');

  const artifact = await (await page.request.get('/api/system/backup-restore')).text();
  await verifyInput.setInputFiles({ name: 'verifica.mediflow', mimeType: 'application/json', buffer: Buffer.from(artifact) });
  await expect(outcome).toContainText('Backup verificato');
  await expect(outcome).toContainText('Verificato non significa provato');

  const altered = JSON.parse(artifact) as { manifest: { checksum: string } };
  altered.manifest.checksum = '0'.repeat(64);
  await verifyInput.setInputFiles({ name: 'alterato.mediflow', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(altered)) });
  await expect(outcome).toContainText('Backup non valido');
  await expect(page.getByTestId('restore-confirmation-panel')).toHaveCount(0);
});
