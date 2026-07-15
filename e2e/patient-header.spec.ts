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

// WUL-274/Kree8: the patient header moved into the cockpit "Quadro" area
// (components/kree8/areas/real-patient-area.tsx, caption "Quadro paziente"). The old
// "Diagnosi in scheda" section with an "ICD-11 <code> · <desc>" label and an explicit
// "Nessuna codifica ICD" empty-state was superseded. The Quadro identity dock renders
// each diagnosis as a "<code> · <desc>" chip (patient-workspace parseDiagnosisLabels,
// no system prefix); for a diagnosis-free patient mapPatientForKree8 substitutes the
// "Profilo da completare" placeholder chip, which must be visible so the empty state
// cannot pass trivially when nothing renders.
test('patient header renders ICD chips and explicit empty state', async ({ page }) => {
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

  const diagnosisList = page.getByRole('list', {
    name: 'Diagnosi e stato del paziente',
    exact: true,
  });
  const diagnosisChip = diagnosisList
    .getByRole('listitem')
    .filter({ hasText: diagnosisDescription });

  /* @Codex: il chip e' una voce di lista nominata dal contenuto visibile.
     Il match esatto, lo snapshot ARIA e la cardinalita' esplicita evitano che
     un attributo non esposto o un duplicato rendano verde il contratto. */
  await page.goto(`/patients/${patientWithDiagnosisId}`);
  await expect(page.getByText('Quadro paziente')).toBeVisible();
  await expect(diagnosisList).toHaveCount(1);
  await expect(diagnosisChip).toHaveCount(1);
  await expect(diagnosisChip).toBeVisible();
  await expect(diagnosisChip).toHaveCSS('min-width', '0px');
  await expect(diagnosisChip).toHaveCSS('max-width', '100%');
  await expect(diagnosisChip).toContainText('EF00');
  await expect(diagnosisChip).toContainText(diagnosisDescription);
  await expect(diagnosisChip).toMatchAriaSnapshot(
    `- listitem: EF00 ${diagnosisDescription}`
  );

  await page.reload();
  await expect(diagnosisChip).toHaveCount(1);
  await expect(diagnosisChip).toBeVisible();

  /* @Codex: la lente clinica deve lasciare il listitem senza nome d'autore e
     conservare codice, descrizione e sistema nel contenuto accessibile. */
  await page.goto(`/patients/${patientWithDiagnosisId}/modules`);
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

  await page.goto(`/patients/${patientWithoutDiagnosisId}`);
  await expect(page.getByText('Quadro paziente')).toBeVisible();
  await expect(page.getByText('Profilo da completare')).toBeVisible();
  await expect(diagnosisChip).toHaveCount(0);
});
