/* @Codex */
import { expect, test } from '@playwright/test';

import { bootstrapUnlockedSession, waitForUnlockedInteractiveShell } from './utils';

const SYNTHETIC_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9X8gAAAABJRU5ErkJggg==',
  'base64',
);

test('document import fails closed until the source is a saved AnyDoc attachment', async ({ page }) => {
  const forbiddenRequests: string[] = [];
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname;
    if (
      pathname === '/api/ocr/extract'
      || pathname.startsWith('/api/ai/document-synthesis/')
      || pathname === '/api/proxy/ollama/chat'
    ) {
      forbiddenRequests.push(`${request.method()} ${pathname}`);
    }
  });

  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  await page.goto('/patients/new');
  await waitForUnlockedInteractiveShell(page);

  await page.getByLabel('Seleziona documento per revisione').setInputFiles({
    name: 'documento-pre-scheda-sintetico.png',
    mimeType: 'image/png',
    buffer: SYNTHETIC_PNG,
  });

  const reviewBoundary = page.getByRole('status');
  await expect(reviewBoundary).toContainText('Revisione documentale richiesta');
  await expect(reviewBoundary).toContainText('unsupported_local_extraction');
  await expect(reviewBoundary).toContainText('salvato come allegato host-owned');
  await expect(reviewBoundary).toContainText('avvia AnyDoc manualmente');
  await expect(page.getByRole('heading', { name: 'Nuova scheda' })).toBeVisible();
  expect(forbiddenRequests).toEqual([]);
});
