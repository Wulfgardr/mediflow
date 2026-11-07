import { expect, test } from '@playwright/test';
import { bootstrapUnlockedSession, openPatientSection } from './utils';

test('la voce nella scheda conserva la bozza dopo un rifiuto e registra sul paziente scelto', async ({ page }) => {
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  const patient = await page.evaluate(async () => {
    const response = await fetch('/api/patients', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ firstName: 'Voce', lastName: 'Inline sintetica', birthDate: '1980-01-01', taxCode: crypto.randomUUID() }) });
    if (!response.ok) throw new Error(`Paziente sintetico: ${response.status}`);
    return response.json() as Promise<{ id: string }>;
  });
  await page.goto(`/patients/${patient.id}/modules#terapie`);
  await page.getByRole('link', { name: 'Nuova voce', exact: true }).click();
  const editor = page.getByRole('textbox', { name: 'Resoconto clinico', exact: true });
  await editor.fill('Resoconto sintetico scritto nella scheda.');
  await page.route('**/api/entries', route => route.request().method() === 'POST'
    ? route.fulfill({ status: 400, json: { error: 'Rifiuto sintetico della voce' } })
    : route.continue());
  await page.getByRole('button', { name: 'Registra nel diario', exact: true }).click();
  await expect(page.getByText('Errore durante il salvataggio', { exact: true })).toBeVisible();
  await expect(editor).toHaveText('Resoconto sintetico scritto nella scheda.');
  const read = () => page.evaluate(async id => (await fetch(`/api/entries?patientId=${id}`)).json(), patient.id);
  expect(await read()).toEqual([]);
  await page.unroute('**/api/entries');
  await page.getByRole('button', { name: 'Registra nel diario', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/patients/${patient.id}/modules$`));
  await openPatientSection(page, 'diario');
  await expect(page.locator('#diario article')).toContainText('Resoconto sintetico scritto nella scheda.');
  const saved = await read();
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({ patientId: patient.id, version: 1, type: 'visit', setting: 'ambulatory' });
});
