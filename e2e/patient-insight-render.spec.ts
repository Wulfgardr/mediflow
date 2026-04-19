/* @Codex */
import { expect, test, type Page } from '@playwright/test';
import { bootstrapUnlockedSession } from './utils';

async function createPatient(
  page: Page,
  payload: Record<string, unknown>
): Promise<string> {
  return await page.evaluate(async (body: Record<string, unknown>) => {
    const response = await fetch('/api/patients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Failed to create patient: ${response.status}`);
    }

    const data = await response.json() as { id: string };
    return data.id;
  }, payload);
}

async function updatePatient(
  page: Page,
  patientId: string,
  payload: Record<string, unknown>
): Promise<void> {
  await page.evaluate(async ({ id, body }: { id: string; body: Record<string, unknown> }) => {
    const currentResponse = await fetch(`/api/patients/${id}`);
    if (!currentResponse.ok) {
      throw new Error(`Failed to load patient: ${currentResponse.status}`);
    }

    const current = await currentResponse.json() as { version?: number };
    const response = await fetch(`/api/patients/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...body,
        version: current.version,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to update patient: ${response.status}`);
    }
  }, { id: patientId, body: payload });
}

test('patient insight renders structured stored markdown without fallback', async ({ page }) => {
  const pin = process.env.E2E_PIN || '1234';
  const suffix = `${Date.now()}`.slice(-6);

  await bootstrapUnlockedSession(page, pin);

  const patientId = await createPatient(page, {
    firstName: `Insight${suffix}`,
    lastName: `Render${suffix}`,
    taxCode: `INSGHT80A01H5${suffix}Z`,
    birthDate: '1980-01-01T00:00:00.000Z',
    address: 'Via Test 3',
    phone: '3330001122',
  });

  await updatePatient(page, patientId, {
    aiSummary: [
      '**Quadro attuale:** Follow-up post-dimissione ortopedica con programma riabilitativo domiciliare in corso. [S1]',
      '',
      '**Attenzioni:**',
      '- Mobilita ridotta con ausilio per la deambulazione. [S1]',
      '',
      '**Prossimi passi:**',
      '- Verificare avanzamento della FKT domiciliare. [S1]',
      '- Rivalutare controllo ortopedico programmato. [S1]',
    ].join('\n'),
  });

  await page.goto(`/patients/${patientId}`);
  await expect(page).toHaveURL(new RegExp(`/patients/${patientId}$`));

  await expect(page.getByRole('heading', { name: 'Insight clinico AI' })).toBeVisible();
  await expect(page.getByText('Prossimi passi')).toBeVisible();
  await expect(page.getByText('Attenzioni')).toBeVisible();
  await expect(page.getByText('Quadro Clinico')).toBeVisible();
  await expect(page.getByText('programma riabilitativo domiciliare in corso', { exact: false })).toBeVisible();
  await expect(page.getByText('Mobilita ridotta con ausilio per la deambulazione.', { exact: false })).toBeVisible();
  await expect(page.getByText('Verificare avanzamento della FKT domiciliare.', { exact: false })).toBeVisible();
  await expect(page.getByText('Insight AI declassato per supporto insufficiente o incoerente nel contesto locale.')).toHaveCount(0);
});
