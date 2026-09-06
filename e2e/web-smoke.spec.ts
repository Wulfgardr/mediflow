/* @Codex */
import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { bootstrapUnlockedSession, openPatientSection } from './utils';

/* @Codex: ordinary UI smoke observes every console error and uncaught page error. */
const errorsByPage = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  errorsByPage.set(page, errors);
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', error => errors.push(error.message));
});
test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status !== 'passed') {
    await testInfo.attach('smoke-focus-context.json', {
      contentType: 'application/json',
      body: JSON.stringify(await page.evaluate(() => ({
        route: location.pathname + location.search + location.hash,
        viewport: { width: innerWidth, height: innerHeight },
        activeElement: document.activeElement ? {
          tag: document.activeElement.tagName,
          id: document.activeElement.id,
          role: document.activeElement.getAttribute('role'),
          label: document.activeElement.getAttribute('aria-label'),
        } : null,
        headings: Array.from(document.querySelectorAll('h1')).map(element => ({
          text: element.textContent, tabIndex: element.tabIndex,
          focused: element === document.activeElement, rect: element.getBoundingClientRect().toJSON(),
        })),
      }))),
    });
  }
  expect(errorsByPage.get(page)).toEqual([]);
});

test('web smoke: unlock/setup + patients filters + settings navigation', async ({ page }) => {
  const pin = process.env.E2E_PIN || '1234';

  // @Codex WUL-55: the locked surface stays terse while retaining an accessible field name.
  await page.goto('/');
  const lockScreen = page.getByLabel('MediFlow lock screen');
  await expect(lockScreen).toBeVisible();
  await expect(lockScreen.getByRole('heading', { name: 'Sblocca MediFlow' })).toBeVisible();
  await expect(lockScreen.getByText(/sessione protetta/i)).toHaveCount(0);
  await expect(lockScreen.getByText(/inserisci (il )?pin/i)).toHaveCount(0);
  await expect(lockScreen.getByText('PIN operatore', { exact: true })).toHaveClass(/sr-only/);
  await expect(lockScreen.getByLabel('PIN operatore')).toBeVisible();

  await bootstrapUnlockedSession(page, pin);

  // WUL-274/Kree8: the patients list moved into the cockpit "incarico" area
  // (components/kree8/areas/incarico-area.tsx). The cockpit toolbar exposes a
  // "Cerca nella lista pazienti" trigger (components/kree8/cockpit-shared.tsx)
  // that focuses the incarico search field (aria-label "Cerca nella lista pazienti").
  await page.getByRole('button', { name: 'Cerca nella lista pazienti' }).click();
  const patientsSearch = page.getByRole('searchbox', { name: 'Cerca nella lista pazienti' });
  await expect(patientsSearch).toBeVisible({ timeout: 20_000 });

  // Scope chips ("Attivi" / "Archivio") replaced the old view-mode toggles.
  await page.getByRole('button', { name: 'Archivio' }).click();
  await expect(page.getByRole('button', { name: 'Archivio' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Attivi' }).click();
  await expect(page.getByRole('button', { name: 'Attivi' })).toHaveAttribute('aria-pressed', 'true');
  await patientsSearch.fill('smoke');
  await patientsSearch.fill('');

  // @Codex ADR 0123: the ordinary settings link owns the canonical /settings route.
  const settingsNav = page.getByRole('link', { name: 'Impostazioni', exact: true });
  await expect(settingsNav).toBeVisible();
  await expect(settingsNav).toHaveAttribute('href', '/settings');
  await settingsNav.focus();
  await expect(settingsNav).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole('heading', { name: 'Impostazioni', level: 1, exact: true })).toBeVisible();
  await expect(page.getByTestId('settings-overview-section')).toBeVisible();

  // WUL-297: the detailed appearance controls still live on the /settings/aspetto route.
  await page.getByRole('link', { name: 'Apri aspetto', exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/aspetto$/);
  await expect(page.getByTestId('settings-nav-sidebar')).toBeVisible();
  await expect(page.getByTestId('settings-appearance-section')).toBeVisible();
  await expect(page.getByTestId('ui-style-runtime-notice')).toBeVisible();
  await expect(page.getByTestId('ui-accessibility-controls')).toBeVisible();

  // @Codex ADR 0123: the persistent primary navigation owns the return to patients.
  const returnToPatients = page.getByRole('navigation', { name: 'Navigazione principale', exact: true })
    .getByRole('link', { name: 'Pazienti', exact: true });
  await expect(returnToPatients).toHaveAttribute('href', '/?area=incarico');
  await returnToPatients.focus();
  await expect(returnToPatients).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/[?&]area=incarico/);
  await expect(page.getByRole('heading', { name: 'Pazienti in carico', level: 1, exact: true })).toBeVisible();
  await expect(patientsSearch).toBeVisible();
});

/* @Codex */
test('web smoke: Rivedi agenda focuses its controlled heading without leaving turno', async ({ page }) => {
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  await page.goto('/?area=turno');

  const reviewAgenda = page.getByRole('button', { name: 'Rivedi agenda', exact: true });
  const agendaHeading = page.getByRole('heading', { name: 'Appuntamenti', exact: true, level: 2 });

  await expect(reviewAgenda).toBeVisible();
  await expect(reviewAgenda).toHaveAttribute('aria-controls', 'turno-agenda-heading');
  await expect(agendaHeading).toHaveAttribute('id', 'turno-agenda-heading');

  await reviewAgenda.focus();
  await expect(reviewAgenda).toBeFocused();

  await page.keyboard.press('Enter');

  await expect(agendaHeading).toBeFocused();
  await expect(agendaHeading).toBeInViewport();
  await expect(page).toHaveURL(/[?&]area=turno(?:&|$)/);
});

/* @Codex ADR 0123: exercise the declared live destinations with API-created
   identities; the standalone review's AI queue and hidden lens are not product controls. */
test('web smoke: live decision CTAs always open their declared patient context', async ({ page }) => {
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  const marker = randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase();
  const createPatient = async (firstName: string, exemptions: string[]) => {
    const lastName = `Smoke${marker}`;
    const taxCode = `SMK${firstName[0]}${marker}00`;
    const response = await page.request.post('/api/patients', { data: {
      firstName, lastName, taxCode, birthDate: '1980-01-01T00:00:00.000Z', exemptions,
      notes: `Contesto sintetico ${firstName}. Nessun dato reale.`, diagnoses: [],
    } });
    expect(response.status()).toBe(201);
    const patient = await response.json() as { id: string };
    return { id: patient.id, name: `${lastName} ${firstName}`, taxCode };
  };
  const quadroPatient = await createPatient('Quadro', []);
  const documentsPatient = await createPatient('Documenti', ['031']);
  // Put the fixture within the ordinary 50-row diary window without changing any clock.
  const latest = await page.request.get('/api/entries?limit=1&orderBy=date&orderDir=desc');
  expect(latest.status()).toBe(200);
  const rows = await latest.json() as Array<{ date: string }>;
  const date = new Date(Math.max(Date.now(), ...rows.map(row => Date.parse(row.date)).filter(Number.isFinite)) + 1_000).toISOString();
  const entryTitle = `Follow-up sintetico ${marker}`;
  const entryResponse = await page.request.post('/api/entries', { data: {
    patientId: quadroPatient.id, type: 'note', title: entryTitle,
    content: 'Voce sintetica per verificare la destinazione della CTA.', date, setting: 'ambulatory',
  } });
  expect(entryResponse.status()).toBe(201);
  const entry = await entryResponse.json() as { id: string; version: number };

  await page.goto(`/?area=turno&paziente=${documentsPatient.id}`);
  const navigation = page.getByRole('navigation', { name: 'Navigazione principale', exact: true });
  await expect(page.getByRole('button', { name: 'Vai alla revisione', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Apri esenzioni', exact: true })).toHaveCount(0);

  const review = page.getByRole('button', { name: 'Apri revisione', exact: true });
  await review.focus();
  await expect(review).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Evidenza, decisione e prossimo passo', level: 1, exact: true })).toBeFocused();
  await expect(page).toHaveURL(new RegExp(`[?&]area=revisione&.*paziente=${documentsPatient.id}`));
  await expect(page.getByTestId('lume-review-case').getByRole('heading', { name: documentsPatient.name, exact: true })).toBeVisible();
  const documents = page.getByRole('link', { name: 'Apri documenti', exact: true });
  await expect(documents).toHaveAttribute('href', `/patients/${documentsPatient.id}/modules#documenti`);
  await documents.focus();
  await expect(documents).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/patients/${documentsPatient.id}/modules#documenti$`));
  await expect(page.locator('#documenti')).toHaveAttribute('data-folder-active', 'true');
  await expect(page.getByRole('heading', { name: documentsPatient.name, level: 1, exact: true })).toBeVisible();

  await navigation.getByRole('link', { name: 'Agenda', exact: true }).click();
  await page.getByRole('button', { name: 'Vai ai pazienti', exact: true }).click();
  await expect(navigation.getByRole('link', { name: 'Pazienti', exact: true })).toHaveAttribute('aria-current', 'page');
  const patientsSearch = page.getByRole('searchbox', { name: 'Cerca nella lista pazienti' });
  await patientsSearch.fill(documentsPatient.taxCode);
  const patientRow = page.getByRole('option').filter({ has: page.getByText(documentsPatient.name, { exact: true }) });
  await expect(patientRow).toBeVisible();
  await patientRow.focus();
  await expect(patientRow).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/patients/${documentsPatient.id}/modules$`));
  await expect(page.getByTestId('lume-scheda-header')).toContainText(documentsPatient.taxCode);
  await openPatientSection(page, 'identita');
  await expect(page.locator('#identita')).toContainText('031');

  // The diary row selects its own patient even though the previous record was different.
  await navigation.getByRole('link', { name: 'Diario', exact: true }).click();
  const diaryEntry = page.getByTestId('lume-diario-entry').filter({ has: page.getByRole('heading', { name: entryTitle, exact: true }) });
  await expect(diaryEntry).toContainText(quadroPatient.name);
  const openQuadro = diaryEntry.getByRole('button', { name: 'Apri quadro', exact: true });
  await openQuadro.focus();
  await expect(openQuadro).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/patients/${quadroPatient.id}/modules#quadro$`));
  await expect(page.locator('#quadro')).toHaveAttribute('data-folder-active', 'true');
  await expect(page.getByRole('heading', { name: quadroPatient.name, level: 1, exact: true })).toBeFocused();
  await expect(page.getByTestId('lume-scheda-header')).toContainText(quadroPatient.taxCode);
  await expect(page.getByRole('region', { name: 'Riepilogo clinico', exact: true })).toContainText('Contesto sintetico Quadro.');

  // Retire only records created here through the versioned, supported endpoints.
  const removedEntry = await page.request.delete(`/api/entries/${entry.id}`, { data: { version: entry.version } });
  expect(removedEntry.status()).toBe(200);
  for (const resource of [`/api/patients/${documentsPatient.id}`, `/api/patients/${quadroPatient.id}`]) {
    const current = await page.request.get(resource);
    expect(current.status()).toBe(200);
    const { version } = await current.json() as { version: number };
    const removed = await page.request.delete(resource, { data: { version } });
    expect(removed.status()).toBe(200);
  }
});
