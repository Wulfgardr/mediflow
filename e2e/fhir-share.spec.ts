/* @Codex */
import { expect, test, type Page } from '@playwright/test';
import { bootstrapUnlockedSession } from './utils';

type ShareOutcome = 'success' | 'abort' | 'failure';

async function createSyntheticPatient(page: Page): Promise<{ id: string; name: string }> {
  const marker = `${Date.now()}`.slice(-8);
  return page.evaluate(async (suffix) => {
    const firstName = `FHIR${suffix}`;
    const lastName = `Sintetico${suffix}`;
    const response = await fetch('/api/patients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName,
        lastName,
        taxCode: `FHR${suffix.padStart(13, '0')}`,
        birthDate: '1980-01-01T00:00:00.000Z',
        address: 'Indirizzo sintetico FHIR',
        phone: '0000000081',
        diagnoses: [],
      }),
    });
    if (!response.ok) throw new Error(`Fixture FHIR: HTTP ${response.status}`);
    const { id } = await response.json() as { id: string };
    return { id, name: `${lastName} ${firstName}` };
  }, marker);
}

async function installShareCapability(page: Page, outcome: ShareOutcome): Promise<void> {
  await page.addInitScript((selectedOutcome) => {
    Object.defineProperty(navigator, 'canShare', {
      configurable: true,
      value: (data: ShareData) => Array.isArray(data.files) && data.files.length === 1,
    });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (data: ShareData) => {
        (window as Window & { __fhirShare?: { fileName: string; title?: string } }).__fhirShare = {
          fileName: data.files?.[0]?.name ?? '',
          title: data.title,
        };
        if (selectedOutcome === 'abort') throw new DOMException('System share dismissed', 'AbortError');
        if (selectedOutcome === 'failure') throw new DOMException('System share unavailable', 'NotAllowedError');
      },
    });
  }, outcome);
}

async function installUnavailableShareCapability(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'canShare', {
      configurable: true,
      value: () => false,
    });
  });
}

for (const outcome of ['success', 'abort', 'failure'] as const) {
  test(`Condividi FHIR capability-gated: ${outcome}`, async ({ page }) => {
    await installShareCapability(page, outcome);
    await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
    const patient = await createSyntheticPatient(page);
    await page.goto(`/patients/${patient.id}/modules`);

    await page.getByRole('button', { name: 'Azioni', exact: true }).click();
    const actionsMenu = page.getByRole('group', { name: 'Azioni scheda', exact: true });
    await expect(actionsMenu).toBeVisible();
    const share = actionsMenu.getByRole('button', { name: 'Condividi FHIR', exact: true });
    await expect(share).toBeVisible();
    await share.click();

    if (outcome === 'failure') {
      await expect.poll(async () => page.evaluate(() =>
        (window as Window & { __fhirShare?: { fileName: string; title?: string } }).__fhirShare,
      )).toMatchObject({
        fileName: `patient-${patient.name.replace(' ', '-')}-fhir.json`,
        title: `FHIR ${patient.name}`,
      });
      await expect(page.getByText('Errore durante la condivisione.', { exact: true })).toBeVisible();
      return;
    }

    await expect.poll(async () => page.evaluate(() =>
      (window as Window & { __fhirShare?: { fileName: string; title?: string } }).__fhirShare,
    )).toMatchObject({
      fileName: `patient-${patient.name.replace(' ', '-')}-fhir.json`,
      title: `FHIR ${patient.name}`,
    });
    await expect(page.getByText('Errore durante la condivisione.', { exact: true })).toHaveCount(0);
  });
}

test('Condividi FHIR resta assente quando il browser non accetta file', async ({ page }) => {
  await installUnavailableShareCapability(page);
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  const patient = await createSyntheticPatient(page);
  await page.goto(`/patients/${patient.id}/modules`);

  await page.getByRole('button', { name: 'Azioni', exact: true }).click();
  const actionsMenu = page.getByRole('group', { name: 'Azioni scheda', exact: true });
  await expect(actionsMenu).toBeVisible();
  await expect(actionsMenu.getByRole('button', { name: 'Condividi FHIR', exact: true })).toHaveCount(0);
});
