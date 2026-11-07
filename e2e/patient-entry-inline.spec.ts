import { expect, test } from '@playwright/test';
import { bootstrapUnlockedSession } from './utils';

for (const width of [1440, 390]) test(`le allergie strutturate restano nella testata durante la scrittura inline a ${width}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 960 });
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  const patient = await page.evaluate(async () => {
    const response = await fetch('/api/patients', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ firstName: 'Allergie', lastName: 'Inline sintetica', birthDate: '1980-01-01', taxCode: crypto.randomUUID() }) });
    if (!response.ok) throw new Error(`Paziente sintetico: ${response.status}`);
    return response.json() as Promise<{ id: string }>;
  });
  await page.goto(`/patients/${patient.id}/edit`);
  await page.getByRole('button', { name: 'Aggiungi allergia', exact: true }).click();
  await page.getByLabel('Sostanza *', { exact: true }).fill('Amoxicillina sintetica');
  await page.getByRole('button', { name: 'Aggiorna scheda', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/patients/${patient.id}/modules$`));
  const header = page.getByTestId('lume-scheda-header');
  const allergies = header.getByRole('list', { name: 'Allergie', exact: true });
  await expect(allergies).toContainText('▲ Amoxicillina sintetica');
  await page.goto(`/patients/${patient.id}/entries/new`);
  await expect(page.getByTestId('progressive-entry-composer').getByRole('list', { name: 'Allergie', exact: true })).toContainText('Amoxicillina sintetica');
  await page.goto(`/patients/${patient.id}/modules`);
  await header.getByRole('link', { name: 'Nuova voce', exact: true }).click();
  const editor = page.getByRole('textbox', { name: 'Resoconto clinico', exact: true });
  await editor.fill('Bozza sintetica con allergia strutturata visibile.');
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => {
      localStorage.setItem('mediflow-theme', value);
      document.documentElement.classList.remove('light', 'dark');
      document.documentElement.classList.add(value);
    }, theme);
    await editor.scrollIntoViewIfNeeded();
    await expect(allergies).toHaveCount(1);
    await expect(allergies).toContainText('▲ Amoxicillina sintetica');
    await expect.poll(() => allergies.evaluate(element => {
      const box = element.getBoundingClientRect();
      return box.top >= 0 && box.bottom <= innerHeight && box.left >= 0 && box.right <= innerWidth;
    })).toBe(true);
    await expect(editor).toHaveText('Bozza sintetica con allergia strutturata visibile.');
  }
  await page.getByTestId('privacy-mode-header-toggle').click();
  await expect(allergies.locator('.liquid-blur')).toHaveCount(1);
});

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
  await expect(page).toHaveURL(new RegExp(`/patients/${patient.id}/modules#diario$`));
  await expect(page.locator('#diario article')).toBeVisible();
  await expect(page.locator('#diario article')).toContainText('Resoconto sintetico scritto nella scheda.');
  const saved = await read();
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({ patientId: patient.id, version: 1, type: 'visit', setting: 'ambulatory' });
  await page.getByRole('link', { name: 'Nuova voce', exact: true }).click();
  await editor.fill('Seconda voce sintetica nella stessa scheda.');
  await page.getByRole('button', { name: 'Registra nel diario', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/patients/${patient.id}/modules#diario$`));
  await expect(page.locator('#diario article').filter({ hasText: 'Seconda voce sintetica nella stessa scheda.' })).toBeVisible();
  expect(await read()).toHaveLength(2);
});

test('la voce inline dichiara il diario non leggibile senza perdere la bozza', async ({ page }) => {
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  const patient = await page.evaluate(async () => {
    const response = await fetch('/api/patients', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ firstName: 'Diario', lastName: 'Non disponibile sintetico', birthDate: '1980-01-01', taxCode: crypto.randomUUID() }) });
    if (!response.ok) throw new Error(`Paziente sintetico: ${response.status}`);
    return response.json() as Promise<{ id: string }>;
  });
  await page.route('**/api/entries?**', route => route.fulfill({ status: 503, json: { error: 'Diario sintetico non leggibile' } }));
  await page.goto(`/patients/${patient.id}/modules#diario`);
  await page.getByRole('link', { name: 'Nuova voce', exact: true }).click();
  const editor = page.getByRole('textbox', { name: 'Resoconto clinico', exact: true });
  await editor.fill('Bozza sintetica conservata durante il guasto del diario.');
  const alert = page.getByRole('alert').filter({ hasText: 'Voci precedenti non disponibili.' });
  await expect(alert).toBeVisible();
  await expect(alert).toContainText('✕');
  await expect(alert).toHaveAttribute('data-view-state', 'error');
  await expect(editor).toHaveText('Bozza sintetica conservata durante il guasto del diario.');
});
