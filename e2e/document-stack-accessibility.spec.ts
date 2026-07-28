/* @Codex */
import { expect, test, type Page } from '@playwright/test';
import { assertKeyboardFocusProgresses, assertNoHorizontalOverflow, bootstrapUnlockedSession } from './utils';

type SyntheticDocumentInsight = {
  id: string;
  date: string;
  fileName: string;
  rawMarkdown: string;
  summary: string;
  quality: { level: 'green' | 'yellow' | 'red'; reason: string };
  extractedData: {
    diagnoses: Array<{ system: 'ICD-11'; code: string; description: string; evidence: string; confidence: 'high' }>;
    medications: string[];
  };
};

const FIXTURE_PREFIX = 'Documento Evidence Stack sintetico';

function buildSyntheticInsights(marker: string): SyntheticDocumentInsight[] {
  return [
    {
      id: `evidence-${marker}-recent`,
      date: '2026-07-27T09:30:00.000Z',
      fileName: `${FIXTURE_PREFIX} recente ${marker}.pdf`,
      rawMarkdown: '# Documento sintetico\nNessun dato reale.',
      summary: 'Sintesi sintetica per verificare il rendering, la revisione esplicita e la curation locale.',
      quality: { level: 'green', reason: 'Fixture sintetica con provenienza dichiarata.' },
      extractedData: {
        diagnoses: [{ system: 'ICD-11', code: 'XS00', description: 'Riscontro sintetico di test', evidence: 'Fixture locale', confidence: 'high' }],
        medications: ['Terapia sintetica di test'],
      },
    },
    {
      id: `evidence-${marker}-review`,
      date: '2026-07-21T09:30:00.000Z',
      fileName: `${FIXTURE_PREFIX} da rivedere ${marker}.pdf`,
      rawMarkdown: '# Documento sintetico\nNessun dato reale.',
      summary: 'Seconda sintesi sintetica, deliberatamente distinta per provare rimozione e stato vuoto.',
      quality: { level: 'yellow', reason: 'Fixture sintetica: richiede revisione operatore.' },
      extractedData: {
        diagnoses: [],
        medications: [],
      },
    },
  ];
}

async function createSyntheticPatient(page: Page, marker: string): Promise<string> {
  return page.evaluate(async (fixtureMarker) => {
    const response = await fetch('/api/patients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName: `Evidence${fixtureMarker.slice(0, 5)}`,
        lastName: `Stack${fixtureMarker.slice(5)}`,
        taxCode: `EST${fixtureMarker.padStart(13, '0')}`,
        birthDate: '1975-01-01T00:00:00.000Z',
        address: 'Indirizzo sintetico Evidence Stack',
        phone: '0000000080',
        diagnoses: [],
      }),
    });
    if (!response.ok) throw new Error(`Fixture paziente Evidence Stack: HTTP ${response.status}`);
    return (await response.json() as { id: string }).id;
  }, marker);
}

async function seedSyntheticInsights(page: Page, patientId: string, insights: SyntheticDocumentInsight[]): Promise<void> {
  await page.evaluate(async ({ id, nextInsights }) => {
    const currentResponse = await fetch(`/api/patients/${encodeURIComponent(id)}`);
    if (!currentResponse.ok) throw new Error(`Lettura fixture Evidence Stack: HTTP ${currentResponse.status}`);
    const current = await currentResponse.json() as { version?: number };
    if (typeof current.version !== 'number') throw new Error('Versione fixture Evidence Stack assente');

    // La route esercitata dalla curation cifra il payload client-side. Il seed usa
    // invece solo testo sintetico e l'API locale per predisporre lo stato iniziale.
    const updateResponse = await fetch(`/api/patients/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: current.version, documentInsights: JSON.stringify(nextInsights) }),
    });
    if (!updateResponse.ok) throw new Error(`Seed fixture Evidence Stack: HTTP ${updateResponse.status}`);
  }, { id: patientId, nextInsights: insights });
}

async function openDocumentSection(page: Page, patientId: string): Promise<void> {
  await page.goto(`/patients/${patientId}/modules`);
  const toggle = page.getByRole('button', { name: /Archivio documenti ed evidenze/ });
  await expect(toggle).toBeVisible();
  if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
}

test.describe.configure({ retries: 0 });

test('Evidence Stack web: fixture popolata, curation, empty ed errore restano verificabili', async ({ page }) => {
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  const marker = `${Date.now()}`.slice(-8);
  const patientId = await createSyntheticPatient(page, marker);
  const insights = buildSyntheticInsights(marker);
  await seedSyntheticInsights(page, patientId, insights);

  await openDocumentSection(page, patientId);
  const stack = page.getByText('Referti recenti', { exact: true }).locator('..');
  await expect(stack.getByText(insights[0].fileName, { exact: true })).toBeVisible();
  await expect(stack.getByText(insights[1].fileName, { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Archivio Intelligente', exact: true })).toBeVisible();
  await assertNoHorizontalOverflow(page, [
    { label: 'documento Evidence Stack popolato', selector: 'document' },
    { label: 'Evidence Stack popolato', selector: '.evidence-stack-tile' },
  ]);

  const archive = page.locator('.patient-detail-side-section', {
    has: page.getByRole('heading', { name: 'Archivio Intelligente', exact: true }),
  });
  const firstDocumentButton = archive.locator('button.flex-1').filter({ hasText: insights[0].fileName });
  await firstDocumentButton.click();
  await expect(archive).toContainText(insights[0].summary);
  const removeFirst = archive.getByRole('button', { name: `Rimuovi ${insights[0].fileName} dall'archivio intelligente` });
  await assertKeyboardFocusProgresses(page, removeFirst, 'rimozione singolo documento Evidence Stack');
  await removeFirst.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Rimuovi', exact: true }).click();
  await expect(archive.getByText(insights[0].fileName, { exact: true })).toHaveCount(0);
  await expect(archive.getByText(insights[1].fileName, { exact: true })).toBeVisible();

  const clearArchive = archive.getByRole('button', { name: 'Svuota archivio', exact: true });
  await clearArchive.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Svuota', exact: true }).click();
  await expect(page.getByText('Nessuna evidenza documentale in primo piano.', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Archivio Intelligente', exact: true })).toHaveCount(0);

  const errorMarker = `${Date.now()}`.slice(-8);
  const errorPatientId = await createSyntheticPatient(page, errorMarker);
  const errorInsights = buildSyntheticInsights(errorMarker).slice(0, 1);
  await seedSyntheticInsights(page, errorPatientId, errorInsights);
  await openDocumentSection(page, errorPatientId);
  await page.route(`**/api/patients/${errorPatientId}`, async (route) => {
    if (route.request().method() === 'PUT') {
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'synthetic-fixture-failure' }) });
      return;
    }
    await route.continue();
  });
  const errorArchive = page.locator('.patient-detail-side-section', {
    has: page.getByRole('heading', { name: 'Archivio Intelligente', exact: true }),
  });
  await errorArchive.getByRole('button', { name: `Rimuovi ${errorInsights[0].fileName} dall'archivio intelligente` }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Rimuovi', exact: true }).click();
  await expect(page.getByText('Aggiornamento non riuscito', { exact: true })).toBeVisible();
  await expect(errorArchive.getByText(errorInsights[0].fileName, { exact: true })).toBeVisible();
});

test('Evidence Stack web: loading ed empty hanno segnali distinti', async ({ page }) => {
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  const marker = `${Date.now()}`.slice(-8);
  const patientId = await createSyntheticPatient(page, marker);
  await page.route(`**/api/patients/${patientId}`, async (route) => {
    if (route.request().method() === 'GET') {
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
    await route.continue();
  });
  const navigation = page.goto(`/patients/${patientId}/modules`);
  await expect(page.getByText('Caricamento scheda paziente...', { exact: true })).toBeVisible();
  await navigation;

  const toggle = page.getByRole('button', { name: /Archivio documenti ed evidenze/ });
  if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
  await expect(page.getByText('Nessuna evidenza documentale in primo piano.', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Archivio Intelligente', exact: true })).toHaveCount(0);
});
