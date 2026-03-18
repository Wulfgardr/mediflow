/* @Codex */
import { expect, test } from '@playwright/test';
import { bootstrapUnlockedSession } from './utils';

async function createPatient(
  page: Parameters<typeof test>[0]['page'],
  payload: Record<string, unknown>
): Promise<string> {
  return await page.evaluate(async (body) => {
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

test('patient header renders ICD chips and explicit empty state', async ({ page }) => {
  const pin = process.env.E2E_PIN || '1234';
  const suffix = `${Date.now()}`.slice(-4);
  const diagnosisDescription = 'Disturbo depressivo maggiore, episodio singolo lieve';

  await bootstrapUnlockedSession(page, pin);

  const patientWithDiagnosisId = await createPatient(page, {
    firstName: `Icd${suffix}`,
    lastName: `Header${suffix}`,
    taxCode: `HDRICD80A01H5${suffix}Z`,
    birthDate: '1980-01-01T00:00:00.000Z',
    address: 'Via Test 1',
    phone: '3331234567',
    diagnoses: [
      {
        system: 'ICD-11',
        code: 'EF00',
        description: diagnosisDescription,
        date: new Date().toISOString(),
      },
    ],
  });

  const patientWithoutDiagnosisId = await createPatient(page, {
    firstName: `Empty${suffix}`,
    lastName: `Header${suffix}`,
    taxCode: `HDREMY80A01H5${suffix}Y`,
    birthDate: '1980-01-01T00:00:00.000Z',
    address: 'Via Test 2',
    phone: '3337654321',
    diagnoses: [],
  });

  await page.goto(`/patients/${patientWithDiagnosisId}`);
  await expect(page.getByText('Diagnosi in scheda')).toBeVisible();
  await expect(page.getByText(`ICD-11 EF00 · ${diagnosisDescription}`)).toBeVisible();

  await page.reload();
  await expect(page.getByText(`ICD-11 EF00 · ${diagnosisDescription}`)).toBeVisible();

  await page.goto(`/patients/${patientWithoutDiagnosisId}`);
  await expect(page.getByText('Diagnosi in scheda')).toBeVisible();
  await expect(page.getByText('Nessuna codifica ICD associata alla scheda.')).toBeVisible();
});
