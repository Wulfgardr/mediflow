/* @Codex */
import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

import { bootstrapUnlockedSession, openPatientSection } from './utils';

const SYNTHETIC_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9X8gAAAABJRU5ErkJggg==',
  'base64',
);

test('document upload saves its source before any local extraction request', async ({ page }) => {
  const forbiddenRequests: string[] = [];
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname;
    if (
      pathname === '/api/ocr/extract'
      || pathname.startsWith('/api/ai/document-synthesis/')
      || pathname === '/api/proxy/ollama/chat'
      || pathname === '/api/icd/proxy'
    ) {
      forbiddenRequests.push(`${request.method()} ${pathname}`);
    }
  });

  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  const marker = randomUUID();
  const patientResponse = await page.request.post('/api/patients', {
    data: {
      firstName: 'Documento', lastName: 'Pre Scheda',
      taxCode: `DOC${marker.replaceAll('-', '').slice(0, 13)}`,
      birthDate: '1975-01-01T00:00:00.000Z', diagnoses: [],
    },
  });
  expect(patientResponse.ok()).toBe(true);
  const patientId = (await patientResponse.json() as { id: string }).id;
  const attachmentName = 'documento-pre-scheda-sintetico.png';
  await page.goto(`/patients/${patientId}/modules`);
  await openPatientSection(page, 'documenti');
  const saved = page.waitForResponse((response) => (
    response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/attachments'
  ));
  await page.locator('#documenti input[type="file"]').setInputFiles({
    name: attachmentName, mimeType: 'image/png', buffer: SYNTHETIC_PNG,
  });
  expect((await saved).ok()).toBe(true);
  await expect(page.getByRole('button', { name: `Estrai testo localmente da ${attachmentName}` })).toBeVisible();
  expect(forbiddenRequests).toEqual([]);
});
