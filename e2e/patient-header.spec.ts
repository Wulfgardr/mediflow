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

// WUL-560: the canonical patient view is /patients/:id/modules. Its Scheda semantics
// expose the lead diagnosis separately in the Quadro region and the secondary coding
// in the Identita region. Keep every code, description and system assertion scoped to
// the current region so a duplicated or stale aggregate string cannot satisfy the test.
test('Scheda paziente renders coded diagnoses and an explicit no-diagnosis state', async ({ page }) => {
  const pin = process.env.E2E_PIN || '1234';
  const suffix = `${Date.now()}`.slice(-4);
  const diagnosisDescription = 'Disturbo depressivo maggiore, episodio singolo lieve';
  const secondaryDiagnosisDescription = 'Ipertensione essenziale primaria';

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
      {
        system: 'ICD-11',
        code: 'BA00',
        description: secondaryDiagnosisDescription,
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

  await page.goto(`/patients/${patientWithDiagnosisId}/modules`);
  await expect(page.getByText('Scheda clinica', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: `Header${suffix} Icd${suffix}`, exact: true })).toBeVisible();

  const quadro = page.getByRole('region', {
    name: 'Baseline e dati verificabili',
    exact: true,
  });
  await expect(quadro).toHaveCount(1);
  await expect(quadro.getByText('Problema guida', { exact: true })).toBeVisible();
  await expect(quadro.getByText('EF00', { exact: true })).toHaveCount(1);
  await expect(quadro.getByText(diagnosisDescription, { exact: true })).toHaveCount(1);
  await expect(quadro.getByText('ICD-11', { exact: true })).toHaveCount(1);

  const identitySection = page.locator('#identita');
  const leadDiagnosisCard = identitySection.locator('.patient-diagnosis-card');
  await expect(identitySection).toHaveCount(1);
  await expect(identitySection.getByRole('heading', { name: 'Quadro clinico', exact: true })).toHaveCount(1);
  await expect(leadDiagnosisCard).toHaveCount(1);
  await expect(leadDiagnosisCard.getByText('EF00', { exact: true })).toHaveCount(1);
  await expect(leadDiagnosisCard.getByText(diagnosisDescription, { exact: true })).toHaveCount(1);
  await expect(leadDiagnosisCard.getByText('ICD-11', { exact: true })).toHaveCount(1);

  /* @Codex: la lista secondaria espone ciascun codice come item autonomo e
     conserva codice, descrizione e sistema nel nome accessibile. */
  const secondaryDiagnosisList = page.getByRole('list', {
    name: 'Diagnosi codificate secondarie',
    exact: true,
  });
  const secondaryDiagnosisItem = secondaryDiagnosisList
    .getByRole('listitem')
    .filter({ hasText: secondaryDiagnosisDescription });
  await expect(secondaryDiagnosisList).toHaveCount(1);
  await expect(secondaryDiagnosisItem).toHaveCount(1);
  await expect(secondaryDiagnosisItem).not.toHaveAttribute('title');
  await expect(secondaryDiagnosisItem).toMatchAriaSnapshot(
    `- listitem: BA00 ${secondaryDiagnosisDescription} ICD-11`
  );

  await page.goto(`/patients/${patientWithoutDiagnosisId}/modules`);
  const emptyQuadro = page.getByRole('region', {
    name: 'Baseline e dati verificabili',
    exact: true,
  });
  await expect(emptyQuadro).toHaveCount(1);
  await expect(emptyQuadro.getByText('Problema guida', { exact: true })).toBeVisible();
  await expect(emptyQuadro.getByText('Nessuna diagnosi codificata in scheda.', { exact: true })).toHaveCount(1);
  await expect(emptyQuadro.getByText('EF00', { exact: true })).toHaveCount(0);
});
