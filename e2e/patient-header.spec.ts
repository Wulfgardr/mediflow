/* @Codex */
import { expect, test, type Page } from '@playwright/test';
import { bootstrapUnlockedSession, openPatientSection } from './utils';

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
// expose the lead diagnosis in Riepilogo clinico and the secondary coding in
// Clinica. Keep every code, description and system assertion scoped to
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
  await expect(page.getByRole('heading', { name: `Header${suffix} Icd${suffix}`, exact: true })).toBeVisible();
  const summaryLink = page.getByRole('navigation', { name: 'Sezioni della vista', exact: true })
    .getByRole('link', { name: 'Riepilogo', exact: true });
  await summaryLink.click();
  await expect(summaryLink).toHaveAttribute('aria-current', 'location');

  const quadro = page.getByRole('region', {
    name: 'Riepilogo clinico',
    exact: true,
  });
  await expect(quadro).toHaveCount(1);
  await expect(quadro).toBeVisible();
  await expect(quadro.getByRole('heading', { name: 'Quadro clinico', exact: true })).toBeVisible();
  await expect(quadro.getByText('EF00 · ICD-11 · altre 1 diagnosi', { exact: true })).toHaveCount(1);
  await expect(quadro.getByText(diagnosisDescription, { exact: true })).toHaveCount(1);

  await openPatientSection(page, 'clinica');
  const clinicalSection = page.locator('#clinica');
  const diagnosesList = clinicalSection.getByRole('list', {
    name: 'Diagnosi registrate',
    exact: true,
  });
  const leadDiagnosis = diagnosesList.getByRole('listitem').filter({
    hasText: diagnosisDescription,
  });
  await expect(clinicalSection).toHaveCount(1);
  await expect(diagnosesList).toHaveCount(1);
  await expect(leadDiagnosis).toHaveCount(1);
  await expect(leadDiagnosis).toContainText(diagnosisDescription);
  await expect(leadDiagnosis).toContainText('EF00 · ICD-11');

  /* @Codex: la lista clinica espone ciascun codice come item autonomo e
     conserva codice, descrizione e sistema nel suo contenuto. */
  const secondaryDiagnosisItem = diagnosesList
    .getByRole('listitem')
    .filter({ hasText: secondaryDiagnosisDescription });
  await expect(secondaryDiagnosisItem).toHaveCount(1);
  await expect(secondaryDiagnosisItem).toContainText(secondaryDiagnosisDescription);
  await expect(secondaryDiagnosisItem).toContainText('BA00 · ICD-11');
  await expect(secondaryDiagnosisItem).not.toHaveAttribute('title');
  await expect(secondaryDiagnosisItem).toMatchAriaSnapshot(
    `- listitem:
  - strong: ${secondaryDiagnosisDescription}
  - text: BA00 · ICD-11`
  );

  await page.goto(`/patients/${patientWithoutDiagnosisId}/modules`);
  await summaryLink.click();
  await expect(summaryLink).toHaveAttribute('aria-current', 'location');
  const emptyQuadro = page.getByRole('region', {
    name: 'Riepilogo clinico',
    exact: true,
  });
  await expect(emptyQuadro).toHaveCount(1);
  await expect(emptyQuadro).toBeVisible();
  await expect(emptyQuadro.getByRole('heading', { name: 'Quadro clinico', exact: true })).toBeVisible();
  await expect(emptyQuadro).toContainText('Diagnosi non registrata.');
  await expect(emptyQuadro.getByRole('link', { name: 'Consulta le diagnosi', exact: true }))
    .toHaveAttribute('href', '#clinica');
  await expect(emptyQuadro).not.toContainText('EF00');
  await expect(emptyQuadro).not.toContainText(diagnosisDescription);
  await expect(emptyQuadro).not.toContainText('ICD-11');
});
