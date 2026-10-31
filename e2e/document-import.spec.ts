import { expect, test } from '@playwright/test';
import { randomBytes, randomUUID, webcrypto } from 'node:crypto';

import { openDocumentActions, bootstrapUnlockedSession, openPatientSection } from './utils';
import { trustedArchiveWebRequestHeaders } from './fixtures/trusted-web-request';

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
  const archiveHeaders = await trustedArchiveWebRequestHeaders(page);
  const marker = randomUUID();
  const patientResponse = await page.request.post('/api/patients', {
    headers: archiveHeaders,
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
  await openDocumentActions(page, attachmentName);
  await expect(page.getByRole('menuitem', { name: `Estrai testo localmente da ${attachmentName}` })).toBeVisible();
  expect(forbiddenRequests).toEqual([]);
});


test('reviewed attachment HTTP creates race without a second record', async ({ page }) => {
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  const headers = await trustedArchiveWebRequestHeaders(page);
  const patient = await page.request.post('/api/patients', { headers, data: {
    firstName: 'Collezione', lastName: 'Sintetica', taxCode: 'COL' + randomUUID().replaceAll('-', '').slice(0, 13),
  } });
  expect(patient.status()).toBe(201);
  const patientId = (await patient.json() as { id: string }).id;
  const key = await webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const seal = async (text: string) => {
    const iv = randomBytes(12);
    const bytes = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text));
    return 'ENC:' + iv.toString('base64') + ':' + Buffer.from(bytes).toString('base64');
  };
  const path = await seal('synthetic.txt');
  const data = { patientId, name: await seal('synthetic.txt'), path,
    data: await seal('data:text/plain;base64,dGVzdA=='), type: 'text/plain', size: 4, expectedCollection: [] };
  const responses = await Promise.all([0, 1].map(() => page.request.post('/api/attachments', { headers, data })));
  expect(responses.map(response => response.status()).sort()).toEqual([201, 409]);
  const listed = await page.request.get('/api/attachments?metadata=true', { headers });
  expect(listed.status()).toBe(200);
  const rows = (await listed.json() as Array<{ id: string; patientId: string; path: string; currentness: unknown }>).filter(row => row.patientId === patientId);
  expect(rows).toHaveLength(1);
  expect(rows[0].path).toBe(path);
  expect(rows[0].currentness).toMatchObject({ sourceRef: expect.stringMatching(/^[0-9a-f]{64}$/), revision: 1, freshnessEpoch: 1 });
});
