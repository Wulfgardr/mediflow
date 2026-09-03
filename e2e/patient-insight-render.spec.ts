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

test('patient insight renders stored markdown as read-only history without fallback', async ({ page }) => {
  const pin = process.env.E2E_PIN || '1234';
  const suffix = `${Date.now()}`.slice(-6);

  await bootstrapUnlockedSession(page, pin);

  // Other specs share this DB and may leave Patient Insight disabled; ensure it is on
  // so the saved historical summary renders instead of the disabled card.
  await page.evaluate(async () => {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'aiPatientInsightKillSwitch', value: 'enabled' }),
    });
  });

  const patientId = await createPatient(page, {
    firstName: `Insight${suffix}`,
    lastName: `Render${suffix}`,
    taxCode: `INSGHT80A01H5${suffix}Z`,
    birthDate: '1980-01-01T00:00:00.000Z',
    address: 'Via Test 3',
    phone: '3330001122',
  });

  // The insight parser (lib/ai-summary-service extractSection) recognises section
  // markers as **Titolo**: (colon outside the bold markers), not **Titolo:**.
  await updatePatient(page, patientId, {
    aiSummary: [
      '**Quadro attuale**: Follow-up post-dimissione ortopedica con programma riabilitativo domiciliare in corso. [S1]',
      '',
      '**Attenzioni**:',
      '- Mobilita ridotta con ausilio per la deambulazione. [S1]',
      '',
      '**Prossimi passi**:',
      '- Verificare avanzamento della FKT domiciliare. [S1]',
      '- Rivalutare controllo ortopedico programmato. [S1]',
    ].join('\n'),
  });

  // WUL-274/Kree8: the full AI insight lives on the primary Scheda route (/modules);
  // /patients/:id lands on the cockpit "Quadro" which does not host the insight card.
  await page.goto(`/patients/${patientId}/modules`);
  await expect(page).toHaveURL(new RegExp(`/patients/${patientId}/modules$`));
  const documents = page.getByRole('button', { name: /Documenti Archivio documenti ed evidenze/u });
  await expect(documents).toBeVisible({ timeout: 20_000 });
  if (await documents.getAttribute('aria-expanded') !== 'true') await documents.click();
  await expect(documents).toHaveAttribute('aria-expanded', 'true');

  // Saved summaries are historical Markdown in read-only mode. New structured
  // proposals have their own review-only surface and are covered separately.
  await expect(page.getByRole('heading', { name: 'Supporto al ragionamento clinico' })).toBeVisible();
  const historicalSummary = page.getByTestId('patient-insight-historical-summary');
  await expect(historicalSummary).toContainText('Riepilogo storico salvato · sola lettura');
  await expect(historicalSummary).toContainText('Quadro attuale');
  await expect(historicalSummary).toContainText('Attenzioni');
  await expect(historicalSummary).toContainText('Prossimi passi');
  await expect(historicalSummary).toContainText('programma riabilitativo domiciliare in corso');
  await expect(historicalSummary).toContainText('Mobilita ridotta con ausilio per la deambulazione.');
  await expect(historicalSummary).toContainText('Verificare avanzamento della FKT domiciliare.');
  await expect(page.getByTestId('patient-insight-review-proposal')).toHaveCount(0);
  await expect(page.getByText('Insight AI declassato per supporto insufficiente o incoerente nel contesto locale.')).toHaveCount(0);
});
